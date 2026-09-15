"""v44.00.35 — AI System Health Analysis (Claude Sonnet 4.6 via Emergent LLM Key)
Master-only endpoint that collects current signals (spam trend, rule performance,
threat feed health, DMARC alarms) and asks Claude to produce a plain-language
Turkish summary + recommended actions.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/ai", tags=["ai"])

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
_client = AsyncIOMotorClient(MONGO_URL)
db = _client[DB_NAME]


async def _require_master(request: Request, license_key: Optional[str]):
    from server import _require_master as core_check
    return await core_check(request, license_key)


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _collect_signals() -> dict:
    """Sistemin son 7 günlük sinyallerini derle → LLM'e context olarak verilecek."""
    now = datetime.now(timezone.utc)
    d7 = (now - timedelta(days=7)).isoformat()
    d1 = (now - timedelta(days=1)).isoformat()

    # Mail metrikleri (7 gün)
    total_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}})
    spam_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7},
                                                     "verdict": {"$in": ["spam", "high_spam"]}})
    virus_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}, "verdict": "virus"})
    phish_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}, "verdict": "phish"})

    # 24 saat delta
    total_24h = await db.mail_events.count_documents({"received_at": {"$gte": d1}})
    spam_24h = await db.mail_events.count_documents({"received_at": {"$gte": d1},
                                                      "verdict": {"$in": ["spam", "high_spam"]}})

    # Kural performansı (top 5 hit, zero-hit süresi)
    top_rules = await db.mailscanner_rule_suggestions.find(
        {"status": "active"}, {"_id": 0, "rule_id": 1, "hits": 1, "zero_hit_days": 1}
    ).sort("hits", -1).limit(5).to_list(5)
    zero_hit_count = await db.mailscanner_rule_suggestions.count_documents(
        {"status": "active", "zero_hit_days": {"$gte": 7}}
    )
    active_rules_total = await db.mailscanner_rule_suggestions.count_documents({"status": "active"})

    # Threat feed sağlığı
    feeds = await db.threat_intel_feeds.find({}, {"_id": 0, "key": 1, "last_sync_status": 1,
                                                    "last_sync_at": 1, "last_error": 1}).to_list(50)
    error_feeds = [f for f in feeds if f.get("last_sync_status") == "error"]

    # USOM
    usom_last = await db.settings.find_one({"_key": "usom_last_run"}, {"_id": 0}) or {}

    # Karantina
    q_total = await db.quarantine.count_documents({})
    q_recent = await db.quarantine.count_documents({"received_at": {"$gte": d7}})

    # Notifications (son 7 gün alarmlar)
    alerts_7d = await db.notifications_inbox.count_documents({"created_at": {"$gte": d7}})
    dmarc_alerts_7d = await db.notifications_inbox.count_documents({
        "created_at": {"$gte": d7}, "kind": "dmarc_attack",
    })

    return {
        "generated_at": _iso(),
        "mail_metrics_7d": {
            "total": total_7d, "spam": spam_7d, "virus": virus_7d, "phish": phish_7d,
            "spam_rate_pct": round(spam_7d / total_7d * 100, 2) if total_7d else 0,
        },
        "mail_metrics_24h": {"total": total_24h, "spam": spam_24h},
        "rule_performance": {
            "active_total": active_rules_total,
            "zero_hit_7d_plus": zero_hit_count,
            "top_5": top_rules,
        },
        "threat_feeds": {
            "total": len(feeds),
            "error_count": len(error_feeds),
            "errors": [{"key": f["key"], "last_error": (f.get("last_error") or "")[:120]}
                       for f in error_feeds[:5]],
        },
        "usom": {
            "last_run_date": usom_last.get("date"),
            "records": usom_last.get("count"),
            "added_to_blacklist": usom_last.get("added_to_blacklist"),
        },
        "quarantine": {"total": q_total, "last_7d": q_recent},
        "alerts_7d": {"total": alerts_7d, "dmarc_attacks": dmarc_alerts_7d},
    }


SYSTEM_PROMPT = """Sen, GökyüzüWebSpam adlı bir WHM/cPanel mail spam koruma
yönetim panelinin AI sağlık analistisin. Kullanıcı bir sistem yöneticisidir.

Görevin: Verilen JSON metriklerini incele ve şu formatta bir Türkçe rapor üret:

1. **Genel Sağlık Skoru** (0-100 arası tek sayı, tek satır)
2. **Öne Çıkan Tehlike Sinyalleri** (madde işaretli 2-4 madde, olumsuz durumlar)
3. **Olumlu Notlar** (madde işaretli 1-3 madde)
4. **Önerilen Aksiyonlar** (öncelik sırasıyla 3-5 madde, her biri 1 cümle, spesifik ve aksiyona yönelik)

Kurallar:
- Sadece verilen JSON verisini kullan, uydurma
- Yüksek spam oranı (%40+), 5+ hata veren feed, 10+ zero-hit kural, 3+ DMARC alarm gibi durumları vurgula
- Kısa ve net yaz, sysadmin dili kullan
- Her bölüm için 1 emoji kullan (📊, 🚨, ✅, 💡)
- Yanıtı Markdown formatında ver
- Toplam uzunluk: max 400 kelime"""


@router.post("/system-analysis")
async def system_analysis(request: Request, license_key: Optional[str] = None):
    """Claude Sonnet 4.6 ile sistem sağlık raporu üret. Master-only."""
    await _require_master(request, license_key)
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "EMERGENT_LLM_KEY tanımlı değil. Profil → Manage Plan → Universal Key")
    signals = await _collect_signals()

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        raise HTTPException(500, "emergentintegrations yüklü değil. pip install emergentintegrations")

    session_id = f"sys-analysis-{uuid.uuid4()}"
    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=SYSTEM_PROMPT)
        .with_model("anthropic", "claude-sonnet-4-6")
    )
    import json as _json
    msg = UserMessage(text=(
        f"Aşağıdaki JSON, GökyüzüWebSpam master panelinin son 7 günlük durum sinyalleridir. "
        f"Sistem prompt'undaki 4 bölümlü Türkçe rapor formatında yanıtla.\n\n"
        f"```json\n{_json.dumps(signals, ensure_ascii=False, indent=2)}\n```"
    ))
    try:
        response_text = await chat.send_message(msg)
    except Exception as ex:
        raise HTTPException(502, f"LLM çağrısı başarısız: {ex}")

    doc = {
        "id": str(uuid.uuid4()),
        "generated_at": _iso(),
        "model": "anthropic/claude-sonnet-4-6",
        "signals": signals,
        "report_markdown": response_text,
    }
    await db.ai_system_reports.insert_one({**doc})
    doc.pop("_id", None)
    return doc


@router.get("/system-analysis/latest")
async def get_latest_analysis(request: Request, license_key: Optional[str] = None):
    """Son üretilen sistem sağlık raporunu döner (cache olarak kullanmak için)."""
    await _require_master(request, license_key)
    doc = await db.ai_system_reports.find_one({}, sort=[("generated_at", -1)], projection={"_id": 0})
    return doc or {}
