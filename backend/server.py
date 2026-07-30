"""
MailShield Pro — WHM/cPanel Mail Security API
FastAPI backend for the spam management dashboard.

This service exposes the mail security management endpoints consumed by the
React dashboard (and by the WHM plugin's CGI proxy). Data is persisted in
MongoDB. Where a real WHM server is available, `whm_bridge.py` shells out to
the local Perl daemon that talks to SpamAssassin/ClamAV/DCC/Razor. When
running in preview mode, seeded data drives every screen so the UI is fully
navigable end-to-end.
"""
from __future__ import annotations

import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="MailShield Pro API", version="1.0.0")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mailshield")


# ---------- Models ----------------------------------------------------------
def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class QuarantineItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    received_at: str = Field(default_factory=_iso)
    sender: str
    sender_ip: str
    recipient: str
    subject: str
    score: float
    verdict: Literal["spam", "high_spam", "virus", "phish"]
    engine: str  # spamassassin | clamav | dcc | razor | ai
    size_kb: int
    body_preview: str
    headers: str
    rules_matched: List[str] = []
    released: bool = False


class ListEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    entry_type: Literal["ip", "domain", "email"]
    value: str
    scope: Literal["global", "user"]
    user: Optional[str] = None
    list_type: Literal["white", "black"]
    note: Optional[str] = ""
    created_at: str = Field(default_factory=_iso)


class Rule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    pattern: str
    score: float
    target: Literal["subject", "body", "header", "from", "any"] = "any"
    enabled: bool = True
    description: Optional[str] = ""
    created_at: str = Field(default_factory=_iso)


class EngineState(BaseModel):
    name: str
    label: str
    enabled: bool
    version: str
    status: Literal["running", "stopped", "error"] = "running"
    scanned_today: int = 0
    caught_today: int = 0
    description: str = ""


class PolicySettings(BaseModel):
    spam_threshold_low: float = 5.0
    spam_threshold_high: float = 8.5
    quarantine_days: int = 14
    report_frequency: Literal["off", "daily", "weekly"] = "daily"
    outbound_limit_per_hour: int = 200
    outbound_block_enabled: bool = True
    bayes_learning: bool = True
    ai_classification: bool = False
    tls_enforce: bool = True
    active_engine: Literal["spamassassin", "rspamd"] = "spamassassin"


class ActivityLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    at: str = Field(default_factory=_iso)
    level: Literal["info", "warn", "error"] = "info"
    source: str
    message: str


class CpanelUser(BaseModel):
    username: str
    domain: str
    email_count_today: int
    spam_caught_today: int
    quarantine_size: int
    per_user_threshold: Optional[float] = None


# ---------- Seed ------------------------------------------------------------
SENDER_POOL = [
    ("promo@discount-hub.ru", "185.220.101.42", "AKÇE-25 kampanyalı hediye kartınız hazır!", 12.4, "high_spam"),
    ("noreply@paypa1-secure.co", "45.155.204.7", "Hesabınız 24 saat içinde kilitlenecek", 9.8, "phish"),
    ("info@viagra-deals.tk", "91.240.118.172", "En iyi fiyatlarla eczane ürünleri", 15.2, "high_spam"),
    ("bulk@newsletter-cheap.io", "23.94.60.11", "Bu haftaki bültenimize göz atın", 6.1, "spam"),
    ("attach@malware-drop.cn", "103.219.31.85", "Fatura ekli - lütfen açın (invoice.exe)", 22.7, "virus"),
    ("winner@lottery-eu.info", "5.188.62.14", "Tebrikler! 850.000 EUR ödül kazandınız", 11.5, "spam"),
    ("support@bank0famerica.com", "196.243.129.44", "Kart bilgilerinizi doğrulayın", 13.9, "phish"),
    ("marketing@blast.mx", "77.83.36.201", "Yeni ürün lansmanı - erken erişim", 5.4, "spam"),
    ("crypto@earn-fast.biz", "37.221.113.9", "Ethereum yatırımıyla günlük %8 kazanç", 10.2, "spam"),
    ("hr@microsofft-hire.co", "62.204.41.90", "İş teklifi - lütfen özgeçmişinizi paylaşın", 8.7, "phish"),
]

RECIPIENT_POOL = [
    ("info@example.com.tr", "example"),
    ("admin@sirket.com", "sirket"),
    ("destek@teknofirma.net", "tekno"),
    ("iletisim@denemedomain.org", "deneme"),
    ("satis@kobifirma.com.tr", "kobi"),
]

ENGINE_SEED = [
    EngineState(name="spamassassin", label="Apache SpamAssassin",
                enabled=True, version="4.0.1", scanned_today=14238, caught_today=1892,
                description="Bayes + puanlama tabanlı klasik spam motoru."),
    EngineState(name="clamav", label="ClamAV Antivirus",
                enabled=True, version="1.4.2", scanned_today=14238, caught_today=47,
                description="Zararlı yazılım imzalı ek dosya taraması."),
    EngineState(name="dcc", label="DCC (Distributed Checksum)",
                enabled=True, version="2.3.171", scanned_today=14238, caught_today=612,
                description="Topluluk tabanlı checksum ile yığın posta tespiti."),
    EngineState(name="razor", label="Vipul's Razor",
                enabled=True, version="2.85", scanned_today=14238, caught_today=489,
                description="Ağ üzerinden imza kontrolü ile spam işaretleme."),
    EngineState(name="rspamd", label="Rspamd (alternatif)",
                enabled=False, version="3.8.4", scanned_today=0, caught_today=0,
                description="Modern, çok iş parçacıklı alternatif spam motoru."),
    EngineState(name="ai", label="AI Sınıflandırma (LLM)",
                enabled=False, version="claude-sonnet-4.5", scanned_today=0, caught_today=0,
                description="İçerik analizi ve phishing tespiti için LLM tabanlı katman."),
]


async def seed_if_empty() -> None:
    if await db.quarantine.estimated_document_count() > 0:
        return
    log.info("Seeding demo data…")
    now = datetime.now(timezone.utc)
    quarantine_docs = []
    for i in range(48):
        s = random.choice(SENDER_POOL)
        r = random.choice(RECIPIENT_POOL)
        received = (now - timedelta(minutes=random.randint(2, 60 * 72))).isoformat()
        item = QuarantineItem(
            received_at=received,
            sender=s[0], sender_ip=s[1], subject=s[2], score=s[3] + random.uniform(-0.4, 0.4),
            verdict=s[4],
            recipient=r[0],
            engine=random.choice(["spamassassin", "clamav", "dcc", "razor"]),
            size_kb=random.randint(4, 320),
            body_preview="Sayın Müşterimiz, hesabınıza acil bir işlem gerekmektedir…\nLütfen aşağıdaki bağlantıyı kullanarak…",
            headers=f"Return-Path: <{s[0]}>\nReceived: from unknown ({s[1]})\nX-Spam-Score: {round(s[3], 2)}\nX-Spam-Flag: YES\nSubject: {s[2]}\n",
            rules_matched=random.sample(
                ["BAYES_99", "HTML_MESSAGE", "URIBL_BLACK", "RDNS_NONE", "DCC_CHECK", "RAZOR2_CHECK",
                 "MISSING_DATE", "FROM_LOCAL_NOVOWEL", "SUBJECT_ALL_CAPS", "MIME_HTML_ONLY"],
                k=random.randint(2, 5),
            ),
        )
        quarantine_docs.append(item.model_dump())
    await db.quarantine.insert_many(quarantine_docs)

    lists = [
        ListEntry(entry_type="domain", value="trusted-partner.com", scope="global", list_type="white", note="Şirket iş ortağı"),
        ListEntry(entry_type="email", value="ceo@ourcompany.com", scope="global", list_type="white", note="Yönetim"),
        ListEntry(entry_type="ip", value="203.0.113.44", scope="global", list_type="white"),
        ListEntry(entry_type="domain", value="discount-hub.ru", scope="global", list_type="black", note="Sürekli spam"),
        ListEntry(entry_type="ip", value="185.220.101.42", scope="global", list_type="black", note="TOR exit node"),
        ListEntry(entry_type="email", value="promo@spammer.tk", scope="global", list_type="black"),
        ListEntry(entry_type="domain", value="paypa1-secure.co", scope="global", list_type="black", note="Phishing"),
        ListEntry(entry_type="domain", value="fatura.example.com.tr", scope="user", user="example", list_type="white"),
    ]
    await db.lists.insert_many([e.model_dump() for e in lists])

    rules = [
        Rule(name="Yerel dil spam", pattern="/ucuz\\s+(viagra|ilaç)/i", score=6.0, target="any",
             description="Türkçe eczane spam kalıpları"),
        Rule(name="Şüpheli bağış", pattern="/tebrikler.*(kazand.n.z|.dül)/i", score=5.5, target="subject"),
        Rule(name="Kripto pump", pattern="/(bitcoin|ethereum).*(sinyal|kazanç)/i", score=4.5, target="body"),
        Rule(name="Sahte fatura", pattern="/invoice.*\\.(exe|scr|js)/i", score=9.0, target="body",
             description="Zararlı ek tespiti"),
    ]
    await db.rules.insert_many([r.model_dump() for r in rules])

    await db.engines.insert_many([e.model_dump() for e in ENGINE_SEED])
    await db.settings.insert_one({"_key": "policy", **PolicySettings().model_dump()})

    users = [
        CpanelUser(username="example", domain="example.com.tr", email_count_today=842,
                   spam_caught_today=118, quarantine_size=34).model_dump(),
        CpanelUser(username="sirket", domain="sirket.com", email_count_today=3120,
                   spam_caught_today=498, quarantine_size=142).model_dump(),
        CpanelUser(username="tekno", domain="teknofirma.net", email_count_today=612,
                   spam_caught_today=88, quarantine_size=19).model_dump(),
        CpanelUser(username="deneme", domain="denemedomain.org", email_count_today=104,
                   spam_caught_today=22, quarantine_size=6).model_dump(),
        CpanelUser(username="kobi", domain="kobifirma.com.tr", email_count_today=1780,
                   spam_caught_today=311, quarantine_size=71).model_dump(),
    ]
    await db.users.insert_many(users)

    logs = []
    for i in range(30):
        at = (now - timedelta(minutes=i * 4 + random.randint(0, 3))).isoformat()
        level = random.choices(["info", "warn", "error"], weights=[75, 20, 5])[0]
        source = random.choice(["spamassassin", "clamav", "dcc", "razor", "milter", "outbound"])
        msg = random.choice([
            "Message rejected: score 12.4 from 185.220.101.42",
            "Bayes DB rebuild completed (17ms)",
            "ClamAV signature update ok — 8.7M sigs",
            "DCC checksum server reached (dcc1.dcc-servers.net)",
            "Razor negotiation successful",
            "Outbound rate limit tripped for user 'kobi' (231/hr)",
            "Milter accepted connection from mx.google.com",
            "Quarantine cleanup removed 42 expired messages",
        ])
        logs.append(ActivityLog(at=at, level=level, source=source, message=msg).model_dump())
    await db.logs.insert_many(logs)
    log.info("Seed complete: %d quarantine items", len(quarantine_docs))


@app.on_event("startup")
async def _startup() -> None:
    await seed_if_empty()


@app.on_event("shutdown")
async def _shutdown() -> None:
    client.close()


# ---------- Endpoints -------------------------------------------------------
@api.get("/")
async def root():
    return {"service": "MailShield Pro", "status": "ok", "version": "1.0.0"}


@api.get("/stats/overview")
async def stats_overview():
    total = await db.quarantine.count_documents({})
    phish = await db.quarantine.count_documents({"verdict": "phish"})
    virus = await db.quarantine.count_documents({"verdict": "virus"})
    high = await db.quarantine.count_documents({"verdict": "high_spam"})
    engines = await db.engines.find({}, {"_id": 0}).to_list(20)
    scanned = sum(e.get("scanned_today", 0) for e in engines if e.get("enabled"))
    caught = sum(e.get("caught_today", 0) for e in engines if e.get("enabled"))
    ham = max(scanned - caught, 0)
    return {
        "scanned_today": scanned,
        "caught_today": caught,
        "ham_today": ham,
        "spam_ratio": round((caught / scanned * 100), 2) if scanned else 0,
        "quarantine_total": total,
        "phishing_count": phish,
        "virus_count": virus,
        "high_spam_count": high,
        "engines_active": sum(1 for e in engines if e.get("enabled")),
        "engines_total": len(engines),
    }


@api.get("/stats/traffic")
async def stats_traffic(hours: int = 24):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    points = []
    for i in range(hours, -1, -1):
        t = now - timedelta(hours=i)
        base_ham = 400 + int(120 * random.random()) + (150 if 9 <= t.hour <= 18 else 0)
        base_spam = 80 + int(60 * random.random()) + (30 if 20 <= t.hour <= 23 else 0)
        base_virus = random.randint(0, 4)
        points.append({
            "time": t.isoformat(),
            "hour": t.strftime("%H:00"),
            "ham": base_ham,
            "spam": base_spam,
            "virus": base_virus,
            "phish": random.randint(0, 6),
        })
    return points


@api.get("/stats/top-senders")
async def top_senders(limit: int = 8):
    pipeline = [
        {"$group": {"_id": "$sender_ip", "count": {"$sum": 1},
                    "sender": {"$first": "$sender"},
                    "avg_score": {"$avg": "$score"},
                    "verdict": {"$first": "$verdict"}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    rows = await db.quarantine.aggregate(pipeline).to_list(limit)
    return [{
        "ip": r["_id"], "sender": r["sender"], "count": r["count"],
        "avg_score": round(r["avg_score"], 2), "verdict": r["verdict"],
    } for r in rows]


# ----- Quarantine -----
@api.get("/quarantine")
async def quarantine_list(
    search: Optional[str] = None,
    verdict: Optional[str] = None,
    engine: Optional[str] = None,
    limit: int = 200,
):
    q: dict = {}
    if verdict and verdict != "all":
        q["verdict"] = verdict
    if engine and engine != "all":
        q["engine"] = engine
    if search:
        q["$or"] = [
            {"sender": {"$regex": search, "$options": "i"}},
            {"subject": {"$regex": search, "$options": "i"}},
            {"recipient": {"$regex": search, "$options": "i"}},
            {"sender_ip": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.quarantine.find(q, {"_id": 0}).sort("received_at", -1).to_list(limit)
    return docs


@api.get("/quarantine/{item_id}")
async def quarantine_get(item_id: str):
    doc = await db.quarantine.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kayıt bulunamadı")
    return doc


class BulkAction(BaseModel):
    ids: List[str]


@api.post("/quarantine/release")
async def quarantine_release(action: BulkAction):
    result = await db.quarantine.update_many(
        {"id": {"$in": action.ids}}, {"$set": {"released": True}}
    )
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="info",
        message=f"{result.modified_count} mesaj karantinadan bırakıldı",
    ).model_dump())
    return {"released": result.modified_count}


@api.post("/quarantine/delete")
async def quarantine_delete(action: BulkAction):
    result = await db.quarantine.delete_many({"id": {"$in": action.ids}})
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="warn",
        message=f"{result.deleted_count} karantina mesajı silindi",
    ).model_dump())
    return {"deleted": result.deleted_count}


@api.post("/quarantine/report-spam")
async def quarantine_report(action: BulkAction):
    # In real deployment this would call sa-learn --spam
    await db.logs.insert_one(ActivityLog(
        source="bayes", level="info",
        message=f"{len(action.ids)} mesaj Bayes'e spam olarak öğretildi",
    ).model_dump())
    return {"trained": len(action.ids)}


# ----- Lists (white/black) -----
@api.get("/lists")
async def lists_get(list_type: Optional[str] = None, scope: Optional[str] = None):
    q: dict = {}
    if list_type:
        q["list_type"] = list_type
    if scope:
        q["scope"] = scope
    return await db.lists.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


class ListEntryIn(BaseModel):
    entry_type: Literal["ip", "domain", "email"]
    value: str
    scope: Literal["global", "user"] = "global"
    user: Optional[str] = None
    list_type: Literal["white", "black"]
    note: Optional[str] = ""


@api.post("/lists")
async def lists_add(entry: ListEntryIn):
    obj = ListEntry(**entry.model_dump())
    await db.lists.insert_one(obj.model_dump())
    return obj.model_dump()


@api.delete("/lists/{entry_id}")
async def lists_delete(entry_id: str):
    r = await db.lists.delete_one({"id": entry_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kayıt yok")
    return {"deleted": True}


# ----- Rules -----
@api.get("/rules")
async def rules_get():
    return await db.rules.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


class RuleIn(BaseModel):
    name: str
    pattern: str
    score: float
    target: Literal["subject", "body", "header", "from", "any"] = "any"
    enabled: bool = True
    description: Optional[str] = ""


@api.post("/rules")
async def rules_add(rule: RuleIn):
    obj = Rule(**rule.model_dump())
    await db.rules.insert_one(obj.model_dump())
    return obj.model_dump()


@api.put("/rules/{rule_id}")
async def rules_update(rule_id: str, rule: RuleIn):
    r = await db.rules.update_one({"id": rule_id}, {"$set": rule.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"updated": True}


@api.delete("/rules/{rule_id}")
async def rules_delete(rule_id: str):
    r = await db.rules.delete_one({"id": rule_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"deleted": True}


# ----- Engines -----
@api.get("/engines")
async def engines_get():
    return await db.engines.find({}, {"_id": 0}).to_list(20)


@api.post("/engines/{name}/toggle")
async def engines_toggle(name: str):
    doc = await db.engines.find_one({"name": name})
    if not doc:
        raise HTTPException(404, "Motor bulunamadı")
    new_val = not doc.get("enabled", False)
    await db.engines.update_one({"name": name}, {"$set": {"enabled": new_val}})
    await db.logs.insert_one(ActivityLog(
        source=name, level="info",
        message=f"{doc.get('label', name)} {'etkinleştirildi' if new_val else 'devre dışı bırakıldı'}",
    ).model_dump())
    return {"name": name, "enabled": new_val}


# ----- Settings -----
@api.get("/settings")
async def settings_get():
    doc = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0})
    return doc or PolicySettings().model_dump()


@api.put("/settings")
async def settings_put(policy: PolicySettings):
    await db.settings.update_one(
        {"_key": "policy"}, {"$set": {**policy.model_dump(), "_key": "policy"}}, upsert=True
    )
    await db.logs.insert_one(ActivityLog(
        source="settings", level="info",
        message=f"Politika güncellendi (threshold {policy.spam_threshold_low}/{policy.spam_threshold_high})",
    ).model_dump())
    return policy.model_dump()


# ----- Users -----
@api.get("/users")
async def users_get():
    return await db.users.find({}, {"_id": 0}).to_list(500)


# ----- Logs -----
@api.get("/logs")
async def logs_get(limit: int = 100, level: Optional[str] = None):
    q = {}
    if level and level != "all":
        q["level"] = level
    return await db.logs.find(q, {"_id": 0}).sort("at", -1).to_list(limit)


# ----- Test scan (used by "Rule tester") -----
class ScanIn(BaseModel):
    subject: str
    from_addr: str
    body: str


@api.post("/scan/test")
async def scan_test(payload: ScanIn):
    rules = await db.rules.find({"enabled": True}, {"_id": 0}).to_list(100)
    settings = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0}) or PolicySettings().model_dump()
    hits = []
    import re
    total = 0.0
    for r in rules:
        pattern = r["pattern"].strip("/")
        flags = re.IGNORECASE if pattern.endswith("i") else 0
        pattern = pattern.rstrip("i").rstrip("/")
        target_text = {
            "subject": payload.subject, "body": payload.body,
            "from": payload.from_addr,
        }.get(r["target"], f"{payload.subject}\n{payload.body}\n{payload.from_addr}")
        try:
            if re.search(pattern, target_text or "", flags):
                hits.append({"name": r["name"], "score": r["score"]})
                total += r["score"]
        except re.error:
            pass
    # Add some canned scores as would come from real SA
    if "http://" in payload.body or "https://" in payload.body:
        hits.append({"name": "HTML_LINK", "score": 0.5}); total += 0.5
    if payload.subject.isupper() and len(payload.subject) > 6:
        hits.append({"name": "SUBJECT_ALL_CAPS", "score": 1.2}); total += 1.2
    verdict = "clean"
    if total >= settings["spam_threshold_high"]:
        verdict = "high_spam"
    elif total >= settings["spam_threshold_low"]:
        verdict = "spam"
    return {"score": round(total, 2), "verdict": verdict, "hits": hits,
            "threshold_low": settings["spam_threshold_low"],
            "threshold_high": settings["spam_threshold_high"]}


# ----- Outbound -----
@api.get("/outbound")
async def outbound_get():
    users = await db.users.find({}, {"_id": 0}).to_list(50)
    limit = (await db.settings.find_one({"_key": "policy"}) or {}).get("outbound_limit_per_hour", 200)
    return {
        "limit_per_hour": limit,
        "top_senders": [
            {"user": u["username"], "domain": u["domain"], "sent_today": u["email_count_today"],
             "flagged": u["spam_caught_today"], "blocked": max(0, u["email_count_today"] - limit * 8)}
            for u in users
        ],
        "queue_size": random.randint(0, 12),
    }


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
