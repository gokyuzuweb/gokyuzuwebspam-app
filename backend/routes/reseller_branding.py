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
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Bu domain için aktif bayı bulunamadı")
    # v43.75 — Trusted Publisher rozetini ekle (public landing'de gösterilecek)
    lk = doc.pop("license_key", None)  # license leak etmeden hesapla
    if lk:
        total = await db.marketplace_signatures.count_documents(
            {"publisher_license": lk, "status": "active"}
        )
        tier = None
        for t in [
            {"min": 5,  "label": "Trusted Publisher", "badge_color": "emerald"},
            {"min": 15, "label": "Expert Publisher",  "badge_color": "violet"},
            {"min": 30, "label": "Elite Publisher",   "badge_color": "amber"},
        ]:
            if total >= t["min"]:
                tier = {"label": t["label"], "badge_color": t["badge_color"], "signatures": total}
        doc["trusted_publisher"] = tier
    return doc


# ====================== v43.75 — SEO + OG Tags ======================
from fastapi.responses import HTMLResponse, Response  # noqa: E402


@router.get("/public/reseller-og", response_class=Response)
async def branding_og_image(host: Optional[str] = Query(None)):
    """SVG olarak dinamik OG image üretir — sosyal medya paylaşımlarında görünür.
    1200x630 pixel Twitter/Facebook standardı."""
    if not host:
        raise HTTPException(400, "host gerekli")
    h = _norm_host(host)
    doc = await db.reseller_branding.find_one({"custom_domain": h, "active": True}, {"_id": 0}) or {}
    brand = _xml_escape(doc.get("brand_name") or "GökyüzüWebSpam")
    tagline = _xml_escape(doc.get("brand_tagline") or "Kurumsal Mail Güvenliği")
    color = doc.get("primary_color") or "#6366f1"
    # Trusted tier
    trusted_label = ""
    if doc.get("license_key"):
        sig_count = await db.marketplace_signatures.count_documents(
            {"publisher_license": doc["license_key"], "status": "active"}
        )
        if sig_count >= 30:
            trusted_label = "Elite Publisher · Marketplace Onaylı"
        elif sig_count >= 15:
            trusted_label = "Expert Publisher · Marketplace Onaylı"
        elif sig_count >= 5:
            trusted_label = "Trusted Publisher · Marketplace Onaylı"

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{color}" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#020617" stop-opacity="1"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect width="1200" height="630" fill="#020617"/>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1050" cy="120" r="220" fill="{color}" opacity="0.14" filter="url(#glow)"/>
  <circle cx="150" cy="500" r="160" fill="{color}" opacity="0.10" filter="url(#glow)"/>
  <g transform="translate(80, 220)">
    <text x="0" y="0" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="{color}" opacity="0.9">
      GÖKYÜZÜWEBSPAM · MAIL GÜVENLİK
    </text>
    <text x="0" y="72" font-family="Inter,system-ui,sans-serif" font-size="72" font-weight="900" fill="#f1f5f9">
      {brand}
    </text>
    <text x="0" y="130" font-family="Inter,system-ui,sans-serif" font-size="32" fill="#cbd5e1">
      {tagline}
    </text>
    {"" if not trusted_label else f'<g transform="translate(0, 190)"><rect x="0" y="0" width="500" height="52" rx="26" fill="' + color + '" opacity="0.15" stroke="' + color + '" stroke-width="2"/><text x="24" y="34" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="700" fill="' + color + '">★ ' + _xml_escape(trusted_label) + '</text></g>'}
    <text x="0" y="290" font-family="Inter,system-ui,sans-serif" font-size="20" fill="#64748b">
      {_xml_escape(h)} — Bayı ile İletişime Geçin
    </text>
  </g>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml", headers={
        "Cache-Control": "public, max-age=3600",
    })


@router.get("/r-meta/{host_slug}", response_class=HTMLResponse)
async def branding_seo_meta(host_slug: str, request: Request):
    """Sosyal medya scraper'ları için pre-rendered HTML with OG tags.
    Bayı landing linki paylaşılınca Twitter/Facebook bu endpoint'i tarar.
    Normal kullanıcı için client tarafta /r/{host_slug} route'a redirect."""
    h = _norm_host(host_slug)
    doc = await db.reseller_branding.find_one({"custom_domain": h, "active": True}, {"_id": 0}) or {}
    brand = _xml_escape(doc.get("brand_name") or "GökyüzüWebSpam")
    tagline = _xml_escape(doc.get("brand_tagline") or "Kurumsal Mail Güvenliği")
    color = doc.get("primary_color") or "#6366f1"
    base = str(request.base_url).rstrip("/")
    og_image = f"{base}/api/public/reseller-og?host={h}"
    landing_url = f"{base}/r/{h}"
    canonical = f"https://{h}/" if h else landing_url

    html = f"""<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{brand} — {tagline}</title>
<meta name="description" content="{brand} · {tagline} — Kurumsal mail güvenliği: spam, phishing, BEC koruması, gerçek zamanlı trafik izleme."/>
<meta name="theme-color" content="{color}"/>
<link rel="canonical" href="{canonical}"/>
<!-- Open Graph -->
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="{brand}"/>
<meta property="og:title" content="{brand} — {tagline}"/>
<meta property="og:description" content="Kurumsal mail güvenliği · Spam, phishing, BEC koruması · WHM/cPanel entegre"/>
<meta property="og:image" content="{og_image}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="{canonical}"/>
<meta property="og:locale" content="tr_TR"/>
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="{brand} — {tagline}"/>
<meta name="twitter:description" content="Kurumsal mail güvenliği · Spam, phishing, BEC koruması"/>
<meta name="twitter:image" content="{og_image}"/>
<!-- SPA redirect for browsers (scraper'lar meta'ları okur ama redirect'i takip etmezler) -->
<meta http-equiv="refresh" content="0;url={landing_url}"/>
<script>window.location.replace({landing_url!r});</script>
</head>
<body>
<h1>{brand}</h1>
<p>{tagline}</p>
<p><a href="{landing_url}">Landing sayfasına yönlendiriliyorsunuz…</a></p>
</body>
</html>"""
    return HTMLResponse(content=html, headers={"Cache-Control": "public, max-age=1800"})


def _xml_escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


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
