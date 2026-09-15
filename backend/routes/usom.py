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
import asyncio
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

# v44.00.32 — Yıla göre çekim: 2024 ve sonrası kayıtlar (son 3 yıl)
USOM_MIN_YEAR_DEFAULT = 2024
USOM_MAX_PAGES_HARDCAP = 5000  # güvenlik: 5000 × 20 = 100K record hard cap

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


async def _fetch_usom_iocs(
    min_year: int | None = None,
    progress_key: str | None = None,
    max_pages: int | None = None,
) -> tuple[list[dict], str]:
    """v44.00.32 — siberguvenlik.gov.tr JSON API'sinden IOC listesi çeker.

    min_year: bu yıldan önceki kayıtları GEÇME (kayıtlar date-desc geldiğinden
              min_year'dan eski bir kayıt görünce durur). None → tümünü çek.
    progress_key: settings._key altına yaz (frontend polling için).
    max_pages: opsiyonel hard cap.

    Döner: (items, source_url). Her item: {"value", "type", "tag", "criticality", "date"}.
    Fallback olarak eski TXT feed'i denenir (sadece progress_key=None ise)."""
    if max_pages is None:
        max_pages = USOM_MAX_PAGES_HARDCAP
    items: list[dict] = []
    seen: set = set()

    async def _write_progress(state: str, page: int, extra: dict | None = None):
        if not progress_key:
            return
        doc = {
            "_key": progress_key,
            "state": state,       # running / done / error
            "page": page,
            "fetched": len(items),
            "min_year": min_year,
            "updated_at": _iso(),
        }
        if extra:
            doc.update(extra)
        try:
            await db.settings.update_one(
                {"_key": progress_key}, {"$set": doc}, upsert=True,
            )
        except Exception:
            pass

    await _write_progress("running", 0, {"started_at": _iso()})

    async with httpx.AsyncClient(
        timeout=45, follow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0 (GokyuzuWebSpam/v44.00.32 Master Panel)",
            "Accept": "application/json, text/plain, */*",
        },
    ) as h:
        # 1) Yeni JSON API — paginated
        last_err = ""
        stopped_by_year = False
        try:
            for page in range(1, max_pages + 1):
                url = f"{USOM_JSON_API}?page={page}&limit={USOM_PAGE_LIMIT}"
                try:
                    r = await h.get(url)
                except httpx.HTTPError as ex:
                    last_err = f"HTTPError page {page}: {ex}"
                    # Küçük hata → 1 kere retry
                    try:
                        r = await h.get(url)
                    except Exception:
                        break
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

                page_stopped = False
                for m in models:
                    date_str = (m.get("date") or "").strip()
                    # Date parse: "2026-09-15 00:23:36" gibi
                    if min_year and date_str:
                        try:
                            yr = int(date_str[:4])
                            if yr < min_year:
                                page_stopped = True
                                stopped_by_year = True
                                break
                        except Exception:
                            pass
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
                        "date": date_str,
                        "usom_id": m.get("id"),
                    })

                # Progress her sayfa
                if page % 5 == 0 or page_stopped:
                    total_count = data.get("totalCount") or None
                    await _write_progress("running", page, {
                        "total_count": total_count,
                    })

                if page_stopped:
                    break
                # Total count based early exit (min_year yoksa)
                if not min_year and len(items) >= (data.get("totalCount") or 999999):
                    break

            if items:
                src = f"{USOM_JSON_API} (JSON API · {len(items)} IOC · {page} sayfa)"
                if stopped_by_year:
                    src += f" · yıl≥{min_year}"
                return items, src
        except httpx.HTTPError as ex:
            last_err = f"JSON API başarısız: {ex}"
        except Exception as ex:
            last_err = f"JSON parse başarısız: {ex}"

        # 2) Fallback: eski TXT feed (sadece hiç item yoksa)
        if not items:
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
    raise HTTPException(502, f"USOM feed çekilemedi: {last_err or 'unknown error'}")


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


# ═══════════════════════════════════════════════════════════════════
# v44.00.32 — Async Fetch + Progress + Bulk Delete
# ═══════════════════════════════════════════════════════════════════

USOM_FETCH_PROGRESS_KEY = "usom_fetch_progress"


async def _ingest_usom_items(items: list[dict], source_url: str) -> dict:
    """Fetch edilmiş item listesini DB'ye yazar (IOC + auto-blacklist)."""
    now = _iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    added_urls = added_domains = added_ips = added_to_blacklist = 0
    seen_domains: set = set()

    for it in items:
        val = it["value"]; typ = it["type"]; tag = it["tag"]
        conf = min(99, 70 + it["criticality"] * 6)
        note = (f"USOM {it['desc_code']} · seviye {it['criticality']}"
                if it["desc_code"] else "USOM Zararlı Bağlantı Listesi")
        r_ioc = await db.threat_iocs.update_one(
            {"type": typ, "value": val},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "type": typ, "value": val,
                "tag": tag, "confidence": conf, "source": "usom",
                "feed": "usom-json-api", "note": note,
                "created_at": now, "expires_at": expires,
                "usom_id": it.get("usom_id"),
                "criticality": it["criticality"],
                "usom_date": it.get("date") or "",
            }, "$set": {"last_seen_at": now}},
            upsert=True,
        )
        if r_ioc.upserted_id:
            if typ == "url": added_urls += 1
            elif typ == "domain": added_domains += 1
            elif typ == "ip": added_ips += 1

        host = None
        if typ == "domain": host = val
        elif typ == "url":
            try:
                u = val if val.startswith(("http://", "https://")) else f"http://{val}"
                host = (urlparse(u).hostname or "").lower()
            except Exception:
                host = None
        if host and "." in host and not re.match(r"^\d+\.\d+\.\d+\.\d+$", host) and host not in seen_domains:
            seen_domains.add(host)
            if typ == "url":
                r_dom = await db.threat_iocs.update_one(
                    {"type": "domain", "value": host},
                    {"$setOnInsert": {
                        "id": str(uuid.uuid4()), "type": "domain", "value": host,
                        "tag": tag, "confidence": max(80, conf - 5),
                        "source": "usom", "feed": "usom-json-api",
                        "note": f"USOM URL'in domain'i · {it['desc_code'] or 'zararlı'}",
                        "created_at": now, "expires_at": expires,
                    }, "$set": {"last_seen_at": now}}, upsert=True,
                )
                if r_dom.upserted_id:
                    added_domains += 1
            existing = await db.lists.find_one(
                {"entry_type": "domain", "value": host, "list_type": "black"},
                {"_id": 0, "id": 1},
            )
            if not existing:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()), "list_type": "black",
                    "entry_type": "domain", "value": host, "scope": "global",
                    "user": None, "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto", "created_at": now,
                })
                added_to_blacklist += 1
        if typ == "ip":
            existing_ip = await db.lists.find_one(
                {"entry_type": "ip", "value": val, "list_type": "black"},
                {"_id": 0, "id": 1},
            )
            if not existing_ip:
                await db.lists.insert_one({
                    "id": str(uuid.uuid4()), "list_type": "black",
                    "entry_type": "ip", "value": val, "scope": "global",
                    "user": None, "note": f"USOM otomatik ekleme · {tag}",
                    "source": "usom_auto", "created_at": now,
                })
                added_to_blacklist += 1

    await db.settings.update_one(
        {"_key": "usom_last_run"},
        {"$set": {"_key": "usom_last_run",
                  "date": datetime.now(timezone.utc).date().isoformat(),
                  "count": len(items), "added_urls": added_urls,
                  "added_domains": added_domains, "added_ips": added_ips,
                  "added_to_blacklist": added_to_blacklist,
                  "source": source_url, "at": now}},
        upsert=True,
    )
    return {
        "total_fetched": len(items),
        "added_urls": added_urls, "added_domains": added_domains,
        "added_ips": added_ips, "added_to_blacklist": added_to_blacklist,
        "source": source_url,
    }


async def _run_async_fetch(min_year: int):
    """Background task: fetch + ingest + progress."""
    started = _iso()
    try:
        items, src = await _fetch_usom_iocs(
            min_year=min_year,
            progress_key=USOM_FETCH_PROGRESS_KEY,
            max_pages=USOM_MAX_PAGES_HARDCAP,
        )
        # Ingest phase
        await db.settings.update_one(
            {"_key": USOM_FETCH_PROGRESS_KEY},
            {"$set": {"state": "ingesting", "fetched": len(items),
                      "updated_at": _iso()}},
            upsert=True,
        )
        result = await _ingest_usom_items(items, src)
        await db.settings.update_one(
            {"_key": USOM_FETCH_PROGRESS_KEY},
            {"$set": {
                "state": "done",
                "fetched": len(items),
                "updated_at": _iso(),
                "finished_at": _iso(),
                "started_at": started,
                "result": result,
                "min_year": min_year,
                "source": src,
            }},
            upsert=True,
        )
    except Exception as ex:
        await db.settings.update_one(
            {"_key": USOM_FETCH_PROGRESS_KEY},
            {"$set": {"state": "error", "error": str(ex)[:400],
                      "updated_at": _iso(), "started_at": started,
                      "finished_at": _iso()}},
            upsert=True,
        )


class UsomFetchAsyncIn(BaseModel):
    min_year: int | None = None  # default 2024


@router.post("/fetch-async")
async def fetch_usom_async(payload: UsomFetchAsyncIn, request: Request,
                            license_key: Optional[str] = None):
    """v44.00.32 — Async USOM fetch başlat. min_year kayıtları (default 2024)
    çekilene kadar arka planda çalışır. Frontend `/fetch-progress` ile polling yapar."""
    await _require_master(request, license_key)
    # Check if already running
    current = await db.settings.find_one({"_key": USOM_FETCH_PROGRESS_KEY}, {"_id": 0})
    if current and current.get("state") in ("running", "ingesting"):
        # 15 dk'dan uzunsa stale kabul et → yeniden başlat
        try:
            updated = datetime.fromisoformat((current.get("updated_at") or "").replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - updated).total_seconds() < 900:
                return {"ok": False, "state": current.get("state"),
                        "message": "Fetch zaten çalışıyor",
                        "started_at": current.get("started_at")}
        except Exception:
            pass
    min_year = payload.min_year or USOM_MIN_YEAR_DEFAULT
    await db.settings.update_one(
        {"_key": USOM_FETCH_PROGRESS_KEY},
        {"$set": {"_key": USOM_FETCH_PROGRESS_KEY, "state": "running",
                  "page": 0, "fetched": 0, "min_year": min_year,
                  "started_at": _iso(), "updated_at": _iso()}},
        upsert=True,
    )
    asyncio.create_task(_run_async_fetch(min_year))
    return {"ok": True, "state": "running", "min_year": min_year}


@router.get("/fetch-progress")
async def fetch_progress(request: Request, license_key: Optional[str] = None):
    """v44.00.32 — Async fetch progress polling."""
    await _require_master(request, license_key)
    doc = await db.settings.find_one({"_key": USOM_FETCH_PROGRESS_KEY}, {"_id": 0}) or {}
    return {
        "state": doc.get("state") or "idle",
        "page": doc.get("page") or 0,
        "fetched": doc.get("fetched") or 0,
        "min_year": doc.get("min_year"),
        "total_count": doc.get("total_count"),
        "started_at": doc.get("started_at"),
        "updated_at": doc.get("updated_at"),
        "finished_at": doc.get("finished_at"),
        "result": doc.get("result"),
        "error": doc.get("error"),
        "source": doc.get("source"),
    }


class UsomBulkDeleteIn(BaseModel):
    ids: list[str] | None = None
    values: list[str] | None = None
    all: bool = False              # ⚠ Tüm USOM kayıtları
    filter_type: Optional[str] = None    # domain / url / ip
    filter_tag: Optional[str] = None     # phishing / malware ...


@router.post("/bulk-delete")
async def bulk_delete_usom(payload: UsomBulkDeleteIn, request: Request,
                            license_key: Optional[str] = None):
    """v44.00.32 — USOM IOC toplu silme.
    - ids: uuid listesi (IOC.id)
    - values: value listesi
    - all=true: tüm USOM kaynaklı IOC'lar (⚠ tehlikeli, master onayı gerekir)
    - filter_type / filter_tag: type=domain, tag=phishing gibi kısmi filtre
    Kara liste (lists) kayıtlarını da temizler."""
    await _require_master(request, license_key)
    filt: dict = {"source": "usom"}
    values_removed: list[str] = []

    if payload.ids:
        filt["id"] = {"$in": payload.ids}
    elif payload.values:
        vals = [v.strip().lower() for v in payload.values if v and v.strip()]
        if not vals:
            raise HTTPException(400, "values boş")
        filt["value"] = {"$in": vals}
        values_removed = vals
    elif payload.all:
        pass  # tüm USOM
    elif payload.filter_type or payload.filter_tag:
        if payload.filter_type:
            filt["type"] = payload.filter_type
        if payload.filter_tag:
            filt["tag"] = payload.filter_tag
    else:
        raise HTTPException(400, "ids / values / all / filter_* birinden en az biri gerekli")

    # ids/filter tipinde önce silinecek value'leri bul (kara liste temizliği için)
    if not values_removed:
        vals_docs = await db.threat_iocs.find(filt, {"_id": 0, "value": 1}).to_list(50000)
        values_removed = [d.get("value") for d in vals_docs if d.get("value")]

    r_ioc = await db.threat_iocs.delete_many(filt)
    r_list = 0
    if values_removed:
        r_list_res = await db.lists.delete_many({
            "value": {"$in": values_removed},
            "source": "usom_auto",
        })
        r_list = r_list_res.deleted_count

    # History kaydı
    try:
        await db.list_history.insert_one({
            "id": str(uuid.uuid4()),
            "action": "usom_bulk_delete",
            "removed_iocs": r_ioc.deleted_count,
            "removed_from_lists": r_list,
            "filter": {k: v for k, v in payload.model_dump().items() if v},
            "at": _iso(),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "removed_iocs": r_ioc.deleted_count,
        "removed_from_lists": r_list,
    }

