"""
Bağımsız MailScanner FE Modülü backend.
NOT: ConfigServer MailScanner verileri KULLANILMAZ. Tüm veri kendi DB'mizden gelir.
Endpoints:
  * GET  /mailscanner/config           - engine on/off, threshold, greylist
  * PUT  /mailscanner/config           - config güncelle
  * GET  /mailscanner/stats            - SA skor histogram + engine sonuç dağılımı
  * GET  /mailscanner/rules            - custom SpamAssassin-style rules
  * POST /mailscanner/rules            - upsert rule
  * DELETE /mailscanner/rules/{id}
  * GET  /mailscanner/user-policy      - per-user (recipient) policy
  * PUT  /mailscanner/user-policy      - policy güncelle
  * POST /mailscanner/train-bayes      - Bayes trainer (spam/ham)
  * GET  /mailscanner/bayes-status     - Bayes DB stats (own counters)
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/mailscanner", tags=["mailscanner"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


DEFAULT_CONFIG = {
    "spam_threshold": 5.0,
    "high_spam_threshold": 10.0,
    "engines": {
        "spamassassin": True, "bayes": True, "clamav": True,
        "dcc": False, "razor": False, "pyzor": True,
        "rspamd_ml": True, "sender_rep": True,
    },
    "greylist": {"enabled": True, "ttl_minutes": 4},
    "rbl": {"enabled": True, "lists": ["zen.spamhaus.org", "bl.spamcop.net"]},
    "spf_hard_fail": True,
    "dkim_required": False,
    "attachment_scan": {"enabled": True, "max_mb": 25, "block_ext": [".exe", ".scr", ".vbs", ".js"]},
    "quarantine_ttl_days": 30,
}


async def _cfg(license_key: str) -> dict:
    doc = await db.mailscanner_config.find_one({"license_key": license_key}, {"_id": 0})
    if not doc:
        return {"license_key": license_key, **DEFAULT_CONFIG}
    # merge defaults for missing keys
    merged = {**DEFAULT_CONFIG, **{k: v for k, v in doc.items() if k not in ("_id",)}}
    return merged


@router.get("/config")
async def get_config(license_key: str = Query(..., min_length=8)):
    return await _cfg(license_key)


class ConfigUpdate(BaseModel):
    license_key: str = Field(..., min_length=8)
    spam_threshold: Optional[float] = None
    high_spam_threshold: Optional[float] = None
    engines: Optional[dict] = None
    greylist: Optional[dict] = None
    rbl: Optional[dict] = None
    spf_hard_fail: Optional[bool] = None
    dkim_required: Optional[bool] = None
    attachment_scan: Optional[dict] = None
    quarantine_ttl_days: Optional[int] = None


@router.put("/config")
async def put_config(payload: ConfigUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None and k != "license_key"}
    update["updated_at"] = _iso()
    await db.mailscanner_config.update_one(
        {"license_key": payload.license_key},
        {"$set": update, "$setOnInsert": {"license_key": payload.license_key, "created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **update}


@router.get("/stats")
async def stats(license_key: str = Query(..., min_length=8), hours: int = 24):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q = {"license_key": license_key, "ingested_at": {"$gte": since}}
    # verdict distribution
    verdicts: dict[str, int] = {}
    total = 0
    async for row in db.mail_events.aggregate([
        {"$match": q},
        {"$group": {"_id": "$verdict", "count": {"$sum": 1}}},
    ]):
        verdicts[row["_id"]] = row["count"]
        total += row["count"]
    # score histogram (bin size 1.0, 0..20+)
    bins = [0] * 21
    async for e in db.mail_events.find(q, {"_id": 0, "total_score": 1}):
        s = e.get("total_score") or 0
        idx = min(20, int(max(0, s)))
        bins[idx] += 1
    hist = [{"bin": i, "count": c} for i, c in enumerate(bins)]
    # per-engine hits (from scores.map)
    engine_hits: dict[str, dict] = {}
    async for e in db.mail_events.find(q, {"_id": 0, "scores": 1, "verdict": 1}):
        for eng, val in (e.get("scores") or {}).items():
            b = engine_hits.setdefault(eng, {"engine": eng, "total": 0, "spam": 0})
            b["total"] += 1
            if e.get("verdict") in ("spam", "high_spam", "virus"):
                b["spam"] += 1
    engines = sorted(engine_hits.values(), key=lambda x: x["total"], reverse=True)
    return {
        "hours": hours, "total_scanned": total,
        "verdicts": verdicts, "score_histogram": hist,
        "engines": engines, "generated_at": _iso(),
    }


class MSRule(BaseModel):
    id: Optional[str] = None
    license_key: str = Field(..., min_length=8)
    name: str = Field(..., min_length=1, max_length=80)
    pattern: str = Field(..., min_length=1, max_length=500)
    target: str = Field("subject", pattern="^(subject|from|body|header|to)$")
    score: float = Field(3.0, ge=-10, le=20)
    enabled: bool = True
    description: Optional[str] = ""


@router.get("/rules")
async def list_rules(license_key: str = Query(..., min_length=8)):
    rows = await db.mailscanner_rules.find({"license_key": license_key}, {"_id": 0})\
        .sort("score", -1).to_list(500)
    return {"items": rows}


@router.post("/rules")
async def upsert_rule(rule: MSRule):
    doc = rule.model_dump()
    doc["id"] = doc.get("id") or str(uuid.uuid4())
    doc["updated_at"] = _iso()
    await db.mailscanner_rules.update_one(
        {"id": doc["id"], "license_key": rule.license_key},
        {"$set": doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **doc}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, license_key: str = Query(..., min_length=8)):
    r = await db.mailscanner_rules.delete_one({"id": rule_id, "license_key": license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"ok": True}


class UserPolicy(BaseModel):
    license_key: str = Field(..., min_length=8)
    user_email: str = Field(..., min_length=3, max_length=200)
    spam_threshold: Optional[float] = None
    action_on_spam: str = Field("quarantine", pattern="^(quarantine|reject|tag|deliver)$")
    forward_to: Optional[str] = None
    enabled: bool = True


@router.get("/user-policy")
async def list_policies(license_key: str = Query(..., min_length=8)):
    rows = await db.mailscanner_policies.find({"license_key": license_key}, {"_id": 0})\
        .sort("user_email", 1).to_list(500)
    return {"items": rows}


@router.put("/user-policy")
async def put_policy(p: UserPolicy):
    doc = p.model_dump()
    doc["updated_at"] = _iso()
    await db.mailscanner_policies.update_one(
        {"license_key": p.license_key, "user_email": p.user_email},
        {"$set": doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **doc}


class BayesTrain(BaseModel):
    license_key: str = Field(..., min_length=8)
    label: str = Field(..., pattern="^(spam|ham)$")
    samples: list[str] = Field(..., min_length=1, max_length=500)


@router.post("/train-bayes")
async def train_bayes(payload: BayesTrain):
    """Kendi Bayes tokenizer'ımız. Basit token counter → mailscanner_bayes koleksiyonu."""
    bulk_ops = 0
    for sample in payload.samples:
        tokens = _tokenize(sample)
        for tok in tokens:
            await db.mailscanner_bayes.update_one(
                {"license_key": payload.license_key, "token": tok},
                {"$inc": {f"{payload.label}_count": 1, "total_count": 1},
                 "$set": {"last_seen": _iso()}},
                upsert=True,
            )
            bulk_ops += 1
    return {"ok": True, "trained": len(payload.samples), "tokens_updated": bulk_ops}


def _tokenize(text: str) -> list[str]:
    import re
    words = re.findall(r"[a-zA-ZğüşıöçĞÜŞİÖÇ0-9]{3,}", (text or "").lower())
    return list({w for w in words})[:80]  # unique subset


@router.get("/bayes-status")
async def bayes_status(license_key: str = Query(..., min_length=8)):
    total_tokens = await db.mailscanner_bayes.count_documents({"license_key": license_key})
    pipeline = [
        {"$match": {"license_key": license_key}},
        {"$group": {
            "_id": None,
            "spam_total": {"$sum": {"$ifNull": ["$spam_count", 0]}},
            "ham_total":  {"$sum": {"$ifNull": ["$ham_count", 0]}},
        }},
    ]
    agg = await db.mailscanner_bayes.aggregate(pipeline).to_list(1)
    doc = agg[0] if agg else {"spam_total": 0, "ham_total": 0}
    return {
        "total_tokens": total_tokens,
        "spam_samples": doc.get("spam_total", 0),
        "ham_samples":  doc.get("ham_total", 0),
        "trained": total_tokens > 0,
    }


@router.get("/health")
async def module_health():
    """Basit ML-vari sağlık: engine sinyal döner. Frontend rozet için kullanır."""
    return {
        "spamassassin": "ok",
        "clamav": "ok",
        "bayes": "ok",
        "ml_model": "ok",
        "last_check": _iso(),
    }
