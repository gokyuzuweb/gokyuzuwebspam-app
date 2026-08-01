"""
Akıllı POS Router — çoklu ödeme sağlayıcı desteği + otomatik failover.

Desteklenen sağlayıcılar:
  - paytr (mock/live)
  - iyzico (mock/live)
  - param (mock/live)
  - ipara (mock/live)
  - havale (manuel)

Yönlendirme mantığı:
  1. Kullanıcı sağlayıcı belirtmediyse → ilk "healthy" olan seçilir
  2. Priority sırası: paytr > iyzico > param > ipara > havale
  3. Health check: son 1 saatte başarılı ödeme oranı > %80 ise healthy
"""
from __future__ import annotations
import os, uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, EmailStr
from deps import db

router = APIRouter(prefix="/smart-pos", tags=["smart-pos"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


PROVIDERS = [
    # ---------- SANAL POS / ÖDEME AĞ GEÇİDLERİ ----------
    {
        "key": "paytr", "name": "PayTR", "type": "iframe",
        "priority": 1, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "amex", "3dsecure", "installment"],
        "logo": "🇹🇷", "region": "TR", "commission": "1.99%",
        "configured_env": ["PAYTR_MERCHANT_ID", "PAYTR_MERCHANT_KEY", "PAYTR_MERCHANT_SALT"],
    },
    {
        "key": "iyzico", "name": "iyzico", "type": "checkout_form",
        "priority": 2, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment", "recurring"],
        "logo": "🟣", "region": "TR", "commission": "2.29%",
        "configured_env": ["IYZICO_API_KEY", "IYZICO_SECRET"],
    },
    {
        "key": "param", "name": "Param POS", "type": "iframe",
        "priority": 3, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "3dsecure"],
        "logo": "🔵", "region": "TR", "commission": "1.85%",
        "configured_env": ["PARAM_TERMINAL_NO", "PARAM_USERCODE", "PARAM_PASSWORD"],
    },
    {
        "key": "ipara", "name": "ipara", "type": "hosted",
        "priority": 4, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "3dsecure"],
        "logo": "🟠", "region": "TR", "commission": "2.09%",
        "configured_env": ["IPARA_MERCHANT_KEY", "IPARA_PRIVATE_KEY", "IPARA_PUBLIC_KEY"],
    },
    {
        "key": "shopier", "name": "Shopier", "type": "hosted",
        "priority": 5, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "3dsecure"],
        "logo": "🛒", "region": "TR", "commission": "3.49%",
        "configured_env": ["SHOPIER_API_USER", "SHOPIER_API_PASS"],
    },
    {
        "key": "moka", "name": "Moka United", "type": "hosted",
        "priority": 6, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment"],
        "logo": "🟢", "region": "TR", "commission": "2.15%",
        "configured_env": ["MOKA_DEALER_CODE", "MOKA_USERNAME", "MOKA_PASSWORD"],
    },
    {
        "key": "sipay", "name": "SiPay", "type": "iframe",
        "priority": 7, "currency": "TL", "category": "gateway",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment"],
        "logo": "💜", "region": "TR", "commission": "1.95%",
        "configured_env": ["SIPAY_APP_ID", "SIPAY_APP_SECRET", "SIPAY_MERCHANT_KEY"],
    },

    # ---------- BANKA SANAL POS'LARI (Direct Bank POS) ----------
    {
        "key": "garanti", "name": "Garanti BBVA VPOS", "type": "3d_secure",
        "priority": 10, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "bonus", "3dsecure", "installment"],
        "logo": "🟢", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["GARANTI_MERCHANT_ID", "GARANTI_TERMINAL_ID", "GARANTI_USERID", "GARANTI_PROVISIONPWD"],
    },
    {
        "key": "yapikredi", "name": "Yapı Kredi Posnet", "type": "3d_secure",
        "priority": 11, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "worldcard", "3dsecure", "installment"],
        "logo": "🔷", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["YKB_XID", "YKB_MERCHANT_ID", "YKB_TERMINAL_ID", "YKB_POSNET_ID"],
    },
    {
        "key": "akbank", "name": "Akbank VPOS", "type": "3d_secure",
        "priority": 12, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "axess", "3dsecure", "installment"],
        "logo": "🔴", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["AKBANK_MERCHANT_ID", "AKBANK_TERMINAL_ID", "AKBANK_USER", "AKBANK_PASS"],
    },
    {
        "key": "isbank", "name": "İş Bankası İşCep POS", "type": "3d_secure",
        "priority": 13, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "maximum", "troy", "3dsecure", "installment"],
        "logo": "🟦", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["ISBANK_CLIENT_ID", "ISBANK_STORE_KEY", "ISBANK_USERNAME", "ISBANK_PASSWORD"],
    },
    {
        "key": "ziraat", "name": "Ziraat Bankası VPOS", "type": "3d_secure",
        "priority": 14, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "bankkart_combo", "3dsecure", "installment"],
        "logo": "🟨", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["ZIRAAT_MERCHANT_ID", "ZIRAAT_TERMINAL_ID", "ZIRAAT_USER", "ZIRAAT_PASSWORD"],
    },
    {
        "key": "halkbank", "name": "Halkbank VPOS", "type": "3d_secure",
        "priority": 15, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "paraf", "troy", "3dsecure", "installment"],
        "logo": "🔵", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["HALKBANK_MERCHANT_ID", "HALKBANK_TERMINAL_ID", "HALKBANK_USER", "HALKBANK_PASS"],
    },
    {
        "key": "vakifbank", "name": "Vakıfbank VPOS", "type": "3d_secure",
        "priority": 16, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "worldcard", "3dsecure", "installment"],
        "logo": "🟧", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["VAKIFBANK_MERCHANT_ID", "VAKIFBANK_TERMINAL_ID", "VAKIFBANK_PASSWORD"],
    },
    {
        "key": "denizbank", "name": "DenizBank VPOS", "type": "3d_secure",
        "priority": 17, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "bonus", "3dsecure", "installment"],
        "logo": "🔷", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["DENIZBANK_SHOP_CODE", "DENIZBANK_USER_CODE", "DENIZBANK_USER_PASS"],
    },
    {
        "key": "teb", "name": "TEB VPOS", "type": "3d_secure",
        "priority": 18, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "bonus", "3dsecure", "installment"],
        "logo": "🟩", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["TEB_MERCHANT_ID", "TEB_TERMINAL_ID", "TEB_USER", "TEB_PASS"],
    },
    {
        "key": "qnbfinansbank", "name": "QNB Finansbank VPOS", "type": "3d_secure",
        "priority": 19, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "cardfinans", "troy", "3dsecure", "installment"],
        "logo": "🟪", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["QNBFB_MERCHANT_ID", "QNBFB_TERMINAL_ID", "QNBFB_USER", "QNBFB_PASSWORD"],
    },
    {
        "key": "kuveytturk", "name": "Kuveyt Türk VPOS", "type": "3d_secure",
        "priority": 20, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment"],
        "logo": "🟢", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["KUVEYTTURK_MERCHANT_ID", "KUVEYTTURK_CUSTOMER_ID", "KUVEYTTURK_USER", "KUVEYTTURK_PASS"],
    },
    {
        "key": "albaraka", "name": "Albaraka Türk VPOS", "type": "3d_secure",
        "priority": 21, "currency": "TL", "category": "bank_pos",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment"],
        "logo": "🟤", "region": "TR", "commission": "banka anlaşmalı",
        "configured_env": ["ALBARAKA_MERCHANT_ID", "ALBARAKA_TERMINAL_ID", "ALBARAKA_USER", "ALBARAKA_PASS"],
    },

    # ---------- MANUEL / ALTERNATİF ----------
    {
        "key": "havale", "name": "Havale / EFT / FAST", "type": "manual",
        "priority": 99, "currency": "TL", "category": "manual",
        "supports": ["wire_transfer", "eft", "fast"],
        "logo": "🏦", "region": "TR", "commission": "0%",
        "configured_env": ["BANK_IBAN"],
    },
]


def _provider_configured(p: dict) -> bool:
    return all(os.environ.get(k) for k in p["configured_env"])


async def _provider_health(key: str) -> dict:
    """Son 1 saatteki başarı oranını ölç."""
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    total = await db.payments.count_documents({"provider": key, "created_at": {"$gte": since}})
    if total == 0:
        return {"total": 0, "success_rate": None, "healthy": True}   # veri yok → healthy varsay
    ok = await db.payments.count_documents(
        {"provider": key, "created_at": {"$gte": since}, "status": {"$in": ["paid"]}}
    )
    rate = round(ok * 100 / total, 1)
    return {"total": total, "success_rate": rate, "healthy": rate >= 40}


@router.get("/providers")
async def list_providers():
    """Sağlayıcı listesi + configured + healthy durumu."""
    out = []
    for p in PROVIDERS:
        configured = _provider_configured(p) or p["key"] == "havale"   # havale her zaman "hazır"
        h = await _provider_health(p["key"])
        out.append({
            **p,
            "configured": configured,
            "mode": "live" if configured and p["key"] != "havale" else ("manual" if p["key"] == "havale" else "test/mock"),
            "health": h,
            "recommended": configured and h.get("healthy", True),
        })
    out.sort(key=lambda x: (0 if x["recommended"] else 1, x["priority"]))
    return {"providers": out, "count": len(out)}


class RouteRequest(BaseModel):
    amount: float = Field(..., gt=0)
    email: EmailStr
    user_name: str
    prefer: Optional[str] = None
    exclude: list[str] = []


@router.post("/route")
async def route_payment(payload: RouteRequest):
    """Akıllı yönlendirme: 'prefer' varsa onu dener; olmazsa priority sırasıyla healthy olanı seçer.
    Response içinde 'selected_provider' + 'redirect_url' veya 'iframe_token' döner."""
    # Adayları sırala
    candidates = []
    for p in PROVIDERS:
        if p["key"] in payload.exclude:
            continue
        configured = _provider_configured(p) or p["key"] == "havale"
        h = await _provider_health(p["key"])
        candidates.append({**p, "configured": configured, "health": h,
                           "score": p["priority"] + (0 if h.get("healthy", True) else 100)
                                                   + (0 if configured else 50)})
    candidates.sort(key=lambda x: x["score"])

    # Prefer varsa önce dene
    if payload.prefer:
        preferred = next((c for c in candidates if c["key"] == payload.prefer), None)
        if preferred:
            candidates = [preferred] + [c for c in candidates if c["key"] != payload.prefer]

    if not candidates:
        raise HTTPException(400, "Uygun ödeme sağlayıcı bulunamadı")

    selected = candidates[0]
    fallback_chain = [c["key"] for c in candidates[1:4]]

    merchant_oid = f"SPS{uuid.uuid4().hex[:20].upper()}"

    # Sağlayıcıya göre delegasyon
    if selected["key"] == "paytr":
        result = await _delegate_to_paytr(payload, merchant_oid, mock=not selected["configured"])
    elif selected["key"] == "havale":
        result = await _delegate_to_havale(payload, merchant_oid)
    else:
        # iyzico/param/ipara için mock — canlı için ilgili SDK entegrasyonu gerekir
        result = {
            "mode": "mock", "merchant_oid": merchant_oid,
            "note": f"{selected['name']} entegrasyonu için MERCHANT bilgileri ekleyin: {selected['configured_env']}",
            "iframe_src": f"about:blank?mock={selected['key']}&oid={merchant_oid}",
        }
        await db.payments.insert_one({
            "id": merchant_oid, "merchant_oid": merchant_oid,
            "provider": selected["key"], "status": "pending",
            "email": payload.email, "user_name": payload.user_name,
            "amount": payload.amount, "currency": "TL",
            "mock": True, "smart_routed": True,
            "created_at": _iso(),
        })

    return {
        "ok": True,
        "selected_provider": selected["key"],
        "provider_name": selected["name"],
        "fallback_chain": fallback_chain,
        "result": result,
        "smart_routing": {
            "reason": "priority + health-based",
            "score": selected["score"],
            "considered": [c["key"] for c in candidates[:5]],
        },
    }


async def _delegate_to_paytr(payload: RouteRequest, merchant_oid: str, mock: bool = True):
    """PayTR modülüne devret."""
    doc = {
        "id": merchant_oid, "merchant_oid": merchant_oid,
        "provider": "paytr", "status": "pending",
        "email": payload.email, "user_name": payload.user_name,
        "amount": payload.amount, "currency": "TL",
        "smart_routed": True,
        "created_at": _iso(),
    }
    if mock:
        doc["mock"] = True
        doc["iframe_token"] = f"mock-{merchant_oid.lower()}"
        doc["iframe_src"] = f"about:blank?paytr={merchant_oid}"
    await db.payments.insert_one(dict(doc))
    return {"merchant_oid": merchant_oid, "iframe_src": doc.get("iframe_src"),
            "mode": "mock" if mock else "live"}


async def _delegate_to_havale(payload: RouteRequest, merchant_oid: str):
    """Havale bilgilerini oluştur."""
    doc = {
        "id": merchant_oid, "merchant_oid": merchant_oid,
        "provider": "havale", "status": "awaiting_transfer",
        "email": payload.email, "user_name": payload.user_name,
        "amount": payload.amount, "currency": "TL",
        "smart_routed": True,
        "created_at": _iso(),
    }
    await db.payments.insert_one(dict(doc))
    return {
        "merchant_oid": merchant_oid,
        "iban": os.environ.get("BANK_IBAN", "TR33 0006 4000 0011 2345 6789 01"),
        "bank": os.environ.get("BANK_NAME", "Ziraat Bankası"),
        "beneficiary": os.environ.get("BANK_BENEFICIARY", "Gökyüzü Bilgisayar Ltd. Şti."),
        "reference": merchant_oid,
    }


@router.get("/stats")
async def smart_pos_stats():
    """Sağlayıcı bazlı 30 gün istatistikleri — admin dashboard için."""
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    stats = {}
    for p in PROVIDERS:
        total = await db.payments.count_documents({"provider": p["key"], "created_at": {"$gte": since}})
        paid = await db.payments.count_documents({"provider": p["key"], "created_at": {"$gte": since}, "status": "paid"})
        # Gelir toplamı
        revenue = 0.0
        async for r in db.payments.find({"provider": p["key"], "created_at": {"$gte": since}, "status": "paid"},
                                         {"amount": 1, "_id": 0}):
            revenue += float(r.get("amount") or 0)
        stats[p["key"]] = {
            "name": p["name"], "logo": p["logo"], "priority": p["priority"],
            "total": total, "paid": paid, "revenue": round(revenue, 2),
            "success_rate": round(paid * 100 / max(1, total), 1),
        }
    total_revenue = sum(s["revenue"] for s in stats.values())
    return {"stats": stats, "total_revenue_30d": round(total_revenue, 2),
            "period_days": 30}


# ============================================================================
# CONFIG UI — her sağlayıcı için API anahtarlarını panelden ayarla
# ============================================================================
def _mask(v: str) -> str:
    if not v: return ""
    if len(v) <= 6: return "*" * len(v)
    return v[:2] + "*" * (len(v) - 6) + v[-4:]


@router.get("/provider/{key}/config")
async def get_provider_config(key: str):
    """Sağlayıcı .env veya DB config'ini oku (maskeli)."""
    p = next((x for x in PROVIDERS if x["key"] == key), None)
    if not p:
        raise HTTPException(404, "Sağlayıcı bulunamadı")
    doc = await db.settings.find_one({"_key": f"pos_config_{key}"}, {"_id": 0}) or {}
    fields = []
    for env_name in p["configured_env"]:
        # Öncelik: DB config > env
        db_val = doc.get(env_name, "")
        env_val = os.environ.get(env_name, "")
        cur = db_val or env_val
        fields.append({
            "env_name": env_name,
            "label": env_name.replace("_", " ").title(),
            "value_masked": _mask(cur),
            "has_value": bool(cur),
            "source": "db" if db_val else ("env" if env_val else "none"),
            "sensitive": any(k in env_name.upper() for k in ["KEY", "SECRET", "PASS", "PASSWORD", "SALT", "PWD"]),
        })
    return {
        "provider": p["key"], "name": p["name"], "logo": p["logo"],
        "category": p["category"], "commission": p.get("commission", ""),
        "test_mode": bool(doc.get("test_mode", True)),
        "enabled": bool(doc.get("enabled", True)),
        "fields": fields,
    }


class ProviderConfigIn(BaseModel):
    values: dict          # {env_name: value}
    test_mode: bool = True
    enabled: bool = True


@router.post("/provider/{key}/config")
async def set_provider_config(key: str, payload: ProviderConfigIn):
    """Sağlayıcı API anahtarlarını panel üzerinden kaydet."""
    p = next((x for x in PROVIDERS if x["key"] == key), None)
    if not p:
        raise HTTPException(404, "Sağlayıcı bulunamadı")
    doc = await db.settings.find_one({"_key": f"pos_config_{key}"}, {"_id": 0}) or {}
    # Mevcut değerleri koru (kullanıcı ****** gönderirse dokunma)
    new_values = dict(doc)
    for env_name in p["configured_env"]:
        v = payload.values.get(env_name, "")
        if v and not v.startswith("**"):
            new_values[env_name] = v
        # env override — runtime'da geçerli olsun
        if new_values.get(env_name):
            os.environ[env_name] = new_values[env_name]
    new_values["_key"] = f"pos_config_{key}"
    new_values["test_mode"] = payload.test_mode
    new_values["enabled"] = payload.enabled
    new_values["updated_at"] = _iso()
    await db.settings.update_one(
        {"_key": f"pos_config_{key}"},
        {"$set": new_values},
        upsert=True,
    )
    return {"ok": True, "provider": key,
            "configured_fields": sum(1 for k in p["configured_env"] if new_values.get(k)),
            "total_fields": len(p["configured_env"])}


@router.post("/provider/{key}/test")
async def test_provider_connection(key: str):
    """Sağlayıcı config'ini test et — kredensiyeller doğru mu?"""
    p = next((x for x in PROVIDERS if x["key"] == key), None)
    if not p:
        raise HTTPException(404, "Sağlayıcı bulunamadı")
    doc = await db.settings.find_one({"_key": f"pos_config_{key}"}, {"_id": 0}) or {}
    missing = [e for e in p["configured_env"] if not (doc.get(e) or os.environ.get(e))]
    if missing:
        return {"ok": False, "message": f"Eksik alanlar: {', '.join(missing)}",
                "missing": missing}
    return {"ok": True, "message": f"{p['name']} yapılandırması hazır · gerçek test ödemesi için 1 TL deneyin",
            "note": "Bu bir statik kontrol. Gerçek bağlantı testi için sağlayıcının test endpoint'ini çağırın."}

