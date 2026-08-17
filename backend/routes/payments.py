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
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
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


# v43.66 — Master-only guard (KRİTİK GÜVENLİK FİX).
# Ödeme admin endpoint'leri (havale onayı, inbox, sipariş listesi) SADECE
# master IP + master key ile erişilebilmeli. Öncesinde herhangi bir ziyaretçi
# tüm ödemeleri (isim/IBAN/tutar) görebiliyordu.
def _client_ip(request: Request) -> str:
    xf = request.headers.get("x-forwarded-for", "")
    if xf:
        return xf.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "")


async def _require_master_payments(request: Request) -> None:
    """Sadece MASTER_LICENSE_KEY sahibi + (opsiyonel) MASTER_IP erişebilir."""
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    master_ip = os.environ.get("MASTER_IP", "")
    header_key = request.headers.get("x-master-key") or ""
    cookie_key = request.cookies.get("gws_master_session") or ""

    # 1) Master session cookie (valid_until içinde)?
    if cookie_key:
        row = await db.settings.find_one({"_key": f"master_session:{cookie_key}"}, {"_id": 0})
        if row and row.get("valid_until", "") > datetime.now(timezone.utc).isoformat():
            return

    # 2) X-Master-Key header master_env ile eşleşiyor mu?
    if master_env and header_key and header_key == master_env:
        # Opsiyonel IP check
        if master_ip:
            cip = _client_ip(request)
            if cip and cip != master_ip:
                raise HTTPException(403, f"Bu işlem sadece ana yönetici sunucusundan yapılabilir (IP eşleşmedi: {cip})")
        return

    raise HTTPException(
        403,
        "Bu işlem sadece ana yönetici tarafından yapılabilir. "
        "Master anahtarınızı Header'daki 'Master Aktif Et' butonuyla girin.",
    )


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


class HavaleReject(BaseModel):
    merchant_oid: str
    reason: Optional[str] = ""


class HavaleNotify(BaseModel):
    merchant_oid: str
    transaction_ref: Optional[str] = ""    # kullanıcının verdiği banka referansı
    sender_name: Optional[str] = ""
    note: Optional[str] = ""


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
async def havale_approve(payload: HavaleApprove, request: Request):
    """Admin havaleyi doğrulayıp aktive eder. SADECE MASTER."""
    await _require_master_payments(request)
    r = await db.payments.find_one({"merchant_oid": payload.merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    await db.payments.update_one(
        {"merchant_oid": payload.merchant_oid},
        {"$set": {"status": "paid", "paid_at": _iso(),
                  "admin_note": payload.admin_note, "approved_by": "master"}},
    )
    # Bildirimi kapat
    await db.notifications_inbox.update_many(
        {"kind": "havale_notified", "merchant_oid": payload.merchant_oid, "read": False},
        {"$set": {"read": True, "read_at": _iso()}},
    )
    return {"ok": True, "merchant_oid": payload.merchant_oid, "status": "paid"}


@router.post("/havale/reject")
async def havale_reject(payload: HavaleReject, request: Request):
    """Admin havaleyi reddeder. SADECE MASTER."""
    await _require_master_payments(request)
    r = await db.payments.find_one({"merchant_oid": payload.merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    await db.payments.update_one(
        {"merchant_oid": payload.merchant_oid},
        {"$set": {"status": "rejected", "rejected_at": _iso(),
                  "reject_reason": payload.reason}},
    )
    await db.notifications_inbox.update_many(
        {"kind": "havale_notified", "merchant_oid": payload.merchant_oid, "read": False},
        {"$set": {"read": True, "read_at": _iso()}},
    )
    return {"ok": True, "merchant_oid": payload.merchant_oid, "status": "rejected"}


@router.post("/havale/notify")
async def havale_notify(payload: HavaleNotify):
    """Kullanıcı 'havale yaptım' der. Admin panelinde bekleyen listesine geçer + inbox notification üretilir."""
    r = await db.payments.find_one({"merchant_oid": payload.merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    if r.get("status") == "paid":
        return {"ok": True, "already": "paid"}
    await db.payments.update_one(
        {"merchant_oid": payload.merchant_oid},
        {"$set": {"status": "notified_by_user", "notified_at": _iso(),
                  "user_transaction_ref": payload.transaction_ref,
                  "user_sender_name": payload.sender_name,
                  "user_note": payload.note}},
    )
    # Admin inbox
    await db.notifications_inbox.insert_one({
        "id": str(uuid.uuid4()), "kind": "havale_notified",
        "merchant_oid": payload.merchant_oid,
        "amount": r.get("amount"), "email": r.get("email"),
        "user_name": r.get("user_name"),
        "sender_name": payload.sender_name,
        "transaction_ref": payload.transaction_ref,
        "note": payload.note, "created_at": _iso(),
        "read": False,
    })
    return {"ok": True, "merchant_oid": payload.merchant_oid, "status": "notified_by_user"}


@router.get("/admin/pending")
async def admin_pending(request: Request):
    """Admin: onay bekleyen havaleler (notified_by_user + awaiting_transfer)."""
    await _require_master_payments(request)
    rows = await db.payments.find(
        {"provider": "havale", "status": {"$in": ["notified_by_user", "awaiting_transfer"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return {"items": rows, "count": len(rows),
            "notified_count": sum(1 for r in rows if r.get("status") == "notified_by_user")}


@router.get("/admin/inbox")
async def admin_inbox(request: Request, limit: int = 50, only_unread: bool = False):
    await _require_master_payments(request)
    q: dict = {}
    if only_unread: q["read"] = False
    rows = await db.notifications_inbox.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    unread = await db.notifications_inbox.count_documents({"read": False})
    return {"items": rows, "unread": unread, "count": len(rows)}


@router.post("/admin/inbox/{nid}/read")
async def admin_inbox_read(request: Request, nid: str):
    await _require_master_payments(request)
    await db.notifications_inbox.update_one({"id": nid}, {"$set": {"read": True, "read_at": _iso()}})
    return {"ok": True}


@router.get("/orders")
async def list_orders(request: Request, limit: int = 50, status: Optional[str] = None):
    """Admin sipariş listesi."""
    await _require_master_payments(request)
    q: dict = {}
    if status: q["status"] = status
    rows = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows, "count": len(rows)}


@router.get("/order/{merchant_oid}")
async def get_order(request: Request, merchant_oid: str):
    await _require_master_payments(request)
    r = await db.payments.find_one({"merchant_oid": merchant_oid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Sipariş bulunamadı")
    return r


# ============================================================================
# HAVALE OTOMATİK EŞLEŞTIRME — banka ekstresi yükle, referans eşleştir
# ============================================================================
class StatementIn(BaseModel):
    raw_text: str = Field(..., min_length=10, description="Banka ekstresi metni (kopyala-yapıştır)")
    auto_approve: bool = False   # true ise eşleşenler direkt paid'e alınır


@router.post("/havale/statement-match")
async def havale_statement_match(payload: StatementIn):
    """Banka ekstresini text olarak alır, içindeki TRF... referanslarını yakalar,
    bekleyen havale siparişleriyle eşleştirir, öneri listesi döner.
    auto_approve=true ise eşleşenler direkt paid yapılır."""
    import re
    text = payload.raw_text
    # TRF + 20 hex = merchant_oid formatı
    refs = set(re.findall(r"TRF[A-F0-9]{20}", text.upper()))
    if not refs:
        return {"ok": False, "message": "Ekstre içinde referans (TRFxxx...) bulunamadı",
                "matches": [], "unmatched_refs": []}

    matches = []
    matched_refs = set()
    for ref in refs:
        order = await db.payments.find_one(
            {"merchant_oid": ref, "provider": "havale",
             "status": {"$in": ["awaiting_transfer", "notified_by_user"]}},
            {"_id": 0},
        )
        if order:
            matched_refs.add(ref)
            # Ekstre satırından tutar tespiti (basit): ref ile aynı satırda TL/decimal ara
            amount_found = None
            for line in text.split("\n"):
                if ref in line.upper():
                    m = re.search(r"([\d.]+[.,]\d{2})\s*(TL|TRY)?", line)
                    if m:
                        try:
                            amount_found = float(m.group(1).replace(".", "").replace(",", "."))
                        except Exception:
                            pass
                    break
            expected = order.get("amount")
            amount_ok = amount_found is None or abs(amount_found - expected) < 0.05
            matches.append({
                "merchant_oid": ref, "user_name": order.get("user_name"),
                "email": order.get("email"), "expected_amount": expected,
                "detected_amount": amount_found, "amount_match": amount_ok,
                "current_status": order.get("status"),
                "confidence": 100 if amount_ok else 70,
            })

    unmatched_refs = list(refs - matched_refs)

    auto_approved: list[str] = []
    if payload.auto_approve:
        for m in matches:
            if m["confidence"] >= 100:  # sadece tam eşleşme
                await db.payments.update_one(
                    {"merchant_oid": m["merchant_oid"]},
                    {"$set": {"status": "paid", "paid_at": _iso(),
                              "approved_by": "auto_statement_match",
                              "admin_note": "Banka ekstresi otomatik eşleştirme"}},
                )
                await db.notifications_inbox.update_many(
                    {"kind": "havale_notified", "merchant_oid": m["merchant_oid"], "read": False},
                    {"$set": {"read": True, "read_at": _iso()}},
                )
                auto_approved.append(m["merchant_oid"])

    # Log
    await db.statement_uploads.insert_one({
        "id": str(uuid.uuid4()),
        "refs_found": list(refs),
        "matched_count": len(matches),
        "unmatched_count": len(unmatched_refs),
        "auto_approve": payload.auto_approve,
        "auto_approved": auto_approved,
        "created_at": _iso(),
    })

    return {
        "ok": True,
        "refs_found": len(refs),
        "matches": matches,
        "unmatched_refs": unmatched_refs,
        "auto_approved": auto_approved,
        "message": (f"{len(matches)} eşleşme bulundu · {len(auto_approved)} otomatik onaylandı"
                    if payload.auto_approve else
                    f"{len(matches)} eşleşme bulundu — inceleyip onaylayın"),
    }



@router.post("/havale/statement-upload")
async def havale_statement_upload(file: UploadFile = File(...)):
    """PDF/CSV/TXT banka ekstresini yükle → metin çıkart → istemci /statement-match'a gönderir.
    pypdf ile PDF sayfalarından text çekilir; encoding fallback ile txt/csv okunur."""
    fname = (file.filename or "").lower()
    data = await file.read()
    if not data:
        raise HTTPException(400, "Boş dosya")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Dosya çok büyük (max 15MB)")

    extracted = ""
    pages = 0
    if fname.endswith(".pdf") or data[:4] == b"%PDF":
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(data))
            pages = len(reader.pages)
            chunks = []
            for i, pg in enumerate(reader.pages):
                try:
                    chunks.append(pg.extract_text() or "")
                except Exception:
                    chunks.append("")
                if i >= 50:  # güvenlik: max 50 sayfa
                    break
            extracted = "\n".join(chunks)
        except Exception as e:
            raise HTTPException(400, f"PDF okunamadı: {e}")
    else:
        for enc in ("utf-8", "utf-8-sig", "iso-8859-9", "cp1254", "latin-1"):
            try:
                extracted = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        pages = 1
    if not extracted.strip():
        raise HTTPException(400, "Dosyadan metin çıkarılamadı (taranmış PDF olabilir - OCR gerekli)")

    return {
        "ok": True,
        "filename": file.filename,
        "pages": pages,
        "size_bytes": len(data),
        "extracted_text": extracted,
        "hint": "Bu metni /statement-match endpoint'ine yollayarak referansları eşleştirin",
    }
