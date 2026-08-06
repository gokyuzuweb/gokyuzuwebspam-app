"""
Exim mail queue management (list + bulk actions).

WHM sunucusunda `exiqgrep -a` / `exim -Mrm` / `exim -M` çağrıları gerçek çalışır.
Preview / dev ortamında mock kuyruk oluşur (mail_events'ten türetilir) — böylece UI eksiksiz test edilir.

Tenant izolasyonu: master (header/cookie) → istediği bayinin verisini görebilir.
Bayi → her zaman kendi lisans key'i ile filtrelenir (frontend'den gelen key
yok sayılır, plugin_state'ten alınır).
"""
from __future__ import annotations
import os
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/queue", tags=["queue"])


async def _resolve_tenant(request: Request, license_key_arg: Optional[str]) -> dict:
    """Ortak `tenant.resolve_tenant_scope`'a delege eder — queue-specific dönüş
    şemasına uyarla: {is_master, license_key}."""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key_arg, db)
    return {
        "is_master": scope["is_master"],
        "license_key": scope["owner_license_key"] or "",
    }


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_exim() -> bool:
    return bool(shutil.which("exim") and shutil.which("exiqgrep"))


def _use_real_exim() -> bool:
    """Gerçek Exim spool'una dokunulsun mu? Panel varsayılan olarak
    `mail_events` (MongoDB) üzerinden çalışır. Sadece USE_REAL_EXIM=1 env var'ı
    set edildiğinde ek olarak `exim -Mrm` gibi komutlar çağrılır — bu, WHM
    plugin'in kendi sunucusundaki spool ile eşleşen ortamlar içindir."""
    flag = (os.environ.get("USE_REAL_EXIM") or "").strip().lower()
    return flag in ("1", "true", "yes", "on") and _has_exim()


async def _mock_queue(license_key: Optional[str], limit: int,
                       verdict: Optional[str] = None,
                       search: Optional[str] = None) -> list[dict]:
    """Kuyruk için mock data — mail_events'ten Exim-tarzı satırlar üretir."""
    q: dict = {"verdict": {"$in": ["spam", "high_spam", "virus", "blocked"]}}
    # Bayi ise sadece kendi lisansı; master license_key=None ise hepsi
    if license_key:
        q["license_key"] = license_key
    if verdict and verdict != "all":
        q["verdict"] = verdict
    if search:
        q["$or"] = [
            {"from_addr": {"$regex": search, "$options": "i"}},
            {"to_addr": {"$regex": search, "$options": "i"}},
            {"subject": {"$regex": search, "$options": "i"}},
        ]
    rows = []
    cursor = db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit)
    async for e in cursor:
        rows.append({
            # `mid` = mail_events.id — bu ID'yi bulk_action DIRECT delete_one({"id": mid}) yapar
            "mid": e.get("exim_mid") or e.get("id") or "",
            "age": "12m",
            "size": e.get("scores", {}).get("size") or 8192,
            "from_addr": e.get("from_addr") or "(bilinmiyor)",
            "to_addr": e.get("to_addr") or "(bilinmiyor)",
            "subject": e.get("subject") or "(konusuz)",
            "verdict": e.get("verdict"),
            "score": e.get("total_score") or 0,
            "frozen": (e.get("verdict") == "high_spam") or bool(e.get("frozen")),
            "attempts": e.get("retries", 1),
            "spooled_at": e.get("ingested_at") or _iso(),
            "owner_license_key": e.get("license_key") or "",
            "delivered": bool(e.get("delivered")),
        })
    return rows


def _parse_exiqgrep(output: str) -> list[dict]:
    """`exiqgrep -a -f` output parser — bir satır: '20m  8K  1tSXKZ-000abc-XX <alice@ex.com> bob@ex.com'"""
    items = []
    for line in output.splitlines():
        parts = line.strip().split()
        if len(parts) < 4:
            continue
        try:
            items.append({
                "age": parts[0], "size": parts[1], "mid": parts[2],
                "from_addr": parts[3].strip("<>"),
                "to_addr": " ".join(parts[4:]).strip("<>") if len(parts) > 4 else "-",
                "subject": "(exim mid)",
                "verdict": "queued", "score": 0, "frozen": False,
                "attempts": 1, "spooled_at": _iso(),
            })
        except Exception:
            continue
    return items


@router.get("")
async def list_queue(
    request: Request,
    license_key: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    only_frozen: bool = False,
    verdict: Optional[str] = None,
    search: Optional[str] = None,
):
    """Kuyruktaki mailleri listele. Gerçek ortam: exiqgrep. Aksi: mock.

    Tenant izolasyonu: bayi frontend'den `license_key` gönderse bile plugin_state'ten
    kendi lisansı zorlanır. Master ise verilen license_key'i bayiye drill-down için
    kullanabilir."""
    scope = await _resolve_tenant(request, license_key)
    effective_lk = scope["license_key"]
    scope_meta = {"is_master": scope["is_master"], "license_key": effective_lk}
    if _use_real_exim():
        try:
            args = ["exiqgrep", "-a"]
            if only_frozen:
                args.append("-z")
            r = subprocess.run(args, capture_output=True, timeout=5, text=True)
            if r.returncode == 0:
                items = _parse_exiqgrep(r.stdout)[:limit]
                return {"items": items, "source": "exim", "count": len(items), "scope": scope_meta}
        except Exception:
            pass
    items = await _mock_queue(effective_lk, limit, verdict=verdict, search=search)
    if only_frozen:
        items = [i for i in items if i.get("frozen")]
    return {
        "items": items, "source": "mock", "count": len(items),
        "scope": scope_meta,
    }


@router.get("/stats")
async def queue_stats(request: Request, license_key: Optional[str] = None):
    """Kuyruk özet: total, frozen, high_spam. Tenant scope zorlanır."""
    scope = await _resolve_tenant(request, license_key)
    effective_lk = scope["license_key"]
    scope_meta = {"is_master": scope["is_master"], "license_key": effective_lk}
    if _use_real_exim():
        try:
            r = subprocess.run(["exim", "-bpc"], capture_output=True, timeout=5, text=True)
            total = int((r.stdout or "0").strip() or "0")
            rz = subprocess.run(["exim", "-bpr"], capture_output=True, timeout=5, text=True)
            frozen = sum(1 for _l in (rz.stdout or "").splitlines() if "*** frozen ***" in _l)
            return {"total": total, "frozen": frozen, "source": "exim", "scope": scope_meta}
        except Exception:
            pass
    items = await _mock_queue(effective_lk, 500)
    return {
        "total": len(items),
        "frozen": sum(1 for i in items if i.get("frozen")),
        "high_spam": sum(1 for i in items if i.get("verdict") == "high_spam"),
        "virus": sum(1 for i in items if i.get("verdict") == "virus"),
        "blocked": sum(1 for i in items if i.get("verdict") == "blocked"),
        "source": "mock",
        "scope": scope_meta,
    }


class QueueAction(BaseModel):
    license_key: Optional[str] = None
    mids: list[str] = Field(..., min_length=1, max_length=500)
    action: str = Field(..., pattern="^(remove|deliver|retry|freeze|thaw|bounce)$")
    forward_to: Optional[str] = None  # for `deliver` with recipient override


def _exim_cmd_for(action: str) -> Optional[list[str]]:
    return {
        "remove":  ["exim", "-Mrm"],   # kuyruktan sil
        "deliver": ["exim", "-M"],     # zorla teslim
        "retry":   ["exim", "-Mc"],    # yeni deneme
        "freeze":  ["exim", "-Mf"],    # dondur
        "thaw":    ["exim", "-Mt"],    # çöz
        "bounce":  ["exim", "-Mg"],    # geri döndür
    }.get(action)


@router.post("/bulk")
async def bulk_action(payload: QueueAction, request: Request):
    """Kuyruk üzerinde toplu işlem.

    Panel her zaman `mail_events` (MongoDB) üzerinde tenant-scoped işlem yapar.
    Böylece "sil" gerçekten mail_events'ten kaydı kaldırır ve UI ANINDA temiz
    görünür. USE_REAL_EXIM=1 env var'ı set ise ek olarak `exim -Mrm` de
    çağrılır — bu, WHM plugin sunucusunda gerçek Exim spool'unu da temizler."""
    scope = await _resolve_tenant(request, payload.license_key)
    effective_lk = scope["license_key"]
    results = []
    also_exim = _use_real_exim()
    base = _exim_cmd_for(payload.action)
    if not base:
        raise HTTPException(400, f"Desteklenmeyen aksiyon: {payload.action}")
    for mid in payload.mids:
        entry = {"mid": mid, "action": payload.action}
        # 1) HER ZAMAN mail_events üzerinde tenant-scoped işlem
        #    mid, mail_events.id VEYA mail_events.exim_mid olabilir
        match: dict = {"$or": [{"exim_mid": mid}, {"id": mid}]}
        if effective_lk:  # bayi ise kendi lisansı; master drill-down için verilen key
            match["license_key"] = effective_lk
        try:
            if payload.action == "remove":
                r = await db.mail_events.delete_one(match)
                entry["db_deleted"] = r.deleted_count
                entry["ok"] = r.deleted_count > 0
                entry["out"] = f"Panel kaydı silindi ({r.deleted_count})"
            elif payload.action == "deliver":
                r = await db.mail_events.update_one(
                    match, {"$set": {"delivered": True, "delivered_at": _iso(),
                                      "forward_to": payload.forward_to}}
                )
                entry["ok"] = r.matched_count > 0
                entry["out"] = f"Teslim işaretlendi{' (fwd: ' + payload.forward_to + ')' if payload.forward_to else ''}"
            elif payload.action == "freeze":
                r = await db.mail_events.update_one(match, {"$set": {"frozen": True}})
                entry["ok"] = r.matched_count > 0
                entry["out"] = "Donduruldu"
            elif payload.action == "thaw":
                r = await db.mail_events.update_one(match, {"$set": {"frozen": False}})
                entry["ok"] = r.matched_count > 0
                entry["out"] = "Çözüldü"
            elif payload.action == "retry":
                r = await db.mail_events.update_one(
                    match, {"$inc": {"retries": 1}, "$set": {"last_retry": _iso()}}
                )
                entry["ok"] = r.matched_count > 0
                entry["out"] = "Yeniden denendi"
            elif payload.action == "bounce":
                r = await db.mail_events.update_one(match, {"$set": {"bounced": True}})
                entry["ok"] = r.matched_count > 0
                entry["out"] = "Geri döndürüldü"
        except Exception as ex:
            entry["ok"] = False
            entry["out"] = f"DB hata: {type(ex).__name__}: {ex}"

        # 2) EK OLARAK gerçek Exim spool'u (opsiyonel)
        if also_exim:
            try:
                r = subprocess.run([*base, mid], capture_output=True, timeout=8, text=True)
                entry["exim_ok"] = r.returncode == 0
                entry["exim_out"] = (r.stdout or r.stderr or "").strip()[:200]
                # Exim komutu başarısız olsa bile mail_events silindiği için ok=True kalır.
            except Exception as ex:
                entry["exim_ok"] = False
                entry["exim_out"] = f"{type(ex).__name__}: {ex}"

        results.append(entry)
        await db.queue_audit.insert_one({
            "license_key": effective_lk,
            "actor_scope": "master" if scope["is_master"] else "reseller",
            "mid": mid, "action": payload.action, "ok": entry.get("ok", False),
            "forward_to": payload.forward_to,
            "created_at": _iso(),
            "output": entry.get("out", ""),
            "exim_ok": entry.get("exim_ok"),
        })
    ok = sum(1 for r in results if r.get("ok"))
    return {"ok": True, "processed": len(results), "success": ok, "failed": len(results) - ok,
            "source": "exim+db" if also_exim else "db",
            "results": results,
            "scope": {"is_master": scope["is_master"], "license_key": effective_lk}}


@router.get("/audit")
async def audit_log(request: Request, license_key: Optional[str] = None,
                     limit: int = Query(50, ge=1, le=200)):
    scope = await _resolve_tenant(request, license_key)
    q: dict = {}
    if not scope["is_master"] and scope["license_key"]:
        q["license_key"] = scope["license_key"]
    elif scope["is_master"] and scope["license_key"]:
        q["license_key"] = scope["license_key"]
    rows = await db.queue_audit.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}
