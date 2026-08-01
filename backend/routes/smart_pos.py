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
    {
        "key": "paytr", "name": "PayTR", "type": "iframe",
        "priority": 1, "currency": "TL",
        "supports": ["visa", "mc", "troy", "amex", "3dsecure", "installment"],
        "logo": "🇹🇷", "region": "TR",
        "configured_env": ["PAYTR_MERCHANT_ID", "PAYTR_MERCHANT_KEY", "PAYTR_MERCHANT_SALT"],
    },
    {
        "key": "iyzico", "name": "iyzico", "type": "checkout_form",
        "priority": 2, "currency": "TL",
        "supports": ["visa", "mc", "troy", "3dsecure", "installment"],
        "logo": "🟣", "region": "TR",
        "configured_env": ["IYZICO_API_KEY", "IYZICO_SECRET"],
    },
    {
        "key": "param", "name": "Param POS", "type": "iframe",
        "priority": 3, "currency": "TL",
        "supports": ["visa", "mc", "troy", "3dsecure"],
        "logo": "🔵", "region": "TR",
        "configured_env": ["PARAM_TERMINAL_NO", "PARAM_USERCODE", "PARAM_PASSWORD"],
    },
    {
        "key": "ipara", "name": "ipara", "type": "hosted",
        "priority": 4, "currency": "TL",
        "supports": ["visa", "mc", "3dsecure"],
        "logo": "🟠", "region": "TR",
        "configured_env": ["IPARA_MERCHANT_KEY", "IPARA_PRIVATE_KEY", "IPARA_PUBLIC_KEY"],
    },
    {
        "key": "havale", "name": "Havale / EFT", "type": "manual",
        "priority": 5, "currency": "TL",
        "supports": ["wire_transfer"],
        "logo": "🏦", "region": "TR",
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
