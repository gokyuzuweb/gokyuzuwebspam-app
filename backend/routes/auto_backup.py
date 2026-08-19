"""v43.99.11 — Auto Weekly DB Backup + Restore.

Haftalık otomatik MongoDB snapshot alan modül. `settings`, `licenses`,
`idle_lock_user_configs`, `notifications` gibi kritik koleksiyonları
JSON.gz dosyasına indirir. Master gerektiğinde geri yükleyebilir.

Snapshot yolu: /app/backups/backup-YYYY-MM-DD-HHMMSS.json.gz
Retention: son 8 snapshot (yaklaşık 2 ay)
"""
from __future__ import annotations
import os
import gzip
import json
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/backups", tags=["backups"])

BACKUP_DIR = Path("/app/backups")
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
RETENTION = 8

# Kritik koleksiyonlar (varsayılan snapshot içeriği)
CRITICAL_COLLECTIONS = [
    "settings",
    "licenses",
    "idle_lock_user_configs",
    "trusted_ips",
    "pin_change_requests",
    "reseller_branding",
    "notifications_inbox",
    "email_templates",
    "engines",
    "rules",
    "lists",
    "webhooks",
    "checkout_orders",
    "payments",
]


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


def _is_master(request: Request) -> bool:
    k = request.headers.get("x-master-key") or ""
    return bool(MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY)


async def _do_snapshot(collections: Optional[List[str]] = None) -> dict:
    """Actual snapshot logic — can be called from HTTP or scheduler."""
    cols = collections or CRITICAL_COLLECTIONS
    ts = datetime.now(timezone.utc)
    fname = f"backup-{ts.strftime('%Y-%m-%d-%H%M%S')}.json.gz"
    fpath = BACKUP_DIR / fname

    payload = {
        "version": "v43.99.11",
        "generated_at": _iso(),
        "collections": {},
        "counts": {},
    }
    total = 0
    for cn in cols:
        try:
            docs = await db[cn].find({}, {"_id": 0}).to_list(length=None)
            payload["collections"][cn] = docs
            payload["counts"][cn] = len(docs)
            total += len(docs)
        except Exception as e:
            payload["collections"][cn] = []
            payload["counts"][cn] = f"error: {str(e)[:60]}"

    # Yaz + gz
    with gzip.open(fpath, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, default=str)

    size_bytes = fpath.stat().st_size

    # Retention: en eski dosyaları sil
    all_backups = sorted(BACKUP_DIR.glob("backup-*.json.gz"),
                         key=lambda p: p.stat().st_mtime, reverse=True)
    removed: List[str] = []
    for p in all_backups[RETENTION:]:
        try:
            p.unlink()
            removed.append(p.name)
        except Exception:
            pass

    # DB'ye meta kaydet
    meta = {
        "id": str(uuid.uuid4()),
        "filename": fname,
        "path": str(fpath),
        "size_bytes": size_bytes,
        "total_docs": total,
        "counts": payload["counts"],
        "collections": list(payload["collections"].keys()),
        "created_at": _iso(),
        "expires_after_snapshots": RETENTION,
    }
    await db.backup_snapshots.insert_one(meta)

    return {
        "filename": fname,
        "size_bytes": size_bytes,
        "size_kb": round(size_bytes / 1024, 1),
        "total_docs": total,
        "counts": payload["counts"],
        "retained_backups": len(all_backups) - len(removed),
        "removed_old": removed,
    }


@router.post("/snapshot")
async def create_snapshot(request: Request, collections: Optional[str] = None):
    """Master: hemen bir snapshot al. `collections=col1,col2` ile filtre uygulanabilir."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    cols = [c.strip() for c in collections.split(",")] if collections else None
    result = await _do_snapshot(cols)
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "backup_snapshot_created",
            "actor_ip": _client_ip(request),
            "details": {"filename": result["filename"], "total_docs": result["total_docs"]},
            "at": _iso(), "severity": "info",
        })
    except Exception:
        pass
    return {"ok": True, **result}


@router.get("/list")
async def list_snapshots(request: Request):
    """Master: mevcut tüm snapshot'ları listeler (dosya sistemi + DB meta)."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    files = sorted(BACKUP_DIR.glob("backup-*.json.gz"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    metas = await db.backup_snapshots.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    meta_by_fn = {m["filename"]: m for m in metas}
    items = []
    for f in files:
        st = f.stat()
        m = meta_by_fn.get(f.name, {})
        items.append({
            "filename": f.name,
            "size_bytes": st.st_size,
            "size_kb": round(st.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            "total_docs": m.get("total_docs"),
            "collections": m.get("collections"),
        })
    return {"items": items, "count": len(items), "retention": RETENTION}


@router.get("/download/{filename}")
async def download_snapshot(filename: str, request: Request):
    """Master: bir snapshot dosyasını indir."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    if ".." in filename or "/" in filename or not filename.startswith("backup-"):
        raise HTTPException(400, "Geçersiz dosya")
    fpath = BACKUP_DIR / filename
    if not fpath.exists():
        raise HTTPException(404, "Dosya bulunamadı")
    return FileResponse(fpath, media_type="application/gzip", filename=filename)


class RestoreOptions:
    pass


@router.post("/restore/{filename}")
async def restore_snapshot(filename: str, request: Request,
                            dry_run: bool = True,
                            collections: Optional[str] = None):
    """Master: bir snapshot'tan geri yükle.

    - `dry_run=True` (varsayılan): sadece rapor döndür, hiçbir şey silmez/yazmaz.
    - `dry_run=false`: gerçekten geri yükler (mevcut koleksiyon içeriğini temizler
      ve snapshot'tan replay eder).
    - `collections`: virgülle ayrılmış — sadece bu koleksiyonlar geri yüklenir.

    ⚠ Restore mevcut DB verisinin üzerine yazar. Önce bir snapshot alın.
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    # 2FA enforce
    try:
        from routes.master_2fa import require_2fa_verified
        await require_2fa_verified(request)
    except HTTPException:
        raise
    except Exception:
        pass

    if ".." in filename or "/" in filename or not filename.startswith("backup-"):
        raise HTTPException(400, "Geçersiz dosya")
    fpath = BACKUP_DIR / filename
    if not fpath.exists():
        raise HTTPException(404, "Snapshot bulunamadı")

    filter_cols = None
    if collections:
        filter_cols = {c.strip() for c in collections.split(",") if c.strip()}

    # Yükle
    try:
        with gzip.open(fpath, "rt", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Snapshot okunamadı: {str(e)[:80]}")

    plan = []
    result = {"restored": {}, "skipped": []}
    for cn, docs in (payload.get("collections") or {}).items():
        if filter_cols and cn not in filter_cols:
            result["skipped"].append(cn)
            continue
        plan.append({"collection": cn, "count": len(docs)})
        if not dry_run:
            try:
                # Güvenlik önce yedek al (dry-run öncesi manuel)
                await db[cn].delete_many({})
                if docs:
                    await db[cn].insert_many(docs)
                result["restored"][cn] = len(docs)
            except Exception as e:
                result["restored"][cn] = f"error: {str(e)[:60]}"

    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "backup_restored" if not dry_run else "backup_restore_dry_run",
            "actor_ip": _client_ip(request),
            "details": {"filename": filename, "dry_run": dry_run, "plan": plan},
            "at": _iso(), "severity": "warning" if not dry_run else "info",
        })
    except Exception:
        pass

    return {
        "ok": True,
        "dry_run": dry_run,
        "filename": filename,
        "snapshot_version": payload.get("version"),
        "snapshot_generated_at": payload.get("generated_at"),
        "plan": plan,
        "result": result,
        "warning": ("Bu bir DRY-RUN'dır. Gerçekten geri yüklemek için ?dry_run=false"
                    if dry_run else "GERÇEK GERİ YÜKLEME TAMAMLANDI"),
    }


@router.delete("/{filename}")
async def delete_snapshot(filename: str, request: Request):
    """Master: bir snapshot dosyasını sil."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    if ".." in filename or "/" in filename or not filename.startswith("backup-"):
        raise HTTPException(400, "Geçersiz dosya")
    fpath = BACKUP_DIR / filename
    if not fpath.exists():
        raise HTTPException(404, "Dosya bulunamadı")
    fpath.unlink()
    await db.backup_snapshots.delete_many({"filename": filename})
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "backup_deleted",
            "actor_ip": _client_ip(request),
            "details": {"filename": filename},
            "at": _iso(), "severity": "warning",
        })
    except Exception:
        pass
    return {"ok": True, "deleted": filename}


# ─────────── SCHEDULER (haftalık otomatik snapshot) ───────────
_scheduler_task: Optional[asyncio.Task] = None


async def _weekly_snapshot_loop():
    """Her 7 gün'de bir otomatik snapshot alır. İlk çalıştırmada eğer son 7 gün içinde
    snapshot yoksa hemen bir tane alır, sonra her 7*24 saat'te bir tekrar eder."""
    while True:
        try:
            latest = await db.backup_snapshots.find_one({}, sort=[("created_at", -1)])
            now = datetime.now(timezone.utc)
            need_now = True
            if latest and latest.get("created_at"):
                try:
                    ts = datetime.fromisoformat(latest["created_at"].replace("Z", "+00:00"))
                    if (now - ts) < timedelta(days=7):
                        need_now = False
                except Exception:
                    pass
            if need_now:
                try:
                    await _do_snapshot()
                    await db.audit_logs.insert_one({
                        "id": str(uuid.uuid4()),
                        "action": "backup_auto_weekly",
                        "actor_ip": "scheduler",
                        "details": {"kind": "auto_weekly"},
                        "at": _iso(), "severity": "info",
                    })
                except Exception:
                    pass
        except Exception:
            pass
        # Her gün 1 kez uyanıp kontrol et (uzun uptime + yeniden başlatmalar için sağlam)
        await asyncio.sleep(24 * 60 * 60)


def start_scheduler():
    """server.py startup hook'undan çağrılır — idempotent."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    loop = asyncio.get_event_loop()
    _scheduler_task = loop.create_task(_weekly_snapshot_loop())
