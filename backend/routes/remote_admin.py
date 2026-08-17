"""
v43.72 — Bayi Uzak Yönetim (Read-Only)

Master, bir bayinin kendi WHM sunucusuna güvenli read-only komut gönderir. Komut
`pending_quarantine_actions` koleksiyonu üzerinden queue'lanır (mevcut plugin
polling altyapısını yeniden kullanır). Bayi'nin heartbeat.pl daemon'ı komutu
çeker, çalıştırır, sonucu master'a POST eder.

Desteklenen komutlar (whitelist — restart / write yok):
    - log_tail        (parametre: log, lines)
    - health_check    (docker ps + service status)
    - version_check   (uname, docker --version, plugin_version)
    - disk_usage      (df -h /)
    - service_status  (systemctl status <service>)

Güvenlik:
- Sadece master `_require_master` guard'ını geçerse komut gönderebilir.
- Command parametreleri sanitized: log_path allow-list, lines <= 1000, service allow-list.
- Bayi tarafı asla arbitrary komut çalıştırmaz — sadece bilinen action_type'lar.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal, Any, List

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from motor.motor_asyncio import AsyncIOMotorClient

_MONGO = AsyncIOMotorClient(os.environ.get("MONGO_URL"))
db = _MONGO[os.environ.get("DB_NAME")]

router = APIRouter(prefix="/remote-admin", tags=["remote-admin"])


ALLOWED_COMMANDS = {
    "log_tail",
    "health_check",
    "version_check",
    "disk_usage",
    "service_status",
}
ALLOWED_LOG_PATHS = {
    "exim_main": "/var/log/exim_mainlog",
    "exim_reject": "/var/log/exim_rejectlog",
    "exim_panic": "/var/log/exim_paniclog",
    "gws_daemon": "/var/log/gws-exim-daemon.log",
    "gws_push": "/var/log/gws-simple-push.log",
    "system_messages": "/var/log/messages",
    "docker_json": "/var/log/docker.log",
}
ALLOWED_SERVICES = {
    "exim",
    "docker",
    "gws-exim-daemon",
    "gws-simple-push.timer",
    "mailscanner",
    "clamav-daemon",
    "spamassassin",
}


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return xff or (request.client.host if request.client else "")


async def _require_master(request: Request, license_key: Optional[str] = None) -> None:
    """Lazy delegate to server.py::_require_master."""
    from server import _require_master as _server_require_master  # type: ignore
    return await _server_require_master(request, license_key)


class RemoteCommandIn(BaseModel):
    license_key: str = Field(..., description="Hedef bayi lisansı (MS-...)")
    command: Literal["log_tail", "health_check", "version_check", "disk_usage", "service_status"]
    params: dict = Field(default_factory=dict, description="Komuta özel parametreler")


@router.post("/dispatch")
async def dispatch_command(payload: RemoteCommandIn, request: Request,
                            license_key: Optional[str] = None):
    """Master-only. Bayiye read-only komut gönderir; komut pending_quarantine_actions
    tablosunda queue'lanır ve bayi heartbeat'i çekecek."""
    await _require_master(request, license_key)

    if payload.command not in ALLOWED_COMMANDS:
        raise HTTPException(400, f"Bilinmeyen komut: {payload.command}")

    # Hedef lisans mevcut mu?
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0, "email": 1, "active": 1})
    if not lic:
        raise HTTPException(404, "Bayı lisansı bulunamadı")

    # Parametreleri sanitize et
    p = dict(payload.params or {})
    if payload.command == "log_tail":
        log_key = str(p.get("log") or "exim_main")
        if log_key not in ALLOWED_LOG_PATHS:
            raise HTTPException(400, f"Log allow-list dışı: {log_key}. İzinli: {sorted(ALLOWED_LOG_PATHS)}")
        lines = int(p.get("lines") or 200)
        lines = max(1, min(1000, lines))
        p = {"log": log_key, "log_path": ALLOWED_LOG_PATHS[log_key], "lines": lines}
    elif payload.command == "service_status":
        svc = str(p.get("service") or "gws-exim-daemon")
        if svc not in ALLOWED_SERVICES:
            raise HTTPException(400, f"Servis allow-list dışı: {svc}. İzinli: {sorted(ALLOWED_SERVICES)}")
        p = {"service": svc}
    else:
        # health_check / version_check / disk_usage için parametre yok
        p = {}

    action_id = str(uuid.uuid4())
    await db.pending_quarantine_actions.insert_one({
        "id": action_id,
        "license_key": payload.license_key,
        "action_type": f"remote_{payload.command}",
        "params": p,
        "read_only": True,
        "created_at": _iso(),
        "created_by_ip": _client_ip(request),
        "completed_at": None,
    })

    # Audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "remote_admin_dispatch",
        "actor_ip": _client_ip(request),
        "details": {
            "target_license": payload.license_key,
            "command": payload.command,
            "params": p,
            "action_id": action_id,
        },
        "at": _iso(),
    })

    return {"ok": True, "action_id": action_id, "queued_at": _iso()}


@router.get("/history")
async def list_history(request: Request, license_key: Optional[str] = None,
                        limit: int = Query(50, ge=1, le=500),
                        target: Optional[str] = None):
    """Master-only. Uzak komut geçmişi (queue + tamamlanan)."""
    await _require_master(request, license_key)
    q: dict[str, Any] = {"action_type": {"$regex": "^remote_"}}
    if target:
        q["license_key"] = target
    cursor = db.pending_quarantine_actions.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    items: List[dict] = await cursor.to_list(length=limit)
    # Bayi label ekle
    ll = {lk: (await db.licenses.find_one({"license_key": lk}, {"_id": 0, "email": 1}) or {}).get("email") or lk[:20]
          for lk in {r.get("license_key") for r in items if r.get("license_key")}}
    for r in items:
        r["bayi_label"] = ll.get(r.get("license_key"), r.get("license_key", "")[:20])
    return {"items": items, "count": len(items)}


@router.get("/action/{action_id}")
async def get_action(action_id: str, request: Request, license_key: Optional[str] = None):
    """Master-only. Tek bir eylemin durumunu / sonucunu döner (polling için)."""
    await _require_master(request, license_key)
    doc = await db.pending_quarantine_actions.find_one({"id": action_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Action bulunamadı")
    return doc


@router.get("/bayilerv")
async def list_bayilerv(request: Request, license_key: Optional[str] = None):
    """Master-only. Aktif bayilerv listesi (uzak komut hedefi seçmek için)."""
    await _require_master(request, license_key)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    cursor = db.licenses.find(
        {"active": True, "license_key": {"$ne": master_key}},
        {"_id": 0, "license_key": 1, "email": 1, "plan": 1, "last_heartbeat": 1},
    ).sort("last_heartbeat", -1).limit(200)
    items = await cursor.to_list(length=200)
    return {"items": items, "count": len(items)}
