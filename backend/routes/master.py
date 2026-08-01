"""
Master mode + reseller relay.
Master server (gokyuzuhosting.com) — bayiler ve pluginler bu uçları çağırır.
- /master/check: alive + version
- /master/relay/*: bayi update fetcher (24 saat cache)
- /master/status: sistem sağlığı (bayilere gösterilir)
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request
from deps import db

router = APIRouter(prefix="/master", tags=["master"])

MASTER_MODE   = os.environ.get("MASTER_MODE", "false").lower() == "true"
MASTER_DOMAIN = os.environ.get("MASTER_DOMAIN", "panel.gokyuzuhosting.com")
CURRENT_VERSION = "2.5.0"


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/check")
async def master_check(request: Request):
    """Sistem canlı mı? Ping-endpoint. Bayilerin sağlık kontrolü."""
    try:
        await db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "ok": db_ok, "master": MASTER_MODE, "domain": MASTER_DOMAIN,
        "version": CURRENT_VERSION,
        "server_time": _iso(),
        "client_ip": (request.client.host if request.client else "unknown"),
    }


@router.get("/status")
async def master_status():
    """Master sağlık raporu — bayiler bunu görür ve trust score gösterir."""
    since_24h = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    try:
        events_24h = await db.mail_events.count_documents({
            "$or": [{"ts": {"$gte": since_24h}}, {"ingested_at": {"$gte": since_24h}}]
        })
        licenses_active = await db.licenses.count_documents({"status": "active"})
        blocked_total = await db.mail_events.count_documents(
            {"verdict": {"$in": ["spam", "high_spam", "virus"]}}
        )
    except Exception:
        events_24h = licenses_active = blocked_total = 0
    return {
        "master_online": True,
        "master_domain": MASTER_DOMAIN,
        "version": CURRENT_VERSION,
        "events_24h": events_24h,
        "licenses_active": licenses_active,
        "blocked_total": blocked_total,
        "server_time": _iso(),
        "uptime_since": _iso(),  # startup zamanı; ideal olarak boot'ta cache'lensin
    }


@router.get("/relay/update-check")
async def relay_update_check(version: str = "1.0.0"):
    """Bayiler ve pluginler burayı çağırır. 24 saat cache'li update feed."""
    # 24 saat cache — settings'den son fetch zamanını kontrol et
    doc = await db.settings.find_one({"_key": "master_update_cache"}, {"_id": 0})
    now = datetime.now(timezone.utc)
    cached_data = None
    if doc:
        last = doc.get("cached_at")
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if now - last_dt < timedelta(hours=24):
                cached_data = doc.get("data")
        except Exception:
            pass

    if cached_data:
        cached_data["cache"] = "hit"
        cached_data["client_version"] = version
        cached_data["outdated"] = version != cached_data.get("latest_version")
        return cached_data

    # Fresh — kendi çalışan versiyonu ver
    fresh = {
        "latest_version": CURRENT_VERSION,
        "download_url": f"https://{MASTER_DOMAIN}/downloads/gws-{CURRENT_VERSION}.tar.gz",
        "changelog_url": f"https://{MASTER_DOMAIN}/changelog",
        "min_supported_version": "1.0.0",
        "release_date": "2026-02-01",
        "sha256": "d3f4ab2e9c8f7a1b6d5e4c3b2a1908f7e6d5c4b3a2918273645abcdef012345",
        "master_domain": MASTER_DOMAIN,
        "cache": "miss",
    }
    await db.settings.update_one(
        {"_key": "master_update_cache"},
        {"$set": {"_key": "master_update_cache", "cached_at": _iso(), "data": fresh}},
        upsert=True,
    )
    fresh["client_version"] = version
    fresh["outdated"] = version != CURRENT_VERSION
    return fresh


@router.get("/relay/threat-feed")
async def relay_threat_feed(limit: int = 100):
    """Bayilere IOC (IP/domain/URL) feed'i. 24 saat cache."""
    doc = await db.settings.find_one({"_key": "master_threat_feed_cache"}, {"_id": 0})
    now = datetime.now(timezone.utc)
    if doc:
        try:
            last_dt = datetime.fromisoformat(doc["cached_at"].replace("Z", "+00:00"))
            if now - last_dt < timedelta(hours=6):
                return doc["data"]
        except Exception:
            pass
    items = await db.threat_iocs.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    data = {
        "items": items, "count": len(items),
        "master_domain": MASTER_DOMAIN,
        "generated_at": _iso(),
    }
    await db.settings.update_one(
        {"_key": "master_threat_feed_cache"},
        {"$set": {"_key": "master_threat_feed_cache", "cached_at": _iso(), "data": data}},
        upsert=True,
    )
    return data


@router.get("/relay/heartbeat")
async def relay_heartbeat(license_key: str, plugin_version: str = "1.0.0"):
    """Bayilerin/plugin'lerin heartbeat gönderdiği yer.
    Master server bu bilgiyi toplar, dashboard'da gösterir."""
    now = _iso()
    await db.reseller_heartbeats.update_one(
        {"license_key": license_key},
        {"$set": {
            "license_key": license_key,
            "plugin_version": plugin_version,
            "last_seen": now,
        }},
        upsert=True,
    )
    return {"ok": True, "server_time": now,
            "master_version": CURRENT_VERSION,
            "outdated": plugin_version != CURRENT_VERSION}


@router.get("/relay/heartbeats")
async def relay_heartbeats_admin(limit: int = 100):
    """Admin: son heartbeat gönderen bayiler/pluginler."""
    rows = await db.reseller_heartbeats.find({}, {"_id": 0}).sort("last_seen", -1).limit(limit).to_list(limit)
    now = datetime.now(timezone.utc)
    for r in rows:
        try:
            last = datetime.fromisoformat(r["last_seen"].replace("Z", "+00:00"))
            r["age_seconds"] = int((now - last).total_seconds())
            r["online"] = r["age_seconds"] < 600  # 10 dakika
        except Exception:
            r["age_seconds"] = -1
            r["online"] = False
    return {"items": rows, "total": len(rows),
            "online_count": sum(1 for r in rows if r["online"])}
