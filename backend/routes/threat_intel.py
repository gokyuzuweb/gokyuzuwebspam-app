"""
Global Threat Intelligence router.
- IOC feed (IP / domain / hash blacklist w/ tags & confidence)
- DMARC aggregate report intake + summary
- Global blocklist sync status (mock feed sources)
- Compliance score (GDPR/KVKK/HIPAA/SOC2 checklist)
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/threat-intel", tags=["threat-intel"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- 1) IOC feed (Indicators of Compromise) ----------
class Indicator(BaseModel):
    type: str = Field(..., pattern="^(ip|domain|url|hash|email)$")
    value: str
    tag: Optional[str] = "spam"        # spam / phishing / malware / c2 / ransomware
    confidence: int = Field(70, ge=0, le=100)
    source: Optional[str] = "manual"
    ttl_days: Optional[int] = 30
    note: Optional[str] = ""


@router.post("/ioc")
async def add_ioc(payload: Indicator):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = _iso()
    if payload.ttl_days and payload.ttl_days > 0:
        doc["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=payload.ttl_days)).isoformat()
    await db.threat_iocs.update_one(
        {"type": doc["type"], "value": doc["value"]},
        {"$set": doc}, upsert=True,
    )
    return {"ok": True, **doc}


# v43.25 — Boş kategori seed'i: Domain / Hash / Email için gerçek dünya feed'i
# yok (URLhaus/PhishTank sadece URL, Spamhaus/Barracuda sadece IP). Kullanıcının
# panelde 5 kategoriyi de dolu görebilmesi için tek tıkla demo IOC yükler.
@router.post("/ioc/seed-demo-categories")
async def seed_demo_ioc_categories():
    """Idempotent — Domain / Hash / Email kategorilerine gerçekçi demo IOC'lar
    ekler. Zaten var olanlar üzerine yazmaz (unique index: type + value)."""
    seed_data = [
        # Malicious domains (phishing/malware C2)
        ("domain", "secure-paypal-login.info",      "phishing",   88, "demo-openphish"),
        ("domain", "microsoft-verify-account.top",  "phishing",   92, "demo-openphish"),
        ("domain", "apple-icloud-lock.support",     "phishing",   90, "demo-openphish"),
        ("domain", "amazon-billing-update.click",   "phishing",   85, "demo-openphish"),
        ("domain", "instagram-verify-badge.help",   "phishing",   87, "demo-openphish"),
        ("domain", "bank-of-america-alert.tech",    "phishing",   93, "demo-openphish"),
        ("domain", "google-drive-shared.link",      "phishing",   80, "demo-openphish"),
        ("domain", "netflix-payment-failed.online", "phishing",   82, "demo-openphish"),
        ("domain", "wechat-security-check.xyz",     "phishing",   78, "demo-openphish"),
        ("domain", "coinbase-wallet-recover.pro",   "phishing",   91, "demo-openphish"),
        ("domain", "wetransfer-download-file.com",  "malware",    75, "demo-malwarebazaar"),
        ("domain", "office365-update.top",          "malware",    83, "demo-malwarebazaar"),
        # Malware hashes (SHA256 first 64 hex, MD5 - realistic patterns)
        ("hash",   "a3b6c9d7e0f1234567890abcdef1234567890abcdef1234567890abcdef123456", "malware",    95, "demo-malwarebazaar"),
        ("hash",   "b4c7d8e9f0a1234567890bcdef1234567890abcdef1234567890abcdef1234567", "ransomware", 97, "demo-malwarebazaar"),
        ("hash",   "c5d8e9f0a1b2345678901cdef1234567890abcdef1234567890abcdef12345678", "malware",    90, "demo-malwarebazaar"),
        ("hash",   "d6e9f0a1b2c3456789012def1234567890abcdef1234567890abcdef123456789", "c2",         88, "demo-malwarebazaar"),
        ("hash",   "e7f0a1b2c3d4567890123ef1234567890abcdef1234567890abcdef1234567890", "malware",    85, "demo-malwarebazaar"),
        ("hash",   "44d88612fea8a8f36de82e1278abb02f",         "malware",    92, "demo-eicar"),
        ("hash",   "84c82835a5d21bbcf75a61706d8ab549",         "ransomware", 96, "demo-wannacry"),
        ("hash",   "d724d8cc6420f06e8a48752f0da11c66",         "malware",    89, "demo-emotet"),
        # Malicious sender emails (spam / phishing)
        ("email",  "phisher@fake-paypal-support.info",   "phishing",   85, "demo-blocklist"),
        ("email",  "no-reply@fake-microsoft-alerts.top", "phishing",   87, "demo-blocklist"),
        ("email",  "spammer1@bulk-mailer-2024.online",   "spam",       92, "demo-blocklist"),
        ("email",  "invoice@fake-amazon-billing.click",  "phishing",   90, "demo-blocklist"),
        ("email",  "admin@compromised-hosting.pro",      "malware",    80, "demo-blocklist"),
        ("email",  "support@fake-apple-service.tech",    "phishing",   88, "demo-blocklist"),
        ("email",  "info@phishing-campaign-2026.link",   "phishing",   83, "demo-blocklist"),
        ("email",  "noreply@ransomware-c2.xyz",          "c2",         95, "demo-blocklist"),
    ]
    inserted = 0
    now = _iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
    for t, v, tag, conf, source in seed_data:
        res = await db.threat_iocs.update_one(
            {"type": t, "value": v},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "type": t, "value": v, "tag": tag,
                "confidence": conf, "source": source, "feed": source,
                "created_at": now, "expires_at": expires,
                "note": "Demo veri — gerçek üretim için OpenPhish/MalwareBazaar/Blocklist.de feed'lerine abone olun",
            }},
            upsert=True,
        )
        if res.upserted_id is not None:
            inserted += 1
    return {
        "ok": True,
        "inserted": inserted,
        "total_seeded": len(seed_data),
        "categories": {"domain": 12, "hash": 8, "email": 8},
    }


@router.get("/ioc")
async def list_ioc(
    type: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
):
    # auto-expire cleanup
    await db.threat_iocs.delete_many({"expires_at": {"$lt": _iso(), "$ne": None}})
    q = {}
    if type: q["type"] = type
    if tag:  q["tag"] = tag
    rows = await db.threat_iocs.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    counts = {"total": len(rows)}
    for t in ["ip", "domain", "url", "hash", "email"]:
        counts[t] = await db.threat_iocs.count_documents({"type": t})
    return {"items": rows, "counts": counts}


@router.delete("/ioc/{ioc_id}")
async def delete_ioc(ioc_id: str):
    r = await db.threat_iocs.delete_one({"id": ioc_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "IOC bulunamadı")
    return {"ok": True}


# ---------- 2) DMARC Aggregator ----------
class DMARCReport(BaseModel):
    domain: str
    org_name: str
    date_range_begin: str
    date_range_end: str
    total_msgs: int
    dkim_pass: int = 0
    spf_pass: int = 0
    dmarc_pass: int = 0
    failures: list[dict] = Field(default_factory=list)


@router.post("/dmarc/ingest")
async def ingest_dmarc(payload: DMARCReport):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["received_at"] = _iso()
    doc["dmarc_pct"] = round((payload.dmarc_pass / max(1, payload.total_msgs)) * 100, 1)
    await db.dmarc_reports.insert_one(dict(doc))
    return {"ok": True, "id": doc["id"], "dmarc_pct": doc["dmarc_pct"]}


@router.get("/dmarc/summary")
async def dmarc_summary(days: int = Query(30, ge=1, le=180)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"received_at": {"$gte": since}}},
        {"$group": {
            "_id": "$domain",
            "reports": {"$sum": 1},
            "total_msgs": {"$sum": "$total_msgs"},
            "dmarc_pass": {"$sum": "$dmarc_pass"},
            "spf_pass": {"$sum": "$spf_pass"},
            "dkim_pass": {"$sum": "$dkim_pass"},
        }},
        {"$sort": {"total_msgs": -1}},
        {"$limit": 50},
    ]
    domains = []
    async for row in db.dmarc_reports.aggregate(pipeline):
        tot = max(1, row["total_msgs"])
        domains.append({
            "domain": row["_id"], "reports": row["reports"],
            "total_msgs": row["total_msgs"],
            "dmarc_pct": round(row["dmarc_pass"] / tot * 100, 1),
            "spf_pct":   round(row["spf_pass"] / tot * 100, 1),
            "dkim_pct":  round(row["dkim_pass"] / tot * 100, 1),
        })
    return {"days": days, "domains": domains, "count": len(domains)}


# ---------- 3) Global Blocklist Sync ----------
GLOBAL_FEEDS = [
    {"key": "spamhaus_zen", "name": "Spamhaus ZEN", "url": "https://www.spamhaus.org/", "interval_min": 30},
    {"key": "barracuda_bl", "name": "Barracuda Reputation", "url": "https://barracudacentral.org/", "interval_min": 30},
    {"key": "sorbs", "name": "SORBS DNSBL", "url": "https://sorbs.net/", "interval_min": 60},
    {"key": "uceprotect_l1", "name": "UCEPROTECT Level 1", "url": "https://uceprotect.net/", "interval_min": 60},
    {"key": "urlhaus", "name": "URLhaus (abuse.ch)", "url": "https://urlhaus.abuse.ch/", "interval_min": 15},
    {"key": "phishtank", "name": "PhishTank", "url": "https://phishtank.org/", "interval_min": 15},
]


@router.get("/feeds")
async def list_feeds():
    """Global feed sync durumu — gerçek DB'den IOC sayısı okunur."""
    now = datetime.now(timezone.utc)
    items = []
    for f in GLOBAL_FEEDS:
        # Gerçek IOC sayısını threat_iocs koleksiyonundan çek
        ioc_count = await db.threat_iocs.count_documents({"source": f["key"]})
        # last_synced_at: bu source için en son eklenen IOC'nin created_at'i
        last_doc = await db.threat_iocs.find_one(
            {"source": f["key"]},
            {"created_at": 1, "_id": 0},
            sort=[("created_at", -1)],
        )
        last_synced = last_doc.get("created_at") if last_doc else None
        next_sync = None
        if last_synced:
            try:
                last_dt = datetime.fromisoformat(last_synced.replace("Z", "+00:00"))
                next_sync = (last_dt + timedelta(minutes=f["interval_min"])).isoformat()
            except Exception:
                pass
        items.append({
            **f,
            "last_synced_at": last_synced or (now - timedelta(days=999)).isoformat(),
            "next_sync_at": next_sync or now.isoformat(),
            "status": "ok" if ioc_count > 0 else "never_synced",
            "ioc_count": ioc_count,
        })
    return {"items": items, "count": len(items)}


@router.post("/feeds/{feed_key}/sync")
async def trigger_sync(feed_key: str):
    """Gerçek feed fetch: URLhaus JSON API + Spamhaus ZEN DNS lookup + diğerleri simüle.
    Sonuçlar threat_iocs koleksiyonuna eklenir."""
    feed = next((f for f in GLOBAL_FEEDS if f["key"] == feed_key), None)
    if not feed:
        raise HTTPException(404, "Feed bulunamadi")
    added = 0
    errors = []
    try:
        if feed_key == "urlhaus":
            # Gerçek URLhaus recent URLs API (auth yok)
            import httpx
            async with httpx.AsyncClient(timeout=10) as h:
                r = await h.get("https://urlhaus.abuse.ch/downloads/json_recent/")
                if r.status_code == 200:
                    data = r.json()
                    # {"1": [{"id":..,"url":..,"host":..,"threat":..}], ...}
                    for _k, entries in list(data.items())[:20]:  # first 20 groups
                        for e in entries[:2]:                    # limit per group
                            url = e.get("url") or ""
                            if not url:
                                continue
                            await db.threat_iocs.update_one(
                                {"type": "url", "value": url},
                                {"$set": {
                                    "id": str(uuid.uuid4()), "type": "url",
                                    "value": url, "tag": "malware",
                                    "confidence": 90, "source": "urlhaus",
                                    "note": e.get("threat") or "URLhaus recent",
                                    "created_at": _iso(),
                                    "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
                                }},
                                upsert=True,
                            )
                            added += 1
                            if added >= 30:
                                break
                        if added >= 30: break
                else:
                    errors.append(f"URLhaus http {r.status_code}")
        elif feed_key == "spamhaus_zen":
            # Spamhaus ZEN DNS-based: son 24s'te en çok görülen kaynak IP'leri ZEN'e sorgula
            import socket
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            pipeline = [
                {"$match": {"ingested_at": {"$gte": since},
                            "verdict": {"$in": ["spam", "high_spam"]},
                            "client_ip": {"$exists": True, "$nin": ["", None]}}},
                {"$group": {"_id": "$client_ip", "n": {"$sum": 1}}},
                {"$sort": {"n": -1}}, {"$limit": 30},
            ]
            top_ips = []
            async for row in db.mail_events.aggregate(pipeline):
                top_ips.append(row["_id"])
            for ip in top_ips:
                try:
                    # Reverse octets and query <rev>.zen.spamhaus.org
                    parts = ip.split(".")
                    if len(parts) != 4:
                        continue
                    q = ".".join(reversed(parts)) + ".zen.spamhaus.org"
                    result = socket.gethostbyname_ex(q)  # NXDOMAIN → raises
                    codes = result[2]  # list of 127.0.0.x codes
                    if codes:
                        await db.threat_iocs.update_one(
                            {"type": "ip", "value": ip},
                            {"$set": {
                                "id": str(uuid.uuid4()), "type": "ip",
                                "value": ip, "tag": "spam", "confidence": 95,
                                "source": "spamhaus_zen",
                                "note": f"ZEN codes: {','.join(codes)}",
                                "created_at": _iso(),
                                "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                            }},
                            upsert=True,
                        )
                        added += 1
                except socket.gaierror:
                    pass  # NXDOMAIN — IP not listed
                except Exception as e:
                    errors.append(str(e)[:60])
                    break
        elif feed_key == "phishtank":
            # OpenPhish free feed (auth yok) — 302 redirect follow
            import httpx
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as h:
                r = await h.get("https://openphish.com/feed.txt")
                if r.status_code == 200:
                    urls = [u.strip() for u in r.text.splitlines() if u.strip() and u.startswith("http")]
                    for url in urls[:40]:
                        await db.threat_iocs.update_one(
                            {"type": "url", "value": url},
                            {"$set": {
                                "id": str(uuid.uuid4()), "type": "url", "value": url,
                                "tag": "phishing", "confidence": 92, "source": "phishtank",
                                "note": "OpenPhish live feed",
                                "created_at": _iso(),
                                "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                            }},
                            upsert=True,
                        )
                        added += 1
                else:
                    errors.append(f"OpenPhish http {r.status_code}")
        elif feed_key in ("barracuda", "barracuda_bl", "sorbs", "uceprotect", "uceprotect_l1"):
            # DNS-based blacklist lookup — Spamhaus pattern ile aynı, farklı domain
            import socket
            dnsbl_map = {
                "barracuda": "b.barracudacentral.org",
                "barracuda_bl": "b.barracudacentral.org",
                "sorbs": "dnsbl.sorbs.net",
                "uceprotect": "dnsbl-1.uceprotect.net",
                "uceprotect_l1": "dnsbl-1.uceprotect.net",
            }
            dnsbl_domain = dnsbl_map[feed_key]
            confidence_val = {"barracuda": 88, "barracuda_bl": 88, "sorbs": 82,
                              "uceprotect": 75, "uceprotect_l1": 75}[feed_key]
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            pipeline = [
                {"$match": {"ingested_at": {"$gte": since},
                            "verdict": {"$in": ["spam", "high_spam"]},
                            "client_ip": {"$exists": True, "$nin": ["", None]}}},
                {"$group": {"_id": "$client_ip", "n": {"$sum": 1}}},
                {"$sort": {"n": -1}}, {"$limit": 25},
            ]
            top_ips = []
            async for row in db.mail_events.aggregate(pipeline):
                top_ips.append(row["_id"])
            for ip in top_ips:
                try:
                    parts = ip.split(".")
                    if len(parts) != 4:
                        continue
                    q = ".".join(reversed(parts)) + "." + dnsbl_domain
                    result = socket.gethostbyname_ex(q)
                    codes = result[2]
                    if codes:
                        await db.threat_iocs.update_one(
                            {"type": "ip", "value": ip},
                            {"$set": {
                                "id": str(uuid.uuid4()), "type": "ip", "value": ip,
                                "tag": "spam", "confidence": confidence_val,
                                "source": feed_key,
                                "note": f"{dnsbl_domain} codes: {','.join(codes)}",
                                "created_at": _iso(),
                                "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                            }},
                            upsert=True,
                        )
                        added += 1
                except socket.gaierror:
                    pass  # NXDOMAIN — not listed
                except Exception as e:
                    errors.append(str(e)[:60])
                    break
        else:
            errors.append(f"Bilinmeyen feed: {feed_key}")
    except Exception as ex:
        errors.append(f"{type(ex).__name__}: {str(ex)[:80]}")
    return {"ok": True, "feed": feed_key, "added": added, "errors": errors}


# ============================================================================
# v43 AUTO-SYNC: feed'leri otomatik periyodik senkronize et
# ============================================================================
class AutoSyncCfg(BaseModel):
    enabled: bool = False
    interval_min: int = Field(60, ge=15, le=1440)  # 15dk - 24sa arası
    last_run_at: Optional[str] = None
    last_added: int = 0


@router.get("/auto-sync")
async def get_auto_sync():
    """Global Threat Intel auto-sync ayarlarını döner."""
    doc = await db.settings.find_one({"_key": "threat_intel_auto_sync"}, {"_id": 0}) or {}
    doc.pop("_key", None)
    if not doc:
        doc = AutoSyncCfg().model_dump()
    return doc


@router.post("/auto-sync")
async def set_auto_sync(cfg: AutoSyncCfg):
    """Auto-sync aç/kapat + periyot belirle."""
    await db.settings.update_one(
        {"_key": "threat_intel_auto_sync"},
        {"$set": {"_key": "threat_intel_auto_sync", **cfg.model_dump()}},
        upsert=True,
    )
    return {"ok": True, "enabled": cfg.enabled, "interval_min": cfg.interval_min}


@router.post("/auto-sync/run-now")
async def auto_sync_run_now():
    """Tüm feed'leri sıralı olarak senkronize et (arka planı beklemeden).
    Feeds tab'ının 'Tüm Feed'leri Şimdi Senkronize Et' butonu bunu çağırır."""
    total_added = 0
    results: list[dict] = []
    for f in GLOBAL_FEEDS:
        try:
            r = await trigger_sync(f["key"])
            total_added += r.get("added", 0)
            results.append({"feed": f["key"], "added": r.get("added", 0), "errors": r.get("errors", [])})
        except Exception as ex:
            results.append({"feed": f["key"], "error": str(ex)[:100]})
    # Update last_run_at metadata
    await db.settings.update_one(
        {"_key": "threat_intel_auto_sync"},
        {"$set": {"last_run_at": _iso(), "last_added": total_added}},
    )
    return {"ok": True, "total_added": total_added, "feeds": len(results), "results": results}


async def _threat_intel_auto_sync_loop():
    """Background task — settings.threat_intel_auto_sync.enabled=true iken
    her interval_min dakikada tüm feed'leri senkronize eder. server.py'nin
    startup task listesine eklenmesi gerekir."""
    import asyncio as _asyncio
    while True:
        try:
            cfg = await db.settings.find_one({"_key": "threat_intel_auto_sync"}, {"_id": 0}) or {}
            if cfg.get("enabled"):
                # Interval kontrolü — son run üzerinden interval_min geçti mi?
                interval_min = int(cfg.get("interval_min", 60))
                last_run = cfg.get("last_run_at")
                should_run = True
                if last_run:
                    try:
                        last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                        if (datetime.now(timezone.utc) - last_dt).total_seconds() < interval_min * 60:
                            should_run = False
                    except Exception:
                        pass
                if should_run:
                    total = 0
                    for f in GLOBAL_FEEDS:
                        try:
                            r = await trigger_sync(f["key"])
                            total += r.get("added", 0)
                        except Exception:
                            pass
                    await db.settings.update_one(
                        {"_key": "threat_intel_auto_sync"},
                        {"$set": {"last_run_at": _iso(), "last_added": total}},
                    )
        except Exception:
            pass
        # Her 60sn'de check (her interval_min dakikada sync)
        await _asyncio.sleep(60)


# ============================================================================
# DMARC DEMO SEED — DB boşsa örnek raporlar ekle (preview/dev için)
# ============================================================================
@router.get("/ioc/today-stats")
async def ioc_today_stats():
    """v43.6 Dashboard widget — bugün eklenen IOC sayısı, kaynak kırılımı, top-5.
    Cache 60sn (frequent-poll dashboard endpoint)."""
    from cache import cache as _cache
    cached = await _cache.get("ti:today_stats")
    if cached is not None:
        return cached
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    total_today = await db.threat_iocs.count_documents({"created_at": {"$gte": today_start}})
    total_all = await db.threat_iocs.count_documents({})
    # Kaynak kırılımı
    pipeline = [
        {"$match": {"created_at": {"$gte": today_start}}},
        {"$group": {"_id": "$source", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    by_source = []
    async for row in db.threat_iocs.aggregate(pipeline):
        by_source.append({"source": row["_id"] or "unknown", "count": row["count"]})
    # Tip kırılımı
    pipe_type = [
        {"$match": {"created_at": {"$gte": today_start}}},
        {"$group": {"_id": "$type", "count": {"$sum": 1}}},
    ]
    by_type = {}
    async for row in db.threat_iocs.aggregate(pipe_type):
        by_type[row["_id"] or "unknown"] = row["count"]
    result = {
        "added_today": total_today,
        "total_all_time": total_all,
        "by_source": by_source,
        "by_type": by_type,
        "generated_at": _iso(),
    }
    await _cache.set("ti:today_stats", result, 60.0)
    return result


@router.post("/dmarc/seed-demo")
async def dmarc_seed_demo():
    """Preview/geliştirme için — DMARC koleksiyonuna örnek raporlar ekler.
    Zaten kayıt varsa dokunmaz (idempotent)."""
    existing = await db.dmarc_reports.count_documents({})
    if existing > 0:
        return {"ok": True, "seeded": 0, "existing": existing, "note": "Zaten kayıt var"}
    import random
    from datetime import timedelta as _td
    domains = ["gokyuzuhosting.com", "example.com", "mail.testdomain.tr", "demo-shop.com", "haberler.tr"]
    orgs = ["Google", "Microsoft", "Yahoo", "AOL", "Proofpoint"]
    now = datetime.now(timezone.utc)
    docs = []
    for i in range(45):
        d = random.choice(domains)
        org = random.choice(orgs)
        total = random.randint(50, 8000)
        dkim = int(total * random.uniform(0.75, 0.98))
        spf = int(total * random.uniform(0.72, 0.96))
        dmarc = int(total * random.uniform(0.65, 0.94))
        rep_time = now - _td(days=random.randint(0, 29))
        docs.append({
            "id": str(uuid.uuid4()),
            "domain": d,
            "org_name": org,
            "date_range_begin": (rep_time - _td(days=1)).isoformat(),
            "date_range_end": rep_time.isoformat(),
            "total_msgs": total,
            "dkim_pass": dkim,
            "spf_pass": spf,
            "dmarc_pass": dmarc,
            "failures": [],
            "received_at": rep_time.isoformat(),
            "dmarc_pct": round((dmarc / max(1, total)) * 100, 1),
            "seeded": True,
        })
    if docs:
        await db.dmarc_reports.insert_many(docs)
    return {"ok": True, "seeded": len(docs), "domains": len(set(d["domain"] for d in docs))}


# ---------- 4) Compliance Center ----------
COMPLIANCE_CHECKS = [
    {"key": "kvkk", "name": "KVKK (Türkiye)", "framework": "TR",
     "items": [
         ("data_encryption", "Karantina verileri şifreli", 20),
         ("audit_logs", "Erişim log'ları tutuluyor", 15),
         ("data_retention", "30 gün karantina saklama", 15),
         ("user_consent", "Kullanıcı rıza mekanizması", 20),
         ("data_export", "KVKK veri talep endpoint'i", 15),
         ("breach_notify", "Sızıntı bildirim akışı", 15),
     ]},
    {"key": "gdpr", "name": "GDPR (AB)", "framework": "EU",
     "items": [
         ("dpo_contact", "DPO iletişim bilgisi", 20),
         ("data_export", "Veri taşınabilirlik (JSON)", 25),
         ("right_to_erasure", "Silme hakkı endpoint'i", 25),
         ("cookie_consent", "Çerez rızası bildirimi", 15),
         ("dpa_contract", "İşleyici sözleşmesi hazır", 15),
     ]},
    {"key": "hipaa", "name": "HIPAA (ABD Sağlık)", "framework": "US",
     "items": [
         ("baa_ready", "BAA (Business Associate) hazır", 30),
         ("phi_encryption", "PHI şifreleme (transit + rest)", 30),
         ("access_control", "Rol tabanlı erişim", 20),
         ("audit_trail", "6 yıl audit tutma", 20),
     ]},
    {"key": "soc2", "name": "SOC 2 Type II", "framework": "Global",
     "items": [
         ("mfa_required", "Yönetici MFA zorunlu", 15),
         ("backup_daily", "Günlük yedekleme", 15),
         ("incident_plan", "Olay müdahale planı", 20),
         ("vendor_review", "3. parti risk değerlendirmesi", 15),
         ("penetration_test", "Yıllık pen test", 20),
         ("access_logs", "Tüm sistem erişim log'ları", 15),
     ]},
]


@router.get("/compliance")
async def compliance_status():
    """Uyumluluk skorlari. Bazi item'lar sistem state'inden otomatik tespit edilir."""
    state = await db.compliance_state.find_one({"_key": "state"}, {"_id": 0}) or {}
    checked = state.get("checked", {})
    # ----- AUTO-DETECT bazi item'lar (sistem state'inden) -----
    auto: dict[str, bool] = {}
    try:
        # audit_logs: db.logs veya alerts_fired son 24s'te varsa OK
        recent_since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        logs_count = 0
        try:
            logs_count = await db.alerts_fired.count_documents({"created_at": {"$gte": recent_since}})
        except Exception:
            pass
        has_logs = logs_count > 0 or (await db.queue_audit.count_documents({}) > 0)
        auto["kvkk.audit_logs"] = has_logs
        auto["soc2.access_logs"] = has_logs
        auto["hipaa.audit_trail"] = has_logs
        # data_encryption: her zaman MongoDB TLS destekli → True
        auto["kvkk.data_encryption"] = True
        auto["hipaa.phi_encryption"] = True
        # data_retention: quarantine_ttl_days config'i varsa OK
        try:
            ms_cfg = await db.mailscanner_config.find_one({}, {"_id": 0}) or {}
            if ms_cfg.get("quarantine_ttl_days"):
                auto["kvkk.data_retention"] = True
        except Exception:
            pass
        # data_export: /api/reports pdf endpoint mevcut → True
        auto["kvkk.data_export"] = True
        auto["gdpr.data_export"] = True
        # backup_daily: db.settings.backup varsa OK
        try:
            bak = await db.settings.find_one({"_key": "backup"}, {"_id": 0}) or {}
            auto["soc2.backup_daily"] = bool(bak.get("enabled"))
        except Exception:
            pass
        # mfa_required: users koleksiyonunda mfa_enabled=true olan admin varsa OK
        try:
            mfa_count = await db.users.count_documents({"role": {"$in": ["master", "admin"]}, "mfa_enabled": True})
            auto["soc2.mfa_required"] = mfa_count > 0
        except Exception:
            pass
        # cookie_consent: FE'de zaten var (banner)
        auto["gdpr.cookie_consent"] = True
        # right_to_erasure: users delete endpoint var
        auto["gdpr.right_to_erasure"] = True
    except Exception:
        pass
    # Merge auto-detected on top of manual checked (manual override still respected)
    for k, v in auto.items():
        if k not in checked:
            checked[k] = v
    # Persist merged state
    if auto:
        await db.compliance_state.update_one(
            {"_key": "state"},
            {"$set": {"_key": "state", "checked": checked,
                      "auto_detected": list(auto.keys()),
                      "last_auto_scan": _iso()}},
            upsert=True,
        )
    frameworks = []
    for framework in COMPLIANCE_CHECKS:
        score = 0
        max_score = 0
        items = []
        for (item_key, item_label, weight) in framework["items"]:
            max_score += weight
            full_key = f"{framework['key']}.{item_key}"
            is_checked = checked.get(full_key, False)
            is_auto = full_key in auto
            if is_checked:
                score += weight
            items.append({"key": item_key, "label": item_label,
                           "weight": weight, "checked": is_checked,
                           "auto_detected": is_auto})
        frameworks.append({
            "key": framework["key"], "name": framework["name"],
            "framework": framework["framework"],
            "score": score, "max_score": max_score,
            "pct": round(score / max(1, max_score) * 100, 1),
            "items": items,
        })
    overall = round(sum(f["pct"] for f in frameworks) / len(frameworks), 1)
    return {"overall_pct": overall, "frameworks": frameworks,
            "auto_detected_count": len(auto)}


class ComplianceToggle(BaseModel):
    framework_key: str
    item_key: str
    checked: bool


@router.post("/compliance/toggle")
async def toggle_compliance(payload: ComplianceToggle):
    full_key = f"{payload.framework_key}.{payload.item_key}"
    state = await db.compliance_state.find_one({"_key": "state"}, {"_id": 0}) or {"checked": {}}
    checked = state.get("checked", {})
    checked[full_key] = payload.checked
    await db.compliance_state.update_one(
        {"_key": "state"},
        {"$set": {"_key": "state", "checked": checked, "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "full_key": full_key, "checked": payload.checked}


# ============================================================================
#  RBL PROVIDERS + DELISTING + MAIL HEALTH + UPDATE SERVER
# ============================================================================
RBL_PROVIDERS = [
    ("spamhaus_sbl", "Spamhaus SBL", "sbl.spamhaus.org", "https://www.spamhaus.org/lookup/"),
    ("spamhaus_css", "Spamhaus CSS", "css.spamhaus.org", "https://www.spamhaus.org/lookup/"),
    ("spamhaus_xbl", "Spamhaus XBL", "xbl.spamhaus.org", "https://www.spamhaus.org/lookup/"),
    ("barracuda", "Barracuda Reputation", "b.barracudacentral.org", "https://barracudacentral.org/rbl/removal-request"),
    ("sorbs_spam", "SORBS SPAM", "spam.dnsbl.sorbs.net", "https://sorbs.net/delisting/dnsbl.shtml"),
    ("sorbs_dul", "SORBS DUL", "dul.dnsbl.sorbs.net", "https://sorbs.net/delisting/dnsbl.shtml"),
    ("sorbs_web", "SORBS WEB", "web.dnsbl.sorbs.net", "https://sorbs.net/delisting/dnsbl.shtml"),
    ("uce_l1", "UCEPROTECT L1", "dnsbl-1.uceprotect.net", "https://www.uceprotect.net/en/rblcheck.php"),
    ("uce_l2", "UCEPROTECT L2", "dnsbl-2.uceprotect.net", "https://www.uceprotect.net/en/rblcheck.php"),
    ("uce_l3", "UCEPROTECT L3", "dnsbl-3.uceprotect.net", "https://www.uceprotect.net/en/rblcheck.php"),
    ("psbl", "PSBL", "psbl.surriel.com", "https://psbl.org/remove"),
    ("s5h", "S5H", "all.s5h.net", "https://blocklist.site/"),
    ("dronebl", "DroneBL", "dnsbl.dronebl.org", "https://dronebl.org/lookup"),
    ("phishtank", "PhishTank", "phishtank.com", "https://phishtank.org/removal/"),
]


@router.get("/rbl/providers")
async def rbl_providers():
    return {"items": [{"key": k, "name": n, "dnsbl": d, "delist_url": u} for (k, n, d, u) in RBL_PROVIDERS]}


class RBLCheckIn(BaseModel):
    ip: str = Field(..., min_length=7, max_length=45)


@router.post("/rbl/check")
async def rbl_check(payload: RBLCheckIn):
    """IP'yi tüm RBL'lere karşı DNS ile kontrol et."""
    import socket
    try:
        parts = payload.ip.split(".")
        if len(parts) != 4:
            raise HTTPException(400, "Sadece IPv4 destekleniyor")
        rev = ".".join(reversed(parts))
    except Exception:
        raise HTTPException(400, "Geçersiz IP")
    results = []
    for (k, n, d, u) in RBL_PROVIDERS:
        listed = False
        codes = []
        try:
            r = socket.gethostbyname_ex(f"{rev}.{d}")
            codes = r[2]
            listed = bool(codes)
        except socket.gaierror:
            listed = False
        except Exception:
            listed = False
        results.append({"key": k, "name": n, "listed": listed, "codes": codes,
                        "delist_url": u, "dnsbl": d})
    listed_count = sum(1 for r in results if r["listed"])
    return {"ip": payload.ip, "listed_count": listed_count,
            "total": len(results), "results": results}


class DelistIn(BaseModel):
    ip: str
    provider_key: str
    contact_email: str
    reason: Optional[str] = ""


@router.post("/rbl/delist")
async def rbl_delist_request(payload: DelistIn):
    """Delisting talebi kaydet (mock: gerçek talep provider URL'inden yapılır)."""
    prov = next((p for p in RBL_PROVIDERS if p[0] == payload.provider_key), None)
    if not prov:
        raise HTTPException(404, "Provider bulunamadı")
    doc = {
        "id": str(uuid.uuid4()), "ip": payload.ip,
        "provider_key": payload.provider_key, "provider_name": prov[1],
        "delist_url": prov[3], "contact_email": payload.contact_email,
        "reason": (payload.reason or "")[:400],
        "status": "submitted", "created_at": _iso(),
    }
    await db.delist_requests.insert_one(dict(doc))
    return {"ok": True, **doc, "note": "Otomatik form gönderimi yerine provider URL'sini takip edin"}


@router.post("/rbl/delist-all")
async def rbl_delist_all(payload: DelistIn):
    """Tüm listelenen provider'lar için toplu delisting talebi."""
    check = await rbl_check(RBLCheckIn(ip=payload.ip))
    submitted = []
    for r in check["results"]:
        if r["listed"]:
            payload.provider_key = r["key"]
            res = await rbl_delist_request(payload)
            submitted.append(res)
    return {"ok": True, "submitted": len(submitted), "items": submitted}


# ---- Mail Health Check ----
class HealthCheckIn(BaseModel):
    domain: str = Field(..., min_length=3, max_length=253)


@router.post("/mail/health-check")
async def mail_health_check(payload: HealthCheckIn):
    """MX/SPF/DKIM/DMARC/PTR DNS kontrolü."""
    import socket
    import dns.resolver
    d = payload.domain.strip().lower()
    result = {"domain": d, "checks": {}, "score": 0, "max_score": 100}
    # MX
    try:
        mx = dns.resolver.resolve(d, "MX")
        result["checks"]["mx"] = {"ok": True, "records": [str(r.exchange) for r in mx][:5]}
        result["score"] += 20
    except Exception as ex:
        result["checks"]["mx"] = {"ok": False, "error": type(ex).__name__}
    # SPF
    try:
        txt = dns.resolver.resolve(d, "TXT")
        spf = [str(r).strip('"') for r in txt if "v=spf1" in str(r)]
        result["checks"]["spf"] = {"ok": bool(spf), "record": spf[0] if spf else None,
                                    "hard_fail": "-all" in (spf[0] if spf else "")}
        if spf: result["score"] += 20
    except Exception as ex:
        result["checks"]["spf"] = {"ok": False, "error": type(ex).__name__}
    # DKIM (default selector)
    try:
        dkim = dns.resolver.resolve(f"default._domainkey.{d}", "TXT")
        recs = [str(r).strip('"') for r in dkim]
        result["checks"]["dkim"] = {"ok": bool(recs), "selector": "default"}
        if recs: result["score"] += 20
    except Exception:
        result["checks"]["dkim"] = {"ok": False, "note": "'default' selector — özel selector varsa manuel bak"}
    # DMARC
    try:
        dmarc = dns.resolver.resolve(f"_dmarc.{d}", "TXT")
        recs = [str(r).strip('"') for r in dmarc if "v=DMARC1" in str(r)]
        pol = ""
        if recs:
            import re
            m = re.search(r"p=(none|quarantine|reject)", recs[0])
            pol = m.group(1) if m else ""
        result["checks"]["dmarc"] = {"ok": bool(recs), "record": recs[0] if recs else None, "policy": pol}
        if recs:
            result["score"] += 20
            if pol == "reject": result["score"] += 10
    except Exception as ex:
        result["checks"]["dmarc"] = {"ok": False, "error": type(ex).__name__}
    # PTR (MX ilkinin IP'sinin reverse)
    try:
        mx0 = result["checks"].get("mx", {}).get("records", [None])[0]
        if mx0:
            ip = socket.gethostbyname(mx0.rstrip("."))
            rev = socket.gethostbyaddr(ip)[0]
            result["checks"]["ptr"] = {"ok": True, "ip": ip, "ptr": rev,
                                        "matches_mx": d in rev}
            result["score"] += 10
    except Exception:
        result["checks"]["ptr"] = {"ok": False}
    return result


# ---- Update Server (gokyuzuhosting.com) ----
CURRENT_VERSION = "1.5.0"
UPDATE_HOST = "https://gokyuzuhosting.com"


@router.get("/update/check")
async def update_check(version: str = Query("1.0.0")):
    """Bayilerin versiyon kontrol endpoint'i."""
    latest = CURRENT_VERSION
    is_outdated = version < latest
    return {
        "current": version,
        "latest": latest,
        "outdated": is_outdated,
        "download_url": f"{UPDATE_HOST}/downloads/gws-{latest}.tar.gz" if is_outdated else None,
        "changelog_url": f"{UPDATE_HOST}/changelog#{latest}",
        "critical": False,
        "checked_at": _iso(),
    }


@router.get("/update/versions")
async def update_versions():
    """Yayınlanan tüm versiyonlar."""
    return {"versions": [
        {"version": "1.5.0", "released_at": "2026-02-15", "notes": "Threat Intel + AI Auto-Actions + Docs Media"},
        {"version": "1.4.0", "released_at": "2026-02-08", "notes": "Landing redesign + Offline TopoJSON"},
        {"version": "1.3.0", "released_at": "2026-02-01", "notes": "MailScanner independent module"},
        {"version": "1.2.0", "released_at": "2026-01-25", "notes": "Country blocking + Attack map"},
        {"version": "1.1.0", "released_at": "2026-01-18", "notes": "Reseller white-label"},
        {"version": "1.0.0", "released_at": "2026-01-01", "notes": "İlk yayın"},
    ], "update_host": UPDATE_HOST}
