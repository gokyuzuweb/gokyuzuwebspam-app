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
