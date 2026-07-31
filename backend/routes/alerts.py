"""
Alert Rules Engine.
Rate-based tetikleyiciler (ornek: 'ayni sender 5dk icinde 10+ mail'), webhook aksiyonlu
(Slack/Discord/generic JSON). Her ingest sonrasi degerlendirilir (see events.ingest_event).
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional, Any, Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl
from deps import db
import uuid, httpx, asyncio, logging

log = logging.getLogger("gws.alerts")
router = APIRouter(prefix="/alerts", tags=["alerts"])


async def _validate_license(license_key: str) -> dict:
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(401, "Gecersiz lisans")
    return lic


class AlertRule(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=2, max_length=60)
    kind: Literal["rate_from_sender", "rate_high_spam", "single_virus"] = "rate_from_sender"
    threshold: int = Field(10, ge=1, le=1000)
    window_min: int = Field(5, ge=1, le=1440)
    webhook_url: str = Field(..., min_length=8)
    webhook_kind: Literal["slack", "discord", "generic"] = "generic"
    enabled: bool = True


class RuleUpsert(BaseModel):
    license_key: str = Field(..., min_length=8)
    id: Optional[str] = None
    name: str
    kind: Literal["rate_from_sender", "rate_high_spam", "single_virus"] = "rate_from_sender"
    threshold: int = 10
    window_min: int = 5
    webhook_url: str
    webhook_kind: Literal["slack", "discord", "generic"] = "generic"
    enabled: bool = True


@router.get("/rules")
async def list_rules(license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    rules = await db.alert_rules.find({"license_key": license_key}, {"_id": 0}).to_list(200)
    return {"items": rules, "count": len(rules)}


@router.post("/rules")
async def upsert_rule(rule: RuleUpsert):
    await _validate_license(rule.license_key)
    rid = rule.id or str(uuid.uuid4())
    doc = rule.model_dump()
    doc["id"] = rid
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alert_rules.update_one({"license_key": rule.license_key, "id": rid},
                                    {"$set": doc,
                                     "$setOnInsert": {"created_at": doc["updated_at"]}},
                                    upsert=True)
    return {"ok": True, "id": rid}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    r = await db.alert_rules.delete_one({"license_key": license_key, "id": rule_id})
    return {"ok": True, "deleted": r.deleted_count}


@router.get("")
async def list_recent_alerts(
    license_key: str = Query(..., min_length=8),
    limit: int = Query(20, ge=1, le=100),
):
    await _validate_license(license_key)
    cursor = db.alerts.find({"license_key": license_key}, {"_id": 0}).sort("fired_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "count": len(items)}


class TestWebhookReq(BaseModel):
    license_key: str
    webhook_url: str
    webhook_kind: Literal["slack", "discord", "generic"] = "generic"


@router.post("/test-webhook")
async def test_webhook(req: TestWebhookReq):
    """Kural kaydetmeden webhook URL'nin canli oldugunu dogrula. Sync — tarayicida
    kullanici basari/hata mesajini anlik gorsun."""
    await _validate_license(req.license_key)
    fake_alert = {
        "id": "test-" + str(uuid.uuid4())[:8],
        "license_key": req.license_key,
        "rule_name": "Test webhook (kural degil)",
        "reason": "Bu bir test bildirimi — panelinizden gonderildi",
        "sample_event": {"from_addr": "test@example.com", "to_addr": "you@your.tld",
                         "subject": "Test webhook", "verdict": "spam"},
        "fired_at": datetime.now(timezone.utc).isoformat(),
    }
    fake_rule = {"name": "Test", "webhook_url": req.webhook_url, "webhook_kind": req.webhook_kind}
    try:
        # _send_webhook alerts.update_one yapar - test icin alerts kaydini insert edelim
        await db.alerts.insert_one(dict(fake_alert))
        await _send_webhook(fake_rule, fake_alert)
        # Read status
        rec = await db.alerts.find_one({"id": fake_alert["id"]}, {"_id": 0, "webhook_status": 1})
        status = (rec or {}).get("webhook_status", "unknown")
        if status.startswith("error") or status.startswith("http_"):
            raise HTTPException(400, f"Webhook basarisiz: {status}")
        return {"ok": True, "message": "Webhook gonderildi — Slack/Discord kanalinizi kontrol edin", "status": status}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Webhook basarisiz: {type(e).__name__}: {e}")


# --- Evaluation engine (called from events.ingest_event) ---
async def evaluate_and_fire(license_key: str, event: dict) -> None:
    """Called after each ingest. Loads rules, checks thresholds, fires webhooks."""
    try:
        rules = await db.alert_rules.find(
            {"license_key": license_key, "enabled": True}, {"_id": 0}
        ).to_list(50)
        if not rules:
            return
        for rule in rules:
            fired = False
            reason = None
            if rule["kind"] == "single_virus" and event.get("verdict") == "virus":
                fired = True
                reason = f"Virus detected from {event.get('from_addr')}"
            elif rule["kind"] == "rate_high_spam":
                since = datetime.now(timezone.utc) - timedelta(minutes=rule["window_min"])
                cnt = await db.mail_events.count_documents({
                    "license_key": license_key,
                    "verdict": {"$in": ["spam", "high_spam"]},
                    "ingested_at": {"$gte": since.isoformat()},
                })
                if cnt >= rule["threshold"]:
                    fired = True
                    reason = f"{cnt} spam events in last {rule['window_min']}m (threshold {rule['threshold']})"
            elif rule["kind"] == "rate_from_sender" and event.get("from_addr"):
                since = datetime.now(timezone.utc) - timedelta(minutes=rule["window_min"])
                cnt = await db.mail_events.count_documents({
                    "license_key": license_key,
                    "from_addr": event["from_addr"],
                    "ingested_at": {"$gte": since.isoformat()},
                })
                if cnt >= rule["threshold"]:
                    fired = True
                    reason = f"{cnt} mails from {event['from_addr']} in last {rule['window_min']}m"

            if not fired:
                continue

            # Deduplicate — same rule fired within cooldown (rule.window_min)?
            dedupe_since = datetime.now(timezone.utc) - timedelta(minutes=rule["window_min"])
            already = await db.alerts.count_documents({
                "license_key": license_key,
                "rule_id": rule["id"],
                "fired_at": {"$gte": dedupe_since.isoformat()},
            })
            if already:
                continue

            alert_doc = {
                "id": str(uuid.uuid4()),
                "license_key": license_key,
                "rule_id": rule["id"],
                "rule_name": rule["name"],
                "kind": rule["kind"],
                "reason": reason,
                "sample_event": {k: event.get(k) for k in ["from_addr", "to_addr", "subject", "verdict", "total_score"]},
                "fired_at": datetime.now(timezone.utc).isoformat(),
                "webhook_status": "pending",
            }
            await db.alerts.insert_one(alert_doc)
            # Fire webhook async
            asyncio.create_task(_send_webhook(rule, alert_doc))
    except Exception as e:
        log.warning("alerts eval failed: %s", e)


async def _send_webhook(rule: dict, alert_doc: dict) -> None:
    url = rule["webhook_url"]
    kind = rule.get("webhook_kind", "generic")
    title = f"[GokyuzuWebSpam] {rule['name']}"
    text  = f"{alert_doc['reason']}\nLicense: {alert_doc['license_key'][:12]}…"
    sample = alert_doc.get("sample_event", {})
    if kind == "slack":
        payload = {
            "text": f"*{title}*\n{text}",
            "attachments": [{
                "color": "danger",
                "fields": [
                    {"title": "From",    "value": sample.get("from_addr", "-"),  "short": True},
                    {"title": "Verdict", "value": sample.get("verdict", "-"),    "short": True},
                    {"title": "Subject", "value": sample.get("subject", "-"),    "short": False},
                ],
            }],
        }
    elif kind == "discord":
        payload = {
            "content": None,
            "embeds": [{
                "title": title,
                "description": text,
                "color": 15548997,
                "fields": [
                    {"name": "From",    "value": sample.get("from_addr", "-"),  "inline": True},
                    {"name": "Verdict", "value": sample.get("verdict", "-"),    "inline": True},
                    {"name": "Subject", "value": (sample.get("subject") or "-")[:200], "inline": False},
                ],
            }],
        }
    else:
        payload = {"title": title, "text": text, "alert": alert_doc}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(url, json=payload)
            status = "ok" if r.status_code < 300 else f"http_{r.status_code}"
    except Exception as e:
        status = f"error:{type(e).__name__}"
    await db.alerts.update_one({"id": alert_doc["id"]}, {"$set": {"webhook_status": status}})
