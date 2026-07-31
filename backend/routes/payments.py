"""
PayTR iFrame API + Manual Havale/EFT (Wire Transfer).
Türkiye ödeme geçidi entegrasyonu.
- PayTR: kartlı ödeme (iframe) — mock/test modu ile canlı akış
- Havale: IBAN göster + admin manuel onay
"""
from __future__ import annotations
import os, uuid, base64, hmac, hashlib, json
from datetime import datetime, timezone
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, EmailStr
from deps import db

router = APIRouter(prefix="/payments", tags=["payments"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


PAYTR_MERCHANT_ID   = os.environ.get("PAYTR_MERCHANT_ID", "")
PAYTR_MERCHANT_KEY  = os.environ.get("PAYTR_MERCHANT_KEY", "")
PAYTR_MERCHANT_SALT = os.environ.get("PAYTR_MERCHANT_SALT", "")
PAYTR_TOKEN_URL     = os.environ.get("PAYTR_TOKEN_URL", "https://www.paytr.com/odeme/api/get-token")
PAYTR_IFRAME_URL    = os.environ.get("PAYTR_IFRAME_URL", "https://www.paytr.com/odeme/guvenli/")
BANK_IBAN           = os.environ.get("BANK_IBAN", "TR33 0006 4000 0011 2345 6789 01")
BANK_NAME           = os.environ.get("BANK_NAME", "Ziraat Bankası")
BANK_BENEFICIARY    = os.environ.get("BANK_BENEFICIARY", "Gökyüzü Bilgisayar Ltd. Şti.")


class CartItem(BaseModel):
    name: str
    price: float
    qty: int = 1


class PayTRRequest(BaseModel):
    email: EmailStr
    user_name: str
    user_address: str = "Türkiye"
    user_phone: str = "05555555555"
    items: list[CartItem]
    plan: Optional[str] = None
    currency: str = "TL"
    test_mode: int = 1
    lang: str = "tr"


class HavaleRequest(BaseModel):
    email: EmailStr
    user_name: str
    amount: float
    plan: Optional[str] = None
    note: Optional[str] = ""


class HavaleApprove(BaseModel):
    merchant_oid: str
    admin_note: Optional[str] = ""


def _get_ip(req: Request) -> str:
    xff = req.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else "127.0.0.1"


def _basket_b64(items: list[CartItem]) -> str:
    raw = [[i.name, f"{i.price:.2f}", i.qty] for i in items]
    return base64.b64encode(json.dumps(raw, ensure_ascii=False).encode()).decode()


@router.get("/config")
async def payment_config():
    """Ödeme sağlayıcı durumu — frontend bunu okur, hangisi aktif?"""
    return {
        "paytr_configured": bool(PAYTR_MERCHANT_ID and PAYTR_MERCHANT_KEY and PAYTR_MERCHANT_SALT),
        "paytr_test_mode": True,   # panel test modunda
        "bank_iban": BANK_IBAN,
        "bank_name": BANK_NAME,
        "bank_beneficiary": BANK_BENEFICIARY,
    }


@router.post("/paytr/create")
async def paytr_create(payload: PayTRRequest, request: Request):
    """PayTR iframe token oluştur. Anahtar yoksa MOCK modda çalışır."""
    total = sum(i.price * i.qty for i in payload.items)
    if total <= 0:
        raise HTTPException(400, "Geçersiz sepet toplamı")
    payment_amount = int(round(total * 100))  # kuruş
    merchant_oid = f"ORD{uuid.uuid4().hex[:20].upper()}"
    doc = {
        "id": merchant_oid, "merchant_oid": merchant_oid,
        "provider": "paytr", "status": "pending",
        "email": payload.email, "user_name": payload.user_name,
        "amount": total, "currency": payload.currency,
        "plan": payload.plan, "items": [i.model_dump() for i in payload.items],
        "test_mode": payload.test_mode, "created_at": _iso(),
    }
    # MOCK modu: gerçek PayTR key yoksa test token dönelim
    if not (PAYTR_MERCHANT_ID and PAYTR_MERCHANT_KEY and PAYTR_MERCHANT_SALT):
        doc["mock"] = True
        doc["iframe_token"] = f"mock-{merchant_oid.lower()}"
        doc["iframe_src"] = f"{PAYTR_IFRAME_URL}mock-{merchant_oid.lower()}"
        await db.payments.insert_one(dict(doc))
        return {"ok": True, "mock": True, "merchant_oid": merchant_oid,
                "iframe_token": doc["iframe_token"], "iframe_src": doc["iframe_src"],
                "amount": total, "note": "PayTR test/mock modu — canlı için MERCHANT bilgilerini .env'e ekleyin"}
    # Gerçek PayTR isteği
    try:
        import requests
        user_ip = _get_ip(request)
        user_basket = _basket_b64(payload.items)
        hash_str = (f"{PAYTR_MERCHANT_ID}{user_ip}{merchant_oid}{payload.email}"
                    f"{payment_amount}{user_basket}0 0{payload.currency}{payload.test_mode}")
        token = base64.b64encode(hmac.new(
            PAYTR_MERCHANT_KEY.encode(),
            (hash_str + PAYTR_MERCHANT_SALT).encode(),
            hashlib.sha256,
        ).digest()).decode()
        data = {
            "merchant_id": PAYTR_MERCHANT_ID, "user_ip": user_ip,
            "merchant_oid": merchant_oid, "email": payload.email,
            "payment_amount": str(payment_amount), "paytr_token": token,
            "user_basket": user_basket, "debug_on": 1,
            "no_installment": 0, "max_installment": 0,
            "user_name": payload.user_name, "user_address": payload.user_address,
            "user_phone": payload.user_phone,
            "merchant_ok_url": os.environ.get("FRONTEND_BASE_URL", "https://gokyuzuhosting.com") + "/checkout/success",
            "merchant_fail_url": os.environ.get("FRONTEND_BASE_URL", "https://gokyuzuhosting.com") + "/checkout/fail",
            "timeout_limit": 30, "currency": payload.currency,
            "test_mode": payload.test_mode, "lang": payload.lang,
        }
        r = requests.post(PAYTR_TOKEN_URL, data=data, timeout=15)
        res = r.json()
        if res.get("status") != "success":
            raise HTTPException(400, res.get("reason", "PayTR token hatası"))
        doc["iframe_token"] = res["token"]
        doc["iframe_src"] = f"{PAYTR_IFRAME_URL}{res['token']}"
        await db.payments.insert_one(dict(doc))
        return {"ok": True, "merchant_oid": merchant_oid,
                "iframe_token": res["token"], "iframe_src": doc["iframe_src"],
                "amount": total}
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(500, f"PayTR isteği başarısız: {type(ex).__name__}: {str(ex)[:100]}")


@router.post("/paytr/callback")
async def paytr_callback(request: Request):
    """PayTR ödeme sonucu callback. Text 'OK' dönmek zorunlu."""
    from fastapi.responses import PlainTextResponse
    form = await request.form()
    merchant_oid = form.get("merchant_oid")
    status = form.get("status")
    total_amount = form.get("total_amount")
    hash_value = form.get("hash")
    order = await db.payments.find_one({"merchant_oid": merchant_oid}, {"_id": 0})
    if not order:
        return PlainTextResponse("OK")
    if order.get("status") in ("paid", "failed"):
        return PlainTextResponse("OK")
    # Hash doğrula (mock atlanır)
    if not order.get("mock") and PAYTR_MERCHANT_KEY:
        raw = f"{merchant_oid}{PAYTR_MERCHANT_SALT}{status}{total_amount}"
        expected = base64.b64encode(hmac.new(
            PAYTR_MERCHANT_KEY.encode(), raw.encode(), hashlib.sha256).digest()).decode()
        if hash_value != expected:
            return PlainTextResponse("bad hash", status_code=400)
    new_status = "paid" if status == "success" else "failed"
    await db.payments.update_one(
        {"merchant_oid": merchant_oid},
        {"$set": {"status": new_status, "paid_at": _iso(),
                  "paid_amount": total_amount, "callback_status": status}},
    )
    return PlainTextResponse("OK")


@router.post("/havale/create")
async def havale_create(payload: HavaleRequest):
    """Havale/EFT sipariş oluştur, kullanıcıya IBAN göster."""
    if payload.amount <= 0:
        raise HTTPException(400, "Geçersiz tutar")
    merchant_oid = f"TRF{uuid.uuid4().hex[:20].upper()}"
    doc = {
        "id": merchant_oid, "merchant_oid": merchant_oid,
        "provider": "havale", "status": "awaiting_transfer",
        "email": payload.email, "user_name": payload.user_name,
        "amount": payload.amount, "currency": "TL",
        "plan": payload.plan, "note": payload.note or "",
        "created_at": _iso(),
    }
    await db.payments.insert_one(dict(doc))
    return {
        "ok": True, "merchant_oid": merchant_oid,
        "iban": BANK_IBAN, "bank": BANK_NAME, "beneficiary": BANK_BENEFICIARY,
        "amount": payload.amount, "reference": merchant_oid,
        "status": "awaiting_transfer",
        "instructions": (
            f"Lütfen aşağıdaki IBAN'a {payload.amount:.2f} TL havale yapın. "
            f"AÇIKLAMA/REFERANS alanına mutlaka '{merchant_oid}' yazın. "
            f"Ödemeniz doğrulandıktan sonra lisansınız 24 saat içinde aktive edilecektir."
        ),
    }


@router.post("/havale/approve")
async def havale_approve(payload: HavaleApprove):
    """Admin havaleyi doğrulayıp aktive eder."""
    r = await db.payments.find_one({"merchant_oid": payload.merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    await db.payments.update_one(
        {"merchant_oid": payload.merchant_oid},
        {"$set": {"status": "paid", "paid_at": _iso(),
                  "admin_note": payload.admin_note, "approved_by": "master"}},
    )
    return {"ok": True, "merchant_oid": payload.merchant_oid, "status": "paid"}


@router.get("/orders")
async def list_orders(limit: int = 50, status: Optional[str] = None):
    """Admin sipariş listesi."""
    q: dict = {}
    if status: q["status"] = status
    rows = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows, "count": len(rows)}


@router.get("/order/{merchant_oid}")
async def get_order(merchant_oid: str):
    r = await db.payments.find_one({"merchant_oid": merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    return r
