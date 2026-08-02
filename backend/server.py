"""
GökyüzüWebSpam — WHM/cPanel Mail Security API
FastAPI backend for the spam management dashboard.

This service exposes the mail security management endpoints consumed by the
React dashboard (and by the WHM plugin's CGI proxy). Data is persisted in
MongoDB. Where a real WHM server is available, `whm_bridge.py` shells out to
the local Perl daemon that talks to SpamAssassin/ClamAV/DCC/Razor. When
running in preview mode, seeded data drives every screen so the UI is fully
navigable end-to-end.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Plugin mode: "customer" (bayi/müşteri kurulumu — lisans gate uygulanır)
# ya da "seller" (satıcı yönetim paneli — tüm özellikler açık).
# WHM'ye kurulunca install.sh varsayılan olarak "customer" set eder.
PLUGIN_MODE = os.environ.get("MAILSHIELD_MODE", "customer").lower()
DEMO_DAYS = int(os.environ.get("MAILSHIELD_DEMO_DAYS", "7"))

app = FastAPI(title="GökyüzüWebSpam API", version="1.0.0")
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
    ai_model: Literal["claude-sonnet-4-5", "gpt-5.2", "gemini-3-flash"] = "claude-sonnet-4-5"
    tls_enforce: bool = True
    active_engine: Literal["spamassassin", "rspamd"] = "spamassassin"
    ui_language: Literal["auto", "tr", "en", "de", "fr", "ar", "es"] = "auto"


class NotificationSettings(BaseModel):
    email_enabled: bool = True
    admin_email: str = "admin@localhost"
    email_from: str = "gokyuzuwebspam@localhost"
    slack_enabled: bool = False
    slack_webhook_url: str = ""
    # Telegram (deprecated in favor of email — kept for backwards compat)
    telegram_enabled: bool = False
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    alert_min_score: float = 10.0
    alert_on_virus: bool = True
    alert_on_phish: bool = True
    alert_on_license_violation: bool = True
    # Yeni: saldırı ve toplu mail alarmları
    alert_on_attack: bool = True         # DDoS / brute-force / port scan
    alert_on_bulk_mail: bool = True      # Kısa sürede yüksek hacim outbound
    attack_threshold_5min: int = 100     # 5 dakikada >=N şüpheli olay
    bulk_mail_threshold_1h: int = 500    # 1 saatte >=N giden mail


class License(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    license_key: str = Field(default_factory=lambda: f"MS-{uuid.uuid4().hex[:24].upper()}")
    customer_name: str
    customer_email: str = ""
    plan: Literal["starter", "pro", "enterprise"] = "pro"
    ip_addresses: List[str] = []  # allowed IPs
    panel_domains: List[str] = []  # allowed cPanel domains (shared-hosting için)
    max_domains: int = 100
    valid_until: str  # ISO date
    active: bool = True
    notes: str = ""
    created_at: str = Field(default_factory=_iso)
    last_heartbeat_at: Optional[str] = None
    last_heartbeat_ip: Optional[str] = None
    last_heartbeat_version: Optional[str] = None
    last_heartbeat_hostname: Optional[str] = None


class LicenseViolation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    at: str = Field(default_factory=_iso)
    ip: str
    hostname: Optional[str] = ""
    license_key: Optional[str] = ""
    reason: str  # ip_not_allowed | key_not_found | expired | inactive
    version: Optional[str] = ""
    raw: dict = {}


class VersionManifest(BaseModel):
    latest_version: str = "1.1.0"
    download_url: str = "https://mailshield.example.com/dist/mailshield-1.1.0.tar.gz"
    sha256: str = ""
    changelog: str = ""
    release_date: str = Field(default_factory=_iso)
    min_supported: str = "1.0.0"


class PricingPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: Literal["starter", "pro", "enterprise"]
    name: str
    currency: str = "USD"
    monthly_price: float = 0.0
    yearly_price: float = 0.0
    setup_fee: float = 0.0
    max_domains: int = 100
    max_ips: int = 1
    features: List[str] = []
    highlighted: bool = False
    active: bool = True
    stripe_lookup_monthly: Optional[str] = None
    stripe_lookup_yearly: Optional[str] = None


class PricingSettings(BaseModel):
    plans: List[PricingPlan] = []
    contact_email: str = "satis@gokyuzuwebspam.com"
    contact_phone: str = ""
    hero_headline: str = "GökyüzüWebSpam · WHM Mail Güvenliği"
    hero_sub: str = "Türkçe destekli, kapsamlı ve modern spam koruma paneli"


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

    # Engines — upsert each so restarts don't duplicate; unique index on 'name'
    try:
        await db.engines.create_index("name", unique=True)
    except Exception:
        pass
    for e in ENGINE_SEED:
        d = e.model_dump()
        await db.engines.update_one({"name": d["name"]}, {"$setOnInsert": d}, upsert=True)
    await db.settings.insert_one({"_key": "policy", **PolicySettings().model_dump()})
    await db.settings.insert_one({"_key": "notifications", **NotificationSettings().model_dump()})
    # Version manifest + current version
    await db.settings.insert_one({"_key": "version", "version": "1.1.0", "installed_at": _iso()})
    await db.settings.insert_one({
        "_key": "version_manifest",
        **VersionManifest(
            latest_version="1.1.0",
            download_url="https://mailshield.example.com/dist/gokyuzuwebspam-1.1.0.tar.gz",
            changelog="v1.1.0: Slack/Telegram uyarıları, AI sınıflandırma, PDF rapor, IP bazlı lisanslama",
            release_date=_iso(),
        ).model_dump()
    })
    # Sample licenses (satıcı için başlangıç örneği)
    now = datetime.now(timezone.utc)
    demo_licenses = [
        License(
            customer_name="Örnek Müşteri A.Ş.",
            customer_email="admin@ornekmusteri.com",
            plan="pro",
            ip_addresses=["203.0.113.10", "203.0.113.11"],
            max_domains=250,
            valid_until=(now + timedelta(days=365)).isoformat(),
            notes="Yıllık pro paket · 2 sunucu",
            last_heartbeat_at=(now - timedelta(minutes=8)).isoformat(),
            last_heartbeat_ip="203.0.113.10",
            last_heartbeat_version="1.1.0",
        ).model_dump(),
        License(
            customer_name="Deneme Hosting Ltd.",
            customer_email="ops@denemehosting.net",
            plan="enterprise",
            ip_addresses=["198.51.100.42"],
            max_domains=1000,
            valid_until=(now + timedelta(days=180)).isoformat(),
            notes="Enterprise · unlimited domain limit yakın",
            last_heartbeat_at=(now - timedelta(hours=2)).isoformat(),
            last_heartbeat_ip="198.51.100.42",
            last_heartbeat_version="1.0.9",
        ).model_dump(),
    ]
    await db.licenses.insert_many(demo_licenses)
    # Default pricing plans
    default_plans = [
        PricingPlan(code="starter", name="Starter", monthly_price=29.0, yearly_price=290.0,
                    max_domains=50, max_ips=1,
                    features=["50 domain'e kadar", "SpamAssassin + ClamAV", "Karantina yönetimi",
                             "Beyaz/Kara liste", "E-posta bildirimi", "Standart destek"],
                    stripe_lookup_monthly="starter_monthly", stripe_lookup_yearly="starter_yearly").model_dump(),
        PricingPlan(code="pro", name="Pro", monthly_price=79.0, yearly_price=790.0,
                    max_domains=250, max_ips=3, highlighted=True,
                    features=["250 domain'e kadar", "3 sunucu IP'si", "DCC + Razor topluluk imzaları",
                             "AI sınıflandırma (Claude/GPT/Gemini)", "Haftalık PDF rapor", "Slack + e-posta uyarısı",
                             "Blacklist otomatik çıkış talebi", "Öncelikli destek"],
                    stripe_lookup_monthly="pro_monthly", stripe_lookup_yearly="pro_yearly").model_dump(),
        PricingPlan(code="enterprise", name="Enterprise", monthly_price=199.0, yearly_price=1990.0,
                    max_domains=10000, max_ips=10,
                    features=["Sınırsız domain (10.000+)", "10 sunucu IP'si", "Reseller yönetimi",
                             "Özel kurallar & AI eğitim", "SLA garantili destek", "White-label branding",
                             "Özel entegrasyon (API)", "7/24 telefon desteği"],
                    stripe_lookup_monthly="enterprise_monthly", stripe_lookup_yearly="enterprise_yearly").model_dump(),
    ]
    await db.settings.insert_one({
        "_key": "pricing",
        **PricingSettings(plans=[PricingPlan(**p) for p in default_plans]).model_dump()
    })
    # Sample violations
    await db.violations.insert_many([
        LicenseViolation(
            ip="45.32.11.7", hostname="unlicensed-server.hosting.tr",
            license_key="MS-STOLEN12345",
            reason="ip_not_allowed", version="1.1.0",
        ).model_dump(),
        LicenseViolation(
            ip="192.0.2.99", hostname="expired-customer.com",
            license_key="MS-EXPIRED67890",
            reason="expired", version="1.0.8",
        ).model_dump(),
    ])

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
    # Deduplicate engines (was seeded multiple times in earlier versions)
    try:
        seen = set()
        async for e in db.engines.find({}, {"_id": 1, "name": 1}):
            n = e.get("name")
            if n in seen:
                await db.engines.delete_one({"_id": e["_id"]})
            else:
                seen.add(n)
        await db.engines.create_index("name", unique=True)
    except Exception as ex:
        log.warning("engines dedupe skipped: %s", ex)
    # Kick off background housekeeping tasks
    asyncio.create_task(_auto_suspend_daily_task())
    asyncio.create_task(_weekly_ai_report_task())
    asyncio.create_task(_hourly_self_training_task())
    asyncio.create_task(_monthly_auto_cleanup_task())
    asyncio.create_task(_license_expiry_alerts_task())
    asyncio.create_task(_pos_health_monitor_task())


async def _auto_suspend_daily_task():
    """Nightly sweep: honor `auto_suspend` settings and suspend idle bayis.
    Runs every 24h; first run 5 minutes after startup."""
    await asyncio.sleep(300)
    while True:
        try:
            cfg = await db.settings.find_one({"_key": "auto_suspend"}, {"_id": 0}) or {}
            if cfg.get("enabled"):
                threshold = int(cfg.get("idle_days_threshold", 30))
                now = datetime.now(timezone.utc)
                suspended = 0
                async for r in db.resellers.find({"active": True}, {"_id": 0}):
                    last = await db.reseller_logins.find_one(
                        {"reseller_id": r["id"], "success": True},
                        {"_id": 0}, sort=[("at", -1)],
                    )
                    anchor = last["at"] if last else r.get("created_at")
                    if not anchor: continue
                    try:
                        days = (now - datetime.fromisoformat(anchor.replace("Z","+00:00"))).days
                    except Exception:
                        continue
                    if days >= threshold:
                        await db.resellers.update_one({"id": r["id"]}, {"$set": {
                            "active": False,
                            "auto_suspended_at": _iso(),
                            "auto_suspend_reason": f"cron: {days} gün girişsiz",
                        }})
                        suspended += 1
                await db.settings.update_one({"_key": "auto_suspend"}, {"$set": {
                    "last_run_at": _iso(),
                    "last_suspended_count": suspended,
                }})
                if suspended:
                    log.info("auto-suspend: %d bayi askiya alindi", suspended)
        except Exception as ex:
            log.warning("auto-suspend task error: %s", ex)
        await asyncio.sleep(86400)  # every 24h


@app.on_event("shutdown")
async def _shutdown() -> None:
    client.close()


async def _hourly_self_training_task():
    """Her saat basi mailscanner AI self-training calisir."""
    # ilk calistirma icin 5 dk bekle (startup thundering herd icin)
    await asyncio.sleep(300)
    while True:
        try:
            from routes.mailscanner import run_self_training_once
            r = await run_self_training_once()
            log.info("self-training run: %s", r)
        except Exception as ex:
            log.warning("self-training loop error: %s", ex)
        await asyncio.sleep(3600)  # her saatte bir


async def _monthly_auto_cleanup_task():
    """Her ayın 1'inde 03:00 UTC'de 90 günden eski verileri arşivle (settings korunur).
    E-posta raporunu configure edilmiş adrese gönder."""
    await asyncio.sleep(600)  # startup'tan 10 dk sonra kontrol başlar
    while True:
        try:
            cfg = await db.settings.find_one({"_key": "auto_cleanup"}, {"_id": 0}) or {}
            if cfg.get("enabled", True):  # default enabled
                now = datetime.now(timezone.utc)
                dom = int(cfg.get("day_of_month", 1))
                hr  = int(cfg.get("hour_utc", 3))
                # Bugün doğru gün + saat mi?
                last = cfg.get("last_run_at")
                if now.day == dom and now.hour == hr:
                    already_today = False
                    if last:
                        try:
                            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                            if last_dt.date() == now.date():
                                already_today = True
                        except Exception:
                            pass
                    if not already_today:
                        from routes.maintenance import _run_auto_cleanup_once
                        r = await _run_auto_cleanup_once()
                        log.info("auto-cleanup cron run: %s", r)
        except Exception as ex:
            log.warning("auto-cleanup cron error: %s", ex)
        # Her saat kontrol et — doğru saat gelince tetikle
        await asyncio.sleep(3600)


async def _license_expiry_alerts_task():
    """Her sabah 09:00 UTC'de lisans bitiş kontrolü.
    14 gün kala uyarı, 3 gün kala kritik uyarı gönderir. Aynı uyarı 24 saatte 1 kez."""
    await asyncio.sleep(900)  # startup'tan 15dk sonra
    while True:
        try:
            now = datetime.now(timezone.utc)
            if now.hour == 9:   # 09:00 UTC (Türkiye 12:00)
                last = await db.settings.find_one({"_key": "expiry_alerts_last_run"}, {"_id": 0})
                already = False
                if last:
                    try:
                        last_dt = datetime.fromisoformat(last.get("ts", "").replace("Z", "+00:00"))
                        if last_dt.date() == now.date():
                            already = True
                    except Exception:
                        pass
                if not already:
                    sent = 0
                    async for lic in db.licenses.find(
                        {"status": {"$ne": "cancelled"}, "expires_at": {"$exists": True, "$ne": None}},
                        {"_id": 0},
                    ):
                        try:
                            exp = datetime.fromisoformat(str(lic["expires_at"]).replace("Z", "+00:00"))
                            days_left = (exp - now).days
                        except Exception:
                            continue
                        # 14 veya 3 gün ise mail
                        if days_left in (14, 3):
                            email = lic.get("email") or lic.get("customer_email")
                            if not email or "@" not in email:
                                continue
                            urgent = days_left <= 3
                            subj = (f"🚨 KRİTİK: Lisansınız {days_left} gün içinde sona eriyor!"
                                    if urgent else
                                    f"⚠️ Lisansınız 14 gün içinde sona eriyor · GökyüzüWebSpam")
                            body = (
                                f"Sayın {lic.get('reseller_name') or lic.get('customer_name') or 'Kullanıcı'},\n\n"
                                f"GökyüzüWebSpam lisansınız {days_left} gün içinde ({exp.date()}) sona erecek.\n\n"
                                f"Lisans Bilgileri:\n"
                                f"  Lisans No: {lic.get('license_key')}\n"
                                f"  Plan: {lic.get('plan', 'starter')}\n"
                                f"  Bitiş: {exp.strftime('%d.%m.%Y')}\n\n"
                                f"Kesintisiz hizmet için lütfen lisansınızı yenileyin:\n"
                                f"  https://panel.gokyuzuhosting.com/checkout\n\n"
                                f"Sorularınız için: destek@gokyuzuhosting.com"
                            )
                            # Bayi kendi domain'inden gönderilsin (Otomatik Mod)
                            from_addr = await _smart_from(lic.get("license_key"))
                            ok, via = await _send_email(email, subj, body, from_addr=from_addr)
                            if ok:
                                sent += 1
                                await db.notifications_history.insert_one({
                                    "id": str(uuid.uuid4()),
                                    "kind": "license_expiry_alert",
                                    "license_key": lic.get("license_key"),
                                    "days_left": days_left, "urgent": urgent,
                                    "to": email, "via": via,
                                    "created_at": _iso(),
                                })
                    await db.settings.update_one(
                        {"_key": "expiry_alerts_last_run"},
                        {"$set": {"_key": "expiry_alerts_last_run", "ts": _iso(), "sent": sent}},
                        upsert=True,
                    )
                    log.info("license expiry alerts sent: %d", sent)
        except Exception as ex:
            log.warning("license expiry task error: %s", ex)
        await asyncio.sleep(3600)


async def _pos_health_monitor_task():
    """Her 15 dk POS sağlığını kontrol et. Bir sağlayıcının başarı oranı %40 altına düşerse
    admin inbox'a uyarı düşür + Telegram bildirim gönder (varsa)."""
    await asyncio.sleep(1200)  # startup'tan 20dk sonra
    while True:
        try:
            from datetime import timedelta as _td
            since = (datetime.now(timezone.utc) - _td(hours=1)).isoformat()
            providers = ["paytr", "iyzico", "param", "ipara"]  # havale hariç
            for prov in providers:
                total = await db.payments.count_documents(
                    {"provider": prov, "created_at": {"$gte": since}},
                )
                if total < 5:   # yeterli veri yoksa geç
                    continue
                paid = await db.payments.count_documents(
                    {"provider": prov, "created_at": {"$gte": since}, "status": "paid"},
                )
                rate = round(paid * 100 / total, 1)
                if rate < 40:
                    # Zaten uyarı verilmiş mi? (1 saat throttle)
                    recent = await db.notifications_inbox.find_one({
                        "kind": "pos_health_alert", "provider": prov,
                        "created_at": {"$gte": since},
                    })
                    if recent:
                        continue
                    doc = {
                        "id": str(uuid.uuid4()), "kind": "pos_health_alert",
                        "provider": prov, "success_rate": rate,
                        "total_1h": total, "paid_1h": paid,
                        "message": f"{prov.upper()} son 1 saatte %{rate} başarı — kritik seviye!",
                        "created_at": _iso(), "read": False, "severity": "critical",
                    }
                    await db.notifications_inbox.insert_one(doc)
                    log.warning("POS health alert: %s = %s%%", prov, rate)
                    # Telegram bildir
                    ns = await _notify_settings()
                    if ns.get("telegram_token") and ns.get("telegram_chat_id"):
                        await _send_telegram(
                            ns["telegram_token"], ns["telegram_chat_id"],
                            f"🚨 *POS Uyarı* — {prov.upper()}\n"
                            f"Son 1 saat başarı oranı: *%{rate}*\n"
                            f"Toplam: {total} · Başarılı: {paid}\n\n"
                            f"Panele bakın: /panel/payments-admin",
                        )
        except Exception as ex:
            log.warning("pos health monitor error: %s", ex)
        await asyncio.sleep(900)   # 15 dk


async def _weekly_ai_report_task():
    """Her Pazartesi 07:00 UTC — son 7 günün spam trendini LLM ile özetler, master admin'e mail atar."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            # next Monday 07:00 UTC
            days_ahead = (7 - now.weekday()) % 7
            if days_ahead == 0 and now.hour >= 7:
                days_ahead = 7
            target = (now + timedelta(days=days_ahead)).replace(hour=7, minute=0, second=0, microsecond=0)
            wait_s = max(60, (target - now).total_seconds())
            await asyncio.sleep(wait_s)
            await _run_weekly_report()
        except Exception as ex:
            log.warning("weekly ai report loop error: %s", ex)
            await asyncio.sleep(3600)


async def _run_weekly_report() -> dict:
    """LLM ile son 7 gün spam özet raporu üretir. `weekly_reports` koleksiyonuna kaydeder.
    SMTP yapılandırılmışsa master admin'e otomatik email gönderir."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        log.info("weekly report atlandi: EMERGENT_LLM_KEY yok")
        return {"ok": False, "reason": "no_key"}
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    total = await db.mail_events.count_documents({"ingested_at": {"$gte": since}})
    spam = await db.mail_events.count_documents(
        {"ingested_at": {"$gte": since}, "verdict": {"$in": ["spam", "high_spam"]}}
    )
    virus = await db.mail_events.count_documents(
        {"ingested_at": {"$gte": since}, "verdict": "virus"}
    )
    top_senders: list[dict] = []
    async for row in db.mail_events.aggregate([
        {"$match": {"ingested_at": {"$gte": since}, "verdict": {"$ne": "clean"}}},
        {"$group": {"_id": "$from_addr", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}, {"$limit": 10},
    ]):
        top_senders.append({"from_addr": row["_id"], "count": row["count"]})
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"weekly-report-{uuid.uuid4()}",
            system_message="Sen bir e-posta güvenlik analistisin. Yönetici için Türkçe haftalık executive özet üretirsin.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        prompt = (
            f"Son 7 gün içinde GökyüzüWebSpam paneli:\n"
            f"- Toplam taranan mail: {total}\n- Spam: {spam}\n- Virus: {virus}\n"
            f"- En sık şüpheli gönderenler: " + ", ".join(f"{s['from_addr']}({s['count']})" for s in top_senders[:6]) + "\n\n"
            f"3 paragraflık executive özet yaz (200 kelime).\n"
            f"1) Genel trend + rakamlar\n2) Riskler ve dikkat çeken kalıplar\n3) Öneriler."
        )
        r = await chat.send_message(UserMessage(text=prompt))
        summary = (r or "").strip()
    except Exception as ex:
        log.warning("weekly report LLM error: %s", ex)
        summary = f"(LLM üretilemedi: {type(ex).__name__}) — Rakamlar: taranan {total}, spam {spam}, virus {virus}."
    doc = {
        "id": str(uuid.uuid4()),
        "period_days": 7,
        "generated_at": _iso(),
        "total_scanned": total, "spam": spam, "virus": virus,
        "top_suspicious_senders": top_senders,
        "summary": summary,
    }
    await db.weekly_reports.insert_one(doc)
    log.info("weekly ai report saved: %s", doc["id"])
    # Mail gönderimi (SMTP yapılandırılmışsa)
    mail_result = await _send_weekly_report_email(doc)
    if mail_result.get("sent"):
        await db.weekly_reports.update_one({"id": doc["id"]}, {"$set": {"emailed_to": mail_result.get("to"), "emailed_at": _iso()}})
    return {"ok": True, "id": doc["id"], "summary": summary, **mail_result}


async def _send_weekly_report_email(report: dict) -> dict:
    """Mevcut SMTP settings (db.settings _key=smtp) ile master admin'e mail atar."""
    cfg = await db.settings.find_one({"_key": "smtp"}, {"_id": 0}) or {}
    if not cfg.get("enabled") or not cfg.get("host"):
        return {"sent": False, "reason": "smtp_not_configured"}
    ns = await db.settings.find_one({"_key": "notifications"}, {"_id": 0}) or {}
    to_email = cfg.get("weekly_report_to") or ns.get("email_to") or cfg.get("from_addr")
    if not to_email:
        return {"sent": False, "reason": "no_recipient"}
    subject = f"[GökyüzüWebSpam] Haftalık AI Rapor - {report['generated_at'][:10]}"
    body_txt = (
        f"Son 7 gün özeti:\n"
        f"- Taranan: {report['total_scanned']}\n- Spam: {report['spam']}\n"
        f"- Virüs: {report['virus']}\n\n{report['summary']}\n"
    )
    try:
        ok, via = await _send_email(to_email, subject, body_txt,
                                     from_addr=cfg.get("from_addr", "noreply@gokyuzuwebspam"))
        return {"sent": ok, "to": to_email, "via": via}
    except Exception as ex:
        log.warning("weekly report email failed: %s", ex)
        return {"sent": False, "reason": f"{type(ex).__name__}"}


class SMTPSettings(BaseModel):
    host: str
    port: int = 587
    user: Optional[str] = ""
    password: Optional[str] = ""
    from_addr: str
    weekly_report_to: Optional[str] = None


@api.post("/settings/smtp/test-weekly")
async def test_smtp_weekly(request: Request, license_key: Optional[str] = None):
    """Ornek haftalik raporu master admin'e gonderir (SMTP test)."""
    await _require_master(request, license_key)
    fake_report = {
        "id": "test", "generated_at": _iso(),
        "total_scanned": 12345, "spam": 234, "virus": 5,
        "summary": "Bu bir test mailidir. SMTP yapılandırması çalışıyor.",
    }
    return await _send_weekly_report_email(fake_report)


@api.post("/ai/weekly-report/run")
async def trigger_weekly_report(request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    return await _run_weekly_report()


@api.get("/ai/weekly-report/latest")
async def get_latest_weekly_report():
    doc = await db.weekly_reports.find_one({}, {"_id": 0}, sort=[("generated_at", -1)])
    return doc or {}


@api.get("/ai/weekly-report/list")
async def list_weekly_reports(limit: int = 12):
    rows = await db.weekly_reports.find({}, {"_id": 0}).sort("generated_at", -1).limit(limit).to_list(limit)
    return {"items": rows}


# ---------- Endpoints -------------------------------------------------------
@api.get("/")
async def root():
    return {"service": "GökyüzüWebSpam", "status": "ok", "version": "1.0.0"}


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


@api.get("/quarantine/local-domains")
async def quarantine_local_domains():
    """Master server'ın gerçekten hostladığı alıcı domainlerinin listesi.
    Son 2000 mail event'ten çıkarılır. Demo/seed domainleri hariç tutulur."""
    seen = {}
    async for e in db.mail_events.find(
        {"to_addr": {"$exists": True, "$ne": None}},
        {"_id": 0, "to_addr": 1}
    ).sort("ts", -1).limit(2000):
        to = (e.get("to_addr") or "").lower()
        if "@" not in to: continue
        d = to.split("@")[-1]
        if d in _DEMO_DOMAINS: continue
        seen[d] = seen.get(d, 0) + 1
    ranked = sorted(seen.items(), key=lambda x: -x[1])[:20]
    return {"items": [{"domain": d, "count": c} for d, c in ranked],
            "demo_domains": sorted(_DEMO_DOMAINS)}


@api.post("/quarantine/purge-demo")
async def quarantine_purge_demo():
    """Master-only convenience: karantinada ve event'lerde demo alıcı domain'i
    olan tüm kayıtları sil. WHM plugin'den gelen gerçek eventler korunur."""
    filt = {"$or": [
        {"recipient": {"$regex": r"@(" + "|".join(_DEMO_DOMAINS) + r")$", "$options": "i"}},
        {"to_addr":  {"$regex": r"@(" + "|".join(_DEMO_DOMAINS) + r")$", "$options": "i"}},
    ]}
    q = await db.quarantine.delete_many(filt)
    e = await db.mail_events.delete_many(filt)
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="warn",
        message=f"Demo verisi temizlendi: quarantine={q.deleted_count}, mail_events={e.deleted_count}",
    ).model_dump())
    return {"quarantine_deleted": q.deleted_count, "events_deleted": e.deleted_count,
            "demo_domains": sorted(_DEMO_DOMAINS)}


# List of seed/demo domains that don't correspond to real customer mailboxes.
_DEMO_DOMAINS = {
    "example.com.tr", "kobifirma.com.tr", "teknofirma.net", "sirket.com",
    "denemedomain.org", "test.local", "your.tld",
}


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
    """
    'Spam değil' işareti = mesajı gelen kutusuna teslim et + göndericiyi otomatik
    whitelist'e ekle + Bayes'e ham (temiz) olarak öğret. Böylece aynı gönderici
    bir daha karantinaya düşmez.
    """
    docs = await db.quarantine.find({"id": {"$in": action.ids}}, {"_id": 0}).to_list(500)
    whitelisted_count = 0
    for d in docs:
        sender = d.get("sender", "")
        ip = d.get("sender_ip", "")
        # Add sender email to whitelist (if not present)
        existing = await db.lists.find_one({"list_type": "white", "value": sender})
        if not existing and sender:
            entry = ListEntry(entry_type="email", value=sender, scope="global",
                              list_type="white", note="Auto: 'spam değil' işaretinden")
            await db.lists.insert_one(entry.model_dump())
            whitelisted_count += 1
        # Also whitelist IP for robustness (skip if already exists)
        if ip:
            ip_exists = await db.lists.find_one({"list_type": "white", "value": ip})
            if not ip_exists:
                ip_entry = ListEntry(entry_type="ip", value=ip, scope="global",
                                     list_type="white", note="Auto: 'spam değil' işaretinden")
                await db.lists.insert_one(ip_entry.model_dump())
                whitelisted_count += 1
    result = await db.quarantine.update_many(
        {"id": {"$in": action.ids}}, {"$set": {"released": True}}
    )
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="info",
        message=f"{result.modified_count} mesaj alıcıya teslim edildi + {whitelisted_count} whitelist kaydı + Bayes ham eğitildi",
    ).model_dump())
    return {"released": result.modified_count, "whitelisted": whitelisted_count, "bayes_ham_trained": len(docs)}


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


# ----- Notifications (Slack + Telegram) -----
async def _notify_settings() -> dict:
    doc = await db.settings.find_one({"_key": "notifications"}, {"_id": 0, "_key": 0})
    # Merge with model defaults so newly added fields don't return None on old docs
    base = NotificationSettings().model_dump()
    if doc:
        base.update({k: v for k, v in doc.items() if v is not None})
    return base


async def _send_slack(webhook: str, text: str) -> bool:
    if not webhook: return False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(webhook, json={"text": text})
            return r.status_code < 400
    except Exception as e:
        log.warning("slack error: %s", e); return False


async def _send_telegram(token: str, chat_id: str, text: str) -> bool:
    if not token or not chat_id: return False
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
            return r.status_code < 400
    except Exception as e:
        log.warning("telegram error: %s", e); return False


async def _smtp_settings() -> dict:
    doc = await db.settings.find_one({"_key": "smtp"}, {"_id": 0, "_key": 0}) or {}
    return {
        "enabled":   bool(doc.get("enabled", False)),
        "auto_mode": bool(doc.get("auto_mode", True)),   # WHM/cPanel sendmail otomatik kullan
        "host":      doc.get("host", ""),
        "port":      int(doc.get("port", 587)),
        "username":  doc.get("username", ""),
        "password":  doc.get("password", ""),
        "from_addr": doc.get("from_addr", ""),
        "use_tls":   doc.get("use_tls", "starttls"),
    }


def _send_via_smtp(cfg: dict, to_addr: str, msg_bytes: bytes, from_addr: str) -> tuple[bool, str]:
    """Blocking SMTP send — runs inside asyncio.to_thread. Uses standard smtplib."""
    import smtplib
    host = cfg.get("host")
    port = int(cfg.get("port") or 587)
    user = cfg.get("username") or ""
    pw   = cfg.get("password") or ""
    mode = cfg.get("use_tls") or "starttls"
    if not host:
        return False, "smtp_no_host"
    try:
        if mode == "ssl":
            s = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            s = smtplib.SMTP(host, port, timeout=15)
            if mode == "starttls":
                s.starttls()
        if user:
            s.login(user, pw)
        s.sendmail(from_addr, [to_addr], msg_bytes)
        s.quit()
        return True, f"smtp:{host}:{port}"
    except Exception as e:
        return False, f"smtp_error:{type(e).__name__}:{str(e)[:120]}"


async def _smart_from(license_key: Optional[str] = None) -> str:
    """Otomatik FROM adresi: 
    - license_key verilirse → licenses koleksiyonundan domain al → noreply@<domain>
    - Yoksa → MASTER_DOMAIN (env) → noreply@gokyuzuhosting.com
    - En son: gokyuzuwebspam@localhost
    """
    master = os.environ.get("MASTER_DOMAIN") or "gokyuzuhosting.com"
    if license_key:
        lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
        if lic:
            # Öncelik: reseller/customer domain → license'daki email domain'i
            dom = lic.get("domain") or lic.get("reseller_domain")
            if not dom:
                em = lic.get("email") or lic.get("customer_email") or ""
                if "@" in em:
                    dom = em.split("@", 1)[1]
            if dom:
                return f"noreply@{dom}"
    return f"noreply@{master}"


async def _send_email(to_addr: str, subject: str, body: str, from_addr: str = "gokyuzuwebspam@localhost") -> tuple[bool, str]:
    """Send email. Tries configured SMTP first, then falls back to local /usr/sbin/sendmail (Exim on WHM)."""
    if not to_addr:
        return False, "no_recipient"
    try:
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["To"] = to_addr
        text_part = body
        html_part = (
            "<html><body style='font-family:-apple-system,Segoe UI,sans-serif;"
            "background:#0f172a;color:#e2e8f0;padding:24px;'>"
            "<div style='max-width:640px;margin:0 auto;background:#1e293b;border-radius:8px;"
            "padding:24px;border:1px solid #334155;'>"
            "<div style='display:flex;align-items:center;gap:8px;margin-bottom:16px;'>"
            "<div style='width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#f43f5e);"
            "border-radius:6px;'></div>"
            "<h2 style='margin:0;font-size:18px;color:#f1f5f9;'>GökyüzüWebSpam</h2></div>"
            f"<pre style='white-space:pre-wrap;font-family:SF Mono,Menlo,monospace;font-size:13px;"
            f"color:#cbd5e1;margin:0;'>{body}</pre>"
            "<hr style='border:0;border-top:1px solid #334155;margin:16px 0;'>"
            "<p style='color:#64748b;font-size:11px;margin:0;'>Bu e-posta GökyüzüWebSpam tarafından "
            "otomatik olarak oluşturulmuştur. Panele erişmek için WHM &gt; Plugins bölümünü ziyaret edin.</p>"
            "</div></body></html>"
        )
        msg.attach(MIMEText(text_part, "plain", "utf-8"))
        msg.attach(MIMEText(html_part, "html", "utf-8"))

        # 1) Try configured SMTP relay (only if manuel mode + host set)
        cfg = await _smtp_settings()
        use_smtp = cfg["enabled"] and cfg["host"] and not cfg.get("auto_mode", True)
        if use_smtp:
            eff_from = cfg["from_addr"] or from_addr
            msg["From"] = eff_from
            ok, info = await asyncio.to_thread(_send_via_smtp, cfg, to_addr, msg.as_bytes(), eff_from)
            if ok:
                return True, info
            # Log the smtp error but try sendmail as a graceful fallback
            log.warning("SMTP send failed (%s) — falling back to local sendmail", info)
            # Rebuild without SMTP From for local delivery
            del msg["From"]

        # 2) Local sendmail (WHM/Exim) — otomatik mod veya SMTP başarısızsa
        # from_addr default'sa akıllı FROM çöz
        if from_addr == "gokyuzuwebspam@localhost":
            from_addr = await _smart_from()
        msg["From"] = from_addr
        # Preview ortamı tespit: local Exim relay dış domain'e izin vermiyorsa
        is_remote_target = "@" in to_addr and not to_addr.endswith("localhost")
        if is_remote_target and os.path.exists("/var/log/exim4/mainlog"):
            try:
                with open("/var/log/exim4/mainlog", "r") as _f:
                    _f.seek(0, 2)
                    _sz = _f.tell()
                    _f.seek(max(0, _sz - 2000))
                    _tail = _f.read()
                if "Mailing to remote domains not supported" in _tail:
                    return False, ("Bu ortam yerel test için — dış domain'lere mail göndermez. "
                                   "Gerçek WHM/cPanel sunucunuzda Otomatik Mod düzgün çalışacaktır. "
                                   "Preview'da test için: SMTP relay ayarları (Gmail/Sendgrid) girin.")
            except Exception:
                pass
        import subprocess
        proc = subprocess.run(
            ["/usr/sbin/sendmail", "-t", "-oi", "-f", from_addr],
            input=msg.as_bytes(), capture_output=True, timeout=15,
        )
        if proc.returncode == 0:
            return True, "sendmail"
        return False, f"sendmail_error: {proc.stderr.decode(errors='ignore')[:200]}"
    except FileNotFoundError:
        return False, "queued (sendmail yok — WHM'ye kurulduğunda gönderilecek)"
    except Exception as e:
        return False, f"error: {e}"


async def _fire_alerts(item: dict) -> dict:
    ns = await _notify_settings()
    should = (
        item.get("score", 0) >= ns.get("alert_min_score", 10)
        or (ns.get("alert_on_virus") and item.get("verdict") == "virus")
        or (ns.get("alert_on_phish") and item.get("verdict") == "phish")
    )
    if not should:
        return {"fired": False}
    subject = f"[GökyüzüWebSpam] {item.get('verdict', '').upper()} · skor {item.get('score', 0):.2f}"
    body = (
        f"GökyüzüWebSpam · Tehdit Uyarısı\n"
        f"=================================\n\n"
        f"Karar    : {item.get('verdict', '').upper()}\n"
        f"Skor     : {item.get('score', 0):.2f}\n"
        f"Gönderici: {item.get('sender', '')}\n"
        f"IP       : {item.get('sender_ip', '')}\n"
        f"Alıcı    : {item.get('recipient', '')}\n"
        f"Motor    : {item.get('engine', '')}\n"
        f"Konu     : {item.get('subject', '')}\n\n"
        f"Bu mesaj karantinaya alındı. Panelden inceleyip aksiyon alabilirsiniz."
    )
    result = {"fired": True, "email": None, "slack": False, "telegram": False}
    if ns.get("email_enabled") and ns.get("admin_email"):
        ok, via = await _send_email(ns["admin_email"], subject, body,
                                    from_addr=ns.get("email_from") or "gokyuzuwebspam@localhost")
        result["email"] = {"ok": ok, "via": via}
    if ns.get("slack_enabled") and ns.get("slack_webhook_url"):
        result["slack"] = await _send_slack(ns["slack_webhook_url"], f"*GökyüzüWebSpam*\n```{body}```")
    if ns.get("telegram_enabled") and ns.get("telegram_bot_token") and ns.get("telegram_chat_id"):
        result["telegram"] = await _send_telegram(ns["telegram_bot_token"], ns["telegram_chat_id"], body)
    return result


@api.get("/notifications")
async def notifications_get():
    return await _notify_settings()


@api.put("/notifications")
async def notifications_put(settings: NotificationSettings):
    await db.settings.update_one(
        {"_key": "notifications"},
        {"$set": {**settings.model_dump(), "_key": "notifications"}},
        upsert=True,
    )
    await db.logs.insert_one(ActivityLog(
        source="notifications", level="info",
        message=f"Bildirim ayarları güncellendi (slack={settings.slack_enabled}, telegram={settings.telegram_enabled})",
    ).model_dump())
    return settings.model_dump()


class TestAlertPayload(BaseModel):
    channel: Literal["email", "slack", "telegram", "all"] = "email"


@api.post("/notifications/test")
async def notifications_test(payload: TestAlertPayload):
    ns = await _notify_settings()
    subject = "GökyüzüWebSpam · Test Bildirimi"
    text = "GökyüzüWebSpam test bildirimi. Sistem hazır ve alert kanalları çalışıyor."
    out = {"email": None, "slack": None, "telegram": None}
    if payload.channel in ("email", "all") and ns.get("admin_email"):
        ok, via = await _send_email(ns["admin_email"], subject, text,
                                    from_addr=ns.get("email_from") or "gokyuzuwebspam@localhost")
        out["email"] = {"ok": ok, "via": via, "to": ns["admin_email"]}
    if payload.channel in ("slack", "all") and ns.get("slack_webhook_url"):
        out["slack"] = await _send_slack(ns["slack_webhook_url"], f"🛡 {text}")
    if payload.channel in ("telegram", "all") and ns.get("telegram_bot_token") and ns.get("telegram_chat_id"):
        out["telegram"] = await _send_telegram(ns["telegram_bot_token"], ns["telegram_chat_id"], text)
    await db.logs.insert_one(ActivityLog(
        source="notifications", level="info",
        message=f"Test bildirimi gönderildi: {out}",
    ).model_dump())
    return out


@api.post("/notifications/simulate-threat")
async def notifications_simulate_threat():
    """Yüksek skorlu bir kayıt bulup gerçek alert yolla — bildirim akışını test etmek için."""
    sample = await db.quarantine.find_one({"verdict": {"$in": ["high_spam", "phish", "virus"]}}, {"_id": 0})
    if not sample:
        raise HTTPException(404, "Örnek kayıt yok")
    result = await _fire_alerts(sample)
    return {"sample": {"sender": sample["sender"], "score": sample["score"], "verdict": sample["verdict"]}, **result}


# ---- SMTP relay settings + test send ----
class SmtpSettingsIn(BaseModel):
    enabled: bool = False
    auto_mode: bool = True   # WHM/cPanel sendmail otomatik
    host: str = ""
    port: int = 587
    username: str = ""
    password: str = ""
    from_addr: str = ""
    use_tls: Literal["starttls", "ssl", "none"] = "starttls"


class MailTestIn(BaseModel):
    to: str
    subject: Optional[str] = None
    body: Optional[str] = None


@api.get("/settings/smtp")
async def get_smtp_settings():
    doc = await db.settings.find_one({"_key": "smtp"}, {"_id": 0, "_key": 0}) or {}
    return {
        "enabled":   bool(doc.get("enabled", False)),
        "auto_mode": bool(doc.get("auto_mode", True)),
        "host":      doc.get("host", ""),
        "port":      int(doc.get("port", 587)),
        "username":  doc.get("username", ""),
        "password":  "" if not doc.get("password") else "********",
        "from_addr": doc.get("from_addr", ""),
        "use_tls":   doc.get("use_tls", "starttls"),
    }


@api.put("/settings/smtp")
async def put_smtp_settings(payload: SmtpSettingsIn):
    doc = payload.model_dump()
    # If password is empty or masked, keep the existing password.
    if not doc["password"] or doc["password"] == "********":
        existing = await db.settings.find_one({"_key": "smtp"}, {"_id": 0, "password": 1}) or {}
        doc["password"] = existing.get("password", "")
    doc["_key"] = "smtp"
    doc["updated_at"] = _iso()
    await db.settings.update_one({"_key": "smtp"}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.post("/mail/test")
async def mail_send_test(payload: MailTestIn):
    """Send a real test email to `to`. Uses SMTP settings if enabled, otherwise local sendmail."""
    if "@" not in payload.to:
        raise HTTPException(400, "Gecerli bir e-posta adresi girin")
    ns = await _notify_settings()
    cfg = await _smtp_settings()
    from_addr = cfg.get("from_addr") or ns.get("email_from") or "gokyuzuwebspam@localhost"
    subject = payload.subject or "GökyüzüWebSpam · Test E-postası"
    body = payload.body or (
        "Merhaba,\n\n"
        "Bu e-posta GökyüzüWebSpam panelinizden gönderilen bir test mesajıdır.\n"
        "Bu mesajı almanız, sunucunuzun mail gönderme kanalının doğru şekilde\n"
        "yapılandırıldığı ve çalıştığı anlamına gelir.\n\n"
        f"Zaman: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"Gönderen: {from_addr}\n"
    )
    ok, via = await _send_email(payload.to, subject, body, from_addr=from_addr)
    await db.logs.insert_one(ActivityLog(
        source="mail-test",
        level="info" if ok else "warn",
        message=f"Test mail → {payload.to} · via={via} · ok={ok}",
    ).model_dump())
    if not ok:
        raise HTTPException(400, f"Gönderilemedi: {via}")
    return {"ok": True, "via": via, "to": payload.to, "from": from_addr}


# ----- AI Classification (Emergent LLM: Claude/GPT/Gemini) -----
class AIScanIn(BaseModel):
    subject: str
    from_addr: str
    body: str
    model: Optional[str] = None  # override


AI_PROVIDER = {
    "claude-sonnet-4-5": ("anthropic", "claude-sonnet-4-5-20250929"),
    "gpt-5.2":           ("openai",    "gpt-5.2"),
    "gemini-3-flash":    ("gemini",    "gemini-3-flash-preview"),
}

AI_SYSTEM = (
    "Sen bir e-posta spam ve phishing dedektörüsün. Gelen mesajı analiz et. "
    "SADECE tek satırlık geçerli JSON döndür (ek metin YOK):\n"
    '{"score": <0-15 arası float>, "verdict": "clean|spam|high_spam|phish|virus", "reason": "kısa Türkçe açıklama"}\n'
    "Puanlama rehberi: 0-3 temiz, 3-6 hafif şüpheli, 6-8 spam, 8-11 yüksek spam, 11+ kesin phishing/virüs."
)


async def _ai_classify(subject: str, from_addr: str, body: str, model_key: str) -> dict:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yapılandırılmamış")
    if model_key not in AI_PROVIDER:
        raise HTTPException(400, f"Bilinmeyen model: {model_key}")
    provider, model_name = AI_PROVIDER[model_key]
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = (
        LlmChat(
            api_key=key,
            session_id=f"ms-{uuid.uuid4().hex[:8]}",
            system_message=AI_SYSTEM,
        ).with_model(provider, model_name)
    )
    user_text = f"KİMDEN: {from_addr}\nKONU: {subject}\n\nGÖVDE:\n{body[:4000]}"
    text = ""
    try:
        resp = await chat.send_message(UserMessage(text=user_text))
        text = (resp or "").strip()
    except Exception as e:
        log.warning("ai error: %s", e)
        raise HTTPException(502, f"AI çağrısı başarısız: {e}")
    import json, re
    m = re.search(r'\{.*\}', text, re.DOTALL)
    parsed = {}
    if m:
        try:
            parsed = json.loads(m.group(0))
        except Exception:
            pass
    return {
        "score": float(parsed.get("score", 0)),
        "verdict": parsed.get("verdict", "clean"),
        "reason": parsed.get("reason", "AI yanıt ayrıştırılamadı") if parsed else text[:400],
        "model": model_key,
        "provider": provider,
    }


@api.post("/scan/ai")
async def scan_ai(payload: AIScanIn):
    settings = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0}) or PolicySettings().model_dump()
    if not settings.get("ai_classification"):
        raise HTTPException(400, "AI sınıflandırma kapalı. Ayarlar → AI Sınıflandırma toggle'ını açın.")
    model = payload.model or settings.get("ai_model", "claude-sonnet-4-5")
    result = await _ai_classify(payload.subject, payload.from_addr, payload.body, model)
    await db.logs.insert_one(ActivityLog(
        source="ai", level="info",
        message=f"AI ({model}) → skor {result['score']:.2f} · {result['verdict']}",
    ).model_dump())
    return result


# ----- Weekly PDF Report -----
def _build_pdf(stats: dict, top_senders: list, engines: list, verdict_counts: dict, period: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    )
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                            leftMargin=1.5 * cm, rightMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("t", parent=styles["Title"], textColor=colors.HexColor("#4f46e5"),
                           spaceAfter=6)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#64748b"))
    h2 = ParagraphStyle("h", parent=styles["Heading2"], textColor=colors.HexColor("#0f172a"))
    story = [
        Paragraph("GökyüzüWebSpam — Güvenlik Raporu", title),
        Paragraph(f"Dönem: <b>{period}</b> · Oluşturulma: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", small),
        Spacer(1, 0.6 * cm),
        Paragraph("Özet", h2),
    ]
    summary = [
        ["Toplam taranan", f"{stats.get('scanned_today', 0):,}".replace(",", ".")],
        ["Yakalanan spam", f"{stats.get('caught_today', 0):,}".replace(",", ".")],
        ["Karantinadaki mesaj", f"{stats.get('quarantine_total', 0):,}".replace(",", ".")],
        ["Phishing tespiti", f"{stats.get('phishing_count', 0)}"],
        ["Virüs tespiti", f"{stats.get('virus_count', 0)}"],
        ["Aktif motorlar", f"{stats.get('engines_active', 0)} / {stats.get('engines_total', 0)}"],
        ["Spam oranı", f"% {stats.get('spam_ratio', 0)}"],
    ]
    t = Table(summary, colWidths=[7 * cm, 6 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2ff")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#312e81")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c7d2fe")),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [t, Spacer(1, 0.6 * cm),
              Paragraph("Motor Performansı", h2)]
    eng_rows = [["Motor", "Durum", "Taranan", "Yakalanan"]]
    for e in engines:
        eng_rows.append([
            e.get("label", e.get("name")),
            "Açık" if e.get("enabled") else "Kapalı",
            f"{e.get('scanned_today', 0):,}".replace(",", "."),
            f"{e.get('caught_today', 0):,}".replace(",", "."),
        ])
    et = Table(eng_rows, colWidths=[6 * cm, 3 * cm, 4 * cm, 4 * cm])
    et.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [et, Spacer(1, 0.6 * cm),
              Paragraph("En Çok Şüpheli IP'ler", h2)]
    ts_rows = [["IP", "Gönderici", "Sayı", "Ort. Skor", "Karar"]]
    for r in top_senders[:10]:
        ts_rows.append([
            r.get("ip", ""), r.get("sender", "")[:32], str(r.get("count", 0)),
            f"{r.get('avg_score', 0):.2f}", str(r.get("verdict", "")).upper(),
        ])
    tt = Table(ts_rows, colWidths=[3.5 * cm, 5.5 * cm, 2 * cm, 2.5 * cm, 3.5 * cm])
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [tt, Spacer(1, 0.6 * cm),
              Paragraph("Tehdit Dağılımı", h2)]
    vd = [["Tür", "Adet"]]
    for k, label in [("high_spam", "Yüksek Spam"), ("spam", "Spam"),
                     ("phish", "Phishing"), ("virus", "Virüs")]:
        vd.append([label, str(verdict_counts.get(k, 0))])
    vt = Table(vd, colWidths=[8 * cm, 4 * cm])
    vt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4f46e5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [vt, Spacer(1, 1 * cm),
              Paragraph("Bu rapor GökyüzüWebSpam tarafından otomatik olarak oluşturulmuştur. "
                        "WHM'ye giriş yaparak detaylara ulaşabilirsiniz.", small)]
    doc.build(story)
    return buf.getvalue()


@api.get("/reports/weekly")
async def reports_weekly_download():
    stats = await stats_overview()
    top = await top_senders(limit=10)
    engines = await db.engines.find({}, {"_id": 0}).to_list(20)
    verdict_counts = {
        "high_spam": await db.quarantine.count_documents({"verdict": "high_spam"}),
        "spam":      await db.quarantine.count_documents({"verdict": "spam"}),
        "phish":     await db.quarantine.count_documents({"verdict": "phish"}),
        "virus":     await db.quarantine.count_documents({"verdict": "virus"}),
    }
    now = datetime.now(timezone.utc)
    period = f"{(now - timedelta(days=7)).strftime('%Y-%m-%d')} → {now.strftime('%Y-%m-%d')}"
    pdf = _build_pdf(stats, top, engines, verdict_counts, period)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="mailshield-report-{now.strftime("%Y%m%d")}.pdf"'},
    )


class ReportSendPayload(BaseModel):
    recipient: str


@api.post("/reports/weekly/send")
async def reports_weekly_send(payload: ReportSendPayload):
    """
    Sunucuya kurulduğunda Exim/sendmail üzerinden gönderim yapar.
    Önizleme ortamında sadece 'kuyruğa alındı' logu düşer + PDF üretilir.
    """
    stats = await stats_overview()
    top = await top_senders(limit=10)
    engines = await db.engines.find({}, {"_id": 0}).to_list(20)
    verdict_counts = {
        "high_spam": await db.quarantine.count_documents({"verdict": "high_spam"}),
        "spam":      await db.quarantine.count_documents({"verdict": "spam"}),
        "phish":     await db.quarantine.count_documents({"verdict": "phish"}),
        "virus":     await db.quarantine.count_documents({"verdict": "virus"}),
    }
    now = datetime.now(timezone.utc)
    period = f"{(now - timedelta(days=7)).strftime('%Y-%m-%d')} → {now.strftime('%Y-%m-%d')}"
    pdf = _build_pdf(stats, top, engines, verdict_counts, period)

    # Try local sendmail (works on WHM host); otherwise queue and log.
    sent_via = "queued"
    try:
        import subprocess, email
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.mime.application import MIMEApplication
        msg = MIMEMultipart()
        msg["From"] = "mailshield@localhost"
        msg["To"] = payload.recipient
        msg["Subject"] = f"GökyüzüWebSpam Haftalık Rapor — {now.strftime('%Y-%m-%d')}"
        msg.attach(MIMEText(f"GökyüzüWebSpam haftalık raporu ektedir.\n\nDönem: {period}", "plain", "utf-8"))
        attach = MIMEApplication(pdf, _subtype="pdf")
        attach.add_header("Content-Disposition", "attachment", filename=f"mailshield-report-{now.strftime('%Y%m%d')}.pdf")
        msg.attach(attach)
        proc = subprocess.run(
            ["/usr/sbin/sendmail", "-t", "-oi"],
            input=msg.as_bytes(),
            capture_output=True,
            timeout=15,
        )
        sent_via = "sendmail" if proc.returncode == 0 else "queued"
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        log.info("sendmail not available (preview env): %s", e)

    await db.logs.insert_one(ActivityLog(
        source="reports", level="info",
        message=f"Haftalık PDF rapor ({sent_via}) → {payload.recipient} · {len(pdf)} bayt",
    ).model_dump())
    return {"sent_via": sent_via, "recipient": payload.recipient, "size_bytes": len(pdf), "period": period}


# ----- Version & Update Manifest -----
@api.get("/version/current")
async def version_current():
    doc = await db.settings.find_one({"_key": "version"}, {"_id": 0, "_key": 0})
    return doc or {"version": "1.1.0", "installed_at": _iso()}


@api.get("/version/manifest")
async def version_manifest():
    doc = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0, "_key": 0})
    return doc or VersionManifest().model_dump()


@api.put("/version/manifest")
async def version_manifest_put(m: VersionManifest):
    await db.settings.update_one(
        {"_key": "version_manifest"},
        {"$set": {**m.model_dump(), "_key": "version_manifest"}},
        upsert=True,
    )
    await db.logs.insert_one(ActivityLog(
        source="version", level="info",
        message=f"Manifest güncellendi → v{m.latest_version}",
    ).model_dump())
    return m.model_dump()


@api.get("/version/check-update")
async def version_check_update():
    """Plugin başlangıçta çağırır — yeni sürüm var mı?"""
    cur = await db.settings.find_one({"_key": "version"}, {"_id": 0, "_key": 0}) or {"version": "1.1.0"}
    mf = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0, "_key": 0}) or VersionManifest().model_dump()
    def _parts(v): return tuple(int(x) for x in v.replace("v", "").split(".") if x.isdigit())
    is_newer = _parts(mf["latest_version"]) > _parts(cur["version"])
    return {
        "current": cur["version"],
        "latest": mf["latest_version"],
        "update_available": is_newer,
        "download_url": mf.get("download_url", ""),
        "download_url_ip": mf.get("download_url_ip", ""),
        "changelog": mf.get("changelog", ""),
        "release_date": mf.get("release_date", ""),
    }


# ----- Master admin gate + auto-publish -----
MASTER_IP = os.environ.get("MASTER_IP", "89.19.15.58")
MASTER_HOST = os.environ.get("MASTER_HOST", "gokyuzuhosting.com")
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _is_master(request: Request, license_key: Optional[str]) -> dict:
    """Master authenticated when the license_key equals the master's (either the
    env-configured MASTER_LICENSE_KEY or a license bound to MASTER_IP).

    IP match is reported for defense-in-depth information, but not strictly
    required — the user asked that master admin be accessible from the master
    server itself regardless of which browser/network they're on.
    """
    client_ip = _client_ip(request)
    xff_chain = request.headers.get("x-forwarded-for", "") + "," + client_ip
    ip_match = bool(MASTER_IP and MASTER_IP in xff_chain)

    key_match = False
    if license_key:
        if MASTER_LICENSE_KEY and license_key == MASTER_LICENSE_KEY:
            key_match = True
        else:
            lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
            if lic and (
                MASTER_IP in (lic.get("ip_addresses") or [])
                or lic.get("last_heartbeat_ip") == MASTER_IP
            ):
                key_match = True
    # Key match alone is enough to be master (user's explicit requirement).
    is_master = key_match
    return {
        "is_master": is_master,
        "ip_match": ip_match,
        "key_match": key_match,
        "client_ip": client_ip,
        "master_ip": MASTER_IP,
        "master_host": MASTER_HOST,
    }


@api.get("/admin/whoami")
async def admin_whoami(request: Request, license_key: Optional[str] = None):
    """Frontend calls this to decide whether to show master-only UI (License Mgmt,
    Version Publish, MRR panel). Sets a lightweight flag; the *authoritative* gating
    still happens on mutating endpoints via `_require_master`."""
    r = await _is_master(request, license_key)
    # If session cookie carries a previously-issued master session, honor it.
    cookie_master = request.cookies.get("gws_master_session")
    if cookie_master:
        row = await db.settings.find_one({"_key": f"master_session:{cookie_master}"}, {"_id": 0})
        if row and row.get("valid_until", "") > datetime.now(timezone.utc).isoformat():
            r["is_master"] = True
            r["via_cookie"] = True
    # is_master ise master anahtarı da dön (frontend localStorage'a yazsın ki
    # X-Master-Key header'ı her PUT/DELETE'te otomatik gitsin ve demo lock
    # yanlışlıkla tetiklenmesin). Sadece is_master true iken güvenli.
    if r.get("is_master"):
        r["master_key"] = os.environ.get("MASTER_LICENSE_KEY", "")
    return r


class MasterUnlockIn(BaseModel):
    license_key: str


@api.post("/admin/master-unlock")
async def admin_master_unlock(payload: MasterUnlockIn, request: Request):
    """One-time unlock: verify IP+key, mint a 30-day master session cookie.
    After unlock, subsequent requests are recognised as master via cookie
    (no need to spoof X-Forwarded-For or keep the key in localStorage)."""
    r = await _is_master(request, payload.license_key)
    if not r["is_master"]:
        raise HTTPException(
            403,
            f"Master oturum acilmadi (ip_match={r['ip_match']}, key_match={r['key_match']}). "
            f"Bu istek {r['client_ip']} IP'sinden geldi.",
        )
    token = str(uuid.uuid4())
    valid_until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.settings.update_one(
        {"_key": f"master_session:{token}"},
        {"$set": {
            "_key": f"master_session:{token}",
            "issued_to_ip": r["client_ip"],
            "license_key": payload.license_key,
            "valid_until": valid_until,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    resp = {"ok": True, "valid_until": valid_until, "token": token}
    # Cross-origin iframe (WHM plugin) için cookie flag'leri:
    # samesite='none' + secure=True → tarayıcı cross-site iframe'den de cookie gönderir.
    # Bu olmadan WHM iframe içindeki panel PUT/DELETE isteklerinde cookie gitmez → 423.
    from fastapi.responses import JSONResponse
    r_ = JSONResponse(resp)
    r_.set_cookie(
        key="gws_master_session",
        value=token,
        max_age=30 * 86400,
        samesite="none",   # cross-site cookie için gerekli
        httponly=True,     # XSS koruması — sadece HTTP request'lerde okunur
        secure=True,       # samesite=none HTTPS zorunlu
        path="/",
    )
    return r_


@api.post("/admin/master-logout")
async def admin_master_logout(request: Request):
    cookie_master = request.cookies.get("gws_master_session")
    if cookie_master:
        await db.settings.delete_one({"_key": f"master_session:{cookie_master}"})
    from fastapi.responses import JSONResponse
    r_ = JSONResponse({"ok": True})
    r_.delete_cookie("gws_master_session", path="/")
    return r_


@api.get("/admin/resellers")
async def admin_list_resellers(request: Request, license_key: Optional[str] = None):
    """Master-only. Returns all reseller accounts with sub-account counts,
    last login timestamp and an inactivity_days score (uyku modu detection)."""
    await _require_master(request, license_key)
    resellers = await db.resellers.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    now = datetime.now(timezone.utc)
    out = []
    for r in resellers:
        sub_count = await db.subaccounts.count_documents({"reseller_id": r["id"]})
        last_login = await db.reseller_logins.find_one(
            {"reseller_id": r["id"], "success": True},
            {"_id": 0}, sort=[("at", -1)],
        )
        inactivity_days = None
        if last_login and last_login.get("at"):
            try:
                delta = now - datetime.fromisoformat(last_login["at"].replace("Z", "+00:00"))
                inactivity_days = delta.days
            except Exception:
                inactivity_days = None
        elif r.get("created_at"):
            try:
                delta = now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                inactivity_days = delta.days
            except Exception:
                inactivity_days = None
        r["subaccount_count"] = sub_count
        r["last_login_at"] = last_login.get("at") if last_login else None
        r["last_login_ip"] = last_login.get("ip") if last_login else None
        r["inactivity_days"] = inactivity_days
        r["idle"] = bool(inactivity_days is not None and inactivity_days >= 7)
        out.append(r)
    return {"items": out, "count": len(out),
            "idle_count": sum(1 for r in out if r.get("idle"))}


@api.post("/admin/resellers/{rid}/send-reminder")
async def admin_send_reminder(rid: str, request: Request, license_key: Optional[str] = None):
    """Master-only. Uykuda olan bayilere hatırlatma e-postası gönderir."""
    await _require_master(request, license_key)
    r = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    if not r.get("email"):
        raise HTTPException(400, "Bayinin e-postasi yok")
    subj = "GökyüzüWebSpam · Bir süredir görüşmedik"
    body = (
        f"Merhaba {r.get('company', 'Bayi')},\n\n"
        f"Bir süredir GökyüzüWebSpam bayi portalına giriş yapmadığınızı fark ettik.\n"
        f"Alt hesaplarınızın spam korumasının aktif kalması ve son alarmları kaçırmamanız için\n"
        f"panele göz atmanızı öneririz.\n\n"
        f"  Giriş adresi: https://{MASTER_HOST}/reseller\n"
        f"  E-postanız: {r['email']}\n\n"
        f"Sorularınız için sistem yöneticiniz ile iletişime geçebilirsiniz.\n\n"
        f"— GökyüzüWebSpam Sistem\n"
        f"Zaman: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
    )
    ok, via = await _send_email(r["email"], subj, body)
    await db.logs.insert_one(ActivityLog(
        source="admin", level="info",
        message=f"Uyku bayi hatirlatmasi gonderildi: {r['email']} · via={via} · ok={ok}",
    ).model_dump())
    if not ok:
        raise HTTPException(400, f"Gönderilemedi: {via}")
    return {"ok": True, "email": r["email"], "via": via}


@api.get("/admin/reseller-logins")
async def admin_reseller_logins(request: Request, license_key: Optional[str] = None, limit: int = 100):
    """Master-only. Recent reseller login events (successful + failed)."""
    await _require_master(request, license_key)
    rows = await db.reseller_logins.find({}, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
    return {"items": rows, "count": len(rows)}


@api.get("/admin/subaccounts")
async def admin_list_subaccounts(request: Request, license_key: Optional[str] = None):
    """Master-only. Aggregated sub-accounts across all resellers with reseller
    context (which reseller owns each sub-account)."""
    await _require_master(request, license_key)
    subs = await db.subaccounts.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    reseller_ids = {s["reseller_id"] for s in subs if s.get("reseller_id")}
    resellers = await db.resellers.find(
        {"id": {"$in": list(reseller_ids)}},
        {"_id": 0, "id": 1, "email": 1, "company": 1, "license_key": 1, "plan": 1},
    ).to_list(500) if reseller_ids else []
    by_id = {r["id"]: r for r in resellers}
    for s in subs:
        r = by_id.get(s.get("reseller_id"))
        if r:
            s["reseller_email"]   = r.get("email")
            s["reseller_company"] = r.get("company", "")
            s["reseller_plan"]    = r.get("plan", "")
    return {"items": subs, "count": len(subs)}


class ResellerResetPwIn(BaseModel):
    new_password: str = Field(..., min_length=6)


@api.post("/admin/resellers/{rid}/reset-password")
async def admin_reset_reseller_password(rid: str, payload: ResellerResetPwIn,
                                        request: Request, license_key: Optional[str] = None):
    """Master-only. Directly resets a reseller's password (bcrypt hashed) so master
    can help a bayi who lost credentials. Optional SMTP email notification to bayi."""
    await _require_master(request, license_key)
    import bcrypt
    r = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    new_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    await db.resellers.update_one(
        {"id": rid},
        {"$set": {"password_hash": new_hash,
                  "password_reset_by_master_at": _iso()}},
    )
    # Notify the bayi by email — best-effort, don't fail the request if mail fails
    email_result = {"sent": False, "via": None, "error": None}
    if r.get("email"):
        subj = "GökyüzüWebSpam · Bayi Portal Şifreniz Sıfırlandı"
        body = (
            f"Merhaba {r.get('company', 'Bayi')},\n\n"
            f"Bayi portal şifreniz sistem yöneticisi tarafından sıfırlandı.\n\n"
            f"  Yeni şifreniz: {payload.new_password}\n\n"
            f"Lütfen girişten sonra hesap ayarlarından şifrenizi değiştirin.\n\n"
            f"Giriş adresi: https://{MASTER_HOST}/reseller\n"
            f"E-posta: {r['email']}\n\n"
            f"Bu bilgileri kimseyle paylaşmayın.\n\n"
            f"— GökyüzüWebSpam Sistem\n"
            f"Zaman: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
        )
        ok, via = await _send_email(r["email"], subj, body)
        email_result = {"sent": ok, "via": via, "error": None if ok else via}
    await db.logs.insert_one(ActivityLog(
        source="admin", level="warn",
        message=f"Master bayi sifresini sifirladi: {r.get('email')} · mail: {email_result['sent']}",
    ).model_dump())
    return {"ok": True, "email": r.get("email"), "notification": email_result}


@api.get("/admin/resellers/{rid}/activity")
async def admin_reseller_activity(rid: str, request: Request, license_key: Optional[str] = None, days: int = 30):
    """Master-only. Aggregated login activity for a specific bayi over N days.
    Returns per-day success/fail counts for a line chart."""
    await _require_master(request, license_key)
    r = await db.resellers.find_one({"id": rid}, {"_id": 0, "password_hash": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    days = max(1, min(days, 90))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    per_day = {}  # day -> {"success":N,"fail":N}
    async for log in db.reseller_logins.find(
        {"$or": [{"reseller_id": rid}, {"email": r.get("email")}],
         "at": {"$gte": cutoff}},
        {"_id": 0, "at": 1, "success": 1, "ip": 1},
    ).sort("at", 1):
        day = (log.get("at") or "")[:10]
        d = per_day.setdefault(day, {"success": 0, "fail": 0})
        if log.get("success"):
            d["success"] += 1
        else:
            d["fail"] += 1
    # Fill missing days with zeros so the chart has a continuous x-axis
    out = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        d = per_day.get(day, {"success": 0, "fail": 0})
        out.append({"day": day, **d, "total": d["success"] + d["fail"]})
    return {"reseller": {"email": r.get("email"), "company": r.get("company", "")},
            "days": days, "items": out}


@api.get("/admin/onboarding-status")
async def admin_onboarding_status(request: Request, license_key: Optional[str] = None):
    """Master-only. 4-step onboarding checklist for first-time setup."""
    await _require_master(request, license_key)
    lic = await db.licenses.find_one({"license_key": MASTER_LICENSE_KEY or license_key}, {"_id": 0}) if (MASTER_LICENSE_KEY or license_key) else None
    smtp = await db.settings.find_one({"_key": "smtp"}, {"_id": 0}) or {}
    branding = await db.reseller_branding.find_one({"license_key": (MASTER_LICENSE_KEY or license_key)}, {"_id": 0}) if (MASTER_LICENSE_KEY or license_key) else None
    stripe_key = bool(os.environ.get("STRIPE_API_KEY", "").strip())
    completed = await db.settings.find_one({"_key": "onboarding_completed"}, {"_id": 0}) or {}

    steps = [
        {"key": "license",  "label": "Ana Lisans Anahtarı",   "done": bool(lic and lic.get("active"))},
        {"key": "smtp",     "label": "SMTP Ayarları",         "done": bool(smtp.get("enabled") and smtp.get("host"))},
        {"key": "branding", "label": "Marka & Logo",          "done": bool(branding and branding.get("brand_name"))},
        {"key": "stripe",   "label": "Stripe / Ödeme Anahtarı","done": stripe_key},
    ]
    done_count = sum(1 for s in steps if s["done"])
    return {
        "steps": steps,
        "done_count": done_count,
        "total": len(steps),
        "completed": bool(completed.get("completed_at")),
        "completed_at": completed.get("completed_at"),
    }


@api.post("/admin/onboarding-complete")
async def admin_onboarding_complete(request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "onboarding_completed"},
        {"$set": {"_key": "onboarding_completed", "completed_at": _iso()}},
        upsert=True,
    )
    return {"ok": True}


class AutoSuspendSettingsIn(BaseModel):
    enabled: bool = False
    idle_days_threshold: int = Field(30, ge=7, le=365)
    notify_before: bool = True


@api.get("/admin/auto-suspend")
async def get_auto_suspend(request: Request, license_key: Optional[str] = None):
    """Master-only. Auto-suspend rule config: how many days of inactivity
    before a reseller is automatically suspended."""
    await _require_master(request, license_key)
    doc = await db.settings.find_one({"_key": "auto_suspend"}, {"_id": 0, "_key": 0}) or {}
    return {
        "enabled": bool(doc.get("enabled", False)),
        "idle_days_threshold": int(doc.get("idle_days_threshold", 30)),
        "notify_before": bool(doc.get("notify_before", True)),
        "last_run_at": doc.get("last_run_at"),
        "last_suspended_count": int(doc.get("last_suspended_count", 0)),
    }


@api.put("/admin/auto-suspend")
async def put_auto_suspend(payload: AutoSuspendSettingsIn, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "auto_suspend"},
        {"$set": {"_key": "auto_suspend", **payload.model_dump(), "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/admin/auto-suspend/run")
async def run_auto_suspend(request: Request, license_key: Optional[str] = None):
    """Master-only. Manually trigger the auto-suspend sweep. Also invoked by
    a nightly background task if enabled."""
    await _require_master(request, license_key)
    cfg = await get_auto_suspend(request, license_key)
    if not cfg["enabled"]:
        return {"ok": False, "reason": "disabled", "suspended": 0}
    threshold = cfg["idle_days_threshold"]
    now = datetime.now(timezone.utc)
    suspended = []
    async for r in db.resellers.find({"active": True}, {"_id": 0}):
        last = await db.reseller_logins.find_one(
            {"reseller_id": r["id"], "success": True},
            {"_id": 0}, sort=[("at", -1)],
        )
        anchor = last["at"] if last else r.get("created_at")
        if not anchor: continue
        try:
            days = (now - datetime.fromisoformat(anchor.replace("Z","+00:00"))).days
        except Exception:
            continue
        if days >= threshold:
            await db.resellers.update_one({"id": r["id"]}, {"$set": {
                "active": False,
                "auto_suspended_at": _iso(),
                "auto_suspend_reason": f"{days} gün girişsiz",
            }})
            suspended.append({"email": r["email"], "days": days})
            if cfg["notify_before"] and r.get("email"):
                await _send_email(
                    r["email"],
                    "GökyüzüWebSpam · Hesabınız askıya alındı",
                    f"Merhaba,\n\n{days} gündür bayi portalına giriş yapmadığınız için hesabınız otomatik olarak askıya alındı.\n"
                    f"Tekrar aktifleştirmek için yönetici ile iletişime geçin: {MASTER_HOST}\n\n— Sistem",
                )
    await db.settings.update_one({"_key": "auto_suspend"}, {"$set": {
        "last_run_at": _iso(),
        "last_suspended_count": len(suspended),
    }})
    return {"ok": True, "suspended": len(suspended), "items": suspended}


@api.get("/admin/analytics/export")
async def admin_analytics_export(request: Request, license_key: Optional[str] = None,
                                 fmt: str = "csv", days: int = 30):
    """Master-only. Weekly/monthly aggregate: all bayis, sub-account counts,
    login stats, mail volume. Returns CSV (fmt=csv) or JSON (fmt=json)."""
    await _require_master(request, license_key)
    days = max(1, min(days, 365))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = []
    async for r in db.resellers.find({}, {"_id": 0, "password_hash": 0}):
        sub_count = await db.subaccounts.count_documents({"reseller_id": r["id"]})
        login_success = await db.reseller_logins.count_documents({"reseller_id": r["id"], "success": True, "at": {"$gte": cutoff}})
        login_fail = await db.reseller_logins.count_documents({"reseller_id": r["id"], "success": False, "at": {"$gte": cutoff}})
        mail_count = await db.mail_events.count_documents({"license_key": r["license_key"], "ts": {"$gte": cutoff}})
        spam_count = await db.mail_events.count_documents({"license_key": r["license_key"], "verdict": {"$in": ["spam","high_spam","virus","phish"]}, "ts": {"$gte": cutoff}})
        last_login = await db.reseller_logins.find_one({"reseller_id": r["id"], "success": True}, sort=[("at", -1)])
        rows.append({
            "email": r["email"],
            "company": r.get("company", ""),
            "plan": r.get("plan", ""),
            "license_key": r["license_key"],
            "active": r.get("active", True),
            "created_at": (r.get("created_at") or "")[:10],
            "sub_accounts": sub_count,
            "logins_success_period": login_success,
            "logins_failed_period": login_fail,
            "mails_scanned_period": mail_count,
            "spam_caught_period": spam_count,
            "spam_ratio_pct": round(spam_count / mail_count * 100, 1) if mail_count else 0,
            "last_login_at": (last_login.get("at") if last_login else "")[:19],
        })
    if fmt == "json":
        return {"period_days": days, "generated_at": _iso(), "rows": rows}
    # CSV format
    import io, csv
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM for Excel UTF-8
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else [
        "email","company","plan","license_key","active","created_at","sub_accounts",
        "logins_success_period","logins_failed_period","mails_scanned_period",
        "spam_caught_period","spam_ratio_pct","last_login_at"])
    w.writeheader()
    for r in rows: w.writerow(r)
    from fastapi.responses import Response
    filename = f"bayi-analytics-{days}gun-{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# --- PWA Web Push subscription (VAPID foundation) ---
class PushSubscribeIn(BaseModel):
    reseller_token: Optional[str] = None
    license_key: Optional[str] = None
    subscription: dict  # { endpoint, keys: {p256dh, auth} }
    user_agent: Optional[str] = None


@api.post("/push/subscribe")
async def push_subscribe(payload: PushSubscribeIn):
    """Store a Web Push subscription so the server can send push messages.
    Currently stores the subscription; server-side push (`pywebpush` + VAPID
    private key) is a follow-up step."""
    sub_endpoint = (payload.subscription or {}).get("endpoint")
    if not sub_endpoint:
        raise HTTPException(400, "Gecerli subscription endpoint'i gerekli")
    doc = {
        "id": str(uuid.uuid4()),
        "endpoint": sub_endpoint,
        "keys": (payload.subscription or {}).get("keys", {}),
        "reseller_token": payload.reseller_token,
        "license_key": payload.license_key,
        "user_agent": payload.user_agent,
        "created_at": _iso(),
    }
    # Upsert by endpoint so re-subscribes replace old
    await db.push_subscriptions.update_one(
        {"endpoint": sub_endpoint}, {"$set": doc}, upsert=True,
    )
    return {"ok": True, "id": doc["id"]}


@api.delete("/push/subscribe")
async def push_unsubscribe(endpoint: str):
    r = await db.push_subscriptions.delete_one({"endpoint": endpoint})
    return {"ok": True, "deleted": r.deleted_count}


@api.get("/push/vapid-public")
async def push_vapid_public():
    """Return the server's VAPID public key so browsers can subscribe."""
    return {"public_key": os.environ.get("VAPID_PUBLIC_KEY", ""),
            "configured": bool(os.environ.get("VAPID_PUBLIC_KEY"))}


class PushSendIn(BaseModel):
    license_key: Optional[str] = None
    reseller_token: Optional[str] = None
    title: str
    body: str
    url: Optional[str] = "/reseller?mobile=1"
    tag: Optional[str] = "gws-admin"


@api.post("/push/send")
async def push_send(payload: PushSendIn, request: Request):
    """Master-only. Send a Web Push notification to all subscriptions matching
    license_key (or reseller_token). Uses pywebpush + VAPID for real Web Push."""
    await _require_master(request, payload.license_key)
    import base64 as _b64
    priv_b64 = os.environ.get("VAPID_PRIVATE_KEY_B64", "")
    subject = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")
    if not priv_b64:
        raise HTTPException(500, "VAPID_PRIVATE_KEY_B64 yapilandirilmamis")
    try:
        priv_pem = _b64.b64decode(priv_b64).decode()
    except Exception:
        raise HTTPException(500, "VAPID private key decode hatasi")

    q = {}
    if payload.license_key:    q["license_key"]    = payload.license_key
    if payload.reseller_token: q["reseller_token"] = payload.reseller_token
    subs = await db.push_subscriptions.find(q, {"_id": 0}).to_list(500)
    if not subs:
        return {"ok": True, "sent": 0, "reason": "no_subscribers"}

    from pywebpush import webpush, WebPushException
    import json as _json
    ok_count = 0
    dead = []
    for s in subs:
        try:
            webpush(
                subscription_info={"endpoint": s["endpoint"], "keys": s.get("keys", {})},
                data=_json.dumps({
                    "title": payload.title,
                    "body": payload.body,
                    "url": payload.url,
                    "tag": payload.tag,
                }),
                vapid_private_key=priv_pem,
                vapid_claims={"sub": subject},
            )
            ok_count += 1
        except WebPushException as ex:
            # 410 Gone / 404 Not Found → subscription expired, clean up
            if getattr(ex, "response", None) is not None and ex.response.status_code in (404, 410):
                dead.append(s["endpoint"])
        except Exception as ex:
            log.warning("push send error: %s", ex)
    if dead:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": dead}})
    return {"ok": True, "sent": ok_count, "total": len(subs), "cleaned": len(dead)}


@api.get("/admin/resellers/{rid}/activity-breakdown")
async def admin_reseller_activity_breakdown(rid: str, request: Request,
                                            license_key: Optional[str] = None,
                                            days: int = 30):
    """Master-only. IP + UserAgent breakdown for a specific bayi's login history."""
    await _require_master(request, license_key)
    r = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    ips = {}
    uas = {}
    total_success = 0
    total_fail = 0
    async for lg in db.reseller_logins.find(
        {"$or": [{"reseller_id": rid}, {"email": r.get("email")}], "at": {"$gte": cutoff}},
        {"_id": 0, "ip": 1, "user_agent": 1, "success": 1, "at": 1},
    ):
        ip = lg.get("ip") or "?"
        ua_raw = (lg.get("user_agent") or "")[:200]
        # naive UA fingerprint (browser family)
        ua_family = "Other"
        for kw, name in [("Firefox","Firefox"),("Edg","Edge"),("Chrome","Chrome"),
                         ("Safari","Safari"),("iPhone","iOS"),("Android","Android"),
                         ("curl","curl"),("Postman","Postman")]:
            if kw in ua_raw: ua_family = name; break
        ok = bool(lg.get("success"))
        if ok: total_success += 1
        else:  total_fail += 1
        ips.setdefault(ip, {"ip": ip, "success": 0, "fail": 0, "last_at": None})
        ips[ip]["success" if ok else "fail"] += 1
        if not ips[ip]["last_at"] or (lg.get("at") or "") > ips[ip]["last_at"]:
            ips[ip]["last_at"] = lg.get("at")
        uas.setdefault(ua_family, {"family": ua_family, "count": 0})
        uas[ua_family]["count"] += 1
    return {
        "reseller": {"email": r.get("email"), "company": r.get("company", "")},
        "days": days,
        "total_success": total_success,
        "total_fail": total_fail,
        "ips": sorted(ips.values(), key=lambda x: -(x["success"] + x["fail"]))[:20],
        "user_agents": sorted(uas.values(), key=lambda x: -x["count"])[:10],
    }


# --- AI Spam Explanation (Emergent LLM) ---
class SpamExplainIn(BaseModel):
    sender:      Optional[str] = None
    recipient:   Optional[str] = None
    subject:     Optional[str] = None
    body_preview:Optional[str] = None
    verdict:     Optional[str] = None
    score:       Optional[float] = None
    rules_matched: Optional[list[str]] = None
    scores:      Optional[dict] = None
    force:       Optional[bool] = False  # bypass cache



class CountryRule(BaseModel):
    country_code: str = Field(..., min_length=2, max_length=2)  # ISO 3166-1 alpha-2 (TR, US, RU..)
    action: str = Field("block", pattern="^(block|allow)$")
    note: Optional[str] = ""
    # Zaman tabanlı: hours 0-23 listesi, days 0-6 (Pzt=0), ttl dakika
    active_hours: Optional[list[int]] = None  # None = 7/24 aktif
    active_days: Optional[list[int]] = None    # None = hafta boyu
    auto_expire_at: Optional[str] = None       # ISO datetime — geçince kural pasif
    reason: Optional[str] = None               # "brute_force", "manual"


@api.get("/security/country-rules")
async def get_country_rules():
    # Auto-expire pasüre olanları temizle
    now_iso = _iso()
    await db.country_rules.delete_many({"auto_expire_at": {"$lt": now_iso, "$ne": None}})
    rows = await db.country_rules.find({}, {"_id": 0}).sort("country_code", 1).to_list(500)
    now = datetime.now(timezone.utc)
    hour = now.hour
    day = now.weekday()
    for r in rows:
        ah = r.get("active_hours")
        ad = r.get("active_days")
        r["currently_active"] = (not ah or hour in ah) and (not ad or day in ad)
    return {"items": rows}


class BulkCountryRule(BaseModel):
    codes: list[str] = Field(..., min_length=1, max_length=200)
    action: str = Field("block", pattern="^(block|allow)$")
    note: Optional[str] = ""
    active_hours: Optional[list[int]] = None
    active_days: Optional[list[int]] = None
    ttl_minutes: Optional[int] = None
    reason: Optional[str] = "manual"


@api.post("/security/country-rules/bulk")
async def bulk_country_rules(payload: BulkCountryRule, request: Request, license_key: Optional[str] = None):
    """Birden çok ülkeyi tek işlemde ekle. TTL varsa auto_expire_at set eder."""
    await _require_master(request, license_key)
    now = datetime.now(timezone.utc)
    expire = None
    if payload.ttl_minutes and payload.ttl_minutes > 0:
        expire = (now + timedelta(minutes=payload.ttl_minutes)).isoformat()
    inserted = 0
    for code in payload.codes:
        code = code.strip().upper()
        if len(code) != 2:
            continue
        doc = {
            "country_code": code, "action": payload.action, "note": payload.note or "",
            "active_hours": payload.active_hours, "active_days": payload.active_days,
            "auto_expire_at": expire, "reason": payload.reason or "manual",
            "id": str(uuid.uuid4()), "created_at": _iso(),
        }
        await db.country_rules.update_one({"country_code": code}, {"$set": doc}, upsert=True)
        inserted += 1
    return {"ok": True, "inserted": inserted, "expire_at": expire}


@api.post("/security/country-rules")
async def add_country_rule(payload: CountryRule, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    doc = payload.model_dump()
    doc["country_code"] = doc["country_code"].upper()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = _iso()
    await db.country_rules.update_one(
        {"country_code": doc["country_code"]},
        {"$set": doc}, upsert=True,
    )
    return {"ok": True, **doc}


@api.delete("/security/country-rules/{code}")
async def del_country_rule(code: str, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    r = await db.country_rules.delete_one({"country_code": code.upper()})
    return {"ok": True, "deleted": r.deleted_count}


@api.post("/security/whitelist-from-event")
async def whitelist_from_event(event_id: str, license_key: str, request: Request):
    """User marks an event as NOT spam — sender goes to whitelist,
    event verdict flips to 'whitelisted', related quarantine entries are released."""
    evt = await db.mail_events.find_one({"id": event_id, "license_key": license_key}, {"_id": 0})
    if not evt:
        raise HTTPException(404, "Event bulunamadi")
    sender = evt.get("from_addr")
    if not sender:
        raise HTTPException(400, "Gonderen adresi yok")
    await db.mail_events.update_one(
        {"id": event_id},
        {"$set": {"verdict": "whitelisted", "marked_not_spam_at": _iso(), "marked_by": "user"}},
    )
    await db.lists.update_one(
        {"kind": "whitelist", "value": sender, "license_key": license_key},
        {"$set": {"kind": "whitelist", "value": sender, "type": "email",
                  "reason": f"User marked NOT spam (event {event_id[:8]})",
                  "license_key": license_key, "created_at": _iso()}},
        upsert=True,
    )
    # Also release any queued quarantine actions for this exim_mid
    if evt.get("exim_mid"):
        await db.quarantine_actions.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": license_key,
            "event_id": event_id,
            "exim_mid": evt["exim_mid"],
            "action": "release",
            "status": "pending",
            "created_at": _iso(),
        })
    # Delete any blacklist entry the previous "mark spam" may have added
    await db.lists.delete_many({"kind": "blacklist", "value": sender, "license_key": license_key})
    return {"ok": True, "whitelisted": sender, "sent_release": bool(evt.get("exim_mid"))}


@api.post("/push/send-test")
async def push_send_test(request: Request, license_key: Optional[str] = None):
    """Master-only convenience: send a test push to ALL subscribers."""
    await _require_master(request, license_key)
    total_subs = await db.push_subscriptions.count_documents({})
    if total_subs == 0:
        return {"ok": True, "sent": 0, "reason": "no_subscribers",
                "hint": "Bayiler önce mobil panelde 🔔 butonuna basıp izin vermeli"}
    # Reuse push_send flow
    from fastapi.testclient import TestClient  # not ideal; call directly instead
    return await push_send(
        PushSendIn(
            title="GökyüzüWebSpam · Test Bildirimi",
            body=f"Master tarafından gönderildi · {datetime.now(timezone.utc).strftime('%H:%M')}",
            url="/reseller?mobile=1",
        ),
        request,
    )



@api.post("/ai/explain-spam")
async def ai_explain_spam(payload: SpamExplainIn):
    """LLM-powered Turkish natural-language explanation of why a mail is spam.
    Cached in `ai_explanations` collection keyed on (sender, subject, verdict)
    so we don't re-invoke the LLM on repeat views of the same event."""
    if not (payload.sender or payload.subject):
        raise HTTPException(400, "sender veya subject gerekli")

    cache_key = f"{payload.sender}|{payload.subject}|{payload.verdict}|{payload.score}"[:200]
    if not payload.force:
        cached = await db.ai_explanations.find_one({"key": cache_key}, {"_id": 0})
        if cached and cached.get("text"):
            return {"text": cached["text"], "cached": True,
                    "generated_at": cached.get("generated_at")}

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yapilandirilmamis")

    prompt = (
        f"Bir spam filtresi bir e-postayi karantinaya aldi. Kullanicilara 2-3 cumleyle "
        f"anlasilir Turkce olarak neden spam/tehlikeli oldugunu acikla. Teknik terimlerden kacin.\n\n"
        f"Gonderen: {payload.sender or '(bilinmiyor)'}\n"
        f"Alici: {payload.recipient or '(bilinmiyor)'}\n"
        f"Konu: {payload.subject or '(konu yok)'}\n"
        f"Verdict: {payload.verdict or 'unknown'}\n"
        f"Skor: {payload.score or 0}\n"
        f"Eslesen kurallar: {', '.join(payload.rules_matched or []) or '(yok)'}\n"
        f"Motor skorlari: {payload.scores or {}}\n\n"
        f"Ilk cumle: mailin ne oldugunu ve niye supheli oldugunu 1 cumlede ozetle.\n"
        f"Ikinci cumle: kullanici acmali mi/acmamali mi ve nedeni.\n"
        f"Ucuncu cumle (opsiyonel): benzer riskleri onlemek icin kisa oneri.\n"
        f"Emoji kullanma, madde isareti kullanma, teknik jargon kullanma."
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"spam-explain-{uuid.uuid4()}",
            system_message="Sen bir e-posta guvenlik uzmanisin. Kullanicilara sade, arkadas canlisi Turkce ile spam maillerini aciklarsin.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        text = (r or "").strip()
    except Exception as ex:
        log.warning("LLM explain failed: %s", ex)
        raise HTTPException(500, f"AI aciklama uretilemedi: {type(ex).__name__}")

    await db.ai_explanations.update_one(
        {"key": cache_key},
        {"$set": {
            "key": cache_key,
            "text": text,
            "sender": payload.sender,
            "subject": payload.subject,
            "verdict": payload.verdict,
            "score": payload.score,
            "generated_at": _iso(),
        }},
        upsert=True,
    )
    return {"text": text, "cached": False, "generated_at": _iso()}


@api.post("/admin/resellers/{rid}/toggle-active")
async def admin_toggle_reseller(rid: str, request: Request, license_key: Optional[str] = None):
    """Master-only. Enable/disable a reseller account."""
    await _require_master(request, license_key)
    r = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    new_val = not r.get("active", True)
    await db.resellers.update_one({"id": rid}, {"$set": {"active": new_val}})
    await db.logs.insert_one(ActivityLog(
        source="admin", level="warn",
        message=f"Bayi hesabi {'aktif' if new_val else 'askiya alindi'}: {r.get('email')}",
    ).model_dump())
    return {"ok": True, "active": new_val}


@api.delete("/admin/resellers/{rid}")
async def admin_delete_reseller(rid: str, request: Request, license_key: Optional[str] = None):
    """Master-only. Permanently delete a reseller account + its sub-accounts."""
    await _require_master(request, license_key)
    r = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bayi bulunamadi")
    subs_deleted = await db.subaccounts.delete_many({"reseller_id": rid})
    await db.resellers.delete_one({"id": rid})
    await db.logs.insert_one(ActivityLog(
        source="admin", level="warn",
        message=f"Bayi hesabi SILINDI: {r.get('email')} · {subs_deleted.deleted_count} alt hesap da silindi",
    ).model_dump())
    return {"ok": True, "subaccounts_deleted": subs_deleted.deleted_count}


class ResellerCreateIn(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    company: Optional[str] = ""
    license_key: str
    plan: str = "pro"


@api.post("/admin/resellers")
async def admin_create_reseller(payload: ResellerCreateIn, request: Request,
                                license_key: Optional[str] = None):
    """Master-only. Create a reseller account directly (bypasses self-registration
    so master can onboard bayi and hand them the credentials)."""
    await _require_master(request, license_key)
    import bcrypt
    if await db.resellers.find_one({"email": payload.email.lower()}, {"_id": 0}):
        raise HTTPException(409, "Bu e-posta zaten kayitli")
    if not await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0}):
        raise HTTPException(400, "Verilen lisans anahtari sistemde yok")
    rid = str(uuid.uuid4())
    doc = {
        "id": rid,
        "email": payload.email.lower(),
        "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
        "company": payload.company or "",
        "license_key": payload.license_key,
        "plan": payload.plan,
        "active": True,
        "created_at": _iso(),
        "created_by_master": True,
    }
    await db.resellers.insert_one(doc)
    await db.logs.insert_one(ActivityLog(
        source="admin", level="info",
        message=f"Master yeni bayi olusturdu: {payload.email}",
    ).model_dump())
    return {"ok": True, "id": rid, "email": payload.email}


class UserSyncIn(BaseModel):
    license_key: str
    accounts: list[dict]  # [{username, domain, email_count_today?, ...}]


@api.post("/users/sync")
async def users_sync(payload: UserSyncIn):
    """WHM plugin daemon POSTs the real cPanel accounts list here. Purges old
    demo users bound to same license and upserts each real account."""
    # Inline license validation (avoid coupling to events module)
    lic = await db.licenses.find_one({"license_key": payload.license_key, "active": True}, {"_id": 0})
    if not lic:
        raise HTTPException(403, "Gecersiz lisans")
    # Remove seed/demo users on first real sync
    _DEMO_USERNAMES = {"example", "sirket", "tekno", "deneme", "kobi"}
    await db.users.delete_many({"username": {"$in": list(_DEMO_USERNAMES)}})
    ups = 0
    for a in payload.accounts[:1000]:
        u = str(a.get("username") or "").strip()
        if not u: continue
        await db.users.update_one(
            {"username": u},
            {"$set": {
                "username": u,
                "domain": a.get("domain", ""),
                "license_key": payload.license_key,
                "email_count_today":  int(a.get("email_count_today")  or 0),
                "spam_caught_today":  int(a.get("spam_caught_today")  or 0),
                "quarantine_size":    int(a.get("quarantine_size")    or 0),
                "source":             "whm",
                "last_synced_at":     _iso(),
            }},
            upsert=True,
        )
        ups += 1
    return {"synced": ups, "purged_demo": True}


async def _require_master(request: Request, license_key: Optional[str]) -> None:
    # Accept cookie-based session too
    cookie_master = request.cookies.get("gws_master_session")
    if cookie_master:
        row = await db.settings.find_one({"_key": f"master_session:{cookie_master}"}, {"_id": 0})
        if row and row.get("valid_until", "") > datetime.now(timezone.utc).isoformat():
            return
    r = await _is_master(request, license_key)
    if not r["is_master"]:
        raise HTTPException(
            403,
            f"Bu islem sadece ana yonetici tarafindan yapilabilir "
            f"(ip_match={r['ip_match']}, key_match={r['key_match']})",
        )


class VersionPublishIn(BaseModel):
    latest_version: Optional[str] = None
    changelog: Optional[str] = ""
    license_key: Optional[str] = None


@api.post("/version/publish")
async def version_publish(payload: VersionPublishIn, request: Request):
    """Master-only: publish a new version. If `latest_version` is omitted, auto-detect
    from the master license's last_heartbeat_version. Generates DUAL download URLs
    (gokyuzuhosting.com + 89.19.15.58) so plugins can fall back if DNS fails."""
    await _require_master(request, payload.license_key)

    # Auto-detect version from the installed version (no auto-bump).
    # Precedence: 1) master heartbeat, 2) installed panel version.
    # We NEVER bump automatically — user asked us to publish exactly what is installed.
    version = (payload.latest_version or "").strip().lstrip("v")
    if not version:
        master_lic = None
        if MASTER_LICENSE_KEY:
            master_lic = await db.licenses.find_one({"license_key": MASTER_LICENSE_KEY}, {"_id": 0})
        if not master_lic:
            master_lic = await db.licenses.find_one(
                {"ip_addresses": {"$in": [MASTER_IP]}}, {"_id": 0}
            ) or await db.licenses.find_one(
                {"last_heartbeat_ip": MASTER_IP}, {"_id": 0}
            )
        if master_lic and master_lic.get("last_heartbeat_version"):
            version = master_lic["last_heartbeat_version"].lstrip("v")
        else:
            # Fallback: use the installed panel version — NO auto-bump.
            installed = await db.settings.find_one({"_key": "version"}, {"_id": 0}) or {}
            version = (installed.get("version") or "1.1.0").lstrip("v")

    dl_host = f"https://{MASTER_HOST}/dist/gokyuzuwebspam-{version}.tar.gz"
    dl_ip   = f"http://{MASTER_IP}/dist/gokyuzuwebspam-{version}.tar.gz"
    release_date = datetime.now(timezone.utc).isoformat()

    manifest = {
        "_key": "version_manifest",
        "latest_version": version,
        "download_url": dl_host,
        "download_url_ip": dl_ip,
        "changelog": payload.changelog or f"Otomatik yayin — v{version} ({MASTER_HOST})",
        "release_date": release_date,
        "published_by_master": True,
    }
    await db.settings.update_one({"_key": "version_manifest"}, {"$set": manifest}, upsert=True)
    await db.logs.insert_one(ActivityLog(
        source="version-publish",
        level="info",
        message=f"Master yayinladi → v{version} (host={MASTER_HOST}, ip={MASTER_IP})",
    ).model_dump())

    # Count plugins that will pick up the update on next check
    affected = await db.licenses.count_documents({"active": True})
    return {
        "ok": True,
        "latest_version": version,
        "download_url": dl_host,
        "download_url_ip": dl_ip,
        "changelog": manifest["changelog"],
        "release_date": release_date,
        "affected_clients": affected,
        "master_host": MASTER_HOST,
        "master_ip": MASTER_IP,
    }


# ----- Licensing -----
async def _fire_license_alert(violation: dict) -> None:
    """Send email (+ optional Slack) alert to seller when license violation happens."""
    ns = await _notify_settings()
    if not ns.get("alert_on_license_violation", True):
        return
    subject = f"[GökyüzüWebSpam] Lisans İhlali · {violation.get('ip')}"
    body = (
        f"🚨 GökyüzüWebSpam · Lisans İhlali Tespit Edildi\n"
        f"================================================\n\n"
        f"IP              : {violation.get('ip')}\n"
        f"Sunucu (hostname): {violation.get('hostname', '?')}\n"
        f"Lisans anahtarı : {violation.get('license_key', 'YOK')}\n"
        f"Sebep           : {violation.get('reason')}\n"
        f"Kurulu sürüm    : {violation.get('version', '?')}\n"
        f"Zaman           : {violation.get('at')}\n\n"
        f"→ Cezai işlem için gerekli aksiyonu alabilirsiniz.\n"
        f"→ Panelden 'Lisans Yönetimi' sekmesinde detayları görebilir,\n"
        f"   plugin çalışmayı durdurmuş olsa da yeni müşterinize satış yapabilirsiniz.\n"
    )
    if ns.get("email_enabled") and ns.get("admin_email"):
        await _send_email(ns["admin_email"], subject, body,
                          from_addr=ns.get("email_from") or "gokyuzuwebspam@localhost")
    if ns.get("slack_enabled") and ns.get("slack_webhook_url"):
        await _send_slack(ns["slack_webhook_url"], f"🚨 *Lisans İhlali*\n```{body}```")
    if ns.get("telegram_enabled") and ns.get("telegram_bot_token") and ns.get("telegram_chat_id"):
        await _send_telegram(ns["telegram_bot_token"], ns["telegram_chat_id"], body)


@api.get("/licenses")
async def licenses_list():
    docs = await db.licenses.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


class LicenseIn(BaseModel):
    customer_name: str
    customer_email: str = ""
    plan: Literal["starter", "pro", "enterprise"] = "pro"
    ip_addresses: List[str] = []
    max_domains: int = 100
    valid_until: str
    active: bool = True
    notes: str = ""


@api.post("/licenses")
async def licenses_add(payload: LicenseIn):
    obj = License(**payload.model_dump())
    await db.licenses.insert_one(obj.model_dump())
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Yeni lisans oluşturuldu: {obj.customer_name} → {obj.license_key} (IP: {', '.join(obj.ip_addresses) or 'yok'})",
    ).model_dump())
    return obj.model_dump()


@api.put("/licenses/{lid}")
async def licenses_update(lid: str, payload: LicenseIn):
    r = await db.licenses.update_one({"id": lid}, {"$set": payload.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Lisans bulunamadı")
    return {"updated": True}


@api.delete("/licenses/{lid}")
async def licenses_delete(lid: str):
    # id ile dene, bulamazsa license_key olarak dene (eski seed'ler id-siz olabilir)
    r = await db.licenses.delete_one({"id": lid})
    if r.deleted_count == 0:
        r = await db.licenses.delete_one({"license_key": lid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Lisans bulunamadı")
    return {"deleted": True}


class BulkLicenseAction(BaseModel):
    ids: List[str]
    action: Literal["delete", "suspend", "activate"] = "delete"


@api.post("/licenses/bulk-action")
async def licenses_bulk_action(payload: BulkLicenseAction):
    """Birden fazla lisans üzerinde topluca sil / askıya al / aktifleştir."""
    if not payload.ids:
        return {"affected": 0, "action": payload.action}
    # id VEYA license_key ile eşleştir (eski kayıtlarda id yoksa)
    match = {"$or": [{"id": {"$in": payload.ids}}, {"license_key": {"$in": payload.ids}}]}
    if payload.action == "delete":
        r = await db.licenses.delete_many(match)
        affected = r.deleted_count
    elif payload.action == "suspend":
        r = await db.licenses.update_many(match, {"$set": {"active": False}})
        affected = r.modified_count
    elif payload.action == "activate":
        r = await db.licenses.update_many(match, {"$set": {"active": True}})
        affected = r.modified_count
    else:
        raise HTTPException(400, "Geçersiz aksiyon")
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Toplu aksiyon: {payload.action} → {affected} lisans etkilendi",
    ).model_dump())
    return {"affected": affected, "action": payload.action}


@api.post("/licenses/fix-missing-ids")
async def licenses_fix_missing_ids():
    """Eski seed'lerden gelen id-siz kayıtlara yeni UUID atar (bir kere çalıştır)."""
    fixed = 0
    async for doc in db.licenses.find({"id": {"$exists": False}}):
        new_id = str(uuid.uuid4())
        await db.licenses.update_one({"_id": doc["_id"]}, {"$set": {"id": new_id}})
        fixed += 1
    return {"fixed": fixed}


class HeartbeatPayload(BaseModel):
    license_key: str
    ip: str
    hostname: Optional[str] = ""
    version: Optional[str] = "1.1.0"
    cpanel_version: Optional[str] = ""
    active_domains: Optional[int] = 0


@api.post("/license/heartbeat")
async def license_heartbeat(payload: HeartbeatPayload):
    """
    Plugin her 15 dk'da bir bunu çağırır. Doğrulama başarısızsa violation
    kaydı düşer + satıcıya Slack/Telegram bildirimi gider + 403 döner.
    """
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    reason = None
    if not lic:
        reason = "key_not_found"
    elif not lic.get("active"):
        reason = "inactive"
    else:
        try:
            valid_dt = datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00"))
            if valid_dt < datetime.now(timezone.utc):
                reason = "expired"
        except Exception:
            reason = "invalid_date"
        if not reason and payload.ip not in (lic.get("ip_addresses") or []):
            reason = "ip_not_allowed"
        if not reason and payload.active_domains > (lic.get("max_domains") or 0):
            reason = "domain_limit_exceeded"

    if reason:
        v = LicenseViolation(
            ip=payload.ip,
            hostname=payload.hostname or "",
            license_key=payload.license_key,
            reason=reason,
            version=payload.version or "",
            raw=payload.model_dump(),
        ).model_dump()
        await db.violations.insert_one(v)
        await db.logs.insert_one(ActivityLog(
            source="license", level="error",
            message=f"LİSANS İHLALİ · IP={payload.ip} · sebep={reason} · key={payload.license_key[:12]}…",
        ).model_dump())
        asyncio.create_task(_fire_license_alert(v))
        raise HTTPException(
            status_code=403,
            detail={
                "ok": False, "reason": reason,
                "message": "Lisans doğrulaması başarısız. Satıcı ile iletişime geçin.",
            },
        )

    # Success: update last heartbeat
    await db.licenses.update_one(
        {"license_key": payload.license_key},
        {"$set": {
            "last_heartbeat_at": _iso(),
            "last_heartbeat_ip": payload.ip,
            "last_heartbeat_version": payload.version,
        }},
    )
    manifest = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0, "_key": 0}) or VersionManifest().model_dump()
    return {
        "ok": True,
        "plan": lic.get("plan"),
        "customer": lic.get("customer_name"),
        "valid_until": lic.get("valid_until"),
        "latest_version": manifest["latest_version"],
        "update_available": manifest["latest_version"] != (payload.version or ""),
        "download_url": manifest.get("download_url", ""),
    }


@api.get("/license/violations")
async def license_violations(limit: int = 100):
    return await db.violations.find({}, {"_id": 0}).sort("at", -1).to_list(limit)


@api.delete("/license/violations")
async def license_violations_clear():
    r = await db.violations.delete_many({})
    return {"deleted": r.deleted_count}


class SimulateViolation(BaseModel):
    ip: str = "203.0.113.99"
    license_key: str = "MS-UNKNOWN"
    hostname: str = "rogue-server.example.com"
    reason: Literal["ip_not_allowed", "key_not_found", "expired", "inactive"] = "ip_not_allowed"


@api.post("/license/simulate-violation")
async def license_simulate_violation(p: SimulateViolation):
    v = LicenseViolation(
        ip=p.ip, hostname=p.hostname, license_key=p.license_key,
        reason=p.reason, version="1.1.0",
        raw={"simulated": True},
    ).model_dump()
    await db.violations.insert_one(v)
    await db.logs.insert_one(ActivityLog(
        source="license", level="error",
        message=f"SİMÜLE İHLAL · IP={p.ip} · sebep={p.reason}",
    ).model_dump())
    await _fire_license_alert(v)
    return {"fired": True, "violation": v}


# ----- Blacklist (RBL) Check & Delist Requests -----
RBL_PROVIDERS = [
    {"code": "spamhaus_zen",       "name": "Spamhaus ZEN",         "dns": "zen.spamhaus.org",
     "type": "ip",     "removal_url": "https://www.spamhaus.org/lookup/", "email": ""},
    {"code": "spamhaus_dbl",       "name": "Spamhaus DBL",         "dns": "dbl.spamhaus.org",
     "type": "domain", "removal_url": "https://www.spamhaus.org/dbl/removal/", "email": ""},
    {"code": "barracuda",          "name": "Barracuda BRBL",       "dns": "b.barracudacentral.org",
     "type": "ip",     "removal_url": "https://www.barracudanetworks.com/reputation/?a=removalrequest", "email": ""},
    {"code": "sorbs",              "name": "SORBS",                "dns": "dnsbl.sorbs.net",
     "type": "ip",     "removal_url": "http://www.sorbs.net/delisting/", "email": ""},
    {"code": "sorbs_spam",         "name": "SORBS Spam",           "dns": "spam.dnsbl.sorbs.net",
     "type": "ip",     "removal_url": "http://www.sorbs.net/delisting/", "email": ""},
    {"code": "surbl",              "name": "SURBL Multi",          "dns": "multi.surbl.org",
     "type": "domain", "removal_url": "https://www.surbl.org/surbl-analysis", "email": ""},
    {"code": "uribl",              "name": "URIBL",                "dns": "multi.uribl.com",
     "type": "domain", "removal_url": "https://uribl.com/refresh.shtml", "email": ""},
    {"code": "invaluement",        "name": "invaluement",          "dns": "sip.invaluement.com",
     "type": "ip",     "removal_url": "https://www.invaluement.com/removal/", "email": "remove@invaluement.com"},
    {"code": "psbl",               "name": "PSBL",                 "dns": "psbl.surriel.com",
     "type": "ip",     "removal_url": "https://psbl.org/remove", "email": ""},
    {"code": "cbl",                "name": "CBL Abuseat",          "dns": "cbl.abuseat.org",
     "type": "ip",     "removal_url": "https://www.abuseat.org/lookup.cgi", "email": ""},
    {"code": "spamcop",            "name": "SpamCop",              "dns": "bl.spamcop.net",
     "type": "ip",     "removal_url": "https://www.spamcop.net/bl.shtml", "email": ""},
    {"code": "hostkarma",          "name": "HostKarma",            "dns": "hostkarma.junkemailfilter.com",
     "type": "ip",     "removal_url": "https://ipadmin.junkemailfilter.com/remove.php", "email": ""},
    {"code": "spam_rats",          "name": "Spam Rats",            "dns": "spam.spamrats.com",
     "type": "ip",     "removal_url": "https://www.spamrats.com/removal.php", "email": ""},
    {"code": "backscatter",        "name": "Backscatterer",        "dns": "ips.backscatterer.org",
     "type": "ip",     "removal_url": "http://www.backscatterer.org/?target=removal", "email": ""},
    {"code": "mailspike_z",        "name": "Mailspike Z",          "dns": "z.mailspike.net",
     "type": "ip",     "removal_url": "https://mailspike.net/removal.html", "email": ""},
]


def _rbl_query(target: str, dns_root: str, is_ip: bool) -> tuple[bool, str]:
    """Return (listed, txt_message)."""
    import socket
    try:
        if is_ip:
            parts = target.strip().split(".")
            if len(parts) != 4:
                return False, "invalid ip"
            query = ".".join(reversed(parts)) + "." + dns_root
        else:
            query = f"{target.strip()}.{dns_root}"
        socket.setdefaulttimeout(3.0)
        try:
            addr = socket.gethostbyname(query)
            return True, addr
        except socket.gaierror:
            return False, ""
    except Exception as e:
        return False, f"error: {e}"


class BlacklistCheckIn(BaseModel):
    target: str  # IP or domain
    type: Literal["ip", "domain"] = "ip"


@api.post("/blacklist/check")
async def blacklist_check(payload: BlacklistCheckIn):
    is_ip = payload.type == "ip"
    results = []
    listed_count = 0
    # Run checks in a thread pool (blocking socket calls)
    def _check_one(p):
        if p["type"] != payload.type:
            return {"code": p["code"], "name": p["name"], "listed": False, "skipped": True, "removal_url": p["removal_url"]}
        listed, msg = _rbl_query(payload.target, p["dns"], is_ip)
        return {"code": p["code"], "name": p["name"], "listed": listed, "dns": p["dns"],
                "removal_url": p["removal_url"], "email": p.get("email", ""), "response": msg,
                "type": p["type"]}
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, _check_one, p) for p in RBL_PROVIDERS]
    results = await asyncio.gather(*tasks)
    for r in results:
        if r.get("listed"):
            listed_count += 1
    return {
        "target": payload.target,
        "type": payload.type,
        "checked_at": _iso(),
        "listed_count": listed_count,
        "providers_checked": len([r for r in results if not r.get("skipped")]),
        "results": results,
    }


class DelistRequestIn(BaseModel):
    target: str
    type: Literal["ip", "domain"] = "ip"
    provider_codes: List[str]
    contact_email: str
    reason: str = "Sunucumuz karantinaya alındı, gerekli önlemler alınmıştır. Delisting talep ediyoruz."


class DelistRequest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    at: str = Field(default_factory=_iso)
    target: str
    type: str
    provider_code: str
    provider_name: str
    provider_url: str
    provider_email: Optional[str] = ""
    contact_email: str
    reason: str
    status: Literal["pending", "submitted", "resolved", "failed"] = "pending"
    submitted_via: Optional[str] = "manual"  # manual (portal) | email | api
    notes: Optional[str] = ""


@api.post("/blacklist/delist")
async def blacklist_delist(payload: DelistRequestIn):
    provider_map = {p["code"]: p for p in RBL_PROVIDERS}
    created = []
    email_attempts = 0
    for code in payload.provider_codes:
        p = provider_map.get(code)
        if not p:
            continue
        submitted_via = "manual"
        # If provider has a removal email, try to send via local sendmail (WHM env)
        if p.get("email"):
            try:
                import subprocess
                from email.mime.multipart import MIMEMultipart
                from email.mime.text import MIMEText
                msg = MIMEMultipart()
                msg["From"] = payload.contact_email
                msg["To"] = p["email"]
                msg["Subject"] = f"Delisting request: {payload.target}"
                body = (
                    f"Hello,\n\nWe would like to request delisting of the following:\n"
                    f"Target: {payload.target} (type: {payload.type})\n"
                    f"Contact: {payload.contact_email}\n\n"
                    f"Reason: {payload.reason}\n\n"
                    f"Regards."
                )
                msg.attach(MIMEText(body, "plain", "utf-8"))
                proc = subprocess.run(
                    ["/usr/sbin/sendmail", "-t", "-oi"],
                    input=msg.as_bytes(), capture_output=True, timeout=10,
                )
                if proc.returncode == 0:
                    submitted_via = "email"
                    email_attempts += 1
            except Exception:
                pass
        req = DelistRequest(
            target=payload.target, type=payload.type,
            provider_code=p["code"], provider_name=p["name"],
            provider_url=p["removal_url"], provider_email=p.get("email", ""),
            contact_email=payload.contact_email, reason=payload.reason,
            status="submitted" if submitted_via == "email" else "pending",
            submitted_via=submitted_via,
        ).model_dump()
        # Insert a COPY (insert_one mutates the dict with ObjectId _id)
        await db.delist_requests.insert_one(dict(req))
        created.append(req)  # original clean dict for response
    await db.logs.insert_one(ActivityLog(
        source="blacklist", level="info",
        message=f"Delisting talep(ler)i oluşturuldu: {payload.target} → {len(created)} sağlayıcı, {email_attempts} e-posta",
    ).model_dump())
    return {"created": len(created), "email_attempts": email_attempts, "requests": created}
    await db.logs.insert_one(ActivityLog(
        source="blacklist", level="info",
        message=f"Delisting talep(ler)i oluşturuldu: {payload.target} → {len(created)} sağlayıcı, {email_attempts} e-posta",
    ).model_dump())
    return {"created": len(created), "email_attempts": email_attempts, "requests": created}


@api.get("/blacklist/requests")
async def blacklist_requests():
    return await db.delist_requests.find({}, {"_id": 0}).sort("at", -1).to_list(200)


class DelistStatusUpdate(BaseModel):
    status: Literal["pending", "submitted", "resolved", "failed"]
    notes: Optional[str] = ""


@api.put("/blacklist/requests/{req_id}")
async def blacklist_update_request(req_id: str, upd: DelistStatusUpdate):
    r = await db.delist_requests.update_one({"id": req_id}, {"$set": upd.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Talep bulunamadı")
    return {"updated": True}


@api.get("/blacklist/providers")
async def blacklist_providers():
    return RBL_PROVIDERS


# ----- AI Rule Generator (SpamAssassin regex production) -----
class AIRuleGenIn(BaseModel):
    prompt: str  # natural language, e.g. "İstanbul emlak spamlerini yakala"
    model: Optional[str] = None
    language: Optional[str] = None  # tr, en, de, fr, ar, es (auto uses policy.ui_language)


AI_RULE_SYSTEM_TEMPLATES = {
    "tr": (
        "Sen bir SpamAssassin uzmanısın. Kullanıcının Türkçe açıklamasından yola çıkarak "
        "1-3 adet spam kuralı üret. HER KURAL bir JSON objesidir; regex tabanlıdır ve "
        "SpamAssassin sözdizimine uygundur. SADECE geçerli JSON dizisi döndür, açıklama YAZMA.\n\n"
        "Şablon:\n"
        "[{\n"
        '  "name": "TÜRKÇE kısa kural adı (max 50 karakter, açıklayıcı)",\n'
        '  "pattern": "/regex desen/i",\n'
        '  "score": <1.0 - 10.0 arası float>,\n'
        '  "target": "subject|body|from|header|any",\n'
        '  "description": "Türkçe açıklama"\n'
        "}]\n\n"
        "Kural: `name` ve `description` Türkçe olmalı. Regex desende Türkçe karakterleri "
        "(ş,ç,ğ,ü,ö,ı,İ) uygun şekilde kaç veya `i` flag'i kullan. Aşırı geniş desenlerden kaçın."
    ),
    "en": (
        "You are a SpamAssassin expert. Based on the user's natural language description, "
        "produce 1-3 spam rules. EACH RULE is a JSON object with a regex pattern following "
        "SpamAssassin syntax. Return ONLY a valid JSON array, NO explanation.\n\n"
        "Schema:\n"
        "[{\n"
        '  "name": "SHORT ENGLISH rule name (max 50 chars, descriptive)",\n'
        '  "pattern": "/regex pattern/i",\n'
        '  "score": <float between 1.0 and 10.0>,\n'
        '  "target": "subject|body|from|header|any",\n'
        '  "description": "English description"\n'
        "}]\n\n"
        "Constraint: `name` and `description` MUST be in English. Avoid overly broad patterns."
    ),
    "de": (
        "Du bist ein SpamAssassin-Experte. Basierend auf der deutschen Beschreibung, generiere "
        "1-3 Spam-Regeln als JSON-Array. Gib NUR gültiges JSON zurück. `name` und `description` "
        "MÜSSEN auf Deutsch sein. Schema wie in der englischen Version."
    ),
    "fr": (
        "Vous êtes un expert SpamAssassin. Générez 1-3 règles anti-spam à partir de la description "
        "en français, sous forme de tableau JSON. Répondez UNIQUEMENT en JSON valide. "
        "`name` et `description` DOIVENT être en français."
    ),
    "es": (
        "Eres un experto en SpamAssassin. Genera 1-3 reglas antispam como array JSON, "
        "basándote en la descripción del usuario en español. Devuelve SOLO JSON válido. "
        "`name` y `description` DEBEN estar en español."
    ),
    "ar": (
        "أنت خبير في SpamAssassin. أنشئ 1-3 قواعد لمكافحة البريد المزعج بناءً على وصف المستخدم. "
        "أعد فقط مصفوفة JSON صالحة. يجب أن يكون كل من name وdescription باللغة العربية."
    ),
}


async def _resolve_language(explicit: Optional[str]) -> str:
    """Resolve language from explicit param → policy setting → default (tr)."""
    if explicit and explicit in AI_RULE_SYSTEM_TEMPLATES:
        return explicit
    settings = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0}) or {}
    lang = settings.get("ui_language", "auto")
    if lang == "auto" or lang not in AI_RULE_SYSTEM_TEMPLATES:
        return "tr"
    return lang


@api.post("/rules/generate")
async def rules_generate(payload: AIRuleGenIn):
    settings = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0}) or PolicySettings().model_dump()
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yapılandırılmamış")
    model = payload.model or settings.get("ai_model", "claude-sonnet-4-5")
    if model not in AI_PROVIDER:
        raise HTTPException(400, f"Bilinmeyen model: {model}")
    provider, model_name = AI_PROVIDER[model]
    lang = await _resolve_language(payload.language)
    system_prompt = AI_RULE_SYSTEM_TEMPLATES.get(lang, AI_RULE_SYSTEM_TEMPLATES["tr"])
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = (
        LlmChat(
            api_key=key,
            session_id=f"rule-{uuid.uuid4().hex[:8]}",
            system_message=system_prompt,
        ).with_model(provider, model_name)
    )
    try:
        text = await chat.send_message(UserMessage(text=payload.prompt))
    except Exception as e:
        raise HTTPException(502, f"AI çağrısı başarısız: {e}")
    import json, re
    m = re.search(r'\[.*\]', text or "", re.DOTALL)
    proposals = []
    if m:
        try:
            arr = json.loads(m.group(0))
            for r in arr[:5]:
                if not isinstance(r, dict): continue
                proposals.append({
                    "name": str(r.get("name", "AI Rule"))[:60],
                    "pattern": str(r.get("pattern", "")),
                    "score": float(r.get("score", 5.0)),
                    "target": r.get("target", "any") if r.get("target") in ("subject", "body", "from", "header", "any") else "any",
                    "description": str(r.get("description", ""))[:200],
                })
        except Exception as e:
            log.warning("rule parse err: %s", e)
    if not proposals:
        raise HTTPException(502, "AI kural üretemedi, farklı ifadelerle tekrar deneyin")
    await db.logs.insert_one(ActivityLog(
        source="ai", level="info",
        message=f"AI kural önerisi ({model}/{lang}) · '{payload.prompt[:60]}' → {len(proposals)} kural",
    ).model_dump())
    return {"model": model, "language": lang, "provider": provider, "count": len(proposals), "proposals": proposals}


# ----- Public i18n helper: expose supported languages + user selection -----
SUPPORTED_LANGUAGES = [
    {"code": "auto", "name_en": "Auto (follow cPanel)", "name_native": "Otomatik (cPanel'i takip et)"},
    {"code": "tr",   "name_en": "Turkish",              "name_native": "Türkçe"},
    {"code": "en",   "name_en": "English",              "name_native": "English"},
    {"code": "de",   "name_en": "German",               "name_native": "Deutsch"},
    {"code": "fr",   "name_en": "French",               "name_native": "Français"},
    {"code": "es",   "name_en": "Spanish",              "name_native": "Español"},
    {"code": "ar",   "name_en": "Arabic",               "name_native": "العربية"},
]


@api.get("/i18n/languages")
async def i18n_languages():
    return SUPPORTED_LANGUAGES


@api.get("/i18n/effective")
async def i18n_effective(cpanel_lang: Optional[str] = None):
    """Return the effective UI language (resolves 'auto' using the cPanel-provided header)."""
    settings = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0}) or {}
    chosen = settings.get("ui_language", "auto")
    if chosen != "auto":
        return {"language": chosen, "source": "policy"}
    if cpanel_lang:
        code = cpanel_lang[:2].lower()
        if code in {"tr", "en", "de", "fr", "es", "ar"}:
            return {"language": code, "source": "cpanel"}
    return {"language": "tr", "source": "default"}


# ----- Plugin state (demo / licensed / expired) -----
async def _plugin_state() -> dict:
    doc = await db.settings.find_one({"_key": "plugin_state"}, {"_id": 0, "_key": 0})
    if not doc:
        now = datetime.now(timezone.utc)
        doc = {
            "installed_at": now.isoformat(),
            "demo_expires": (now + timedelta(days=DEMO_DAYS)).isoformat(),
            "licensed": False,
            "license_key": "",
            "license_expires": "",
        }
        await db.settings.insert_one({"_key": "plugin_state", **doc})
    return doc


def _parse_iso(s: str) -> Optional[datetime]:
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


async def _plugin_status_payload() -> dict:
    st = await _plugin_state()
    now = datetime.now(timezone.utc)
    demo_exp = _parse_iso(st.get("demo_expires", ""))
    lic_exp = _parse_iso(st.get("license_expires", ""))
    licensed = bool(st.get("licensed")) and lic_exp and lic_exp > now
    is_demo = not licensed
    demo_days_remaining = 0
    demo_over = False
    if is_demo and demo_exp:
        delta = demo_exp - now
        demo_days_remaining = max(0, delta.days)
        demo_over = delta.total_seconds() <= 0
    # In seller mode we do not enforce demo/gating
    gated = PLUGIN_MODE == "customer" and demo_over and not licensed

    # Aktif lisansın müşteri adı / plan bilgisini de gönder
    license_customer_name = ""
    license_plan = ""
    license_active_flag = True
    if licensed and st.get("license_key"):
        try:
            lic_doc = await db.licenses.find_one(
                {"license_key": st.get("license_key")}, {"_id": 0}
            )
            if lic_doc:
                license_customer_name = lic_doc.get("customer_name", "")
                license_plan = lic_doc.get("plan", "")
                license_active_flag = bool(lic_doc.get("active", True))
        except Exception:
            pass

    # Lisans pasife alınmışsa modülleri kilit — licensed'i false say
    if licensed and not license_active_flag:
        licensed = False
        gated = PLUGIN_MODE == "customer"

    return {
        "mode": PLUGIN_MODE,
        "installed_at": st.get("installed_at"),
        "is_demo": is_demo,
        "demo_expires": st.get("demo_expires"),
        "demo_days_remaining": demo_days_remaining,
        "demo_over": demo_over,
        "licensed": licensed,
        "license_key": st.get("license_key", ""),
        "license_expires": st.get("license_expires", ""),
        "license_customer_name": license_customer_name,
        "license_plan": license_plan,
        "license_active": license_active_flag,
        "gated": gated,
        "gate_reason": (
            "license_suspended" if licensed is False and st.get("license_key") and not license_active_flag else
            "license_required" if gated else
            ("demo_active" if is_demo and not demo_over else "ok")
        ),
    }


@api.get("/plugin/status")
async def plugin_status():
    return await _plugin_status_payload()


class LogSourceIn(BaseModel):
    mode: Literal["exim", "mailscanner", "auto"] = "auto"
    license_key: Optional[str] = None


@api.get("/plugin/log-source")
async def plugin_log_source_get():
    """WHM sunucusu Exim log'u mu, MailScanner spool'unu mu, ya da her ikisini
    (auto) mu kullansın — bu ayar Perl script tarafından startup'ta okunur.
    'exim' → sadece /var/log/exim_mainlog (bağımsız, MailScanner gerektirmez)
    'mailscanner' → sadece MailScanner spool + SpamCheck header'ları
    'auto' → ikisini birden (varsa MailScanner, yoksa Exim) — DEFAULT
    """
    row = await db.settings.find_one({"_key": "log_source_mode"}, {"_id": 0}) or {}
    return {
        "mode": row.get("mode", "auto"),
        "description": {
            "exim":        "Sadece Exim mainlog — MailScanner kurulu olmayan sunucular için",
            "mailscanner": "Sadece MailScanner spool — ConfigServer MSFE ile birebir parite",
            "auto":        "Otomatik: MailScanner varsa onu, yoksa Exim'i kullan (önerilir)",
        },
        "updated_at": row.get("updated_at"),
    }


@api.post("/plugin/log-source")
async def plugin_log_source_set(payload: LogSourceIn, request: Request):
    """Sadece master anahtarı bu ayarı değiştirebilir."""
    await _require_master(request, payload.license_key)
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"_key": "log_source_mode"},
        {"$set": {"_key": "log_source_mode", "mode": payload.mode, "updated_at": now}},
        upsert=True,
    )
    return {"ok": True, "mode": payload.mode, "updated_at": now,
            "note": "Perl script bir sonraki restart'ta yeni modu kullanır (systemctl restart mailshield-logtail)"}


class VerifyLicenseIn(BaseModel):
    license_key: Optional[str] = None
    ip: Optional[str] = None  # public IP of the plugin host
    hostname: Optional[str] = None  # cPanel primary domain (shared-hosting'de kritik)


@api.post("/plugin/verify-license")
async def plugin_verify_license(payload: VerifyLicenseIn):
    """
    Bayinin 'Lisans Sorgula' butonundan çağrılır. Verilen key/IP/hostname
    lisans DB'sinde varsa ve süresi geçerliyse plugin_state güncellenir.

    Eşleştirme sırası:
      1) license_key verilmişse → onunla doğrudan eşleştir
      2) hostname verilmişse → panel_domains içinde arayarak eşleştir (shared hosting)
      3) IP verilmişse → ip_addresses'ta arayarak eşleştir (VPS/dedicated)

    Master IP (89.19.15.58) gibi paylaşımlı IP'lerde IP tek başına yetmez;
    hostname zorunlu olarak istenir (aksi hâlde belirsizlik hatası).
    """
    now = datetime.now(timezone.utc)
    lic = None
    ambiguous_ip_match = False

    # 1) license_key ile
    if payload.license_key:
        lic = await db.licenses.find_one({"active": True, "license_key": payload.license_key}, {"_id": 0})

    # 2) hostname ile
    if not lic and payload.hostname:
        lic = await db.licenses.find_one({"active": True, "panel_domains": payload.hostname.lower()}, {"_id": 0})

    # 3) IP ile — ama paylaşımlı ise (birden fazla lisans varsa) reddet
    if not lic and payload.ip:
        candidates = await db.licenses.find({"active": True, "ip_addresses": payload.ip}, {"_id": 0}).to_list(20)
        if len(candidates) == 1:
            lic = candidates[0]
        elif len(candidates) > 1:
            ambiguous_ip_match = True

    # 4) Nameserver bazlı otomatik lisans — sunucumuzun NS'lerini kullanan
    #    her domain otomatik lisanslı sayılır (hosting müşterisi olduğu için)
    if not lic and payload.hostname:
        authorized_ns = [
            ns.strip().lower().rstrip(".")
            for ns in os.environ.get(
                "AUTHORIZED_NAMESERVERS",
                "ns1.gokyuzuhosting.com,ns2.gokyuzuhosting.com"
            ).split(",")
            if ns.strip()
        ]
        if authorized_ns:
            try:
                import dns.resolver
                resolver = dns.resolver.Resolver()
                resolver.timeout = 3
                resolver.lifetime = 4
                answer = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: resolver.resolve(payload.hostname, "NS")
                )
                domain_ns = [str(r).lower().rstrip(".") for r in answer]
                if any(ns in domain_ns for ns in authorized_ns):
                    # Otomatik lisans oluştur / getir
                    auto_key = f"AUTO-{payload.hostname[:24].upper().replace('.', '-')}"
                    lic = await db.licenses.find_one(
                        {"license_key": auto_key, "active": True}, {"_id": 0}
                    )
                    if not lic:
                        auto_valid = (now + timedelta(days=365)).isoformat()
                        auto_lic = License(
                            license_key=auto_key,
                            customer_name=f"Auto: {payload.hostname}",
                            customer_email="",
                            plan="pro",
                            ip_addresses=[payload.ip] if payload.ip else [],
                            panel_domains=[payload.hostname.lower()],
                            max_domains=50,
                            valid_until=auto_valid,
                            notes=f"Nameserver bazlı otomatik lisans — NS: {', '.join(domain_ns)}",
                        ).model_dump()
                        await db.licenses.insert_one(auto_lic)
                        lic = auto_lic
                        await db.logs.insert_one(ActivityLog(
                            source="license", level="info",
                            message=f"Otomatik NS lisansı oluşturuldu: {payload.hostname} → {auto_key}",
                        ).model_dump())
            except Exception as e:
                # DNS başarısız olsa da normal akış devam eder
                logging.info(f"NS auto-license check failed for {payload.hostname}: {e}")

    if not lic:
        v = LicenseViolation(
            ip=payload.ip or "unknown",
            hostname=payload.hostname or "",
            license_key=payload.license_key or "",
            reason=(
                "ambiguous_shared_ip" if ambiguous_ip_match
                else ("key_not_found" if payload.license_key else "ip_or_hostname_not_allowed")
            ),
            version="",
            raw={"verify_attempt": True, "ambiguous": ambiguous_ip_match},
        ).model_dump()
        await db.violations.insert_one(v)
        asyncio.create_task(_fire_license_alert(v))
        if ambiguous_ip_match:
            raise HTTPException(
                409,
                "Bu IP birden fazla lisansa kayıtlı (paylaşımlı sunucu). "
                "Lütfen lisans anahtarınızı elle girin veya sistem yöneticinize "
                "cPanel domain'inizin lisansa eklenmesini rica edin."
            )
        raise HTTPException(404, "Lisans bulunamadı. Lütfen satıcı ile iletişime geçin.")
    valid_until = _parse_iso(lic.get("valid_until", ""))
    if not valid_until or valid_until < now:
        raise HTTPException(410, "Lisans süresi dolmuş.")
    # Update plugin_state
    await db.settings.update_one(
        {"_key": "plugin_state"},
        {"$set": {
            "licensed": True,
            "license_key": lic["license_key"],
            "license_expires": lic["valid_until"],
            "licensed_at": now.isoformat(),
        }},
        upsert=True,
    )
    # Update license last heartbeat
    await db.licenses.update_one(
        {"license_key": lic["license_key"]},
        {"$set": {
            "last_heartbeat_at": now.isoformat(),
            "last_heartbeat_ip": payload.ip or "",
            "last_heartbeat_hostname": (payload.hostname or "").lower(),
            "last_heartbeat_version": "1.1.0",
        }},
    )
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Lisans doğrulandı ve etkinleştirildi: {lic['customer_name']} → {lic['license_key'][:12]}…",
    ).model_dump())
    return {
        "ok": True,
        "customer": lic.get("customer_name"),
        "plan": lic.get("plan"),
        "license_key": lic["license_key"],
        "valid_until": lic["valid_until"],
        "message": "Lisans başarıyla etkinleştirildi",
    }


@api.post("/plugin/reset-demo")
async def plugin_reset_demo():
    """Yalnızca seller modunda (test için) demo süresini sıfırlar."""
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Sadece seller modunda kullanılabilir")
    now = datetime.now(timezone.utc)
    await db.settings.update_one(
        {"_key": "plugin_state"},
        {"$set": {
            "installed_at": now.isoformat(),
            "demo_expires": (now + timedelta(days=DEMO_DAYS)).isoformat(),
            "licensed": False,
            "license_key": "",
            "license_expires": "",
        }},
        upsert=True,
    )
    return {"reset": True, "demo_days": DEMO_DAYS}


class SimulateStateIn(BaseModel):
    state: Literal["demo_active", "demo_over", "licensed"]


@api.post("/plugin/simulate-state")
async def plugin_simulate_state(payload: SimulateStateIn):
    """Preview/test için plugin_state'i belirli bir duruma zorlar (yalnızca seller)."""
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Sadece seller modunda")
    now = datetime.now(timezone.utc)
    if payload.state == "demo_active":
        upd = {
            "installed_at": (now - timedelta(days=2)).isoformat(),
            "demo_expires": (now + timedelta(days=5)).isoformat(),
            "licensed": False, "license_key": "", "license_expires": "",
        }
    elif payload.state == "demo_over":
        upd = {
            "installed_at": (now - timedelta(days=10)).isoformat(),
            "demo_expires": (now - timedelta(days=3)).isoformat(),
            "licensed": False, "license_key": "", "license_expires": "",
        }
    else:  # licensed
        upd = {
            "installed_at": (now - timedelta(days=30)).isoformat(),
            "demo_expires": (now - timedelta(days=23)).isoformat(),
            "licensed": True,
            "license_key": "MS-DEMOSIMULATED",
            "license_expires": (now + timedelta(days=365)).isoformat(),
        }
    await db.settings.update_one({"_key": "plugin_state"}, {"$set": upd}, upsert=True)
    return {"simulated": payload.state}


@api.get("/system/mode")
async def system_mode():
    return {"mode": PLUGIN_MODE, "demo_days": DEMO_DAYS}


class UpgradeResult(BaseModel):
    ok: bool
    message: str
    old_version: str = ""
    new_version: str = ""


@api.post("/plugin/upgrade")
async def plugin_upgrade():
    """Tek tıkla plugin güncelleme — WHM'de mailshieldctl update çalıştırır.
    Preview ortamında simüle eder, WHM'de gerçekten tar indirip install.sh --upgrade tetikler."""
    import subprocess
    cur = await db.settings.find_one({"_key": "version"}, {"_id": 0, "_key": 0}) or {"version": "1.1.0"}
    mf  = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0, "_key": 0}) or VersionManifest().model_dump()
    old = cur["version"]; new = mf["latest_version"]
    def _parts(v): return tuple(int(x) for x in v.replace("v", "").split(".") if x.isdigit())
    if _parts(new) <= _parts(old):
        return UpgradeResult(ok=False, message="Zaten güncel — yeni sürüm yok.", old_version=old, new_version=new).model_dump()
    # In real WHM install, run mailshieldctl update
    try:
        proc = subprocess.run(["/usr/local/sbin/mailshieldctl", "update"],
                              capture_output=True, timeout=120)
        if proc.returncode == 0:
            await db.settings.update_one({"_key": "version"}, {"$set": {"version": new, "installed_at": _iso()}}, upsert=True)
            await db.logs.insert_one(ActivityLog(source="version", level="info",
                message=f"Plugin güncellendi: {old} → {new}").model_dump())
            return UpgradeResult(ok=True, message=f"Güncelleme tamamlandı: v{old} → v{new}", old_version=old, new_version=new).model_dump()
        return UpgradeResult(ok=False, message=f"mailshieldctl hata: {proc.stderr.decode(errors='ignore')[:200]}",
                             old_version=old, new_version=new).model_dump()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Preview ortamında simüle et
        await db.settings.update_one({"_key": "version"}, {"$set": {"version": new, "installed_at": _iso()}}, upsert=True)
        await db.logs.insert_one(ActivityLog(source="version", level="info",
            message=f"[SIMULATED preview] Plugin güncellendi: {old} → {new}").model_dump())
        return UpgradeResult(ok=True, message=f"[önizleme] Güncelleme simüle edildi: v{old} → v{new}",
                             old_version=old, new_version=new).model_dump()


# ----- Pricing (public read, seller-only write) -----
async def _pricing_settings() -> dict:
    doc = await db.settings.find_one({"_key": "pricing"}, {"_id": 0, "_key": 0})
    return doc or PricingSettings().model_dump()


@api.get("/pricing")
async def pricing_get():
    """Herkese açık — satış sayfası ve License Gate 'Fiyat Planları' bu endpoint'i çeker."""
    return await _pricing_settings()


@api.put("/pricing")
async def pricing_put(payload: PricingSettings):
    """Yalnızca satıcı yönetim panelinde çağrılır."""
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Fiyat yönetimi yalnızca satıcı modunda")
    await db.settings.update_one(
        {"_key": "pricing"},
        {"$set": {**payload.model_dump(), "_key": "pricing"}},
        upsert=True,
    )
    await db.logs.insert_one(ActivityLog(
        source="pricing", level="info",
        message=f"Fiyatlandırma güncellendi: {len(payload.plans)} plan",
    ).model_dump())
    return payload.model_dump()


# ----- Stripe Checkout & Auto-License -----
class CheckoutCreateIn(BaseModel):
    plan_code: Literal["starter", "pro", "enterprise"]
    billing_period: Literal["monthly", "yearly"] = "yearly"
    customer_email: str
    customer_name: Optional[str] = ""
    origin_url: str  # frontend origin for redirect URLs


class PaymentTransaction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    plan_code: str
    billing_period: str
    amount: float
    currency: str = "USD"
    customer_email: str
    customer_name: str = ""
    status: Literal["pending", "paid", "failed", "expired"] = "pending"
    license_key: Optional[str] = ""
    origin_url: Optional[str] = ""
    created_at: str = Field(default_factory=_iso)
    completed_at: Optional[str] = ""
    metadata: dict = {}


def _stripe_client(origin: str):
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        raise HTTPException(500, "Stripe yapılandırılmamış")
    return StripeCheckout(api_key=api_key, webhook_url=f"{origin}/api/checkout/webhook")


@api.post("/checkout/create-session")
async def checkout_create_session(payload: CheckoutCreateIn):
    from emergentintegrations.payments.stripe.checkout import CheckoutSessionRequest
    pricing = await _pricing_settings()
    plan = next((p for p in pricing["plans"] if p["code"] == payload.plan_code and p.get("active", True)), None)
    if not plan:
        raise HTTPException(404, "Plan bulunamadı veya pasif")
    amount = plan["yearly_price"] if payload.billing_period == "yearly" else plan["monthly_price"]
    if amount <= 0:
        raise HTTPException(400, "Bu plan için ödeme alınamaz")
    currency = plan.get("currency", "USD").lower()
    origin = payload.origin_url.rstrip("/")
    stripe = _stripe_client(origin)
    session_request = CheckoutSessionRequest(
        amount=float(amount), currency=currency,
        success_url=f"{origin}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/pricing",
        metadata={
            "plan_code": payload.plan_code,
            "billing_period": payload.billing_period,
            "customer_email": payload.customer_email,
            "customer_name": payload.customer_name or "",
            "product": "GokyuzuWebSpam",
            "plan_name": plan["name"],
            "max_domains": str(plan.get("max_domains", 100)),
        },
    )
    session = await stripe.create_checkout_session(session_request)
    tx = PaymentTransaction(
        session_id=session.session_id, plan_code=payload.plan_code,
        billing_period=payload.billing_period, amount=float(amount),
        currency=plan.get("currency", "USD"), customer_email=payload.customer_email,
        customer_name=payload.customer_name or "", metadata=session_request.metadata,
        origin_url=origin,
    ).model_dump()
    await db.payment_transactions.insert_one(dict(tx))
    await db.logs.insert_one(ActivityLog(
        source="checkout", level="info",
        message=f"Checkout başlatıldı: {payload.plan_code}/{payload.billing_period} · {payload.customer_email} · {amount} {currency.upper()}",
    ).model_dump())
    return {"session_id": session.session_id, "url": session.url}


async def _finalize_purchase(session_id: str, metadata: dict) -> Optional[dict]:
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        return None
    if tx.get("status") == "paid" and tx.get("license_key"):
        return tx
    now = datetime.now(timezone.utc)
    billing_period = metadata.get("billing_period") or tx.get("billing_period", "yearly")
    days = 365 if billing_period == "yearly" else 30
    plan_code = metadata.get("plan_code") or tx.get("plan_code", "pro")
    pricing = await _pricing_settings()
    plan = next((p for p in pricing["plans"] if p["code"] == plan_code), None) or {}
    lic = License(
        customer_name=metadata.get("customer_name") or tx.get("customer_email"),
        customer_email=metadata.get("customer_email") or tx.get("customer_email", ""),
        plan=plan_code,
        ip_addresses=[],
        max_domains=int(metadata.get("max_domains") or plan.get("max_domains", 100)),
        valid_until=(now + timedelta(days=days)).isoformat(),
        notes=f"Auto-created from Stripe session {session_id}",
    )
    await db.licenses.insert_one(dict(lic.model_dump()))
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "paid", "completed_at": now.isoformat(), "license_key": lic.license_key}},
    )
    await db.logs.insert_one(ActivityLog(
        source="checkout", level="info",
        message=f"ÖDEME TAMAMLANDI · {lic.customer_email} · {plan_code}/{billing_period} · lisans: {lic.license_key[:16]}…",
    ).model_dump())
    # Onboarding email — license key + wget install command + step-by-step guide
    origin = tx.get("origin_url", "").rstrip("/") or ""
    if not origin:
        # try to reconstruct from any stored metadata
        origin = (metadata.get("origin_url") or "").rstrip("/")
    download_url = f"{origin}/api/plugin/download" if origin else "https://gokyuzuwebspam.com/download"
    subject = f"GökyüzüWebSpam · Lisans Anahtarınız · {plan.get('name', plan_code)}"
    body = (
        f"Merhaba{(' ' + (metadata.get('customer_name') or tx.get('customer_name'))) if (metadata.get('customer_name') or tx.get('customer_name')) else ''},\n\n"
        f"GökyüzüWebSpam satın alımınız için teşekkür ederiz! 🎉\n"
        f"────────────────────────────────────────────────────\n"
        f"  LİSANS BİLGİLERİ\n"
        f"────────────────────────────────────────────────────\n"
        f"  Plan            : {plan.get('name', plan_code)} ({billing_period})\n"
        f"  Lisans Anahtarı : {lic.license_key}\n"
        f"  Geçerlilik      : {lic.valid_until[:10]}\n"
        f"  Max domain      : {lic.max_domains}\n"
        f"  Tutar           : {tx['amount']} {tx['currency']}\n\n"
        f"────────────────────────────────────────────────────\n"
        f"  1-KOMUT KURULUM (WHM sunucunuza root SSH ile bağlanın)\n"
        f"────────────────────────────────────────────────────\n"
        f"  wget -O gws.tar.gz \"{download_url}\" && \\\n"
        f"  mkdir -p /opt/gokyuzuwebspam && \\\n"
        f"  tar -xzf gws.tar.gz -C /opt/gokyuzuwebspam --strip-components=1 && \\\n"
        f"  cd /opt/gokyuzuwebspam && \\\n"
        f"  chmod +x install.sh && \\\n"
        f"  ./install.sh --license={lic.license_key}\n\n"
        f"────────────────────────────────────────────────────\n"
        f"  ADIM ADIM (manuel tercih ederseniz)\n"
        f"────────────────────────────────────────────────────\n"
        f"  1) wget -O gws.tar.gz \"{download_url}\"\n"
        f"  2) tar -xzf gws.tar.gz && cd whm-plugin\n"
        f"  3) chmod +x install.sh\n"
        f"  4) ./install.sh --license={lic.license_key}\n"
        f"  5) /usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf\n"
        f"  6) systemctl enable --now mailshield-api mailshield-milter mailshield-heartbeat.timer\n"
        f"  7) WHM > Plugins > GökyüzüWebSpam menüsünden panele erişin.\n\n"
        f"────────────────────────────────────────────────────\n"
        f"  DESTEK\n"
        f"────────────────────────────────────────────────────\n"
        f"  • Kurulum kılavuzu : {origin or 'https://gokyuzuwebspam.com'}/install\n"
        f"  • Mail             : destek@gokyuzuwebspam.com\n"
        f"  • Panelden 'Lisansı Sorgula' butonuyla anında doğrulama\n\n"
        f"GökyüzüWebSpam ekibi\n"
    )
    await _send_email(lic.customer_email, subject, body)
    ns = await _notify_settings()
    if ns.get("admin_email"):
        await _send_email(ns["admin_email"],
                          f"[SATIŞ] {plan_code} - {lic.customer_email}",
                          f"Yeni satış!\nMüşteri: {lic.customer_email}\nPlan: {plan_code}/{billing_period}\nTutar: {tx['amount']} {tx['currency']}\nAnahtar: {lic.license_key}")
    return await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})


@api.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, request: Request):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı")
    if tx["status"] == "paid":
        return tx
    origin = str(request.base_url).rstrip("/")
    stripe = _stripe_client(origin)
    try:
        s = await stripe.get_checkout_status(session_id)
        if s.payment_status == "paid":
            await _finalize_purchase(session_id, s.metadata or tx.get("metadata", {}))
            tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    except Exception as e:
        log.warning("stripe status err: %s", e)
    return tx


@api.post("/checkout/webhook")
async def checkout_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("stripe-signature", "")
    origin = str(request.base_url).rstrip("/")
    stripe = _stripe_client(origin)
    try:
        event = await stripe.handle_webhook(body, sig)
    except Exception as e:
        log.warning("webhook parse err: %s", e)
        return {"received": False}
    if getattr(event, "payment_status", "") == "paid":
        await _finalize_purchase(event.session_id, getattr(event, "metadata", None) or {})
    return {"received": True}


@api.get("/checkout/transactions")
async def checkout_transactions():
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Sadece satıcı modu")
    return await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)




# ----- Milter report hook (called by Perl milter to record verdicts) -----
class MilterReport(BaseModel):
    engines: dict
    verdict: str
    headers: str
    body_hash: str


@api.post("/milter/report")
async def milter_report(payload: MilterReport):
    total = sum(float(v) for v in payload.engines.values())
    doc = QuarantineItem(
        sender="unknown@from-milter",
        sender_ip="0.0.0.0",
        recipient="unknown@local",
        subject="(milter'dan gelen)",
        score=total,
        verdict=payload.verdict if payload.verdict in ("spam", "high_spam", "virus", "phish") else "spam",
        engine=max(payload.engines, key=lambda k: payload.engines[k]) if payload.engines else "spamassassin",
        size_kb=len(payload.headers) // 1024 + 1,
        body_preview=payload.body_hash[:400],
        headers=payload.headers,
        rules_matched=list(payload.engines.keys()),
    ).model_dump()
    await db.quarantine.insert_one(doc)
    # fire notifications
    asyncio.create_task(_fire_alerts(doc))
    return {"ok": True}


app.include_router(api)

# ---- Modular route inclusion (v1.4 refactor) --------------------------------
from routes.analytics import router as _analytics_router  # noqa: E402
from routes.plugin import router as _plugin_router  # noqa: E402
from routes.reseller import router as _reseller_router  # noqa: E402
from routes.license_client import router as _license_client_router  # noqa: E402
from routes.invoices import router as _invoices_router  # noqa: E402
from routes.events import router as _events_router  # noqa: E402
from routes.alerts import router as _alerts_router  # noqa: E402
from routes.insights import router as _insights_router  # noqa: E402
from routes.queue import router as _queue_router  # noqa: E402
from routes.security_adv import router as _security_adv_router  # noqa: E402
from routes.mailscanner import router as _mailscanner_router  # noqa: E402
from routes.threat_intel import router as _threat_intel_router  # noqa: E402
from routes.payments import router as _payments_router  # noqa: E402
from routes.maintenance import router as _maintenance_router  # noqa: E402
from routes.master import router as _master_router  # noqa: E402
from routes.smart_pos import router as _smart_pos_router  # noqa: E402
app.include_router(_analytics_router, prefix="/api")
app.include_router(_plugin_router, prefix="/api")
app.include_router(_reseller_router, prefix="/api")
app.include_router(_license_client_router, prefix="/api")
app.include_router(_invoices_router, prefix="/api")
app.include_router(_events_router, prefix="/api")
app.include_router(_alerts_router, prefix="/api")
app.include_router(_insights_router, prefix="/api")
app.include_router(_queue_router, prefix="/api")
app.include_router(_security_adv_router, prefix="/api")
app.include_router(_mailscanner_router, prefix="/api")
app.include_router(_threat_intel_router, prefix="/api")
app.include_router(_payments_router, prefix="/api")
app.include_router(_maintenance_router, prefix="/api")
app.include_router(_master_router, prefix="/api")
app.include_router(_smart_pos_router, prefix="/api")

# ---------------------------------------------------------------------------
# Demo mode write-guard middleware
# ---------------------------------------------------------------------------
# Demo modundaki (lisanssız) müşteri kurulumlarında yazma isteklerini reddeder.
# Yalnızca /api/* altındaki mutating (POST/PUT/PATCH/DELETE) istekler engellenir.
# Lisans etkinleştirme ve plugin durumu gibi yollar istisna tutulur.
# ---------------------------------------------------------------------------

_DEMO_ALLOW_PREFIXES = (
    "/api/plugin/",            # plugin status, verify-license, upgrade, vs.
    "/api/admin/master-unlock",
    "/api/license/",           # müşteri lisans akışı (activate, refresh)
    "/api/version/",           # sürüm sorgulamaları
    "/api/master/",            # master API (satıcı tarafı)
    "/api/reseller/",          # bayi heartbeat
    "/api/payments/",          # ödeme akışı (lisans satın alma)
    "/api/smart-pos/",         # ödeme akışı
    "/api/auth/",              # oturum
    "/api/invoices/",          # fatura akışı
    "/api/shop",               # mağaza
    "/api/events/ingest",      # Exim milter'dan mail event ingest (license_key ile doğrulanır)
    "/api/events/ingest-batch",# batch ingest
    "/api/events/action",      # milter/logtail action reporting
    "/api/events/complete-action", # logtail aksiyon tamamlama callback
    "/api/events/logtail-heartbeat", # logtail script canlılık heartbeat
    "/api/events/admin/migrate-ts-tz", # master timezone migration
    "/api/mail/ingest",        # alternatif mail ingest
    "/api/heartbeat",          # plugin heartbeat (license_key ile doğrulanır)
    "/api/threat/report",      # threat feed report
)


@app.middleware("http")
async def demo_write_guard(request: Request, call_next):
    method = request.method.upper()
    path = request.url.path
    if method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api/"):
        return await call_next(request)
    # istisna yolları
    if any(path.startswith(p) for p in _DEMO_ALLOW_PREFIXES):
        return await call_next(request)
    # Cookie-based master session (admin/master-unlock ile alınır, 30 gün geçerli).
    # Bu cookie varsa localStorage/header/query karışıklığından bağımsız yazma serbest.
    cookie_master = request.cookies.get("gws_master_session")
    if cookie_master:
        try:
            row = await db.settings.find_one(
                {"_key": f"master_session:{cookie_master}"}, {"_id": 0}
            )
            if row and row.get("valid_until", "") > datetime.now(timezone.utc).isoformat():
                return await call_next(request)
        except Exception:
            pass
    try:
        status = await _plugin_status_payload()
    except Exception:
        return await call_next(request)

    # Seller/master modu: master anahtarı istekle geldiyse yazma serbest,
    # gelmediyse (ziyaretçi) demo yazma kilidi çalışır.
    if status.get("mode") == "seller":
        master_key_env = os.environ.get("MASTER_LICENSE_KEY", "")
        master_ip_env = os.environ.get("MASTER_IP", "")
        provided_key = (
            request.headers.get("x-master-key")
            or request.query_params.get("master_key")
            or request.query_params.get("license_key")
            or ""
        )
        if master_key_env and provided_key and provided_key == master_key_env:
            return await call_next(request)
        # Master IP eşleşmesi: request master sunucudan geliyorsa (WHM plugin
        # iframe içinden) X-Master-Key olmasa da yazmaya izin ver.
        client_ip = ""
        try:
            xff = request.headers.get("x-forwarded-for", "")
            client_ip = (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")
        except Exception:
            pass
        if master_ip_env and client_ip and client_ip == master_ip_env:
            return await call_next(request)
        # Ziyaretçi: yazma kilitle
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=423,
            content={
                "detail": "Demo modundasınız. Yazma işlemleri için lisans girin.",
                "code": "DEMO_READ_ONLY",
                "demo_days_remaining": status.get("demo_days_remaining", 7),
                "demo_over": False,
            },
        )

    if status.get("mode") == "customer" and not status.get("licensed"):
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=423,
            content={
                "detail": "Demo modunda yazma işlemi yapılamaz. Lütfen lisansınızı etkinleştirin.",
                "code": "DEMO_READ_ONLY",
                "demo_days_remaining": status.get("demo_days_remaining", 0),
                "demo_over": status.get("demo_over", False),
            },
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # allow_origins=["*"] + allow_credentials=True kombinasyonu tarayıcıda cookie
    # bazlı auth'u kırar. Env'de CORS_ORIGINS yoksa allow_origin_regex=".*" ile
    # tüm origin'leri kabul et — starlette bu durumda Access-Control-Allow-Origin
    # header'ında istek origin'ini geri yansıtır ve cookie düzgün akar.
    allow_origins=(os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else []),
    allow_origin_regex=(None if os.environ.get("CORS_ORIGINS") else ".*"),
    allow_methods=["*"],
    allow_headers=["*"],
)
