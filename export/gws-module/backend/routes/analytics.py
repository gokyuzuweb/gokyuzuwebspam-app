"""
Financial analytics (MRR / ARR / Churn / LTV) route module.
Extracted from server.py in v1.4 modularization pass.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
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
