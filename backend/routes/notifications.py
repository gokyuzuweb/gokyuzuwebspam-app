"""v44.00.47 — Recipient Alert Notifications
Bir alici (to_addr) icin engellenen zararli maillerin listesi. Bayi kendi
kullanicilarina "size 3 zararli mail gonderildi ama engellendi" ozeti
gonderebilir. Frontend UI kullanicilara bildirim gostermek icin cekebilir.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Query

from deps import db

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/recipient-alerts")
async def recipient_alerts_list(
    license_key: Optional[str] = None,
    recipient: Optional[str] = None,
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(200, ge=1, le=1000),
):
    """Alici bazli zararli mail engelleme kayitlari.
    * `license_key` verilirse tenant filter uygulanir.
    * `recipient` verilirse sadece o alicinin engelleri.
    """
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    filt: dict = {"created_at": {"$gte": since}}
    if license_key:
        filt["license_key"] = license_key
    if recipient:
        filt["recipient"] = recipient.lower().strip()
    rows = await db.recipient_alerts.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    total = await db.recipient_alerts.count_documents(filt)
    return {"items": rows, "count": len(rows), "total": total, "hours": hours}


@router.get("/recipient-alerts/digest")
async def recipient_alerts_digest(
    license_key: Optional[str] = None,
    hours: int = Query(24, ge=1, le=720),
):
    """Bayi icin toplu ozet — hangi alici kac zararli mail aldi, hangi kaynaklardan.
    Bayi bu veriyi gunluk digest mail'ine dokebilir.
    """
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    filt: dict = {"created_at": {"$gte": since}}
    if license_key:
        filt["license_key"] = license_key
    pipeline = [
        {"$match": filt},
        {"$group": {
            "_id": "$recipient",
            "count": {"$sum": 1},
            "kinds": {"$addToSet": "$malware_kind"},
            "senders": {"$addToSet": "$sender"},
            "last_ts": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 50},
        {"$project": {
            "recipient": "$_id",
            "count": 1, "kinds": 1,
            "senders_top3": {"$slice": ["$senders", 3]},
            "last_ts": 1, "_id": 0,
        }},
    ]
    top_recipients = await db.recipient_alerts.aggregate(pipeline).to_list(50)
    total = await db.recipient_alerts.count_documents(filt)
    return {
        "hours": hours,
        "total_blocked": total,
        "affected_recipients": len(top_recipients),
        "top_recipients": top_recipients,
    }


@router.post("/recipient-alerts/mark-notified")
async def recipient_alerts_mark(license_key: str, recipient: Optional[str] = None):
    """Bildirim gonderildi olarak isaretle (idempotent digest icin)."""
    filt: dict = {"license_key": license_key, "notified": False}
    if recipient:
        filt["recipient"] = recipient.lower().strip()
    r = await db.recipient_alerts.update_many(
        filt, {"$set": {"notified": True, "notified_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"updated": r.modified_count}
