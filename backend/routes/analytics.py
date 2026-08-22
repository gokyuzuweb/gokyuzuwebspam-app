"""
Financial analytics (MRR / ARR / Churn / LTV) route module.
Extracted from server.py in v1.4 modularization pass.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from deps import db, PLUGIN_MODE

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _parse(iso: Optional[str]) -> datetime:
    try:
        if not iso:
            return datetime.now(timezone.utc) - timedelta(days=999)
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc) - timedelta(days=999)


@router.get("/mrr")
async def analytics_mrr():
    """MRR, ARR, ARPU, active subs, LTV, churn — computed live from
    payment_transactions + licenses collections. Seller-only."""
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Sadece satıcı modu")

    now = datetime.now(timezone.utc)
    paid = await db.payment_transactions.find({"status": "paid"}, {"_id": 0}).to_list(5000)

    def _monthly(tx: dict) -> float:
        amt = float(tx.get("amount") or 0.0)
        return amt / 12.0 if tx.get("billing_period") == "yearly" else amt

    total_revenue = round(sum(float(t.get("amount") or 0.0) for t in paid), 2)

    licenses = await db.licenses.find({}, {"_id": 0}).to_list(5000)
    lic_by_key = {l["license_key"]: l for l in licenses}

    def _active(lic: dict) -> bool:
        if not lic or not lic.get("active"):
            return False
        try:
            return datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00")) > now
        except Exception:
            return False

    active_paid_tx = [t for t in paid if _active(lic_by_key.get(t.get("license_key") or ""))]
    mrr = round(sum(_monthly(t) for t in active_paid_tx), 2)
    arr = round(mrr * 12, 2)
    active_subs = len(active_paid_tx)
    arpu = round(mrr / active_subs, 2) if active_subs else 0.0

    d30 = now - timedelta(days=30)
    new30 = [t for t in paid if _parse(t.get("completed_at") or t.get("created_at")) >= d30]
    new_mrr_30 = round(sum(_monthly(t) for t in new30), 2)

    churned = 0
    for l in licenses:
        try:
            vu = datetime.fromisoformat(l["valid_until"].replace("Z", "+00:00"))
            if d30 <= vu < now:
                churned += 1
        except Exception:
            continue
    churn_pct = round((churned / active_subs * 100), 2) if active_subs else 0.0

    monthly_churn = churned / max(active_subs, 1)
    avg_lifetime_m = round(1 / monthly_churn, 1) if monthly_churn > 0 else 24.0
    ltv = round(arpu * avg_lifetime_m, 2)

    def _mkey(dt: datetime) -> str:
        return f"{dt.year}-{dt.month:02d}"

    trend: dict[str, float] = {}
    for i in range(6):
        m = now.replace(day=1) - timedelta(days=i * 30)
        trend[_mkey(m)] = 0.0
    for t in paid:
        d = _parse(t.get("completed_at") or t.get("created_at"))
        k = _mkey(d)
        if k in trend:
            trend[k] += _monthly(t)
    trend_series = [{"month": k, "mrr": round(v, 2)} for k, v in sorted(trend.items())]

    plans_agg: dict[str, dict] = {}
    for t in active_paid_tx:
        code = t.get("plan_code", "pro")
        plans_agg.setdefault(code, {"count": 0, "mrr": 0.0})
        plans_agg[code]["count"] += 1
        plans_agg[code]["mrr"] += _monthly(t)
    plans_breakdown = [
        {"plan": k, "count": v["count"], "mrr": round(v["mrr"], 2)} for k, v in plans_agg.items()
    ]

    recent = sorted(paid, key=lambda t: t.get("completed_at") or t.get("created_at"), reverse=True)[:5]

    return {
        "currency": (paid[0].get("currency") if paid else "USD") or "USD",
        "mrr": mrr,
        "arr": arr,
        "active_subs": active_subs,
        "arpu": arpu,
        "ltv": ltv,
        "churn_pct": churn_pct,
        "churned_last_30d": churned,
        "new_mrr_30d": new_mrr_30,
        "total_revenue": total_revenue,
        "trend": trend_series,
        "plans_breakdown": plans_breakdown,
        "recent": recent,
    }


# v44.00.04 — Per-tenant Bayi Analytics (churn azaltmak için)
# Bayi kendi WHM sunucusunda "kaç mail bloke ettim, kaç para koruma sağladım"
# görsün → daha az iptal, daha çok upgrade.
@router.get("/reseller-stats")
async def reseller_stats(request: Request):
    """Bayi'nin kendi lisansına göre spam/mail metriklerini hesaplar.
    Master için toplu değerler (masterin kendi bayilerinin sunucularından gelen
    heartbeat sayaçları) döner."""
    # Caller identity
    caller_key = (request.headers.get("x-master-key") or request.headers.get("x-license-key") or "").strip()
    if not caller_key:
        raise HTTPException(401, "X-Master-Key header gerekli")
    import os as _os
    master_key = _os.environ.get("MASTER_LICENSE_KEY", "")
    is_master = bool(master_key) and caller_key == master_key

    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_7d = (now - timedelta(days=7)).isoformat()
    since_30d = (now - timedelta(days=30)).isoformat()

    # Base filter (bayi = kendi mail_events, master = tümü)
    base = {} if is_master else {"license_key": caller_key}

    # 24h counts
    scanned_24h = await db.mail_events.count_documents({**base, "ts": {"$gte": since_24h}})
    blocked_24h = await db.mail_events.count_documents({**base, "ts": {"$gte": since_24h}, "action": {"$in": ["reject", "bounce", "quarantine"]}})
    # 7d counts
    scanned_7d = await db.mail_events.count_documents({**base, "ts": {"$gte": since_7d}})
    blocked_7d = await db.mail_events.count_documents({**base, "ts": {"$gte": since_7d}, "action": {"$in": ["reject", "bounce", "quarantine"]}})
    # 30d counts
    scanned_30d = await db.mail_events.count_documents({**base, "ts": {"$gte": since_30d}})
    blocked_30d = await db.mail_events.count_documents({**base, "ts": {"$gte": since_30d}, "action": {"$in": ["reject", "bounce", "quarantine"]}})

    # Quarantine
    q_base = {} if is_master else {"owner_license_key": caller_key}
    quar_total = await db.quarantine.count_documents(q_base)
    phish = await db.quarantine.count_documents({**q_base, "verdict": "phish"})
    virus = await db.quarantine.count_documents({**q_base, "verdict": "virus"})

    # Top threat categories (7d)
    pipe = [
        {"$match": {**base, "ts": {"$gte": since_7d}, "action": {"$in": ["reject", "bounce", "quarantine"]}}},
        {"$group": {"_id": {"$ifNull": ["$sa_report", "spam"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]
    top_threats = []
    async for row in db.mail_events.aggregate(pipe):
        top_threats.append({"category": (row["_id"] or "spam")[:60], "count": row["count"]})

    # Estimated "savings" — çok basit heuristic: her bloke edilen mail ortalama
    # 0.02 USD ekonomik zarar önler (bandwidth, storage, kullanıcı zamanı).
    estimated_savings_30d = round(blocked_30d * 0.02, 2)

    # Trend (son 7 gün, günlük bloke edilen)
    trend = []
    for i in range(6, -1, -1):
        d_start = (now - timedelta(days=i+1)).isoformat()
        d_end = (now - timedelta(days=i)).isoformat()
        cnt = await db.mail_events.count_documents({**base, "ts": {"$gte": d_start, "$lt": d_end}, "action": {"$in": ["reject", "bounce", "quarantine"]}})
        trend.append({"day": (now - timedelta(days=i)).strftime("%Y-%m-%d"), "blocked": cnt})

    # Motor durumu (kaç motor aktif)
    engines_filter = {} if is_master else {"owner_license_key": caller_key}
    engines_docs = await db.engines.find(engines_filter, {"_id": 0, "name": 1, "enabled": 1}).to_list(20)
    engines_active = sum(1 for e in engines_docs if e.get("enabled"))
    engines_total = len(engines_docs)

    return {
        "scope": "master" if is_master else "reseller",
        "license_key_short": caller_key[:12] + "...",
        "counts": {
            "scanned_24h": scanned_24h,
            "blocked_24h": blocked_24h,
            "scanned_7d": scanned_7d,
            "blocked_7d": blocked_7d,
            "scanned_30d": scanned_30d,
            "blocked_30d": blocked_30d,
        },
        "quarantine": {
            "total": quar_total,
            "phish": phish,
            "virus": virus,
        },
        "block_rate_pct": round((blocked_7d / scanned_7d) * 100, 1) if scanned_7d else 0.0,
        "top_threats": top_threats,
        "estimated_savings_usd_30d": estimated_savings_30d,
        "trend_7d": trend,
        "engines": {"active": engines_active, "total": engines_total},
    }
