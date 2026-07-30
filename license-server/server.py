"""
GökyüzüWebSpam Standalone License Server (v1.0)
================================================
Ayrı FastAPI service — WHM plugin'lerden gelen heartbeat isteklerini karşılar,
IP doğrulaması yapar, ihlal olaylarını `license_violations` koleksiyonuna yazar
ve gerekirse admin'e alarm gönderir.

Prod'da bu servis satıcının domain'inde host edilir (örn. https://license.gokyuzuwebspam.com).
Preview'de aynı sunucuda 8002 portunda çalışır; ana backend'in `PUBLIC_LICENSE_SERVER_URL`
env değişkeni bu adresi tutar.

Endpoints:
  POST /v1/heartbeat        — plugin heartbeat + IP kaydı
  GET  /v1/verify           — anahtar+IP doğrulama (idempotent)
  POST /v1/revoke           — anahtar iptali (yalnızca API key ile)
  GET  /v1/health           — health check
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
ADMIN_API_KEY = os.environ.get("LICENSE_SERVER_ADMIN_KEY", "gws-license-admin-key")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="GökyüzüWebSpam License Server", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class HeartbeatIn(BaseModel):
    license_key: str
    server_ip: str
    hostname: Optional[str] = ""
    plugin_version: Optional[str] = ""
    engines_active: List[str] = Field(default_factory=list)
    scanned_last_hour: int = 0


class HeartbeatOut(BaseModel):
    ok: bool
    status: str  # "active" | "expired" | "violation" | "unknown"
    message: str = ""
    valid_until: Optional[str] = None
    latest_version: Optional[str] = None
    server_time: str = Field(default_factory=_iso)


class RevokeIn(BaseModel):
    license_key: str
    reason: str = ""


@app.get("/v1/health")
async def health():
    return {"service": "gws-license-server", "version": "1.0.0", "time": _iso()}


@app.post("/v1/heartbeat", response_model=HeartbeatOut)
async def heartbeat(payload: HeartbeatIn, request: Request):
    """Called by WHM plugin heartbeat daemon every ~5 minutes.
    Validates license, checks IP, records violations if not authorized.
    """
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    if not lic:
        # Log unknown-key attempt
        await db.license_violations.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "reason": "unknown_license_key",
            "at": _iso(),
        })
        return HeartbeatOut(ok=False, status="unknown", message="Lisans anahtarı bilinmiyor")

    if not lic.get("active", True):
        return HeartbeatOut(ok=False, status="expired", message="Lisans devre dışı", valid_until=lic.get("valid_until"))

    # Check expiry
    try:
        vu = datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00"))
        if vu < datetime.now(timezone.utc):
            return HeartbeatOut(ok=False, status="expired",
                                message="Lisans süresi dolmuş — /shop üzerinden yenileyin",
                                valid_until=lic["valid_until"])
    except Exception:
        pass

    # Check IP authorization
    allowed_ips = lic.get("ip_addresses") or lic.get("allowed_ips") or []
    if allowed_ips and payload.server_ip not in allowed_ips:
        await db.license_violations.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "reason": "ip_mismatch",
            "allowed_ips": allowed_ips,
            "at": _iso(),
        })
        return HeartbeatOut(
            ok=False, status="violation",
            message=f"IP {payload.server_ip} bu lisans için yetkili değil",
            valid_until=lic.get("valid_until"),
        )

    # If no IPs registered yet, auto-register on first heartbeat (bootstrap)
    if not allowed_ips:
        await db.licenses.update_one(
            {"license_key": payload.license_key},
            {"$set": {"ip_addresses": [payload.server_ip]}},
        )

    # Record heartbeat
    await db.license_heartbeats.update_one(
        {"license_key": payload.license_key},
        {"$set": {
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "plugin_version": payload.plugin_version or "",
            "engines_active": payload.engines_active,
            "scanned_last_hour": payload.scanned_last_hour,
            "last_seen_at": _iso(),
        }},
        upsert=True,
    )

    manifest = await db.version_manifest.find_one({}, {"_id": 0}) or {}
    return HeartbeatOut(
        ok=True, status="active", message="OK",
        valid_until=lic.get("valid_until"),
        latest_version=manifest.get("latest_version"),
    )


@app.get("/v1/verify")
async def verify(license_key: str, server_ip: str):
    """Idempotent verify — used by 'Verify License' button and installer."""
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    if not lic:
        return {"valid": False, "reason": "unknown_key"}
    if not lic.get("active", True):
        return {"valid": False, "reason": "inactive"}
    try:
        vu = datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00"))
        if vu < datetime.now(timezone.utc):
            return {"valid": False, "reason": "expired", "valid_until": lic["valid_until"]}
    except Exception:
        return {"valid": False, "reason": "invalid_date"}
    allowed = lic.get("ip_addresses") or lic.get("allowed_ips") or []
    if allowed and server_ip not in allowed:
        return {"valid": False, "reason": "ip_mismatch", "allowed_count": len(allowed)}
    return {
        "valid": True,
        "plan": lic.get("plan", "pro"),
        "valid_until": lic["valid_until"],
        "customer_name": lic.get("customer_name", ""),
    }


@app.post("/v1/revoke")
async def revoke(payload: RevokeIn, x_admin_key: Optional[str] = Header(default=None)):
    """Admin-only: revoke a license (mark inactive)."""
    if x_admin_key != ADMIN_API_KEY:
        raise HTTPException(401, "X-Admin-Key gerekli")
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı")
    await db.licenses.update_one(
        {"license_key": payload.license_key},
        {"$set": {"active": False, "revoked_at": _iso(), "revoke_reason": payload.reason}},
    )
    return {"revoked": True, "license_key": payload.license_key}
