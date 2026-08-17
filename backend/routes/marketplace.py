"""
Signature Marketplace — bayi tarafından AI'nın önerdiği (veya elle yazılan)
MailScanner kurallarını paylaşabildiği sürüm-kontrollü rule store.

Akış:
  1. Bayi `/api/mailscanner/rules` içindeki bir kuralı Marketplace'e "publish" eder.
  2. Diğer bayiler `/api/marketplace/signatures` listesinden görür, upvote atar veya
     kendi hesabına "install" eder.
  3. Her yeni sürüm ayrı revizyon olarak saklanır → tarihçe korunur.
  4. Rating (upvote / downvote / install_count) sıralamada kullanılır.

Collections:
  db.marketplace_signatures      : yayınlanmış imzalar (id, name, pattern, target,
                                     score, description, publisher_license, version,
                                     stats {upvotes, downvotes, installs, tested_by})
  db.marketplace_votes           : {signature_id, license_key, kind, ts}
  db.marketplace_install_log     : {signature_id, license_key, ts, rule_id}
"""
from __future__ import annotations
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db


router = APIRouter(prefix="/marketplace", tags=["marketplace"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _validate_license(license_key: str) -> dict:
    lic = await db.licenses.find_one({"license_key": license_key, "active": True}, {"_id": 0})
    if not lic:
        raise HTTPException(403, "Geçersiz veya pasif lisans")
    return lic


# ============================================================================
# 1. PUBLISH — bayinin bir kuralı marketplace'e göndermesi
# ============================================================================
class PublishReq(BaseModel):
    license_key: str = Field(..., min_length=8)
    name: str = Field(..., min_length=2, max_length=80)
    pattern: str = Field(..., min_length=1, max_length=500)
    target: Literal["subject", "from", "body", "header", "to"] = "subject"
    score: float = Field(3.0, ge=-10, le=20)
    description: str = Field("", max_length=800)
    category: Literal["spam", "phishing", "malware", "scam", "commercial", "other"] = "spam"
    source_rule_id: Optional[str] = None  # yerel rule id (tracing amaçlı)


@router.post("/publish")
async def publish_signature(req: PublishReq):
    """Bir kuralı marketplace'e yayınla. Aynı publisher aynı pattern'i tekrar
    yayınlarsa yeni bir revision olarak eklenir."""
    await _validate_license(req.license_key)
    # Regex validasyonu (yerel Python re ile)
    try:
        re.compile(req.pattern)
    except re.error as e:
        raise HTTPException(400, f"Geçersiz regex: {e}")

    # Aynı publisher + aynı name için sürüm sayısını bul
    existing = await db.marketplace_signatures.count_documents({
        "publisher_license": req.license_key,
        "name": req.name,
    })
    version = existing + 1

    doc = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "pattern": req.pattern,
        "target": req.target,
        "score": req.score,
        "description": req.description,
        "category": req.category,
        "publisher_license": req.license_key,
        "publisher_masked": req.license_key[:6] + "…" + req.license_key[-4:],
        "source_rule_id": req.source_rule_id,
        "version": version,
        "stats": {"upvotes": 0, "downvotes": 0, "installs": 0, "tested_by": 0},
        "published_at": _iso(),
        "status": "active",  # active | flagged | removed
    }
    await db.marketplace_signatures.insert_one(dict(doc))
    return {"ok": True, "id": doc["id"], "version": version}


# ============================================================================
# 2. BROWSE — imza katalogu (arama + sıralama + filtre)
# ============================================================================
@router.get("/signatures")
async def list_signatures(
    q: Optional[str] = None,
    category: Optional[str] = None,
    sort: Literal["hot", "new", "top", "installed"] = "hot",
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Public liste — bayi lisansı olmadan da görüntülenebilir (marketing).
    - hot: (upvotes - downvotes) + installs*2 son 30 gün öncelikli
    - new: published_at DESC
    - top: installs DESC
    - installed: sadece install edilmiş olanlar
    """
    match: dict = {"status": "active"}
    if q:
        match["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"pattern": {"$regex": re.escape(q), "$options": "i"}},
        ]
    if category:
        match["category"] = category

    # Sort key
    if sort == "new":
        pipeline = [{"$match": match}, {"$sort": {"published_at": -1}}]
    elif sort == "top":
        pipeline = [{"$match": match}, {"$sort": {"stats.installs": -1, "stats.upvotes": -1}}]
    elif sort == "installed":
        match["stats.installs"] = {"$gt": 0}
        pipeline = [{"$match": match}, {"$sort": {"stats.installs": -1}}]
    else:  # hot
        pipeline = [
            {"$match": match},
            {"$addFields": {
                "hot_score": {"$add": [
                    {"$subtract": ["$stats.upvotes", "$stats.downvotes"]},
                    {"$multiply": ["$stats.installs", 2]},
                ]},
            }},
            {"$sort": {"hot_score": -1, "published_at": -1}},
        ]

    pipeline += [{"$skip": offset}, {"$limit": limit},
                 {"$project": {"_id": 0}}]  # publisher_license'ı sonra kaldıracağız (tier hesabı için)
    items = await db.marketplace_signatures.aggregate(pipeline).to_list(limit)
    # v43.76 — Her imzaya publisher tier badge ekle (Trusted/Expert/Elite)
    publisher_keys = list({s.get("publisher_license") for s in items if s.get("publisher_license")})
    tier_map: dict[str, dict] = {}
    if publisher_keys:
        # Bulk sayı — tek pipeline
        agg = db.marketplace_signatures.aggregate([
            {"$match": {"publisher_license": {"$in": publisher_keys}, "status": "active"}},
            {"$group": {"_id": "$publisher_license", "n": {"$sum": 1}}},
        ])
        async for row in agg:
            n = row.get("n", 0)
            tier = None
            if n >= 30:  tier = {"label": "Elite Publisher",   "badge_color": "amber",   "signatures": n}
            elif n >= 15: tier = {"label": "Expert Publisher",  "badge_color": "violet",  "signatures": n}
            elif n >= 5:  tier = {"label": "Trusted Publisher", "badge_color": "emerald", "signatures": n}
            if tier:
                tier_map[row["_id"]] = tier
    # publisher_license leak etme — tier ekle, license sil
    for s in items:
        lk = s.pop("publisher_license", None)
        if lk and lk in tier_map:
            s["publisher_tier"] = tier_map[lk]
    total = await db.marketplace_signatures.count_documents(match)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/signature/{sig_id}")
async def get_signature(sig_id: str):
    doc = await db.marketplace_signatures.find_one(
        {"id": sig_id}, {"_id": 0, "publisher_license": 0})
    if not doc:
        raise HTTPException(404, "İmza bulunamadı")
    # Kısa install log (son 5 install)
    logs = await db.marketplace_install_log.find(
        {"signature_id": sig_id}, {"_id": 0, "license_key": 0}
    ).sort("ts", -1).limit(5).to_list(5)
    doc["recent_installs"] = logs
    # Aynı publisher'ın diğer sürümleri
    other_versions = await db.marketplace_signatures.find(
        {"name": doc["name"], "id": {"$ne": sig_id}},
        {"_id": 0, "publisher_license": 0, "pattern": 0, "description": 0},
    ).sort("version", -1).limit(5).to_list(5)
    doc["other_versions"] = other_versions
    return doc


# ============================================================================
# 3. VOTE — upvote / downvote
# ============================================================================
class VoteReq(BaseModel):
    license_key: str = Field(..., min_length=8)
    kind: Literal["up", "down"]


@router.post("/vote/{sig_id}")
async def vote(sig_id: str, req: VoteReq):
    await _validate_license(req.license_key)
    sig = await db.marketplace_signatures.find_one({"id": sig_id}, {"_id": 0, "id": 1})
    if not sig:
        raise HTTPException(404, "İmza bulunamadı")

    prev = await db.marketplace_votes.find_one(
        {"signature_id": sig_id, "license_key": req.license_key},
        {"_id": 0, "kind": 1},
    )
    inc: dict = {}
    if prev:
        if prev["kind"] == req.kind:
            # Aynı yönde tekrar → oy geri al
            await db.marketplace_votes.delete_one(
                {"signature_id": sig_id, "license_key": req.license_key})
            inc = {f"stats.{'upvotes' if req.kind == 'up' else 'downvotes'}": -1}
            action = "removed"
        else:
            # Yön değiştir
            await db.marketplace_votes.update_one(
                {"signature_id": sig_id, "license_key": req.license_key},
                {"$set": {"kind": req.kind, "ts": _iso()}},
            )
            inc = {
                f"stats.{'upvotes' if req.kind == 'up' else 'downvotes'}": 1,
                f"stats.{'downvotes' if req.kind == 'up' else 'upvotes'}": -1,
            }
            action = "switched"
    else:
        await db.marketplace_votes.insert_one({
            "signature_id": sig_id, "license_key": req.license_key,
            "kind": req.kind, "ts": _iso(),
        })
        inc = {f"stats.{'upvotes' if req.kind == 'up' else 'downvotes'}": 1}
        action = "recorded"

    if inc:
        await db.marketplace_signatures.update_one({"id": sig_id}, {"$inc": inc})
    updated = await db.marketplace_signatures.find_one(
        {"id": sig_id}, {"_id": 0, "stats": 1})
    return {"ok": True, "action": action, "kind": req.kind, "stats": updated.get("stats", {})}


# ============================================================================
# 4. INSTALL — imzayı kendi mailscanner_rules'a kopyala
# ============================================================================
class InstallReq(BaseModel):
    license_key: str = Field(..., min_length=8)
    enable: bool = True


@router.post("/install/{sig_id}")
async def install_signature(sig_id: str, req: InstallReq):
    await _validate_license(req.license_key)
    sig = await db.marketplace_signatures.find_one({"id": sig_id}, {"_id": 0})
    if not sig:
        raise HTTPException(404, "İmza bulunamadı")

    # Aynı licanse zaten install ettiyse — sadece güncelle
    existing_log = await db.marketplace_install_log.find_one({
        "signature_id": sig_id, "license_key": req.license_key})

    rule_id = existing_log.get("rule_id") if existing_log else str(uuid.uuid4())
    rule_doc = {
        "id": rule_id,
        "license_key": req.license_key,
        "name": sig["name"],
        "pattern": sig["pattern"],
        "target": sig["target"],
        "score": sig["score"],
        "enabled": bool(req.enable),
        "description": f"[Marketplace v{sig['version']}] {sig.get('description', '')}",
        "marketplace_sig_id": sig_id,
        "updated_at": _iso(),
    }
    await db.mailscanner_rules.update_one(
        {"id": rule_id, "license_key": req.license_key},
        {"$set": rule_doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )

    if not existing_log:
        await db.marketplace_install_log.insert_one({
            "signature_id": sig_id,
            "license_key": req.license_key,
            "license_masked": req.license_key[:6] + "…" + req.license_key[-4:],
            "rule_id": rule_id,
            "sig_version": sig["version"],
            "ts": _iso(),
        })
        await db.marketplace_signatures.update_one(
            {"id": sig_id}, {"$inc": {"stats.installs": 1}})

    return {"ok": True, "rule_id": rule_id, "sig_id": sig_id,
            "version": sig["version"], "already_installed": bool(existing_log)}


# ============================================================================
# 5. MY SIGNATURES — bayinin kendi yayınları
# ============================================================================
@router.get("/mine")
async def my_signatures(license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    items = await db.marketplace_signatures.find(
        {"publisher_license": license_key},
        {"_id": 0, "publisher_license": 0},
    ).sort("published_at", -1).to_list(100)
    return {"items": items, "count": len(items)}


@router.delete("/signature/{sig_id}")
async def remove_signature(sig_id: str, license_key: str = Query(..., min_length=8)):
    await _validate_license(license_key)
    r = await db.marketplace_signatures.delete_one(
        {"id": sig_id, "publisher_license": license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "İmza bulunamadı veya yetki yok")
    return {"ok": True, "deleted": True}


# ============================================================================
# 6. STATS — genel marketplace göstergeleri (Dashboard widget'ı için)
# ============================================================================
# v43.74 — Trusted Publisher Rozeti
@router.get("/publisher/stats")
async def publisher_stats(license_key: str):
    """Bayı kendi Marketplace istatistiklerini + Trusted Publisher rozetini alır.
    Trusted eşiği: 5+ aktif imza yayınlamış olmak."""
    if not license_key or not license_key.startswith("MS-"):
        raise HTTPException(400, "license_key gerekli")
    # v43.74 — geçerli aktif lisans doğrulaması (arbitrary MS- prefix'i kabul etmesin)
    lic = await db.licenses.find_one({"license_key": license_key, "active": True},
                                      {"_id": 0, "license_key": 1})
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı veya aktif değil")
    match = {"publisher_license": license_key, "status": "active"}
    total = await db.marketplace_signatures.count_documents(match)
    agg = await db.marketplace_signatures.aggregate([
        {"$match": match},
        {"$group": {
            "_id": None,
            "installs": {"$sum": {"$ifNull": ["$stats.installs", 0]}},
            "upvotes": {"$sum": {"$ifNull": ["$stats.upvotes", 0]}},
        }},
    ]).to_list(1)
    installs = (agg[0].get("installs", 0) if agg else 0)
    upvotes = (agg[0].get("upvotes", 0) if agg else 0)

    # Trust levels — kademe artışı bayilerin daha çok imza yayınlamasını teşvik eder
    TRUST_TIERS = [
        {"tier": "trusted", "min_signatures": 5,  "label": "Trusted Publisher", "badge_color": "emerald"},
        {"tier": "expert",  "min_signatures": 15, "label": "Expert Publisher",  "badge_color": "violet"},
        {"tier": "elite",   "min_signatures": 30, "label": "Elite Publisher",   "badge_color": "amber"},
    ]
    tier = None
    for t in TRUST_TIERS:
        if total >= t["min_signatures"]:
            tier = t
    next_tier = None
    for t in TRUST_TIERS:
        if total < t["min_signatures"]:
            next_tier = {**t, "remaining": t["min_signatures"] - total}
            break

    return {
        "publisher_license": license_key,
        "signatures_published": total,
        "total_installs": installs,
        "total_upvotes": upvotes,
        "tier": tier,               # aktif tier (None = henüz Trusted olmadı)
        "next_tier": next_tier,     # bir üstündeki hedef (kaç imza daha lazım)
        "is_trusted": total >= 5,   # kolay bool kontrol
        "generated_at": _iso(),
    }


@router.get("/stats")
async def marketplace_stats():
    total = await db.marketplace_signatures.count_documents({"status": "active"})
    total_installs = 0
    async for row in db.marketplace_signatures.aggregate([
        {"$match": {"status": "active"}},
        {"$group": {"_id": None, "sum": {"$sum": "$stats.installs"}}},
    ]):
        total_installs = row.get("sum", 0)
    publishers = await db.marketplace_signatures.distinct("publisher_license",
                                                          {"status": "active"})
    # Kategori dağılımı
    cats: dict[str, int] = {}
    async for row in db.marketplace_signatures.aggregate([
        {"$match": {"status": "active"}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]):
        cats[row["_id"] or "other"] = row["count"]
    # Top 3 (installs)
    top = await db.marketplace_signatures.find(
        {"status": "active"}, {"_id": 0, "publisher_license": 0, "pattern": 0}
    ).sort("stats.installs", -1).limit(3).to_list(3)
    return {
        "total": total,
        "total_installs": total_installs,
        "publishers": len(publishers),
        "categories": cats,
        "top": top,
        "generated_at": _iso(),
    }


# v43.73 — Haftalık Liderlik Tablosu
@router.get("/leaderboard/weekly")
async def marketplace_weekly_leaderboard():
    """Son 7 gün içinde en çok imza yayınlayan bayıler + toplam install/upvote.
    Dashboard banner'ı için tek satır kazanan döner."""
    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # Son 7 günde publish edenler bazında agrega
    pipeline = [
        {"$match": {"status": "active", "created_at": {"$gte": since}}},
        {"$group": {
            "_id": "$publisher_license",
            "signatures_published": {"$sum": 1},
            "total_installs": {"$sum": {"$ifNull": ["$stats.installs", 0]}},
            "total_upvotes": {"$sum": {"$ifNull": ["$stats.upvotes", 0]}},
            "sample_names": {"$push": "$name"},
        }},
        {"$addFields": {
            "score": {"$add": [
                {"$multiply": ["$signatures_published", 5]},
                "$total_installs",
                {"$multiply": ["$total_upvotes", 2]},
            ]},
        }},
        {"$sort": {"score": -1}},
        {"$limit": 10},
    ]
    rows: list[dict] = []
    async for r in db.marketplace_signatures.aggregate(pipeline):
        rows.append({
            "publisher_license": r.get("_id"),
            "signatures_published": r.get("signatures_published", 0),
            "total_installs": r.get("total_installs", 0),
            "total_upvotes": r.get("total_upvotes", 0),
            "score": r.get("score", 0),
            "sample_names": (r.get("sample_names") or [])[:3],
        })
    # Bayı email etiketi
    keys = [r["publisher_license"] for r in rows if r.get("publisher_license")]
    lic_map: dict[str, str] = {}
    if keys:
        async for l in db.licenses.find({"license_key": {"$in": keys}}, {"_id": 0, "license_key": 1, "email": 1}):
            lic_map[l["license_key"]] = l.get("email") or l["license_key"][:20]
    for r in rows:
        r["publisher_label"] = lic_map.get(r.get("publisher_license", ""), (r.get("publisher_license") or "anonim")[:20])
    winner = rows[0] if rows else None
    return {
        "week_start": since,
        "generated_at": _iso(),
        "winner": winner,
        "top10": rows,
    }


# ============================================================================
# 7. SEED — DB boşsa örnek imzalar üret (preview/dev)
# ============================================================================
_SEED_SIGS = [
    {
        "name": "Nijerya prensi bekleyen ödemesi",
        "pattern": r"(?i)(inheritance|prens|kalıt|milyon dolar|inheriting)",
        "target": "subject", "score": 6.5, "category": "scam",
        "description": "Klasik 419 dolandırıcılığı — prens/miras iddiaları.",
    },
    {
        "name": "Sahte fatura eki (uzantı sızması)",
        "pattern": r"(?i)(fatura|invoice).*(\.exe|\.scr|\.js|\.vbs)",
        "target": "subject", "score": 8.0, "category": "malware",
        "description": "Ekli .exe/.scr'yi fatura görünümüyle sızdıran malspam.",
    },
    {
        "name": "Kripto ödeme baskısı",
        "pattern": r"(?i)(bitcoin|btc|usdt|monero).{0,30}(ödeme|payment|acil|urgent)",
        "target": "subject", "score": 5.5, "category": "scam",
        "description": "Şantaj/sextortion mailleri kriptoya ödeme zorlar.",
    },
    {
        "name": "Google Docs sahte paylaşım",
        "pattern": r"(?i)(shared a document|paylaş[dt]ı bir belge|docs\.google)",
        "target": "body", "score": 4.5, "category": "phishing",
        "description": "Google Docs görünümünde parola çalan phishing sayfası.",
    },
    {
        "name": "IBAN değişikliği aciliyet çağrısı",
        "pattern": r"(?i)(iban değişti|yeni hesap numaram|new bank account|acil havale)",
        "target": "subject", "score": 7.0, "category": "phishing",
        "description": "BEC saldırısı — CEO/mali müdürden gelmiş gibi görünür.",
    },
]


@router.post("/seed-demo")
async def seed_demo_signatures():
    """DB boşsa 5 örnek imza ekler (preview/demo için)."""
    existing = await db.marketplace_signatures.count_documents({})
    if existing >= 5:
        return {"ok": True, "seeded": 0, "current": existing, "note": "Zaten seed'lenmiş"}
    seeded = 0
    for i, s in enumerate(_SEED_SIGS):
        # Her seed imzasına farklı bir publisher göster
        publisher = f"DEMO-{['GH', 'MS', 'BQ', 'AT', 'ZY'][i % 5]}-{'1234'[:4]}"
        doc = {
            "id": str(uuid.uuid4()),
            "publisher_license": publisher,
            "publisher_masked": publisher[:6] + "…" + publisher[-4:],
            "version": 1,
            "stats": {
                "upvotes": 20 + i * 7, "downvotes": i,
                "installs": 8 + i * 4, "tested_by": 15 + i * 3,
            },
            "published_at": _iso(),
            "status": "active",
            **s,
        }
        await db.marketplace_signatures.insert_one(doc)
        seeded += 1
    return {"ok": True, "seeded": seeded}
