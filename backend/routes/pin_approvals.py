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


def _hash_pin(pin: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 200_000).hex()


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

    salt = secrets.token_bytes(16)
    doc = {
        "id": str(uuid.uuid4()),
        "bayi_license_key": key,
        "new_pin_hash": _hash_pin(payload.new_pin, salt),
        "new_pin_salt": salt.hex(),
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
        # PIN'i gerçekten uygula: idle_lock_settings collection'a yaz
        try:
            await db.idle_lock_user_settings.update_one(
                {"owner": doc["bayi_license_key"]},
                {"$set": {
                    "owner": doc["bayi_license_key"],
                    "pin_hash": doc["new_pin_hash"],
                    "pin_salt": doc["new_pin_salt"],
                    "pin_updated_at": _iso(),
                    "pin_failures": 0,
                    "locked_until": None,
                }},
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
