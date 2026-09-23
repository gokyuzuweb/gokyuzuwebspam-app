"""v44.00.46 — Malicious URL/Payload Blocklist
Master ve bayilerin manuel ya da otomatik olarak bilinen zararli URL, dosya
hash veya URL kalibi ekleyebilecegi merkezi bir koleksiyon. Ingest sirasinda
`events.py` bu koleksiyonu tarayip match olursa +20 puan verir ve verdict'i
`malware` yapar.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from deps import db

router = APIRouter(prefix="/threat-intel/malicious-urls", tags=["threat-intel"])


class MaliciousUrlIn(BaseModel):
    pattern: str            # url substring / file id / hash — case insensitive substring match
    kind: Optional[str] = "known_malicious"  # known_malicious | rat | trojan | phishing | c2
    note: Optional[str] = ""
    source: Optional[str] = "manual"


@router.post("/add")
async def malicious_url_add(payload: MaliciousUrlIn):
    """Yeni kotu URL/pattern ekle. Idempotent (pattern tekilligi)."""
    pat = (payload.pattern or "").strip().lower()
    if not pat or len(pat) < 4:
        raise HTTPException(400, "pattern en az 4 karakter olmali")
    existing = await db.malicious_urls.find_one({"pattern": pat}, {"_id": 0, "id": 1})
    if existing:
        return {"ok": True, "added": False, "pattern": pat, "id": existing["id"]}
    doc = {
        "id": str(uuid.uuid4()),
        "pattern": pat,
        "kind": (payload.kind or "known_malicious").lower(),
        "note": payload.note or "",
        "source": payload.source or "manual",
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.malicious_urls.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "added": True, **doc}


@router.get("")
async def malicious_url_list(limit: int = Query(500, ge=1, le=5000),
                                q: Optional[str] = None):
    """Kotu URL kayitlarini dondur (opsiyonel arama)."""
    filt: dict = {}
    if q:
        filt["pattern"] = {"$regex": q.lower(), "$options": "i"}
    rows = await db.malicious_urls.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    total = await db.malicious_urls.count_documents(filt)
    return {"items": rows, "count": len(rows), "total": total}


@router.delete("/{entry_id}")
async def malicious_url_delete(entry_id: str):
    r = await db.malicious_urls.delete_one({"id": entry_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kayit yok")
    return {"deleted": True, "id": entry_id}


@router.post("/toggle/{entry_id}")
async def malicious_url_toggle(entry_id: str):
    """Kaydi aktif/pasif toggle et."""
    doc = await db.malicious_urls.find_one({"id": entry_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kayit yok")
    new_state = not bool(doc.get("active", True))
    await db.malicious_urls.update_one({"id": entry_id}, {"$set": {"active": new_state}})
    return {"id": entry_id, "active": new_state}


async def seed_malicious_urls():
    """Ilk kurulumda bilinen kotu URL'leri ekle. Idempotent."""
    KNOWN = [
        # v44.00.46 — Kullanici tarafindan raporlanan Google Drive RAT/jar payload
        {
            "pattern": "1kmhmdicnsaqlgi1_1mgqjaemntnbdjm2",
            "kind": "rat",
            "note": "Google Drive - .jar payload (kullanici raporu 2026-02-17 - seriisdokum.com hedefi)",
            "source": "user_report",
        },
        # Yaygin patternler
        {
            "pattern": "drive.google.com/uc?export=download",
            "kind": "phishing",
            "note": "Google Drive dogrudan indirme link'i - ciplak file ID ile klasik lure",
            "source": "generic_pattern",
        },
    ]
    for k in KNOWN:
        pat = k["pattern"].lower()
        if not await db.malicious_urls.find_one({"pattern": pat}, {"_id": 1}):
            await db.malicious_urls.insert_one({
                "id": str(uuid.uuid4()),
                "pattern": pat,
                "kind": k["kind"],
                "note": k["note"],
                "source": k["source"],
                "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })


# ============================================================================
# v44.00.48 — URLhaus otomatik feed senkron
# ============================================================================
# Kaynak: https://urlhaus.abuse.ch/downloads/csv_recent/
# Son 30 gunde raporlanan malware URL'leri (Emotet, TrickBot, IcedID, vs)
# Format: CSV — id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
# Sync stratejisi: URL'nin domain kismini (netloc) `malicious_urls` koleksiyonuna
# `source="urlhaus"` ile idempotent yaz. Duplicate skip. Cron 6 saatte bir.
URLHAUS_FEED_URL = "https://urlhaus.abuse.ch/downloads/csv_recent/"


async def sync_urlhaus_feed(max_entries: int = 2000) -> dict:
    """URLhaus CSV feed'ini cek ve `malicious_urls`'a yaz.
    Idempotent (pattern tekilligi ile). Bir cagriya max_entries kotasi.
    Sadece `url_status=online` olanlari alir.

    v44.00.55 — CSV parse blocking operasyon, `asyncio.to_thread`'a taşındı
    ki uvicorn tek-worker'da event loop bloklanmasın (health probe flap fix).
    """
    import httpx
    import asyncio as _asyncio
    import csv
    from io import StringIO
    from urllib.parse import urlparse

    added = 0
    skipped = 0
    errors = 0
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as cx:
            r = await cx.get(URLHAUS_FEED_URL)
            r.raise_for_status()
            content = r.text
    except Exception as e:
        return {"ok": False, "error": str(e)[:200], "added": 0}

    def _parse_lines(text: str):
        """Blocking CSV parse — thread'a alinacak."""
        lines = [l for l in text.splitlines() if l and not l.startswith("#")]
        rows: list[dict] = []
        reader = csv.reader(lines, quotechar='"', delimiter=",", skipinitialspace=True)
        for row in reader:
            try:
                if len(row) < 7:
                    continue
                url = (row[2] or "").strip().strip('"')
                status = (row[3] or "").strip().strip('"').lower()
                threat = (row[5] or "").strip().strip('"').lower() or "malware"
                tags = (row[6] or "").strip().strip('"')
                if not url or status != "online":
                    continue
                parsed = urlparse(url)
                host = (parsed.hostname or "").lower()
                if not host or "." not in host:
                    continue
                path = (parsed.path or "").lower()[:60]
                pattern = f"{host}{path}".rstrip("/")
                if len(pattern) < 6:
                    continue
                rows.append({"pattern": pattern, "threat": threat, "tags": tags})
            except Exception:
                continue
        return rows

    # Parse'i thread'e ver — event loop bloklanmasın
    parsed_rows = await _asyncio.to_thread(_parse_lines, content)

    now_iso = datetime.now(timezone.utc).isoformat()
    for item in parsed_rows[:max_entries]:
        try:
            pattern = item["pattern"]
            threat = item["threat"]
            tags = item["tags"]
            existing = await db.malicious_urls.find_one({"pattern": pattern}, {"_id": 1})
            if existing:
                skipped += 1
            else:
                _kind = "known_malicious"
                if "ransom" in threat: _kind = "trojan"
                elif "rat" in tags.lower(): _kind = "rat"
                elif "emotet" in tags.lower() or "trickbot" in tags.lower(): _kind = "trojan"
                elif "phish" in threat: _kind = "phishing"
                await db.malicious_urls.insert_one({
                    "id": str(uuid.uuid4()),
                    "pattern": pattern,
                    "kind": _kind,
                    "note": f"URLhaus feed · threat={threat} · tags={tags[:60]}",
                    "source": "urlhaus",
                    "active": True,
                    "created_at": now_iso,
                })
                added += 1
        except Exception:
            errors += 1
            continue

    processed = min(len(parsed_rows), max_entries)
    await db.threat_feed_status.update_one(
        {"_key": "urlhaus"},
        {"$set": {
            "_key": "urlhaus",
            "last_sync": now_iso,
            "last_added": added,
            "last_skipped": skipped,
            "last_errors": errors,
            "processed": processed,
        }},
        upsert=True,
    )
    return {"ok": True, "added": added, "skipped": skipped, "errors": errors, "processed": processed}


@router.post("/sync-urlhaus")
async def sync_urlhaus_manual(max_entries: int = 2000):
    """URLhaus feed'i manuel tetikle (cron dışı test/urgent sync)."""
    return await sync_urlhaus_feed(max_entries=max_entries)


@router.get("/feed-status")
async def feed_status():
    """URLhaus + digger otomatik feed'lerin son senkronize durumu."""
    rows = await db.threat_feed_status.find({}, {"_id": 0}).to_list(50)
    total_urls = await db.malicious_urls.count_documents({})
    by_source = {}
    async for r in db.malicious_urls.aggregate([
        {"$group": {"_id": "$source", "count": {"$sum": 1}}},
    ]):
        by_source[r["_id"] or "unknown"] = r["count"]
    return {"feeds": rows, "total_urls": total_urls, "by_source": by_source}


async def urlhaus_sync_loop():
    """Her 6 saatte bir URLhaus feed'ini senkronize et."""
    import asyncio as _asyncio
    # Baslangicta 60sn bekle (servis warmup)
    await _asyncio.sleep(60)
    while True:
        try:
            res = await sync_urlhaus_feed()
            import logging
            logging.info(f"[urlhaus-sync] {res}")
        except Exception as e:
            import logging
            logging.warning(f"[urlhaus-sync] error: {e}")
        await _asyncio.sleep(6 * 3600)  # 6 saat
