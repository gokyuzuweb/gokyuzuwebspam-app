"""
Mail Event ingestion + listing (SaaS mode).
Milter (yerel WHM sunucusu) her taranmis mail icin buraya POST atar,
panel de buradan license_key'e gore filtreli olarak listeler.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from deps import db
import uuid

router = APIRouter(prefix="/events", tags=["events"])


class MailEvent(BaseModel):
    license_key: str = Field(..., min_length=8)
    server_ip: Optional[str] = None
    server_hostname: Optional[str] = None
    exim_mid: Optional[str] = None   # Exim message id (spool executor icin)
    from_addr: Optional[str] = None
    to_addr: Optional[str] = None
    subject: Optional[str] = None
    verdict: str = Field(..., pattern="^(clean|spam|high_spam|virus|blocked|whitelisted)$")
    action: Optional[str] = None
    total_score: float = 0.0
    scores: dict[str, Any] = Field(default_factory=dict)
    headers_preview: Optional[str] = None
    ts: Optional[str] = None  # ISO ts, milter tarafinda uretilirse


async def _validate_license(license_key: str) -> dict:
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(401, "Gecersiz lisans anahtari")
    if lic.get("active") is False:
        raise HTTPException(403, "Lisans pasif/iptal")
    return lic


@router.post("/ingest")
async def ingest_event(evt: MailEvent, request: Request):
    """Milter -> backend. Tek mail rapor.
    Rate limiting yok (guven license anahtarina). Failsafe: ts eksikse simdi.
    """
    await _validate_license(evt.license_key)
    doc = evt.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["ts"] = doc.get("ts") or datetime.now(timezone.utc).isoformat()
    doc["ingested_at"] = datetime.now(timezone.utc).isoformat()
    doc["client_ip"] = request.client.host if request.client else None
    await db.mail_events.insert_one(doc)
    # Ek olarak license'in son_seen timestamp'ini guncelle
    await db.licenses.update_one(
        {"license_key": evt.license_key},
        {"$set": {"last_event_at": doc["ingested_at"]},
         "$inc": {"total_events": 1}}
    )
    # Alert rules degerlendir (fire & forget)
    try:
        from routes.alerts import evaluate_and_fire
        import asyncio
        asyncio.create_task(evaluate_and_fire(evt.license_key, doc))
    except Exception:
        pass
    return {"ok": True, "id": doc["id"]}


@router.post("/ingest-batch")
async def ingest_batch(events: list[MailEvent]):
    """Milter offline-cache burst upload icin (network flap sonrasi)."""
    if not events:
        return {"ok": True, "inserted": 0}
    lic_keys = {e.license_key for e in events}
    if len(lic_keys) > 1:
        raise HTTPException(400, "Batch icinde tek license_key olmali")
    key = lic_keys.pop()
    await _validate_license(key)
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for e in events:
        d = e.model_dump()
        d["id"] = str(uuid.uuid4())
        d["ts"] = d.get("ts") or now
        d["ingested_at"] = now
        docs.append(d)
    await db.mail_events.insert_many(docs)
    await db.licenses.update_one(
        {"license_key": key},
        {"$set": {"last_event_at": now}, "$inc": {"total_events": len(docs)}}
    )
    return {"ok": True, "inserted": len(docs)}


@router.get("")
async def list_events(
    license_key: str = Query(..., min_length=8),
    limit: int = Query(50, ge=1, le=500),
    verdict: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    scope_user: Optional[str] = Query(None),
):
    """Panelden cagirilir. Sadece verilen license_key'e ait eventleri doner.
    scope_user verilirse to_addr veya from_addr'ta o cPanel kullanicisi olan mailleri filtreler.
    """
    await _validate_license(license_key)
    q: dict[str, Any] = {"license_key": license_key}
    if verdict:
        q["verdict"] = verdict
    if since:
        q["ts"] = {"$gte": since}
    if scope_user:
        # cPanel end-user modu: substring match — kullanici 'user@domain' veya 'domain'
        # verebilir. Regex.escape ile safe injection'a karsi koruma.
        import re
        safe = re.escape(scope_user)
        q["$or"] = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
    cursor = db.mail_events.find(q, {"_id": 0}).sort("ts", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "count": len(items)}


@router.get("/summary")
async def events_summary(
    license_key: str = Query(..., min_length=8),
    scope_user: Optional[str] = Query(None),
):
    """Ozet istatistik - toplam + verdict breakdown."""
    await _validate_license(license_key)
    match: dict[str, Any] = {"license_key": license_key}
    if scope_user:
        import re
        safe = re.escape(scope_user)
        match["$or"] = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
    total = await db.mail_events.count_documents(match)
    pipeline = [{"$match": match}, {"$group": {"_id": "$verdict", "count": {"$sum": 1}}}]
    breakdown = {}
    async for row in db.mail_events.aggregate(pipeline):
        breakdown[row["_id"]] = row["count"]
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0, "last_event_at": 1})
    return {
        "total": total,
        "by_verdict": breakdown,
        "last_event_at": (lic or {}).get("last_event_at"),
    }


@router.get("/by-server")
async def events_by_server(license_key: str = Query(..., min_length=8)):
    """Multi-server rozetleri icin: distinct server_hostname + count + last_seen."""
    await _validate_license(license_key)
    pipeline = [
        {"$match": {"license_key": license_key, "server_hostname": {"$ne": None}}},
        {"$group": {
            "_id": "$server_hostname",
            "count": {"$sum": 1},
            "last_seen": {"$max": "$ts"},
            "spam_count": {"$sum": {"$cond": [{"$in": ["$verdict", ["spam", "high_spam", "virus"]]}, 1, 0]}},
        }},
        {"$sort": {"count": -1}},
    ]
    items = []
    async for row in db.mail_events.aggregate(pipeline):
        items.append({
            "hostname": row["_id"],
            "count": row["count"],
            "last_seen": row["last_seen"],
            "spam_count": row.get("spam_count", 0),
        })
    return {"items": items, "total_servers": len(items)}



@router.post("/test-ingest")
async def test_ingest(license_key: str = Query(..., min_length=8)):
    """Curl ile tetiklenir. 5 ornek event yaratir, panele hemen dusmesi icin."""
    await _validate_license(license_key)
    import random
    samples = [
        {"from_addr": "spammer@junkmail.example", "to_addr": "user@your.tld",
         "subject": "*** URGENT *** Nigerian Prince needs your help", "verdict": "high_spam",
         "action": "quarantine", "total_score": 12.4, "scores": {"spamassassin": 9.2, "ai": 3.2}},
        {"from_addr": "newsletter@shop.example", "to_addr": "user@your.tld",
         "subject": "Haftalik indirim bulteni", "verdict": "clean",
         "action": "accept", "total_score": 1.2, "scores": {"spamassassin": 1.2}},
        {"from_addr": "phish@bank-fake.example", "to_addr": "user@your.tld",
         "subject": "Hesabinizi dogrulayin - kimlik guncelleme", "verdict": "spam",
         "action": "quarantine", "total_score": 7.8, "scores": {"spamassassin": 5.1, "ai": 2.7}},
        {"from_addr": "virus@bad.example", "to_addr": "user@your.tld",
         "subject": "Invoice_1023.doc.exe", "verdict": "virus",
         "action": "reject", "total_score": 20.0, "scores": {"clamav": 15.0, "spamassassin": 5.0}},
        {"from_addr": "friend@known.example", "to_addr": "user@your.tld",
         "subject": "Bugun kahve icelim mi?", "verdict": "clean",
         "action": "accept", "total_score": 0.5, "scores": {"spamassassin": 0.5}},
    ]
    now = datetime.now(timezone.utc)
    docs = []
    for i, s in enumerate(samples):
        d = {**s, "license_key": license_key,
             "server_ip": "89.19.15.58", "server_hostname": "ns1.gokyuzuhosting.com",
             "id": str(uuid.uuid4()),
             "ts": now.isoformat(),
             "ingested_at": now.isoformat()}
        docs.append(d)
    await db.mail_events.insert_many(docs)
    await db.licenses.update_one(
        {"license_key": license_key},
        {"$set": {"last_event_at": now.isoformat()}, "$inc": {"total_events": len(docs)}}
    )
    return {"ok": True, "inserted": len(docs),
            "message": "5 ornek event olusturuldu. Panelde canli event akisinda gorulmelidir."}


# --- Quarantine Sync ---
# Kullanici panelden bir mail'i karantinaya alma / silme / release isterse
# ilgili sunucudaki logtail daemon'a job kuyrugu yazariz. Sunucudaki daemon
# short-poll ile pending action listesini alir, sunucu spool'unda gercek
# aksiyon uygular ve action_completed = True'yi geri raporlar.

class QuarantineActionReq(BaseModel):
    license_key: str
    event_id: str
    action: str = Field(..., pattern="^(delete|release|report_spam)$")


@router.post("/quarantine-action")
async def request_quarantine_action(req: QuarantineActionReq):
    """Panel -> sunucu: karantina aksiyon talebi kuyruga alinir."""
    await _validate_license(req.license_key)
    evt = await db.mail_events.find_one(
        {"license_key": req.license_key, "id": req.event_id}, {"_id": 0}
    )
    if not evt:
        raise HTTPException(404, "Event bulunamadi")
    action_id = str(uuid.uuid4())
    await db.pending_quarantine_actions.insert_one({
        "id": action_id,
        "license_key": req.license_key,
        "event_id": req.event_id,
        "action": req.action,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "result": None,
    })
    return {"ok": True, "action_id": action_id, "queued": True}


@router.get("/pending-actions")
async def list_pending_actions(license_key: str = Query(..., min_length=8)):
    """Sunucudaki logtail daemon her N saniyede bir bunu poll'lar."""
    await _validate_license(license_key)
    cursor = db.pending_quarantine_actions.find(
        {"license_key": license_key, "completed_at": None},
        {"_id": 0},
    ).sort("created_at", 1).limit(20)
    return {"items": await cursor.to_list(length=20)}


class ActionResult(BaseModel):
    license_key: str
    action_id: str
    result: str
    message: Optional[str] = None


@router.post("/complete-action")
async def complete_action(res: ActionResult):
    """Sunucudaki daemon aksiyonu tamamladiktan sonra sonucu buraya bildirir."""
    await _validate_license(res.license_key)
    r = await db.pending_quarantine_actions.update_one(
        {"license_key": res.license_key, "id": res.action_id, "completed_at": None},
        {"$set": {
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": res.result,
            "message": res.message,
        }},
    )
    return {"ok": True, "matched": r.matched_count}
