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
    """Basit tenant scope: master header/cookie varsa is_master=True (verilen
    license_key'i target olarak kullanır). Aksi halde bayi kabul edilir ve
    kendi plugin_state'inden license_key okunur; kullanıcı bunu override edemez.

    SECURITY: v35 fix — sadece `license_key_arg == MASTER_KEY` üzerinden master
    scope veremeyiz (query-string escalation). Legacy fallback için IP kontrolü
    zorunlu (MASTER_IP env)."""
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    hdr = request.headers.get("x-master-key") or ""
    cookie = request.cookies.get("gws_master_session") or ""
    if master_env and (hdr == master_env or cookie == master_env):
        target = license_key_arg if (license_key_arg and license_key_arg != master_env) else None
        return {"is_master": True, "license_key": target}
    # Legacy WHM plugin (no header/cookie) — güvenlik için MASTER_IP zorunlu
    if master_env and license_key_arg == master_env:
        master_ip = os.environ.get("MASTER_IP", "")
        xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        client_ip = xff or (request.client.host if request.client else "")
        if master_ip and client_ip == master_ip:
            return {"is_master": True, "license_key": None}
        # Master key + wrong IP → reject silently, treat as reseller
    # Bayi: kendi state'inden okur; argümanı yok say (isteğe bağlı override yok)
    st = await db.plugin_state.find_one({"_id": "main"}, {"_id": 0, "license_key": 1}) or {}
    return {"is_master": False, "license_key": st.get("license_key") or ""}


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_exim() -> bool:
    return bool(shutil.which("exim") and shutil.which("exiqgrep"))


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
            "mid": e.get("exim_mid") or f"1t{(e.get('id') or '')[:6]}-XXX",
            "age": "12m",
            "size": e.get("scores", {}).get("size") or 8192,
            "from_addr": e.get("from_addr") or "(bilinmiyor)",
            "to_addr": e.get("to_addr") or "(bilinmiyor)",
            "subject": e.get("subject") or "(konusuz)",
            "verdict": e.get("verdict"),
            "score": e.get("total_score") or 0,
            "frozen": (e.get("verdict") == "high_spam"),
            "attempts": 1,
            "spooled_at": e.get("ingested_at") or _iso(),
            "owner_license_key": e.get("license_key") or "",
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
    if _has_exim():
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
    if _has_exim():
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
    """Kuyruk üzerinde toplu işlem. Tenant scope zorlanır:
    - Gerçek Exim varsa `exim -Mrm/-M/...` çağrılır (kuyrukta gerçek işlem).
    - Aksi halde mock: `remove` → mail_events'ten kaydı siler; `deliver` →
      forwarded=True işaretler + forward_to varsa gerçek SMTP forward denenir.
      Her durumda `queue_audit` kaydı atılır."""
    scope = await _resolve_tenant(request, payload.license_key)
    effective_lk = scope["license_key"]
    results = []
    real = _has_exim()
    base = _exim_cmd_for(payload.action)
    if not base:
        raise HTTPException(400, f"Desteklenmeyen aksiyon: {payload.action}")
    for mid in payload.mids:
        entry = {"mid": mid, "action": payload.action}
        if real:
            try:
                r = subprocess.run([*base, mid], capture_output=True, timeout=8, text=True)
                entry["ok"] = r.returncode == 0
                entry["out"] = (r.stdout or r.stderr or "").strip()[:200]
            except Exception as ex:
                entry["ok"] = False
                entry["out"] = f"{type(ex).__name__}: {ex}"
        else:
            # MOCK: mail_events üzerinde tenant-scoped işlem yap
            match = {"exim_mid": mid}
            if not scope["is_master"] and effective_lk:
                match["license_key"] = effective_lk
            elif scope["is_master"] and effective_lk:
                match["license_key"] = effective_lk
            try:
                if payload.action == "remove":
                    r = await db.mail_events.delete_one(match)
                    entry["ok"] = r.deleted_count > 0
                    entry["out"] = f"MOCK: mail_events kaydı silindi ({r.deleted_count})"
                elif payload.action == "deliver":
                    r = await db.mail_events.update_one(
                        match, {"$set": {"delivered": True, "delivered_at": _iso(),
                                          "forward_to": payload.forward_to}}
                    )
                    entry["ok"] = r.matched_count > 0
                    entry["out"] = f"MOCK: teslim işaretlendi{' (fwd: ' + payload.forward_to + ')' if payload.forward_to else ''}"
                elif payload.action == "freeze":
                    r = await db.mail_events.update_one(match, {"$set": {"frozen": True}})
                    entry["ok"] = r.matched_count > 0
                    entry["out"] = "MOCK: donduruldu"
                elif payload.action == "thaw":
                    r = await db.mail_events.update_one(match, {"$set": {"frozen": False}})
                    entry["ok"] = r.matched_count > 0
                    entry["out"] = "MOCK: çözüldü"
                elif payload.action == "retry":
                    r = await db.mail_events.update_one(
                        match, {"$inc": {"retries": 1}, "$set": {"last_retry": _iso()}}
                    )
                    entry["ok"] = r.matched_count > 0
                    entry["out"] = "MOCK: yeniden denendi"
                elif payload.action == "bounce":
                    r = await db.mail_events.update_one(match, {"$set": {"bounced": True}})
                    entry["ok"] = r.matched_count > 0
                    entry["out"] = "MOCK: geri döndürüldü"
                else:
                    entry["ok"] = False
                    entry["out"] = "aksiyon desteklenmiyor"
            except Exception as ex:
                entry["ok"] = False
                entry["out"] = f"{type(ex).__name__}: {ex}"
        results.append(entry)
        await db.queue_audit.insert_one({
            "license_key": effective_lk,
            "actor_scope": "master" if scope["is_master"] else "reseller",
            "mid": mid, "action": payload.action, "ok": entry["ok"],
            "forward_to": payload.forward_to,
            "created_at": _iso(),
            "output": entry["out"],
        })
    ok = sum(1 for r in results if r["ok"])
    return {"ok": True, "processed": len(results), "success": ok, "failed": len(results) - ok,
            "source": "exim" if real else "mock", "results": results,
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
