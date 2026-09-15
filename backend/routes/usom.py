"""v44.00.26 — USOM (T.C. Siber Güvenlik Başkanlığı) Zararlı Bağlantı Entegrasyonu
=====================================================================

USOM = Ulusal Siber Olaylara Müdahale Merkezi (Türkiye)
Kaynak: https://siberguvenlik.gov.tr/api/address/index  (yeni resmi JSON API)
       Legacy: https://www.usom.gov.tr/url-list.txt (fallback)

API response örneği:
  {"totalCount": 492462, "count": 20, "models": [
     {"id": 1168040, "url": "sahtebanka.com", "type": "domain",
      "desc": "PH", "source": "IH", "date": "2026-09-15 00:23:36.242325",
      "criticality_level": 4, "connectiontype": "PH"}, ...
  ]}

Fetch:
  - JSON API paginated (?page=1&limit=100) — ilk N sayfa çekilir (son eklenenler)
  - `type` alanına göre: "domain" → domain IOC, "url" → url IOC, "ip" → ip IOC
  - "desc" alanı zararlı türü: PH=Phishing, MW=Malware, RS=Ransomware, SPAM, BOT vb.
  - Her domain otomatik olarak kara liste'ye yazılır (scan verdict etkisi)

Endpoints:
  POST /api/threat-intel/usom/fetch  — manuel tetikle
  GET  /api/threat-intel/usom/list?q= — listele (arama)
  POST /api/threat-intel/usom/delete — kayıt sil
"""
from __future__ import annotations
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

# v44.00.26 — Yeni USOM API: https://siberguvenlik.gov.tr/api/
# JSON paginated (page + limit). Legacy TXT feed fallback olarak tutulur.
USOM_JSON_API = "https://siberguvenlik.gov.tr/api/address/index"
USOM_FEED_CANDIDATES = [
    "https://www.usom.gov.tr/url-list.txt",
    "https://usom.gov.tr/url-list.txt",
]
# İlk N sayfa çek — 200/page × 25 = 5000 IOC (son eklenenler, yani en güncel tehditler)
USOM_MAX_PAGES = 25
USOM_PAGE_LIMIT = 200

# USOM "desc" kodları → insan-okur etiket
USOM_DESC_MAP = {
    "PH": "phishing",   "MW": "malware",   "RS": "ransomware",
    "SPAM": "spam",     "BOT": "botnet",   "C2": "c2",
    "DR": "dropper",    "IH": "impersonation",
    "TR": "trojan",     "AD": "adware",    "MI": "miner",
}


router = APIRouter(prefix="/threat-intel/usom", tags=["threat-intel-usom"])

_client = AsyncIOMotorClient(os.environ.get("MONGO_URL"))
db = _client[os.environ.get("DB_NAME").strip('"')]


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _require_master(request: Request, license_key: Optional[str] = None):
    from server import _require_master as core_check
    return await core_check(request, license_key)


# v44.00.22 — Valid URL/domain satırlarını tanımlar. HTML tag'lerini, boş
# satırları, comment'leri, garbage'ı reddeder.
_VALID_LINE_RE = re.compile(
    r"^(https?://)?[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+"
    r"(?::\d{1,5})?(?:/[^\s<>\"']*)?$",
    re.IGNORECASE,
)


def _is_html_content(text: str) -> bool:
    """First 500 char'da HTML sniff."""
    head = text[:500].lstrip().lower()
    return head.startswith(("<!doctype", "<html", "<?xml"))


async def _fetch_usom_iocs() -> tuple[list[dict], str]:
    """v44.00.26 — Yeni siberguvenlik.gov.tr JSON API'sinden IOC listesi çeker.
    Döner: (items, source_url). Her item: {"value", "type", "tag", "criticality", "date"}.
    Fallback olarak eski TXT feed'i denenir."""
    items: list[dict] = []
    seen: set = set()
    async with httpx.AsyncClient(
        timeout=30, follow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0 (GokyuzuWebSpam/v44.00.26 Master Panel)",
            "Accept": "application/json, text/plain, */*",
        },
    ) as h:
        # 1) Yeni JSON API — paginated
        try:
            for page in range(1, USOM_MAX_PAGES + 1):
                url = f"{USOM_JSON_API}?page={page}&limit={USOM_PAGE_LIMIT}"
                r = await h.get(url)
                if r.status_code != 200:
                    if page == 1:
                        raise httpx.HTTPError(f"HTTP {r.status_code} on page 1")
                    break
                try:
                    data = r.json()
                except Exception:
                    if page == 1:
                        raise
                    break
                models = data.get("models") or []
                if not models:
                    break
                for m in models:
                    val = (m.get("url") or "").strip()
                    typ = (m.get("type") or "").strip().lower()
                    if not val or typ not in ("url", "domain", "ip"):
                        continue
                    val_l = val.lower()
                    key = (typ, val_l)
                    if key in seen:
                        continue
                    seen.add(key)
                    desc_code = (m.get("desc") or "").upper()
                    tag = USOM_DESC_MAP.get(desc_code, "malicious")
                    items.append({
                        "value": val_l,
                        "type": typ,
                        "tag": tag,
                        "desc_code": desc_code,
                        "criticality": int(m.get("criticality_level") or 3),
                        "date": m.get("date") or "",
                        "usom_id": m.get("id"),
                    })
                # Total count based early exit
                if len(items) >= (data.get("totalCount") or 999999):
                    break
            if items:
                return items, f"{USOM_JSON_API} (JSON API, {len(items)} IOC · {page} sayfa)"
        except httpx.HTTPError as ex:
            _last_err = f"JSON API başarısız: {ex}"
        except Exception as ex:
            _last_err = f"JSON parse başarısız: {ex}"

        # 2) Fallback: eski TXT feed
        for feed_url in USOM_FEED_CANDIDATES:
            try:
                r = await h.get(feed_url)
                if r.status_code != 200 or _is_html_content(r.text):
                    continue
                for line in r.text.splitlines():
                    u = line.strip()
                    if not u or u.startswith("#"):
                        continue
                    if any(c in u for c in ("<", ">", '"', "'", "{", "}", "=")):
                        continue
                    if not _VALID_LINE_RE.match(u):
                        continue
                    if not u.startswith(("http://", "https://")):
                        u = "http://" + u
                    key = ("url", u.lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append({
                        "value": u.lower(), "type": "url", "tag": "malicious",
                        "desc_code": "", "criticality": 3, "date": "",
                        "usom_id": None,
                    })
                if items:
                    return items, feed_url + " (TXT fallback)"
            except httpx.HTTPError:
                continue
    raise HTTPException(502, "USOM feed çekilemedi (JSON API + TXT fallback ikisi de başarısız)")


# Backwards compat: eski test'ler _fetch_usom_urls'ı çağırıyor
async def _fetch_usom_urls() -> tuple[list[str], str]:
    items, src = await _fetch_usom_iocs()
    urls = [(i["value"] if i["value"].startswith(("http://", "https://")) else f"http://{i['value']}")
            for i in items if i["type"] in ("url", "domain")]
    return urls, src


@router.post("/fetch")
async def fetch_usom(request: Request, license_key: Optional[str] = None):
    """USOM zararlı IOC listesini yeni JSON API'den indir, IOC'lara + Kara Liste'ye yaz.
    v44.00.26 — Yeni siberguvenlik.gov.tr API + IP + domain + URL tipleri destekleniyor.
    Domain'ler otomatik olarak scan-verdict kara listesine yazılır."""
    await _require_master(request, license_key)
    items, source_url = await _fetch_usom_iocs()
    now = _iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    added_urls = 0
    added_domains = 0
    added_ips = 0
    added_to_blacklist = 0
    seen_domains: set = set()

    for it in items:
        val = it["value"]
        typ = it["type"]
        tag = it["tag"]
        conf = min(99, 70 + it["criticality"] * 6)  # criticality 1→76, 5→100
        note = f"USOM {it['desc_code']} · seviye {it['criticality']}" if it["desc_code"] else "USOM Zararlı Bağlantı Listesi"

        # IOC insert
        r_ioc = await db.threat_iocs.update_one(
            {"type": typ, "value": val},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "type": typ, "value": val,
                "tag": tag, "confidence": conf,
                "source": "usom",
                "feed": "usom-json-api",
                "note": note,
                "created_at": now, "expires_at": expires,
                "usom_id": it.get("usom_id"),
                "criticality": it["criticality"],
            }, "$set": {"last_seen_at": now}},
            upsert=True,
        )
        if r_ioc.upserted_id:
            if typ == "url":     added_urls += 1
            elif typ == "domain": added_domains += 1
            elif typ == "ip":     added_ips += 1

        # v44.00.26 — Domain ve URL'ler için otomatik kara liste ekleme
        host = None
        if typ == "domain":
            host = val
        elif typ == "url":
            try:
                u = val if val.startswith(("http://", "https://")) else f"http://{val}"
                host = (urlparse(u).hostname or "").lower()
            except Exception:
                host = None
        if host and "." in host and not re.match(r"^\d+\.\d+\.\d+\.\d+$", host) and host not in seen_domains:
            seen_domains.add(host)
            # Domain IOC (URL tipiyse ayrıca)
            if typ == "url":
                r_dom = await db.threat_iocs.update_one(
                    {"type": "domain", "value": host},
                    {"$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "type": "domain", "value": host,
                        "tag": tag, "confidence": max(80, conf - 5),
                        "source": "usom",
                        "feed": "usom-json-api",
                        "note": f"USOM URL'in domain'i · {it['desc_code'] or 'zararlı'}",
                        "created_at": now, "expires_at": expires,
                    }, "$set": {"last_seen_at": now}},
                    upsert=True,
                )
                if r_dom.upserted_id:
                    added_domains += 1
            # Otomatik kara liste (db.lists UI schema)
            existing = await db.lists.find_one(
                {"entry_type": "domain", "value": host, "list_type": "black"},
                {"_id": 0, "id": 1},
            )
            if not existing:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()),
                    "list_type": "black",
                    "entry_type": "domain",
                    "value": host,
                    "scope": "global",
                    "user": None,
                    "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto",
                    "created_at": now,
                })
                added_to_blacklist += 1

        # IP'ler için de otomatik kara liste (db.lists UI schema)
        if typ == "ip":
            existing_ip = await db.lists.find_one(
                {"entry_type": "ip", "value": val, "list_type": "black"},
                {"_id": 0, "id": 1},
            )
            if not existing_ip:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()),
                    "list_type": "black",
                    "entry_type": "ip",
                    "value": val,
                    "scope": "global",
                    "user": None,
                    "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto",
                    "created_at": now,
                })
                added_to_blacklist += 1

    await db.settings.update_one(
        {"_key": "usom_last_run"},
        {"$set": {"_key": "usom_last_run", "date": datetime.now(timezone.utc).date().isoformat(),
                  "count": len(items), "added_urls": added_urls,
                  "added_domains": added_domains, "added_ips": added_ips,
                  "added_to_blacklist": added_to_blacklist,
                  "at": now, "source": source_url}},
        upsert=True,
    )
    return {
        "ok": True,
        "source": source_url,
        "total_fetched": len(items),
        "added_urls": added_urls,
        "added_domains": added_domains,
        "added_ips": added_ips,
        "added_to_blacklist": added_to_blacklist,
        "at": now,
    }


async def _fetch_usom_urls() -> tuple[list[str], str]:
    """USOM public URL feed'ini dener (birden fazla adayı). Döner: (urls, source_url)."""
    last_err = ""
    async with httpx.AsyncClient(
        timeout=25, follow_redirects=True,
        headers={"User-Agent": "GokyuzuWebSpam/v44.00.22 (Master Panel)",
                 "Accept": "text/plain, */*"},
    ) as h:
        for feed_url in USOM_FEED_CANDIDATES:
            try:
                r = await h.get(feed_url)
                if r.status_code != 200:
                    last_err = f"{feed_url} → HTTP {r.status_code}"
                    continue
                if _is_html_content(r.text):
                    last_err = f"{feed_url} → HTML page (not URL list)"
                    continue
                urls: list = []
                for line in r.text.splitlines():
                    u = line.strip()
                    if not u or u.startswith("#"):
                        continue
                    # Reject lines with HTML/JS residue
                    if any(c in u for c in ("<", ">", '"', "'", "{", "}", "=")):
                        continue
                    # Must match valid URL pattern
                    if not _VALID_LINE_RE.match(u):
                        continue
                    if not u.startswith(("http://", "https://")):
                        u = "http://" + u
                    urls.append(u)
                if urls:
                    return urls, feed_url
                last_err = f"{feed_url} → no valid URLs after filter"
            except httpx.HTTPError as ex:
                last_err = f"{feed_url} → {ex}"
    raise HTTPException(502, f"USOM feed'i çekilemedi: {last_err}")


@router.post("/cleanup")
async def cleanup_usom(request: Request, license_key: Optional[str] = None):
    """v44.00.22 — Kirli USOM IOC'ları temizle (HTML tag'i içeren, geçersiz format).
    Önceki hatalı fetch'lerden kalan kayıtları siler."""
    await _require_master(request, license_key)
    # HTML tag / garbage içeren kayıtları bul
    bad_pattern = {"$or": [
        {"value": {"$regex": r"[<>\"'{}=]"}},
        {"value": {"$regex": r"^https?://[<>]"}},
        {"value": {"$regex": r"DOCTYPE|<html|<meta|<title|<head|<body|<script", "$options": "i"}},
    ]}
    filt = {"source": "usom", **bad_pattern}
    r_ioc = await db.threat_iocs.delete_many(filt)
    # Kara liste'den de temizle
    r_list = await db.lists.delete_many({
        "source_kind": "usom",
        "value": {"$regex": r"[<>\"'{}=]"},
    })
    return {"ok": True, "removed_iocs": r_ioc.deleted_count,
            "removed_from_lists": r_list.deleted_count}


@router.get("/list")
async def list_usom(request: Request, q: Optional[str] = None,
                    limit: int = 500, license_key: Optional[str] = None):
    """USOM kaynaklı IOC'ları listele (arama)."""
    await _require_master(request, license_key)
    q_l = (q or "").strip().lower() or None
    filt: dict = {"source": "usom"}
    if q_l:
        filt["value"] = {"$regex": re.escape(q_l), "$options": "i"}
    rows = await db.threat_iocs.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    state = await db.settings.find_one({"_key": "usom_last_run"}, {"_id": 0}) or {}
    return {
        "items": rows,
        "count": len(rows),
        "last_sync_at": state.get("at"),
        "total_fetched": state.get("count", 0),
        "added_urls": state.get("added_urls", 0),
        "added_domains": state.get("added_domains", 0),
        "added_ips": state.get("added_ips", 0),
        "added_to_blacklist": state.get("added_to_blacklist", 0),
    }


# v44.00.29 — USOM İstatistik: tag/desc_code breakdown, kritiklik histogramı
@router.get("/stats")
async def usom_stats(request: Request, license_key: Optional[str] = None):
    """USOM IOC'ları için detaylı istatistik: type/tag/criticality/desc_code breakdown."""
    await _require_master(request, license_key)
    # Type breakdown
    types: dict[str, int] = {}
    async for r in db.threat_iocs.aggregate([
        {"$match": {"source": "usom"}},
        {"$group": {"_id": "$type", "c": {"$sum": 1}}}
    ]):
        types[r["_id"] or "other"] = r["c"]
    # Tag breakdown (phishing/malware/ransomware/spam vb.)
    tags: dict[str, int] = {}
    async for r in db.threat_iocs.aggregate([
        {"$match": {"source": "usom"}},
        {"$group": {"_id": "$tag", "c": {"$sum": 1}}},
        {"$sort": {"c": -1}}, {"$limit": 15},
    ]):
        tags[r["_id"] or "unknown"] = r["c"]
    # Criticality histogramı (1-5)
    crit: dict[int, int] = {i: 0 for i in range(1, 6)}
    async for r in db.threat_iocs.aggregate([
        {"$match": {"source": "usom", "criticality": {"$exists": True}}},
        {"$group": {"_id": "$criticality", "c": {"$sum": 1}}}
    ]):
        crit[int(r["_id"] or 0)] = r["c"]
    # Auto-blacklist sayacı
    bl_count = await db.lists.count_documents({"source": "usom_auto"})
    total = sum(types.values())
    state = await db.settings.find_one({"_key": "usom_last_run"}, {"_id": 0}) or {}
    return {
        "total": total,
        "types": types,
        "tags": tags,
        "criticality": crit,
        "blacklist_count": bl_count,
        "last_sync_at": state.get("at"),
        "last_source": state.get("source"),
    }


# v44.00.29 — Manuel cron trigger + domain-extraction refresh
@router.post("/cron-refresh")
async def usom_manual_cron_refresh(request: Request, license_key: Optional[str] = None):
    """Cron'un günlük yaptığı işi ŞİMDİ tetikler:
    - JSON API'den güncel IOC'ları çek
    - URL tipindeki IOC'lardan domain çıkart → domain IOC + otomatik karaliste ekle
    - Sync state'i güncelle (settings.usom_last_run)
    """
    await _require_master(request, license_key)
    # 1) Fresh fetch
    items, source_url = await _fetch_usom_iocs()
    now = _iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    added_urls = added_domains = added_ips = added_bl = 0
    domain_extracted = 0
    seen_domains: set = set()

    for it in items:
        val = it["value"]; typ = it["type"]; tag = it["tag"]
        conf = min(99, 70 + it["criticality"] * 6)
        note = (f"USOM {it['desc_code']} · seviye {it['criticality']}"
                if it["desc_code"] else "USOM Zararlı Bağlantı Listesi")
        r_ioc = await db.threat_iocs.update_one(
            {"type": typ, "value": val},
            {"$setOnInsert": {"id": str(uuid.uuid4()), "type": typ, "value": val,
                              "tag": tag, "confidence": conf, "source": "usom",
                              "feed": "usom-json-api", "note": note,
                              "created_at": now, "expires_at": expires,
                              "usom_id": it.get("usom_id"),
                              "criticality": it["criticality"]},
             "$set": {"last_seen_at": now}}, upsert=True)
        if r_ioc.upserted_id:
            if typ == "url": added_urls += 1
            elif typ == "domain": added_domains += 1
            elif typ == "ip": added_ips += 1

        # URL / Domain → auto blacklist
        host = None
        if typ == "domain":
            host = val
        elif typ == "url":
            try:
                u = val if val.startswith(("http://", "https://")) else f"http://{val}"
                host = (urlparse(u).hostname or "").lower()
            except Exception:
                host = None
        if host and "." in host and not re.match(r"^\d+\.\d+\.\d+\.\d+$", host) \
                and host not in seen_domains:
            seen_domains.add(host)
            # URL'lerden domain'i IOC olarak da ekle
            if typ == "url":
                r_dom = await db.threat_iocs.update_one(
                    {"type": "domain", "value": host},
                    {"$setOnInsert": {"id": str(uuid.uuid4()), "type": "domain",
                                      "value": host, "tag": tag,
                                      "confidence": max(80, conf - 5),
                                      "source": "usom", "feed": "usom-json-api",
                                      "note": f"USOM URL'in domain'i · {it['desc_code'] or 'zararlı'}",
                                      "created_at": now, "expires_at": expires},
                     "$set": {"last_seen_at": now}}, upsert=True)
                if r_dom.upserted_id:
                    added_domains += 1
                    domain_extracted += 1
            existing = await db.lists.find_one(
                {"entry_type": "domain", "value": host, "list_type": "black"},
                {"_id": 0, "id": 1})
            if not existing:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()), "list_type": "black",
                    "entry_type": "domain", "value": host,
                    "scope": "global", "user": None,
                    "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto", "created_at": now})
                added_bl += 1
        if typ == "ip":
            existing_ip = await db.lists.find_one(
                {"entry_type": "ip", "value": val, "list_type": "black"},
                {"_id": 0, "id": 1})
            if not existing_ip:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()), "list_type": "black",
                    "entry_type": "ip", "value": val,
                    "scope": "global", "user": None,
                    "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto", "created_at": now})
                added_bl += 1

    # 2) Mevcut URL-tipli IOC'lardan domain extraction (henüz karalisteye eklenmemişleri)
    async for url_ioc in db.threat_iocs.find(
        {"source": "usom", "type": "url"},
        {"_id": 0, "value": 1, "tag": 1, "criticality": 1, "desc_code": 1}
    ):
        try:
            u = url_ioc["value"]
            if not u.startswith(("http://", "https://")):
                u = "http://" + u
            host = (urlparse(u).hostname or "").lower()
        except Exception:
            continue
        if not host or "." not in host or re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
            continue
        if host in seen_domains:
            continue
        seen_domains.add(host)
        existing = await db.lists.find_one(
            {"entry_type": "domain", "value": host, "list_type": "black"},
            {"_id": 0, "id": 1})
        if not existing:
            await db.lists.insert_one({
                "id": str(uuid.uuid4()), "list_type": "black",
                "entry_type": "domain", "value": host,
                "scope": "global", "user": None,
                "note": f"USOM URL host extraction · {url_ioc.get('tag') or 'zararlı'}",
                "source": "usom_auto", "created_at": now})
            added_bl += 1
            domain_extracted += 1

    await db.settings.update_one(
        {"_key": "usom_last_run"},
        {"$set": {"_key": "usom_last_run",
                  "date": datetime.now(timezone.utc).date().isoformat(),
                  "count": len(items), "added_urls": added_urls,
                  "added_domains": added_domains, "added_ips": added_ips,
                  "added_to_blacklist": added_bl,
                  "domain_extracted": domain_extracted,
                  "source": source_url, "at": now,
                  "trigger": "manual_cron_refresh"}},
        upsert=True)
    return {"ok": True, "total_fetched": len(items),
            "added_urls": added_urls, "added_domains": added_domains,
            "added_ips": added_ips, "added_to_blacklist": added_bl,
            "domain_extracted": domain_extracted,
            "source": source_url, "at": now}


class UsomDeleteIn(BaseModel):
    value: str


@router.post("/delete")
async def delete_usom(payload: UsomDeleteIn, request: Request, license_key: Optional[str] = None):
    """USOM kaynaklı tek bir IOC'u sil (URL veya domain)."""
    await _require_master(request, license_key)
    val = (payload.value or "").strip().lower()
    if not val:
        raise HTTPException(400, "value required")
    # Remove from threat_iocs
    r_ioc = await db.threat_iocs.delete_many({"source": "usom", "value": val})
    # Remove from lists (black) if it's a domain
    r_list = await db.lists.delete_many({"list_type": "black", "value": val, "source_kind": "usom"})
    return {"ok": True,
            "removed_iocs": r_ioc.deleted_count,
            "removed_from_lists": r_list.deleted_count}
