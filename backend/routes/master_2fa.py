"""v43.99 — Master TOTP 2FA (Google Authenticator / Authy / 1Password compatible).

Flow:
1. POST /master/2fa/setup-init → yeni secret + QR (base64 PNG) döner (kaydedilmez)
2. POST /master/2fa/enable {secret, code} → 6-haneli kod doğrula → DB'ye kaydet + 10 backup code döner
3. POST /master/2fa/verify {code} → doğruluk kontrolü + 8 saatlik verify token (cookie/localStorage)
4. GET  /master/2fa/status
5. POST /master/2fa/disable {code}

Backup codes tek kullanımlıktır. Verify token cookie olarak set edilir (gws_2fa_ok).
"""
from __future__ import annotations
import os
import io
import base64
import secrets
import uuid
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import pyotp
import qrcode
from fastapi import APIRouter, HTTPException, Request, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/master/2fa", tags=["master-2fa"])

ISSUER = "GökyüzüWebSpam"
SETTING_KEY = "master_2fa"
_VERIFY_TOKEN_TTL_HOURS = 8


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


async def _is_master(request: Request) -> bool:
    """Reuse ana master detection: header key || master IP || WHM iframe."""
    k = request.headers.get("x-master-key") or request.headers.get("x-license-key") or ""
    if MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY:
        return True
    # IP check
    ip = _client_ip(request)
    master_ip = os.environ.get("MASTER_IP", "")
    if master_ip and ip == master_ip:
        return True
    # WHM iframe
    ref = (request.headers.get("referer") or "").lower()
    org = (request.headers.get("origin") or "").lower()
    if ":2087" in ref and master_ip and master_ip in ref:
        return True
    if ":2087" in org and master_ip and master_ip in org:
        return True
    return False


async def _require_master(request: Request):
    if not await _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


class SetupInitResp(BaseModel):
    secret: str
    otpauth_url: str
    qr_png_base64: str


@router.post("/setup-init")
async def setup_init(request: Request):
    """Yeni secret üretir + QR kodu döner. Bu aşamada kaydedilmez, sadece kullanıcıya
    telefon uygulamasına ekletir. Kullanıcı 6 haneli kod ile POST /enable çağırır."""
    await _require_master(request)
    secret = pyotp.random_base32()
    email = "master@gokyuzuhosting.com"
    try:
        lic = await db.licenses.find_one(
            {"license_key": MASTER_LICENSE_KEY} if MASTER_LICENSE_KEY else {"is_master": True},
            {"_id": 0, "customer_email": 1},
        )
        if lic and lic.get("customer_email"):
            email = lic["customer_email"]
    except Exception:
        pass
    otpauth = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)
    # QR PNG
    img = qrcode.make(otpauth)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {
        "secret": secret,
        "otpauth_url": otpauth,
        "qr_png_base64": qr_b64,
    }


class EnableIn(BaseModel):
    secret: str = Field(..., min_length=16, max_length=64)
    code: str = Field(..., min_length=6, max_length=6)


@router.post("/enable")
async def enable_2fa(payload: EnableIn, request: Request):
    await _require_master(request)
    if not pyotp.TOTP(payload.secret).verify(payload.code, valid_window=1):
        raise HTTPException(400, "Kod geçersiz — telefondaki güncel 6 haneli sayıyı girin")
    # 10 backup code üret (12 char alfanumeric)
    backups = ["-".join([secrets.token_hex(2).upper() for _ in range(2)]) for _ in range(10)]
    doc = {
        "_key": SETTING_KEY,
        "enabled": True,
        "secret": payload.secret,   # DB access already access-guarded; consider KMS later
        "backup_codes_hashed": [_hash(b) for b in backups],
        "enabled_at": _iso(),
        "enabled_by_ip": _client_ip(request),
    }
    await db.settings.update_one({"_key": SETTING_KEY}, {"$set": doc}, upsert=True)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "master_2fa_enabled",
        "actor_ip": _client_ip(request), "at": _iso(), "severity": "info",
    })
    return {"ok": True, "backup_codes": backups}


class VerifyIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=14)   # backup codes 11 char


@router.post("/verify")
async def verify_2fa(payload: VerifyIn, request: Request, response: Response):
    await _require_master(request)
    cfg = await db.settings.find_one({"_key": SETTING_KEY}, {"_id": 0}) or {}
    if not cfg.get("enabled"):
        raise HTTPException(400, "2FA aktif değil")
    code = payload.code.strip().replace(" ", "")
    verified = False
    used_backup = None
    if "-" in code and len(code) >= 9:
        # Backup code
        h = _hash(code.upper())
        if h in (cfg.get("backup_codes_hashed") or []):
            verified = True
            used_backup = code.upper()
            # Kullanılan kodu listeden çıkar (tek kullanımlık)
            await db.settings.update_one(
                {"_key": SETTING_KEY},
                {"$pull": {"backup_codes_hashed": h}},
            )
    else:
        # TOTP kod
        secret = cfg.get("secret") or ""
        if secret and pyotp.TOTP(secret).verify(code, valid_window=1):
            verified = True

    if not verified:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()), "action": "master_2fa_failed",
            "actor_ip": _client_ip(request), "at": _iso(), "severity": "warning",
        })
        raise HTTPException(401, "Kod hatalı")

    # 8 saatlik verify token
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=_VERIFY_TOKEN_TTL_HOURS)
    await db.settings.update_one(
        {"_key": f"master_2fa_token:{token}"},
        {"$set": {"_key": f"master_2fa_token:{token}",
                    "valid_until": expires_at.isoformat(),
                    "created_at": _iso(),
                    "used_backup": used_backup}},
        upsert=True,
    )
    # Cookie set
    response.set_cookie(
        key="gws_2fa_ok", value=token,
        httponly=True, samesite="lax", secure=False,
        max_age=_VERIFY_TOKEN_TTL_HOURS * 3600,
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "master_2fa_verified",
        "actor_ip": _client_ip(request), "at": _iso(), "severity": "info",
        "details": {"used_backup": bool(used_backup)},
    })
    return {"ok": True, "token": token, "expires_at": expires_at.isoformat(),
            "used_backup_code": bool(used_backup),
            "backup_codes_remaining": max(0, len(cfg.get("backup_codes_hashed", [])) - (1 if used_backup else 0))}


@router.get("/status")
async def status(request: Request):
    await _require_master(request)
    cfg = await db.settings.find_one({"_key": SETTING_KEY}, {"_id": 0}) or {}
    verified = False
    tok = request.cookies.get("gws_2fa_ok")
    if tok:
        row = await db.settings.find_one({"_key": f"master_2fa_token:{tok}"}, {"_id": 0})
        if row and row.get("valid_until", "") > _iso():
            verified = True
    return {
        "enabled": bool(cfg.get("enabled")),
        "verified": verified,
        "backup_codes_remaining": len(cfg.get("backup_codes_hashed") or []),
        "enabled_at": cfg.get("enabled_at"),
    }


class DisableIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=14)


@router.post("/disable")
async def disable_2fa(payload: DisableIn, request: Request, response: Response):
    await _require_master(request)
    cfg = await db.settings.find_one({"_key": SETTING_KEY}, {"_id": 0}) or {}
    if not cfg.get("enabled"):
        raise HTTPException(400, "2FA zaten kapalı")
    code = payload.code.strip().replace(" ", "")
    ok = False
    if "-" in code and _hash(code.upper()) in (cfg.get("backup_codes_hashed") or []):
        ok = True
    else:
        secret = cfg.get("secret") or ""
        if secret and pyotp.TOTP(secret).verify(code, valid_window=1):
            ok = True
    if not ok:
        raise HTTPException(401, "Kod hatalı")
    await db.settings.update_one(
        {"_key": SETTING_KEY},
        {"$set": {"enabled": False, "disabled_at": _iso()}},
    )
    response.delete_cookie("gws_2fa_ok")
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "master_2fa_disabled",
        "actor_ip": _client_ip(request), "at": _iso(), "severity": "warning",
    })
    return {"ok": True}
