"""v44.00.22 — USOM (siberguvenlik.gov.tr) Zararlı Bağlantı Entegrasyonu
=====================================================================

USOM = Ulusal Siber Olaylara Müdahale Merkezi (Türkiye)
Kaynak: https://www.usom.gov.tr/url-list.txt (public zararlı URL feed'i)
       + https://www.usom.gov.tr/adres (HTML listesi — meta için scrape)

Fetch:
  - Text feed (URL listesi) her satırda 1 URL — hızlı ve güvenilir
  - Fetched IOC'lar: type=url + type=domain (host'tan çıkart), source=usom
  - Kullanıcı UI'dan tek tek arama + silme yapabilir
  - Her satır otomatik olarak "kara liste" scan-verdict etkisine girer

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

USOM_URL_FEED = "https://www.usom.gov.tr/url-list.txt"

router = APIRouter(prefix="/threat-intel/usom", tags=["threat-intel-usom"])

_client = AsyncIOMotorClient(os.environ.get("MONGO_URL"))
db = _client[os.environ.get("DB_NAME").strip('"')]


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _require_master(request: Request, license_key: Optional[str] = None):
    """Lightweight master check — reuse server.py's helper via HTTP header.
    Simplified: require X-Master-Session cookie or valid license from server.py's session store."""
    # Delegate to central auth by importing at call-time
    from server import _require_master as core_check
    return await core_check(request, license_key)


async def _fetch_usom_urls() -> list[str]:
    """USOM public URL feed'ini indir."""
    try:
        async with httpx.AsyncClient(
            timeout=25, follow_redirects=True,
            headers={"User-Agent": "GokyuzuWebSpam/v44.00.22 (Master Panel)"},
        ) as h:
            r = await h.get(USOM_URL_FEED)
            if r.status_code != 200:
                raise HTTPException(502, f"USOM feed HTTP {r.status_code}")
            urls = []
            for line in r.text.splitlines():
                u = line.strip()
                if not u or u.startswith("#"):
                    continue
                # normalize: some entries omit scheme
                if not u.startswith(("http://", "https://")):
                    u = "http://" + u
                urls.append(u)
            return urls
    except httpx.HTTPError as ex:
        raise HTTPException(502, f"USOM feed unreachable: {ex}")


@router.post("/fetch")
async def fetch_usom(request: Request, license_key: Optional[str] = None):
    """USOM zararlı URL listesini indir, IOC'lara + Kara Liste'ye yaz."""
    await _require_master(request, license_key)
    urls = await _fetch_usom_urls()
    now = _iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    added_urls = 0
    added_domains = 0
    seen_domains: set = set()

    for u in urls:
        # Insert URL IOC
        r_url = await db.threat_iocs.update_one(
            {"type": "url", "value": u},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "type": "url", "value": u,
                "tag": "malicious", "confidence": 98,
                "source": "usom",
                "feed": "usom-url-list",
                "note": "USOM Zararlı Bağlantı Listesi",
                "created_at": now, "expires_at": expires,
            }, "$set": {"last_seen_at": now}},
            upsert=True,
        )
        if r_url.upserted_id:
            added_urls += 1

        # Extract host → domain IOC + kara liste sync
        try:
            host = (urlparse(u).hostname or "").lower()
        except Exception:
            host = ""
        if not host or "." not in host or host in seen_domains:
            continue
        if re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
            continue
        seen_domains.add(host)

        r_dom = await db.threat_iocs.update_one(
            {"type": "domain", "value": host},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "type": "domain", "value": host,
                "tag": "malicious", "confidence": 95,
                "source": "usom",
                "feed": "usom-url-list",
                "note": "USOM listesindeki zararlı URL'nin domain'i",
                "created_at": now, "expires_at": expires,
            }, "$set": {"last_seen_at": now}},
            upsert=True,
        )
        if r_dom.upserted_id:
            added_domains += 1

        # scan-verdict blacklist sync (db.lists — Master UI schema)
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
                "note": "USOM (siberguvenlik.gov.tr) — otomatik",
                "owner_license_key": None,
                "source_kind": "usom",
                "created_at": now,
            })

    # Update sync state
    await db.threat_intel_feeds.update_one(
        {"key": "usom"},
        {"$set": {
            "key": "usom", "name": "USOM (siberguvenlik.gov.tr)",
            "url": "https://www.usom.gov.tr/adres",
            "last_sync_at": now,
            "last_added_urls": added_urls,
            "last_added_domains": added_domains,
            "total_fetched": len(urls),
        }},
        upsert=True,
    )
    return {
        "ok": True,
        "fetched_urls": len(urls),
        "new_urls": added_urls,
        "new_domains": added_domains,
        "synced_at": now,
    }


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
    state = await db.threat_intel_feeds.find_one({"key": "usom"}, {"_id": 0}) or {}
    return {
        "items": rows,
        "count": len(rows),
        "last_sync_at": state.get("last_sync_at"),
        "total_fetched": state.get("total_fetched", 0),
    }


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
