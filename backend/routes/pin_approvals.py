"""v43.90 — Bayi PIN Change Approval Workflow.

Bayi PIN değiştirmek istediğinde direkt uygulamaz; talebi `pin_change_requests`
koleksiyonuna düşürür. Master onaylayınca PIN gerçekten uygulanır.
"""
from __future__ import annotations
import os
import uuid
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/pin-approvals", tags=["pin-approvals"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_pin(pin: str, salt: str) -> str:
    """v43.99.10 — server.py::_pin_hash ile birebir aynı: salt UTF-8 encoded hex string."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("utf-8"), 200_000).hex()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


def _requester_key(request: Request) -> Optional[str]:
    """Bayi kendi kimliği için X-Master-Key header'ında kendi lisansı gelir."""
    k = request.headers.get("x-master-key") or request.headers.get("x-license-key") or ""
    return k or None


def _is_master(request: Request) -> bool:
    k = _requester_key(request)
    if not k:
        return False
    if MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY:
        return True
    return False


class PinChangeRequestIn(BaseModel):
    new_pin: str = Field(..., min_length=4, max_length=8)
    reason: str = Field("", max_length=200)


@router.post("/request")
async def request_pin_change(payload: PinChangeRequestIn, request: Request):
    """Bayi PIN değişikliği talebi oluşturur."""
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli (X-Master-Key)")
    if not payload.new_pin.isdigit():
        raise HTTPException(400, "PIN yalnızca rakam içermelidir")
    # Aynı bayı için başka pending varsa reddet (spam koruma)
    existing = await db.pin_change_requests.find_one(
        {"bayi_license_key": key, "status": "pending"}, {"_id": 0}
    )
    if existing:
        raise HTTPException(409, "Zaten bir talebiniz onay bekliyor")

    salt = secrets.token_hex(16)   # v43.99.10 — hex string (server.py ile uyumlu)
    doc = {
        "id": str(uuid.uuid4()),
        "bayi_license_key": key,
        "new_pin_hash": _hash_pin(payload.new_pin, salt),
        "new_pin_salt": salt,
        "new_pin_length": len(payload.new_pin),  # v43.99.11 — güvenli meta (master için)
        "reason": (payload.reason or "").strip()[:200],
        "status": "pending",
        "requested_at": _iso(),
        "requested_ip": _client_ip(request),
        "requested_ua": (request.headers.get("user-agent", "") or "")[:120],
    }
    await db.pin_change_requests.insert_one(doc)

    # Master'a bildirim
    try:
        await db.master_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "pin_change_request",
            "severity": "info",
            "message": f"🔐 PIN değişikliği talebi: {key[:12]}... ({doc['requested_ip']})",
            "details": {"license_key": key, "reason": doc["reason"], "request_id": doc["id"]},
            "seen": False, "read": False,
            "created_at": _iso(),
        })
    except Exception:
        pass

    doc.pop("new_pin_hash", None)
    doc.pop("new_pin_salt", None)
    return {"ok": True, "status": "pending", "request_id": doc["id"], "message": "Talebiniz onaya gönderildi"}


@router.get("/my")
async def my_pin_requests(request: Request):
    """Bayi kendi taleplerini görür (son 20)."""
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    rows = await db.pin_change_requests.find(
        {"bayi_license_key": key},
        {"_id": 0, "new_pin_hash": 0, "new_pin_salt": 0},
    ).sort("requested_at", -1).limit(20).to_list(20)
    return {"items": rows, "count": len(rows)}


@router.get("/pending")
async def list_pending(request: Request):
    """Master: bekleyen tüm PIN değişiklik taleplerini listeler."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    rows = await db.pin_change_requests.find(
        {"status": "pending"},
        {"_id": 0, "new_pin_hash": 0, "new_pin_salt": 0},
    ).sort("requested_at", -1).limit(200).to_list(200)
    # Enrich with license customer_name
    for r in rows:
        try:
            lic = await db.licenses.find_one({"license_key": r["bayi_license_key"]},
                                              {"_id": 0, "customer_name": 1, "customer_email": 1})
            if lic:
                r["customer_name"] = lic.get("customer_name")
                r["customer_email"] = lic.get("customer_email")
        except Exception:
            pass
    return {"items": rows, "count": len(rows)}


@router.get("/all")
async def list_all_requests(request: Request, status: Optional[str] = None, limit: int = 200):
    """v43.99.11 — Master: tüm PIN değişiklik geçmişini kim/nereden/ne zaman ile
    zenginleştirilmiş şekilde listeler.
    Filtre: `?status=pending|approved|rejected|cancelled_by_master_reset|superseded_by_master`
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    q = {}
    if status:
        q["status"] = status
    lim = max(1, min(limit, 500))
    # NOT: PIN hash'ini plaintext olarak ASLA dönmüyoruz. Ama hash prefix + salt prefix
    # göndererek Master'ın kayıt eşleştirme yapabilmesini sağlıyoruz.
    rows = await db.pin_change_requests.find(q).sort("requested_at", -1).limit(lim).to_list(lim)
    out = []
    for r in rows:
        r.pop("_id", None)
        pin_hash = r.pop("new_pin_hash", "") or ""
        r.pop("new_pin_salt", None)
        # Bayi bilgisi zenginleştirme
        try:
            lic = await db.licenses.find_one(
                {"license_key": r.get("bayi_license_key", "")},
                {"_id": 0, "customer_name": 1, "customer_email": 1, "plan": 1,
                 "ip_addresses": 1, "is_master": 1, "status": 1}
            )
            if lic:
                r["customer_name"] = lic.get("customer_name")
                r["customer_email"] = lic.get("customer_email")
                r["plan"] = lic.get("plan")
                r["license_status"] = lic.get("status")
                r["ip_addresses"] = lic.get("ip_addresses", [])
                r["is_master_row"] = bool(lic.get("is_master"))
            # v44.00.02 — company field'ı bayi tablosundan
            try:
                reseller = await db.resellers.find_one(
                    {"license_key": r.get("bayi_license_key", "")},
                    {"_id": 0, "company": 1, "email": 1}
                )
                if reseller:
                    r["company"] = reseller.get("company") or ""
                    if not r.get("customer_email"):
                        r["customer_email"] = reseller.get("email") or ""
            except Exception:
                pass
        except Exception:
            pass
        # PIN'in kendisi ASLA dönmez; sadece güvenli meta:
        r["pin_hash_preview"] = (pin_hash[:12] + "…") if pin_hash else None
        r["pin_length"] = r.get("new_pin_length")  # kayıtlıysa uzunluk (integer)
        out.append(r)
    return {"items": out, "count": len(out), "filter_status": status}



class PinDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field("", max_length=200)


@router.post("/{req_id}/decide")
async def decide_request(req_id: str, payload: PinDecisionIn, request: Request):
    """Master: PIN değişiklik talebini onayla/reddet."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    doc = await db.pin_change_requests.find_one({"id": req_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Talep bulunamadı")
    if doc["status"] != "pending":
        raise HTTPException(400, f"Talep zaten {doc['status']}")

    new_status = "approved" if payload.decision == "approve" else "rejected"
    updates = {
        "status": new_status,
        "decided_at": _iso(),
        "decided_by_ip": _client_ip(request),
        "decision_note": (payload.note or "").strip()[:200],
    }

    if new_status == "approved":
        # v43.99.10 — PIN'i gerçekten uygula: idle_lock_user_configs koleksiyonu, server.py ile aynı field'lar
        try:
            await db.idle_lock_user_configs.update_one(
                {"owner": doc["bayi_license_key"]},
                {"$set": {
                    "owner": doc["bayi_license_key"],
                    "pin_hash": doc["new_pin_hash"],
                    "salt": doc["new_pin_salt"],
                    "updated_at": _iso(),
                    "updated_by_ip": _client_ip(request),
                    "failed_attempts": 0,
                    "locked_until": None,
                }, "$setOnInsert": {"created_at": _iso()}},
                upsert=True,
            )
        except Exception as e:
            # Rollback: mark rejected instead
            updates["status"] = "rejected"
            updates["decision_note"] = f"Sistem hatası: {str(e)[:80]}"

    await db.pin_change_requests.update_one({"id": req_id}, {"$set": updates})

    # Bayi'ye bildirim
    try:
        await db.notifications_inbox.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": doc["bayi_license_key"],
            "type": "pin_change_decision",
            "title": ("✅ PIN Değişikliği Onaylandı" if new_status == "approved"
                       else "❌ PIN Değişikliği Reddedildi"),
            "body": updates.get("decision_note") or "",
            "created_at": _iso(),
            "read": False,
        })
    except Exception:
        pass

    # Audit
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": f"pin_change_{new_status}",
            "actor_ip": _client_ip(request),
            "details": {"request_id": req_id, "bayi": doc["bayi_license_key"], "note": updates.get("decision_note")},
            "at": _iso(),
            "severity": "info" if new_status == "approved" else "warning",
        })
    except Exception:
        pass

    return {"ok": True, "status": new_status, "request_id": req_id}


@router.delete("/{req_id}")
async def delete_request(req_id: str, request: Request):
    """v44.00.02 — Master: geçmiş PIN talebini sil.
    Yalnızca `pending` OLMAYAN kayıtlar silinebilir (aktif iş akışı silinmesin).
    Silinen kayıt için audit log yazılır.
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    doc = await db.pin_change_requests.find_one({"id": req_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Talep bulunamadı")
    if doc.get("status") == "pending":
        raise HTTPException(400, "Beklemede olan talepler silinemez — önce karar verin")
    r = await db.pin_change_requests.delete_one({"id": req_id})
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "pin_change_delete",
            "actor_ip": _client_ip(request),
            "details": {"request_id": req_id, "bayi": doc.get("bayi_license_key"), "was_status": doc.get("status")},
            "at": _iso(),
            "severity": "info",
        })
    except Exception:
        pass
    return {"ok": True, "deleted": int(r.deleted_count)}


class PinBulkDeleteIn(BaseModel):
    status: Optional[Literal["approved", "rejected", "cancelled_by_master_reset", "superseded_by_master"]] = None
    older_than_days: Optional[int] = None


@router.post("/bulk-delete")
async def bulk_delete_requests(payload: PinBulkDeleteIn, request: Request):
    """v44.00.02 — Master: geçmiş PIN taleplerini toplu sil.
    Örn. tüm 'rejected' kayıtları veya 30 günden eski karara bağlı kayıtlar.
    `pending` durumundakilere DOKUNMAZ.
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    q: dict = {"status": {"$ne": "pending"}}
    if payload.status:
        q["status"] = payload.status
    if payload.older_than_days is not None and payload.older_than_days > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - payload.older_than_days * 86400
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        q["requested_at"] = {"$lt": cutoff_iso}
    r = await db.pin_change_requests.delete_many(q)
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "pin_change_bulk_delete",
            "actor_ip": _client_ip(request),
            "details": {"filter": q, "deleted": int(r.deleted_count)},
            "at": _iso(),
            "severity": "info",
        })
    except Exception:
        pass
    return {"ok": True, "deleted": int(r.deleted_count)}



# ─────────────────────────────────────────────────────────────
# v43.99.10 — MASTER ADMIN PIN YÖNETİMİ
# Master, aktif tüm kullanıcı/bayilerin PIN durumlarını görebilir,
# gerektiğinde PIN sıfırlayabilir veya yeni PIN atayabilir.
# ─────────────────────────────────────────────────────────────

@router.get("/admin/user-pins")
async def admin_list_user_pins(request: Request):
    """Master: tüm bayilerin/kullanıcıların PIN durumunu listeler.
    Sadece meta bilgiler döner (pin_hash/salt asla plaintext olarak dönmez).
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")

    # Tüm PIN kayıtlarını topla
    rows = await db.idle_lock_user_configs.find(
        {}, {"_id": 0, "pin_hash": 0, "salt": 0}
    ).sort("updated_at", -1).limit(500).to_list(500)

    # Bayi ismini/eposta bilgisini enrich et
    for r in rows:
        owner = r.get("owner", "")
        # __master__ sentinel bilgi olarak gösterilsin
        if owner == "__master__":
            r["customer_name"] = "MASTER (Kendisi)"
            r["customer_email"] = ""
            r["is_master_row"] = True
        else:
            try:
                lic = await db.licenses.find_one(
                    {"license_key": owner},
                    {"_id": 0, "customer_name": 1, "customer_email": 1, "plan": 1,
                     "ip_addresses": 1, "is_master": 1, "status": 1}
                )
                if lic:
                    r["customer_name"] = lic.get("customer_name")
                    r["customer_email"] = lic.get("customer_email")
                    r["plan"] = lic.get("plan")
                    r["license_status"] = lic.get("status")
                    r["ip_addresses"] = lic.get("ip_addresses", [])
                    r["is_master_row"] = bool(lic.get("is_master"))
            except Exception:
                pass
        # UI için özet flag'ler
        r["has_pin"] = bool(r.pop("_has_pin", None)) if "_has_pin" in r else True  # kayıt varsa PIN vardır
        # Not: pin_hash'ı ayıkladık, has_pin doğrudan idle_lock_user_configs varlığından çıkar
        r["is_locked"] = bool(r.get("locked_until"))
        r["failed_attempts"] = int(r.get("failed_attempts") or 0)

    # PIN'i olmayan lisansları da listeye ekle (bayı henüz PIN kurmamış)
    all_lics = await db.licenses.find(
        {"status": {"$ne": "revoked"}},
        {"_id": 0, "license_key": 1, "customer_name": 1, "customer_email": 1,
         "plan": 1, "ip_addresses": 1, "is_master": 1, "status": 1}
    ).limit(500).to_list(500)
    known = {r.get("owner") for r in rows}
    for lic in all_lics:
        lk = lic.get("license_key", "")
        if lk and lk not in known:
            rows.append({
                "owner": lk,
                "customer_name": lic.get("customer_name"),
                "customer_email": lic.get("customer_email"),
                "plan": lic.get("plan"),
                "license_status": lic.get("status"),
                "ip_addresses": lic.get("ip_addresses", []),
                "is_master_row": bool(lic.get("is_master")),
                "has_pin": False,
                "is_locked": False,
                "failed_attempts": 0,
                "enabled": None,
                "updated_at": None,
            })

    return {"items": rows, "count": len(rows)}


class AdminPinResetIn(BaseModel):
    note: str = Field("", max_length=200)


@router.post("/admin/user-pins/{owner:path}/reset")
async def admin_reset_user_pin(owner: str, payload: AdminPinResetIn, request: Request):
    """Master: bir kullanıcının PIN'ini sıfırlar (kaldırır).
    Kullanıcı yeni PIN'i lisans key fallback ile veya PIN Değişiklik Talebi ile yeniden koyabilir.
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")

    doc = await db.idle_lock_user_configs.find_one({"owner": owner}) or {}
    if not doc:
        raise HTTPException(404, "Kullanıcı PIN kaydı bulunamadı")

    await db.idle_lock_user_configs.update_one(
        {"owner": owner},
        {"$set": {
            "pin_hash": None,
            "salt": None,
            "failed_attempts": 0,
            "locked_until": None,
            "updated_at": _iso(),
            "updated_by_ip": _client_ip(request),
            "reset_by_master": True,
            "reset_note": (payload.note or "").strip()[:200],
        }}
    )

    # Bayi'ye inbox bildirim
    if owner != "__master__":
        try:
            await db.notifications_inbox.insert_one({
                "id": str(uuid.uuid4()),
                "license_key": owner,
                "type": "pin_master_reset",
                "title": "🔓 PIN'iniz Master tarafından sıfırlandı",
                "body": (payload.note or "Panel üzerinden yeni PIN belirleyebilirsiniz."),
                "created_at": _iso(),
                "read": False,
            })
        except Exception:
            pass

    # Bekleyen talepleri de temizle
    try:
        await db.pin_change_requests.update_many(
            {"bayi_license_key": owner, "status": "pending"},
            {"$set": {"status": "cancelled_by_master_reset", "decided_at": _iso()}}
        )
    except Exception:
        pass

    # Audit
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "pin_master_reset",
            "actor_ip": _client_ip(request),
            "details": {"target_owner": owner, "note": payload.note},
            "at": _iso(), "severity": "warning",
        })
    except Exception:
        pass

    return {"ok": True, "owner": owner, "action": "reset"}


class AdminPinSetIn(BaseModel):
    new_pin: str = Field(..., min_length=4, max_length=8)
    note: str = Field("", max_length=200)


@router.post("/admin/user-pins/{owner:path}/set")
async def admin_set_user_pin(owner: str, payload: AdminPinSetIn, request: Request):
    """Master: bir kullanıcı için doğrudan yeni PIN belirler.
    Bayi'ye bildirim ile iletilir. Onay akışı gerekmeksizin uygulanır.
    """
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    if not payload.new_pin.isdigit():
        raise HTTPException(400, "PIN yalnızca rakam içermelidir")

    salt = secrets.token_hex(16)
    pin_hash = _hash_pin(payload.new_pin, salt)

    await db.idle_lock_user_configs.update_one(
        {"owner": owner},
        {"$set": {
            "owner": owner,
            "pin_hash": pin_hash,
            "salt": salt,
            "failed_attempts": 0,
            "locked_until": None,
            "updated_at": _iso(),
            "updated_by_ip": _client_ip(request),
            "set_by_master": True,
        }, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )

    # Bayi'ye inbox bildirim (PIN'in kendisi asla plaintext olarak yazılmaz;
    # Master zaten belirlediği PIN'i biliyor ve bayiye kanal dışı iletir).
    if owner != "__master__":
        try:
            await db.notifications_inbox.insert_one({
                "id": str(uuid.uuid4()),
                "license_key": owner,
                "type": "pin_master_set",
                "title": "🔐 PIN'iniz Master tarafından yenilendi",
                "body": (payload.note or "Yeni PIN'iniz Master tarafından iletildi. Kilit ekranında kullanabilirsiniz."),
                "created_at": _iso(),
                "read": False,
            })
        except Exception:
            pass

    # Bekleyen talepleri süpür
    try:
        await db.pin_change_requests.update_many(
            {"bayi_license_key": owner, "status": "pending"},
            {"$set": {"status": "superseded_by_master", "decided_at": _iso()}}
        )
    except Exception:
        pass

    # Audit — PIN'in kendisi ASLA loglanmaz
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "pin_master_set",
            "actor_ip": _client_ip(request),
            "details": {"target_owner": owner, "note": payload.note, "pin_length": len(payload.new_pin)},
            "at": _iso(), "severity": "warning",
        })
    except Exception:
        pass

    return {"ok": True, "owner": owner, "action": "set", "pin_length": len(payload.new_pin)}


@router.post("/admin/user-pins/{owner:path}/unlock")
async def admin_unlock_user_pin(owner: str, request: Request):
    """Master: PIN'de kilitlenmiş kullanıcıyı hemen açar (failed_attempts=0)."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master yetkilendirilmiştir")
    r = await db.idle_lock_user_configs.update_one(
        {"owner": owner},
        {"$set": {
            "failed_attempts": 0,
            "locked_until": None,
            "unlocked_by_master_at": _iso(),
        }}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "pin_master_unlock",
            "actor_ip": _client_ip(request),
            "details": {"target_owner": owner},
            "at": _iso(), "severity": "info",
        })
    except Exception:
        pass
    return {"ok": True, "owner": owner, "action": "unlock"}
