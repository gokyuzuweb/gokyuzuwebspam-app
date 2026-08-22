"""
Master mode + reseller relay.
Master server (gokyuzuhosting.com) — bayiler ve pluginler bu uçları çağırır.
- /master/check: alive + version
- /master/relay/*: bayi update fetcher (24 saat cache)
- /master/status: sistem sağlığı (bayilere gösterilir)
"""
from __future__ import annotations
import os, uuid
from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request, HTTPException
from deps import db

router = APIRouter(prefix="/master", tags=["master"])

MASTER_MODE   = os.environ.get("MASTER_MODE", "false").lower() == "true"
MASTER_DOMAIN = os.environ.get("MASTER_DOMAIN", "panel.gokyuzuhosting.com")
CURRENT_VERSION = "44.00.02"


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
    # Master admin bir versiyon yayınladıysa onu göster (published_at'den itibaren)
    pub = await db.settings.find_one({"_key": "master_current_version"}, {"_id": 0})
    if pub:
        latest = pub.get("version") or CURRENT_VERSION
        fresh = {
            "latest_version": latest,
            "download_url": pub.get("download_url") or f"https://{MASTER_DOMAIN}/downloads/gws-{latest}.tar.gz",
            "changelog_url": f"https://{MASTER_DOMAIN}/changelog",
            "changelog": pub.get("changelog", ""),
            "min_supported_version": "1.0.0",
            "release_date": (pub.get("published_at") or "")[:10],
            "sha256": pub.get("sha256") or "",
            "master_domain": MASTER_DOMAIN,
            "cache": "publish",
            "client_version": version,
            "outdated": version != latest,
        }
        return fresh

    # 24 saat cache
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
    # Lisans bilgisi ile zenginleştir
    lic_map: dict[str, dict] = {}
    async for lic in db.licenses.find({}, {"_id": 0}):
        lic_map[lic.get("license_key", "")] = lic
    for r in rows:
        try:
            last = datetime.fromisoformat(r["last_seen"].replace("Z", "+00:00"))
            r["age_seconds"] = int((now - last).total_seconds())
            r["online"] = r["age_seconds"] < 600  # 10 dakika
        except Exception:
            r["age_seconds"] = -1
            r["online"] = False
        # Lisans info
        lic = lic_map.get(r.get("license_key", ""), {})
        r["reseller_name"] = lic.get("reseller_name") or lic.get("customer_name") or lic.get("domain") or "-"
        r["email"] = lic.get("email") or "-"
        r["plan"] = lic.get("plan") or "starter"
        r["status"] = lic.get("status") or "unknown"
        # Bitiş tarihi
        exp = lic.get("expires_at") or lic.get("end_date") or lic.get("valid_until")
        r["expires_at"] = exp
        if exp:
            try:
                exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                days_left = int((exp_dt - now).total_seconds() // 86400)
                r["days_left"] = days_left
                r["expired"] = days_left < 0
                r["expiring_soon"] = 0 <= days_left <= 14
            except Exception:
                r["days_left"] = None
                r["expired"] = False
                r["expiring_soon"] = False
        else:
            r["days_left"] = None
            r["expired"] = False
            r["expiring_soon"] = False
    expiring_count = sum(1 for r in rows if r.get("expiring_soon"))
    expired_count = sum(1 for r in rows if r.get("expired"))
    return {"items": rows, "total": len(rows),
            "online_count": sum(1 for r in rows if r["online"]),
            "outdated_count": sum(1 for r in rows if r.get("plugin_version") != CURRENT_VERSION),
            "expiring_soon": expiring_count,
            "expired": expired_count}


@router.post("/publish-version")
async def publish_version(payload: dict):
    """Master admin: yeni versiyon yayınla. Cache'i temizler + settings'e yazar.
    payload: {version, changelog, download_url, sha256, notify_resellers}"""
    global CURRENT_VERSION
    ver = payload.get("version") or CURRENT_VERSION
    changelog = payload.get("changelog", "")
    download_url = payload.get("download_url") or f"https://{MASTER_DOMAIN}/downloads/gws-{ver}.tar.gz"
    sha256 = payload.get("sha256", "")
    notify = payload.get("notify_resellers", True)
    now = _iso()
    # 1) Cache temizle
    await db.settings.delete_many({"_key": {"$in": ["master_update_cache", "master_threat_feed_cache"]}})
    # 2) Yeni versiyon kaydet
    doc = {
        "_key": "master_current_version",
        "version": ver, "changelog": changelog,
        "download_url": download_url, "sha256": sha256,
        "published_at": now,
    }
    await db.settings.update_one(
        {"_key": "master_current_version"},
        {"$set": doc},
        upsert=True,
    )
    # 3) Yayın log
    await db.release_history.insert_one({
        "id": now, "version": ver,
        "changelog": changelog, "download_url": download_url,
        "sha256": sha256, "published_at": now,
    })
    # 4) Global değişkeni güncelle
    CURRENT_VERSION = ver
    # 5) Bayilere e-posta bildirimi
    notified_emails = 0
    if notify:
        try:
            from server import _send_email, _smart_from
            seen_emails = set()
            async for lic in db.licenses.find({"status": "active"}, {"_id": 0}):
                email = lic.get("email") or lic.get("customer_email")
                if not email or "@" not in email or email in seen_emails:
                    continue
                seen_emails.add(email)
                name = lic.get("reseller_name") or lic.get("customer_name") or "Değerli Bayimiz"
                subj = f"🚀 GökyüzüWebSpam v{ver} yayınlandı!"
                body = (
                    f"Sayın {name},\n\n"
                    f"GökyüzüWebSpam v{ver} yayınlandı. Sistem güvenliğinizi artırmak için lütfen güncelleyin.\n\n"
                    f"📝 DEĞİŞİKLİKLER\n{changelog or '(değişiklik notu eklenmedi)'}\n\n"
                    f"📦 İndirme: {download_url}\n"
                    f"🔐 SHA256: {sha256 or '(hesaplanmadı)'}\n\n"
                    f"WHM pluginleriniz otomatik olarak yeni sürümü heartbeat üzerinden algılayacak.\n\n"
                    f"Sorularınız için: destek@gokyuzuhosting.com"
                )
                from_addr = await _smart_from(lic.get("license_key"))
                ok, _ = await _send_email(email, subj, body, from_addr=from_addr)
                if ok:
                    notified_emails += 1
        except Exception:
            pass
    outdated = await db.reseller_heartbeats.count_documents({"plugin_version": {"$ne": ver}})
    return {
        "ok": True, "version": ver, "published_at": now,
        "cache_cleared": True,
        "resellers_notified_via_heartbeat": await db.reseller_heartbeats.estimated_document_count(),
        "resellers_notified_email": notified_emails,
        "resellers_outdated": outdated,
    }


@router.post("/notify-resellers")
async def notify_resellers(payload: dict):
    """Bayilere manuel bildirim mail'i gönder.
    payload: {subject, message, urgent}"""
    subject = payload.get("subject") or "GökyüzüWebSpam bildirimi"
    message = payload.get("message", "")
    urgent = payload.get("urgent", False)
    if not message.strip():
        raise HTTPException(400, "message alanı zorunlu")
    prefix = "🚨 ACİL: " if urgent else "📢 "
    sent = 0
    try:
        from server import _send_email, _smart_from
        seen = set()
        async for lic in db.licenses.find({"status": "active"}, {"_id": 0}):
            email = lic.get("email") or lic.get("customer_email")
            if not email or "@" not in email or email in seen:
                continue
            seen.add(email)
            name = lic.get("reseller_name") or lic.get("customer_name") or "Bayimiz"
            body = f"Sayın {name},\n\n{message}\n\n--\nGökyüzüWebSpam · gokyuzuhosting.com"
            from_addr = await _smart_from(lic.get("license_key"))
            ok, _ = await _send_email(email, prefix + subject, body, from_addr=from_addr)
            if ok: sent += 1
    except Exception:
        pass
    # Log
    await db.notifications_history.insert_one({
        "id": str(uuid.uuid4()), "kind": "reseller_broadcast",
        "subject": subject, "message": message[:500],
        "urgent": urgent, "sent_count": sent,
        "created_at": _iso(),
    })
    return {"ok": True, "sent": sent, "urgent": urgent}


@router.get("/releases")
async def release_history(limit: int = 20):
    """Yayın geçmişi."""
    rows = await db.release_history.find({}, {"_id": 0}).sort("published_at", -1).limit(limit).to_list(limit)
    return {"items": rows, "current": CURRENT_VERSION}



# ============================================================================
# v43.38 — Master Alerts (Dashboard sistem bildirim kartı)
# Threat Intel auto-sync loop, plugin daemon fail, license violation vb.
# `master_alerts` koleksiyonuna yazar. Frontend Dashboard bunu tüketir.
# ============================================================================
@router.get("/alerts")
async def list_master_alerts(request: Request, limit: int = 20, unread_only: bool = False,
                             license_key: Optional[str] = None):
    """v43.99.24 — SADECE MASTER. Bayi/müşteri sunucu bu endpoint'i çağırırsa
    boş liste döner (data leak önlemi). Master alert'leri sadece
    panel.gokyuzuhosting.com sunucusunun sahibi görebilir."""
    # Master doğrulaması (import inline — circular önleme)
    try:
        from server import _is_master
        r = await _is_master(request, license_key)
        if not r.get("is_master"):
            # Bayi/müşteri → boş dönüş (master alert'leri sızmasın)
            return {"items": [], "count": 0, "total_unread": 0}
    except Exception:
        # Yardımcı fonksiyon yoksa güvenli tarafta kal → boş dön
        return {"items": [], "count": 0, "total_unread": 0}
    q: dict = {}
    if unread_only:
        # Legacy 'seen' field OR new 'read' field
        q["$or"] = [{"read": False}, {"read": {"$exists": False}, "seen": False}]
    items_raw = await db.master_alerts.find(q, {"_id": 0}) \
        .sort("created_at", -1).limit(min(limit, 100)).to_list(limit)
    # Normalize shape (new_version alerts use seen/type/message; new alerts use read/kind/title/detail)
    items: list[dict] = []
    for a in items_raw:
        is_read = bool(a.get("read", a.get("seen", False)))
        items.append({
            "id": a.get("id"),
            "kind": a.get("kind") or a.get("type") or "notice",
            "severity": a.get("severity") or ("info" if a.get("type") == "new_version" else "warning"),
            "title": a.get("title") or a.get("message") or a.get("kind") or "",
            "detail": a.get("detail") or (f"Sürüm: {a.get('version')}" if a.get("type") == "new_version" else ""),
            "added_iocs": a.get("added_iocs"),
            "failures": a.get("failures"),
            "created_at": a.get("created_at"),
            "read": is_read,
        })
    total_unread = await db.master_alerts.count_documents(
        {"$or": [{"read": False}, {"read": {"$exists": False}, "seen": False}]})
    return {"items": items, "count": len(items), "total_unread": total_unread}


@router.post("/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str):
    r = await db.master_alerts.update_one(
        {"id": alert_id},
        {"$set": {"read": True, "seen": True, "read_at": _iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Alert bulunamadı")
    return {"ok": True}


@router.post("/alerts/read-all")
async def mark_all_alerts_read():
    r = await db.master_alerts.update_many(
        {"$or": [{"read": False}, {"read": {"$exists": False}, "seen": False}]},
        {"$set": {"read": True, "seen": True, "read_at": _iso()}},
    )
    return {"ok": True, "modified": r.modified_count}
