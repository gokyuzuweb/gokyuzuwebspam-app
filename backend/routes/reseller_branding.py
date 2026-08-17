"""
v43.73 — Bayı Kendi Domain'i + Custom Branding

Bayı kendi mail.bayihosting.com gibi domain'i tanımlar, otomatik landing/subscription
sayfası oluşur. Bayı kendi logosunu, marka rengini, fiyat notunu düzenler.

Endpoint'ler:
  GET  /api/reseller-branding/me            — bayı kendi ayarları
  POST /api/reseller-branding/me            — bayı kendi ayarını günceller
  GET  /api/public/reseller-branding?host=X — public: subdomain lookup ile landing
  GET  /api/admin/reseller-branding/list    — master: tüm bayilerv brand'leri
"""
from __future__ import annotations
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, HttpUrl
from motor.motor_asyncio import AsyncIOMotorClient

_MONGO = AsyncIOMotorClient(os.environ.get("MONGO_URL"))
db = _MONGO[os.environ.get("DB_NAME")]

router = APIRouter(tags=["reseller-branding"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9\-\.]{1,251})[a-z0-9]$", re.IGNORECASE)


def _norm_host(h: str) -> str:
    h = (h or "").strip().lower()
    h = re.sub(r"^https?://", "", h)
    h = h.rstrip("/")
    return h


async def _resolve_bayi_key(request: Request, license_key: Optional[str] = None) -> str:
    """Bayı kimliği: X-Master-Key veya query license_key. Master (env) hariç."""
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    hdr = (request.headers.get("x-master-key") or "").strip()
    key = (license_key or hdr or "").strip()
    if not key or key == master_env or not key.startswith("MS-"):
        raise HTTPException(401, "Bayı lisans anahtarı gerekli")
    lic = await db.licenses.find_one({"license_key": key, "active": True}, {"_id": 0, "license_key": 1})
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı veya aktif değil")
    return key


class BrandingIn(BaseModel):
    custom_domain: Optional[str] = Field(None, max_length=253, description="mail.bayihosting.com")
    brand_name: Optional[str] = Field(None, max_length=64)
    brand_tagline: Optional[str] = Field(None, max_length=180)
    logo_url: Optional[str] = Field(None, max_length=500)
    primary_color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    support_email: Optional[str] = Field(None, max_length=180)
    support_whatsapp: Optional[str] = Field(None, max_length=32)
    pricing_note: Optional[str] = Field(None, max_length=500)
    active: bool = True


@router.get("/reseller-branding/me")
async def branding_get(request: Request, license_key: Optional[str] = None):
    """Bayı kendi branding ayarını okur."""
    lk = await _resolve_bayi_key(request, license_key)
    doc = await db.reseller_branding.find_one({"license_key": lk}, {"_id": 0})
    if not doc:
        return {
            "license_key": lk,
            "custom_domain": None,
            "brand_name": None,
            "brand_tagline": "Kurumsal Mail Güvenliği",
            "logo_url": None,
            "primary_color": "#6366f1",
            "support_email": None,
            "support_whatsapp": None,
            "pricing_note": None,
            "active": False,
        }
    return doc


@router.post("/reseller-branding/me")
async def branding_set(payload: BrandingIn, request: Request,
                        license_key: Optional[str] = None):
    """Bayı kendi branding ayarını kaydeder."""
    lk = await _resolve_bayi_key(request, license_key)
    data = payload.model_dump(exclude_none=True)
    if "custom_domain" in data:
        h = _norm_host(data["custom_domain"])
        if h and not _HOST_RE.match(h):
            raise HTTPException(400, "Geçersiz domain formatı — örn: mail.bayihosting.com")
        # Aynı domain başkası tarafından kullanılıyor mu?
        if h:
            conflict = await db.reseller_branding.find_one(
                {"custom_domain": h, "license_key": {"$ne": lk}},
                {"_id": 0, "license_key": 1},
            )
            if conflict:
                raise HTTPException(409, "Bu domain başka bir bayı tarafından kullanılıyor")
        data["custom_domain"] = h or None
    data["license_key"] = lk
    data["updated_at"] = _iso()
    await db.reseller_branding.update_one(
        {"license_key": lk},
        {"$set": data, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _iso()}},
        upsert=True,
    )
    doc = await db.reseller_branding.find_one({"license_key": lk}, {"_id": 0})
    return {"ok": True, **doc}


@router.get("/public/reseller-branding")
async def branding_public(host: Optional[str] = Query(None, description="mail.bayihosting.com")):
    """Landing sayfası için public — sadece aktif bayilerv görünür."""
    if not host:
        raise HTTPException(400, "host parametresi gerekli")
    h = _norm_host(host)
    doc = await db.reseller_branding.find_one(
        {"custom_domain": h, "active": True},
        {"_id": 0, "license_key": 0},
    )
    if not doc:
        raise HTTPException(404, "Bu domain için aktif bayı bulunamadı")
    return doc


@router.get("/admin/reseller-branding/list")
async def branding_admin_list(request: Request, license_key: Optional[str] = None):
    """Master-only. Tüm bayilerv brand'leri (Landing CMS yönetimi için)."""
    from server import _require_master  # type: ignore
    await _require_master(request, license_key)
    cursor = db.reseller_branding.find({}, {"_id": 0}).sort("updated_at", -1).limit(500)
    items = await cursor.to_list(length=500)
    # Bayı email etiket ekle
    keys = list({r.get("license_key") for r in items if r.get("license_key")})
    lic_map: dict[str, str] = {}
    if keys:
        async for l in db.licenses.find({"license_key": {"$in": keys}}, {"_id": 0, "license_key": 1, "email": 1}):
            lic_map[l["license_key"]] = l.get("email") or l["license_key"][:20]
    for r in items:
        r["bayi_label"] = lic_map.get(r.get("license_key", ""), (r.get("license_key") or "")[:20])
    return {"items": items, "count": len(items)}
