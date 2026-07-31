"""
Reseller branding + advanced insights (health metrics, alert timeline, compliance snapshot).
Konsolide edildi: 4 kucuk feature tek route dosyasinda.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from deps import db
import subprocess

router = APIRouter(tags=["insights"])


async def _validate_license(license_key: str) -> dict:
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(401, "Gecersiz lisans")
    return lic


# ============ 1) Reseller White-label ============
class Branding(BaseModel):
    license_key: str
    brand_name: Optional[str] = "GokyuzuWebSpam"
    logo_url: Optional[str] = None
    primary_color: Optional[str] = "#6366f1"
    accent_color: Optional[str] = "#10b981"


@router.get("/reseller/branding")
async def get_branding(license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    doc = await db.reseller_branding.find_one({"license_key": license_key}, {"_id": 0})
    return doc or {
        "license_key": license_key,
        "brand_name": "GokyuzuWebSpam",
        "logo_url": None,
        "primary_color": "#6366f1",
        "accent_color": "#10b981",
    }


@router.put("/reseller/branding")
async def put_branding(b: Branding):
    await _validate_license(b.license_key)
    doc = b.model_dump()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.reseller_branding.update_one(
        {"license_key": b.license_key},
        {"$set": doc, "$setOnInsert": {"created_at": doc["updated_at"]}},
        upsert=True,
    )
    return {"ok": True}


# ============ 2) Health Metrics Advanced ============
@router.get("/events/health-metrics")
async def health_metrics(license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    now = datetime.now(timezone.utc)
    since_1h = now - timedelta(hours=1)

    # Latency: ingested_at - ts (avg over last 100)
    latency_ms = 0
    cursor = db.mail_events.find(
        {"license_key": license_key, "ingested_at": {"$gte": since_1h.isoformat()}},
        {"_id": 0, "ts": 1, "ingested_at": 1},
    ).limit(100)
    diffs = []
    async for e in cursor:
        try:
            a = datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))
            b = datetime.fromisoformat(e["ingested_at"].replace("Z", "+00:00"))
            diffs.append(abs((b - a).total_seconds() * 1000))
        except Exception:
            pass
    if diffs:
        latency_ms = round(sum(diffs) / len(diffs))

    # Write rate: mail_events count in last 1h / 60 -> per minute
    wr = await db.mail_events.count_documents(
        {"license_key": license_key, "ingested_at": {"$gte": since_1h.isoformat()}}
    )
    write_per_min = round(wr / 60, 2)

    # Queue backlog: exiqgrep -c on host if available (best-effort, non-fatal)
    queue_backlog = 0
    try:
        r = subprocess.run(["exiqgrep", "-c"], capture_output=True, timeout=3, text=True)
        if r.returncode == 0:
            for line in r.stdout.splitlines():
                if "matching messages" in line or line.strip().isdigit():
                    parts = line.split()
                    if parts and parts[0].isdigit():
                        queue_backlog = int(parts[0])
                        break
    except Exception:
        pass

    return {
        "latency_ms": latency_ms,
        "write_per_min": write_per_min,
        "queue_backlog": queue_backlog,
        "sample_size": len(diffs),
    }


# ============ 3) Alert Timeline (last 7d) ============
@router.get("/alerts/timeline")
async def alerts_timeline(license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    since = datetime.now(timezone.utc) - timedelta(days=7)
    pipeline = [
        {"$match": {"license_key": license_key, "fired_at": {"$gte": since.isoformat()}}},
        {"$addFields": {"day": {"$substr": ["$fired_at", 0, 10]}}},
        {"$group": {
            "_id": {"day": "$day", "rule": "$rule_name"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id.day": 1}},
    ]
    by_day: dict[str, dict] = {}
    async for row in db.alerts.aggregate(pipeline):
        day = row["_id"]["day"]
        by_day.setdefault(day, {"day": day, "total": 0, "rules": {}})
        by_day[day]["total"] += row["count"]
        by_day[day]["rules"][row["_id"]["rule"]] = row["count"]
    return {"items": list(by_day.values())}


# ============ 4) Compliance Snapshot ============
@router.get("/events/compliance-snapshot")
async def compliance_snapshot(
    license_key: str = Query(..., min_length=8),
    days: int = Query(30, ge=1, le=365),
):
    await _validate_license(license_key)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"license_key": license_key, "ingested_at": {"$gte": since.isoformat()}}},
        {"$group": {"_id": "$verdict", "count": {"$sum": 1}}},
    ]
    counts = {}
    total = 0
    async for row in db.mail_events.aggregate(pipeline):
        counts[row["_id"]] = row["count"]
        total += row["count"]
    spam_blocked  = counts.get("spam", 0) + counts.get("high_spam", 0) + counts.get("blocked", 0)
    virus_blocked = counts.get("virus", 0)
    clean_delivered = counts.get("clean", 0) + counts.get("whitelisted", 0)
    return {
        "period_days": days,
        "since": since.isoformat(),
        "total_scanned": total,
        "spam_blocked": spam_blocked,
        "virus_blocked": virus_blocked,
        "clean_delivered": clean_delivered,
        "block_ratio": round((spam_blocked + virus_blocked) / total * 100, 2) if total else 0.0,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
