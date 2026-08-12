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
from typing import List, Optional, Literal, Dict, Any

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, Response
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
    owner_license_key: str = ""  # bayi lisansı ile scope'lu (boşsa master/global)
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
    contact_email: str = "satis@gokyuzuhosting.com"
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
    # Deduplicate engines by (name, owner_license_key) — multi-tenant safe.
    # Legacy pre-multitenancy dedupe used only `name` which wiped bayi copies,
    # and legacy `name_1` unique index conflicts with per-bayi rows.
    try:
        # Drop any legacy single-field unique index on name (if it exists)
        try:
            await db.engines.drop_index("name_1")
        except Exception:
            pass
        # Tag legacy docs missing owner_license_key as master template ""
        await db.engines.update_many(
            {"owner_license_key": {"$exists": False}},
            {"$set": {"owner_license_key": ""}},
        )
        # Dedupe by (name, owner_license_key)
        seen = set()
        async for e in db.engines.find({}, {"_id": 1, "name": 1, "owner_license_key": 1}):
            key = (e.get("name"), e.get("owner_license_key", ""))
            if key in seen:
                await db.engines.delete_one({"_id": e["_id"]})
            else:
                seen.add(key)
        await db.engines.create_index(
            [("name", 1), ("owner_license_key", 1)],
            unique=True, name="name_owner_unique",
        )
    except Exception as ex:
        log.warning("engines dedupe skipped: %s", ex)

    # v40 Performance indexes — Landing sayfa polling'i (public/blocked-stats,
    # geo/blocked-heatmap) mail_events üzerinde ağır aggregation koşuyor.
    # Bu index'ler p95 latency'yi ~10x düşürür. Idempotent create_index.
    try:
        await db.mail_events.create_index([("verdict", 1), ("ts", -1)], name="v40_verdict_ts", background=True)
        await db.mail_events.create_index([("verdict", 1), ("ingested_at", -1)], name="v40_verdict_ingested", background=True)
        await db.mail_events.create_index([("license_key", 1), ("verdict", 1), ("ts", -1)], name="v40_lic_verdict_ts", background=True)
        await db.lists.create_index([("kind", 1), ("type", 1)], name="v40_kind_type", background=True)
        await db.threat_iocs.create_index([("type", 1)], name="v40_ioc_type", background=True)
    except Exception as ex:
        log.warning("v40 perf indexes skipped: %s", ex)

    # Kick off background housekeeping tasks
    asyncio.create_task(_auto_suspend_daily_task())
    asyncio.create_task(_weekly_ai_report_task())
    asyncio.create_task(_hourly_self_training_task())
    asyncio.create_task(_monthly_auto_cleanup_task())
    asyncio.create_task(_license_expiry_alerts_task())
    asyncio.create_task(_pos_health_monitor_task())
    asyncio.create_task(_daily_violations_cleanup_task())
    asyncio.create_task(_threat_ratio_monitor_task())
    asyncio.create_task(_plugin_normalization_health_task())
    # v43 Global Threat Intel auto-sync (opt-in via settings.threat_intel_auto_sync.enabled)
    try:
        from routes.threat_intel import _threat_intel_auto_sync_loop
        asyncio.create_task(_threat_intel_auto_sync_loop())
    except Exception as _ex:
        log.warning("threat_intel auto-sync task not scheduled: %s", _ex)


async def _daily_violations_cleanup_task():
    """7 günden eski license_violations kayıtlarını her gece sil. İlk çalıştırma
    startup'tan 15 dk sonra, sonra her 24 saatte bir. Delete count'u maintenance_log'a
    ve activity logs'a yazar. Master paneli manuel tetikleme:
    POST /api/maintenance/violations/auto-cleanup?days=7."""
    await asyncio.sleep(900)  # 15 dk bekle
    while True:
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            q = {"$or": [{"at": {"$lt": cutoff}}, {"created_at": {"$lt": cutoff}}]}
            r1 = await db.license_violations.delete_many(q)
            r2 = await db.violations.delete_many(q)
            total = r1.deleted_count + r2.deleted_count
            await db.maintenance_log.insert_one({
                "id": str(uuid.uuid4()),
                "action": "auto_cleanup_violations",
                "older_than_days": 7,
                "deleted": total,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            if total:
                await db.logs.insert_one({
                    "id": str(uuid.uuid4()),
                    "source": "auto_cleanup",
                    "level": "info",
                    "message": f"Cron: 7 günden eski {total} lisans ihlali otomatik silindi",
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                log.info("daily-violations-cleanup: %d rows deleted", total)
        except Exception as ex:
            log.warning("daily-violations-cleanup error: %s", ex)
        await asyncio.sleep(86400)  # 24 saat


async def _threat_ratio_monitor_task():
    """Her 5 dakikada bir tüm bayilerin son 1 saatlik mail trafiğini kontrol eder.
    Bayi min. 20 mail almış VE (spam+virus+phish)/toplam > %30 ise:
      • `master_alerts` collection'a UNSEEN alert kaydı ekler (aynı bayi için son
        1 saat içinde alert varsa dedupe yapar)
      • Admin e-postasına uyarı gönderir (notify_settings.email_enabled ise)
      • Activity logs'a yazar
    Frontend master badge/bell bu collection'ı polling yapar."""
    await asyncio.sleep(180)  # startup'tan 3 dk sonra ilk tarama
    while True:
        try:
            await _threat_ratio_scan_once()
        except Exception as ex:
            log.warning("threat-ratio-monitor error: %s", ex)
        await asyncio.sleep(300)  # 5 dakika


async def _threat_ratio_scan_once(min_mails: int = 20, threshold: float = 0.30,
                                  window_minutes: int = 60, dedupe_minutes: int = 60) -> int:
    """Bir tarama turu — kaç yeni alert oluşturulduğunu döner. Master paneli
    isteğe bağlı olarak `POST /api/admin/threat-alerts/scan` üzerinden çağırabilir."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=window_minutes)).isoformat()
    dedupe_cutoff = (now - timedelta(minutes=dedupe_minutes)).isoformat()
    created = 0
    async for r in db.resellers.find({"active": {"$ne": False}}, {"_id": 0}):
        lic_key = r.get("license_key") or ""
        if not lic_key:
            continue
        pipe = [
            {"$match": {"license_key": lic_key, "ts": {"$gte": cutoff}}},
            {"$group": {"_id": "$verdict", "n": {"$sum": 1}}},
        ]
        mails = spam = virus = phish = 0
        try:
            async for row in db.mail_events.aggregate(pipe):
                v = (row.get("_id") or "").lower()
                n = int(row.get("n") or 0)
                mails += n
                if v in ("spam", "high_spam"): spam += n
                elif v == "virus": virus += n
                elif v in ("phish", "phishing"): phish += n
        except Exception:
            continue
        if mails < min_mails:
            continue
        bad = spam + virus + phish
        ratio = bad / mails
        if ratio < threshold:
            continue
        # Dedupe: aynı bayi için son N dakikada UNSEEN alert varsa atla
        existing = await db.master_alerts.find_one({
            "type": "threat_ratio", "reseller_id": r.get("id"),
            "created_at": {"$gte": dedupe_cutoff},
        })
        if existing:
            continue
        alert_id = str(uuid.uuid4())
        pct = round(ratio * 100, 1)
        payload = {
            "id": alert_id,
            "type": "threat_ratio",
            "severity": "critical" if ratio >= 0.6 else "warning",
            "reseller_id": r.get("id"),
            "reseller_email": r.get("email", ""),
            "reseller_company": r.get("company", ""),
            "license_key": lic_key,
            "ratio_pct": pct,
            "mails": mails,
            "spam": spam, "virus": virus, "phish": phish,
            "window_minutes": window_minutes,
            "threshold_pct": int(threshold * 100),
            "message": (f"⚠️ {r.get('company') or r.get('email')} son {window_minutes}dk'da "
                        f"%{pct} tehdit oranına ulaştı ({bad}/{mails} mail)"),
            "seen": False,
            "created_at": now.isoformat(),
        }
        await db.master_alerts.insert_one(payload)
        created += 1
        try:
            await db.logs.insert_one({
                "id": str(uuid.uuid4()),
                "source": "threat_monitor",
                "level": "warn",
                "message": payload["message"],
                "at": now.isoformat(),
            })
        except Exception:
            pass
        # E-posta bildirimi
        try:
            ns = await _notify_settings()
            if ns.get("email_enabled") and ns.get("admin_email"):
                subj = f"[GökyüzüWebSpam] Bayi Tehdit Uyarısı: %{pct} — {r.get('company') or r.get('email')}"
                body = (
                    f"Merhaba,\n\n"
                    f"Aşağıdaki bayinin son {window_minutes} dakikada tehdit oranı eşiği aştı:\n\n"
                    f"  Bayi     : {r.get('company','')} <{r.get('email','')}>\n"
                    f"  Lisans   : {lic_key}\n"
                    f"  Toplam   : {mails} mail\n"
                    f"  Kötüler  : {bad} (spam:{spam} virüs:{virus} phishing:{phish})\n"
                    f"  Oran     : %{pct}  (eşik %{int(threshold*100)})\n"
                    f"  Zaman    : {now.isoformat()}\n\n"
                    f"Master panel Canlı Bayi Trafiği: /panel/master-live\n"
                    f"— GökyüzüWebSpam Threat Monitor\n"
                )
                await _send_email(ns["admin_email"], subj, body)
        except Exception as em:
            log.warning("threat-alert email failed: %s", em)
    return created


async def _plugin_normalization_health_task():
    """Her 30 dakikada bir tüm bayilerde son 24 saatte skor normalize edilen mail
    sayısını sayar. >100 ise plugin'de bug var (yanlış `total_score` gönderiyor)
    → master_alerts'a UNSEEN uyarı ekler + admin e-postasına bildirir.

    Dedup: aynı bayi için son 6 saat içinde normalization_alert varsa tekrar yazmaz."""
    await asyncio.sleep(300)  # startup'tan 5 dk sonra
    while True:
        try:
            await _plugin_normalization_scan_once()
        except Exception as ex:
            log.warning("plugin-normalization-health error: %s", ex)
        await asyncio.sleep(1800)  # 30 dakika


async def _plugin_normalization_scan_once(threshold: int = 100,
                                            hours: int = 24,
                                            dedupe_hours: int = 6) -> int:
    """Bir tarama turu. Kaç yeni uyarı oluşturulduğunu döner."""
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=hours)).isoformat()
    dedupe_cutoff = (now - timedelta(hours=dedupe_hours)).isoformat()
    created = 0
    async for r in db.resellers.find({"active": {"$ne": False}}, {"_id": 0}):
        lic_key = r.get("license_key") or ""
        if not lic_key:
            continue
        norm_count = await db.mail_events.count_documents({
            "license_key": lic_key,
            "score_normalized": True,
            "ingested_at": {"$gte": since},
        })
        if norm_count < threshold:
            continue
        # Dedup
        recent = await db.master_alerts.find_one({
            "type": "plugin_normalization",
            "license_key": lic_key,
            "created_at": {"$gte": dedupe_cutoff},
        }, {"_id": 0})
        if recent:
            continue
        alert = {
            "id": str(uuid.uuid4()),
            "type": "plugin_normalization",
            "severity": "warning",
            "license_key": lic_key,
            "reseller_email": r.get("email"),
            "reseller_company": r.get("company"),
            "message": (
                f"Bayi {r.get('company') or r.get('email')} son {hours} saat "
                f"içinde {norm_count} mail'de skor normalize etti — plugin'de "
                f"bug var (yanlış `total_score`). WHM sunucusunda "
                f"mailshield-logtail.pl güncellenmeli."
            ),
            "normalized_count": norm_count,
            "hours": hours,
            "seen": False,
            "created_at": now.isoformat(),
        }
        await db.master_alerts.insert_one(alert)
        created += 1
        try:
            await db.logs.insert_one({
                "id": str(uuid.uuid4()),
                "source": "plugin_health",
                "level": "warn",
                "message": alert["message"],
                "at": now.isoformat(),
            })
        except Exception:
            pass
        # E-posta bildirimi
        try:
            ns = await _notify_settings()
            if ns.get("email_enabled") and ns.get("admin_email"):
                subj = f"[GökyüzüWebSpam] Plugin Skor Bug'ı — {r.get('company') or r.get('email')}"
                body = (
                    f"Merhaba,\n\n"
                    f"Bayi plugin'i yanlış `total_score` gönderiyor. Panel son "
                    f"{hours} saatte {norm_count} mail'in skorunu SpamAssassin "
                    f"değeriyle otomatik düzeltti.\n\n"
                    f"  Bayi   : {r.get('company','')} <{r.get('email','')}>\n"
                    f"  Lisans : {lic_key}\n"
                    f"  Normalize sayısı: {norm_count}\n"
                    f"  Eşik   : {threshold}\n"
                    f"  Zaman  : {now.isoformat()}\n\n"
                    f"Aksiyon: Bayiden `install-bayi.sh` üzerinden plugin'i "
                    f"güncellemesini isteyin.\n\n"
                    f"— GökyüzüWebSpam Plugin Health Monitor\n"
                )
                await _send_email(ns["admin_email"], subj, body)
        except Exception as em:
            log.warning("plugin-health email failed: %s", em)
    return created


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
    30 gün kala bilgi, 14 gün kala uyarı, 3 gün kala kritik e-posta gönderir.
    Aynı eşik için aynı lisansa günde 1 kez mail atılır (dedupe).

    NOT: Şema `valid_until` alanını kullanıyor (`expires_at` değil)."""
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
                        {"active": {"$ne": False}, "valid_until": {"$exists": True, "$nin": [None, ""]}},
                        {"_id": 0},
                    ):
                        try:
                            exp = datetime.fromisoformat(str(lic["valid_until"]).replace("Z", "+00:00"))
                            days_left = (exp - now).days
                        except Exception:
                            continue
                        # 30 / 14 / 3 gün → mail
                        if days_left not in (30, 14, 3):
                            continue
                        email = lic.get("customer_email") or lic.get("email")
                        if not email or "@" not in email:
                            continue
                        urgent = days_left <= 3
                        warning = days_left <= 14
                        subj = (
                            f"🚨 KRİTİK: Lisansınız {days_left} gün içinde sona eriyor!" if urgent else
                            f"⚠️ Lisansınız {days_left} gün içinde sona eriyor · GökyüzüWebSpam" if warning else
                            f"📅 Lisansınız 30 gün içinde yenilenmeli · GökyüzüWebSpam"
                        )
                        body = (
                            f"Sayın {lic.get('customer_name') or 'Kullanıcı'},\n\n"
                            f"GökyüzüWebSpam lisansınız {days_left} gün içinde ({exp.date()}) sona erecek.\n\n"
                            f"Lisans Bilgileri:\n"
                            f"  Lisans No : {lic.get('license_key')}\n"
                            f"  Plan      : {lic.get('plan', 'starter')}\n"
                            f"  Bitiş     : {exp.strftime('%d.%m.%Y')}\n\n"
                            f"Kesintisiz hizmet için tek tık ile yenileyin:\n"
                            f"  /panel/subscription?renew=1\n\n"
                            f"Yıllık plan seçerek 2 ay hediye kazanabilirsiniz.\n\n"
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
                                "days_left": days_left,
                                "urgent": urgent, "warning": warning,
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
async def stats_overview(request: Request, license_key: Optional[str] = None):
    """Bayi/master scope'a göre izole edilir. Bayi sadece kendi mail_events +
    quarantine + engines sayaçlarını görür."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    # Quarantine filtresi
    q_filter = {} if scope["is_master"] and not owner else ({"owner_license_key": owner} if owner else {})
    total = await db.quarantine.count_documents(q_filter)
    phish = await db.quarantine.count_documents({**q_filter, "verdict": "phish"})
    virus = await db.quarantine.count_documents({**q_filter, "verdict": "virus"})
    high = await db.quarantine.count_documents({**q_filter, "verdict": "high_spam"})
    # Engines filtresi (owner=='' master global template'i)
    eng_filter = {"owner_license_key": owner} if owner or not scope["is_master"] else {"owner_license_key": ""}
    engines = await db.engines.find(eng_filter, {"_id": 0}).to_list(20)
    # Canlı mail_events sayaçları (son 24s) — bayi izolasyonu buradan gelir
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    me_filter = {"ts": {"$gte": since}}
    if owner:
        me_filter["license_key"] = owner
    scanned = await db.mail_events.count_documents(me_filter)
    caught = await db.mail_events.count_documents({
        **me_filter, "verdict": {"$in": ["spam", "high_spam", "virus", "phish"]},
    })
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
    request: Request,
    search: Optional[str] = None,
    verdict: Optional[str] = None,
    engine: Optional[str] = None,
    direction: Optional[str] = None,   # v43: in | out | all (default all)
    limit: int = 200,
    license_key: Optional[str] = None,
):
    """Karantina listesi — bayi/master scope izole. Bayi kendi lisansına ait
    kayıtları görür; master hepsini veya `?license_key=X` ile bir bayinin.

    v43: `direction=in|out` — Gelen/Giden ayrımı için filtre. Boş/all → hepsi
    (backward compat: direction alanı olmayan legacy kayıtlar `in` sayılır)."""
    scope = await _tenant_scope(request, license_key)
    # Plan gate: karantina görüntüleme özelliği kapalıysa 403
    await _require_feature(scope, "quarantine_view")
    q: dict = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            q["owner_license_key"] = scope["owner_license_key"]
        # Master default görünümde: kendi + legacy (owner_license_key olmayan) kayıtları
        else:
            master_env = os.environ.get("MASTER_LICENSE_KEY", "")
            q["$or"] = [
                {"owner_license_key": master_env},
                {"owner_license_key": {"$exists": False}},
                {"owner_license_key": None},
                {"owner_license_key": ""},
            ]
    else:
        q["owner_license_key"] = scope["owner_license_key"] or "__none__"
    if verdict and verdict != "all":
        q["verdict"] = verdict
    if engine and engine != "all":
        q["engine"] = engine
    # v43 direction filter
    if direction == "out":
        q["direction"] = "out"
    elif direction == "in":
        # Legacy (direction alanı yok) + explicit "in"
        q["$and"] = q.get("$and", []) + [
            {"$or": [
                {"direction": "in"},
                {"direction": {"$exists": False}},
                {"direction": None},
            ]}
        ]
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
async def quarantine_purge_demo(request: Request):
    """Master-only convenience: karantinada ve event'lerde demo alıcı domain'i
    olan tüm kayıtları sil. WHM plugin'den gelen gerçek eventler korunur.
    Sadece master çağırabilir (bayi kendi verilerine dokunmak için normal
    quarantine/delete akışı vardır)."""
    scope = await _tenant_scope(request, None)
    if not scope.get("is_master"):
        raise HTTPException(403, "Bu işlem sadece master içindir")
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


@api.get("/quarantine/stats")
async def quarantine_stats(request: Request, license_key: Optional[str] = None):
    """Kuyruk paneli üst bandında gösterilecek KPI'lar: toplam, bugün,
    verdict kırılımı, en sık gönderici/domain, en eski/son gelen."""
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "quarantine_view")
    q: dict = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            q["owner_license_key"] = scope["owner_license_key"]
    else:
        q["owner_license_key"] = scope["owner_license_key"] or "__none__"
    now = datetime.now(timezone.utc)
    day = (now - timedelta(days=1)).isoformat()
    week = (now - timedelta(days=7)).isoformat()
    total = await db.quarantine.count_documents(q)
    today = await db.quarantine.count_documents({**q, "received_at": {"$gte": day}})
    week_count = await db.quarantine.count_documents({**q, "received_at": {"$gte": week}})
    released = await db.quarantine.count_documents({**q, "released": True})
    verdicts: dict = {}
    pipeline = [
        {"$match": q},
        {"$group": {"_id": "$verdict", "n": {"$sum": 1}}},
    ]
    async for row in db.quarantine.aggregate(pipeline):
        verdicts[str(row.get("_id") or "unknown")] = int(row.get("n") or 0)
    # En sık gönderici (top 5)
    top_senders = []
    async for row in db.quarantine.aggregate([
        {"$match": q},
        {"$group": {"_id": "$sender", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 5},
    ]):
        top_senders.append({"sender": row.get("_id") or "?", "count": int(row.get("n") or 0)})
    # Skor dağılımı histogram — mail_events üzerinden (karantina + akış hepsi)
    # Bucket'lar: 0-3 clean, 3-5 suspicious, 5-10 spam, 10+ high_spam
    mail_q: dict = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            mail_q["license_key"] = scope["owner_license_key"]
    else:
        mail_q["license_key"] = scope["owner_license_key"] or "__none__"
    since_iso = (now - timedelta(days=7)).isoformat()
    mail_q["ingested_at"] = {"$gte": since_iso}
    buckets = {"clean": 0, "suspicious": 0, "spam": 0, "high_spam": 0}
    async for row in db.mail_events.aggregate([
        {"$match": mail_q},
        {"$bucket": {
            "groupBy": {"$ifNull": ["$total_score", 0]},
            "boundaries": [-1000, 3, 5, 10, 1000],
            "default": "other",
            "output": {"n": {"$sum": 1}},
        }},
    ]):
        b_id = row.get("_id")
        n = int(row.get("n") or 0)
        if b_id == -1000:
            buckets["clean"] = n
        elif b_id == 3:
            buckets["suspicious"] = n
        elif b_id == 5:
            buckets["spam"] = n
        elif b_id == 10:
            buckets["high_spam"] = n
    return {
        "total": total, "today": today, "week": week_count, "released": released,
        "verdicts": verdicts, "top_senders": top_senders,
        "score_distribution": buckets,
        "generated_at": now.isoformat(),
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
async def quarantine_release(action: BulkAction, request: Request, license_key: Optional[str] = None):
    """
    'Spam değil' işareti = mesajı gelen kutusuna teslim et + göndericiyi otomatik
    whitelist'e ekle + Bayes'e ham (temiz) olarak öğret. Böylece aynı gönderici
    bir daha karantinaya düşmez.
    Plan gate: `quarantine_release`. Tenant izolasyonu: sadece kendi kayıtları.
    """
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "quarantine_release")
    # ID filtresini owner ile daralt (bayi sadece kendisine ait ID'leri işleyebilir)
    match = {"id": {"$in": action.ids}}
    if not scope["is_master"]:
        match["owner_license_key"] = scope["owner_license_key"] or "__none__"
    docs = await db.quarantine.find(match, {"_id": 0}).to_list(500)
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
        match, {"$set": {"released": True}}
    )
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="info",
        message=f"{result.modified_count} mesaj alıcıya teslim edildi + {whitelisted_count} whitelist kaydı + Bayes ham eğitildi",
    ).model_dump())
    return {"released": result.modified_count, "whitelisted": whitelisted_count, "bayes_ham_trained": len(docs)}


@api.post("/quarantine/delete")
async def quarantine_delete(action: BulkAction, request: Request, license_key: Optional[str] = None):
    """Karantina toplu silme. Plan gate: `quarantine_delete`. Bayi sadece
    kendi lisansındaki kayıtları silebilir. Master legacy (owner_license_key
    olmayan) kayıtları da silebilir."""
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "quarantine_delete")
    match = {"id": {"$in": action.ids}}
    if not scope["is_master"]:
        match["owner_license_key"] = scope["owner_license_key"] or "__none__"
    result = await db.quarantine.delete_many(match)
    return {"deleted": result.deleted_count}


@api.post("/quarantine/purge-all")
async def quarantine_purge_all(request: Request, license_key: Optional[str] = None,
                                verdict: Optional[str] = None, older_than_days: Optional[int] = None):
    """Karantinada belirli filtreye uyan TÜM kayıtları temizler. Master için
    tam veya filtreli purge; bayi için sadece kendi kayıtları. Filtreler:
      - verdict = 'spam' | 'virus' | 'phish' | 'all'
      - older_than_days = N (sadece N günden eski olanları sil)
    """
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "quarantine_delete")
    q: dict = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            q["owner_license_key"] = scope["owner_license_key"]
    else:
        q["owner_license_key"] = scope["owner_license_key"] or "__none__"
    if verdict and verdict != "all":
        q["verdict"] = verdict
    if older_than_days and older_than_days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=older_than_days)).isoformat()
        q["received_at"] = {"$lt": cutoff}
    result = await db.quarantine.delete_many(q)
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="warn",
        message=f"PURGE-ALL · silinen: {result.deleted_count} · filter={q}",
    ).model_dump())
    return {"deleted": result.deleted_count, "filter": {"verdict": verdict, "older_than_days": older_than_days}}


@api.post("/quarantine/forward")
async def quarantine_forward(payload: dict, request: Request, license_key: Optional[str] = None):
    """Karantinadaki bir maili farklı bir adrese `forward`. payload:
       { ids: [...], to: 'admin@example.com' }
    Plan gate: `quarantine_release` (aynı akış).
    """
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "quarantine_release")
    ids = payload.get("ids") or []
    to_addr = (payload.get("to") or "").strip()
    if not ids or not to_addr or "@" not in to_addr:
        raise HTTPException(400, "'ids' ve geçerli 'to' e-postası gerekli")
    match = {"id": {"$in": ids}}
    if not scope["is_master"]:
        match["owner_license_key"] = scope["owner_license_key"] or "__none__"
    docs = await db.quarantine.find(match, {"_id": 0}).to_list(500)
    forwarded = 0
    for d in docs:
        try:
            subj = f"[FWD-Karantina] {d.get('subject', '(konu yok)')}"
            body = (
                f"Karantinada tutulan mail forward edildi\n\n"
                f"Gönderici: {d.get('sender','?')}\n"
                f"Alıcı: {d.get('recipient','?')}\n"
                f"Verdict: {d.get('verdict','?')}\n"
                f"Alındı: {d.get('received_at','?')}\n\n"
                f"─── ORİJİNAL MAİL ───\n{d.get('body','')}\n"
            )
            ok, _ = await _send_email(to_addr, subj, body)
            if ok:
                forwarded += 1
        except Exception:
            pass
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="info",
        message=f"FORWARD · {forwarded}/{len(docs)} mail → {to_addr}",
    ).model_dump())
    return {"forwarded": forwarded, "total": len(docs), "to": to_addr}


@api.post("/quarantine/delete-orig")
async def quarantine_delete_orig(action: BulkAction, request: Request, license_key: Optional[str] = None):
    """Legacy alias — /quarantine/delete ile aynı davranır."""
    return await quarantine_delete(action, request, license_key)


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
async def lists_get(request: Request, list_type: Optional[str] = None,
                    scope: Optional[str] = None, license_key: Optional[str] = None):
    """Whitelist/Blacklist listesi — bayi/master scope'a göre izole.
    • Master: tüm kayıtlar veya `?license_key=X` ile bir bayinin.
    • Bayi: sadece kendi lisansının kayıtları (owner_license_key eşleşmesi).
    """
    sc = await _tenant_scope(request, license_key)
    q: dict = {}
    if list_type:
        q["list_type"] = list_type
    if scope:
        q["scope"] = scope
    if sc["is_master"]:
        if sc["owner_license_key"]:
            q["owner_license_key"] = sc["owner_license_key"]
        # aksi halde tüm kayıtlar (drill-down yok)
    else:
        # Bayi kendi verisini görür — owner_license_key eşleşmeli
        q["owner_license_key"] = sc["owner_license_key"] or "__none__"
    return await db.lists.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


class ListEntryIn(BaseModel):
    entry_type: Literal["ip", "domain", "email"]
    value: str
    scope: Literal["global", "user"] = "global"
    user: Optional[str] = None
    list_type: Literal["white", "black"]
    note: Optional[str] = ""


@api.post("/lists")
async def lists_add(entry: ListEntryIn, request: Request, license_key: Optional[str] = None):
    """Whitelist/Blacklist kayıt ekleme — plan bazlı feature gate:
    • black → `blacklist_manage`
    • white → `whitelist_manage`
    Bayi kendi lisansına atanır (`owner_license_key`)."""
    scope = await _tenant_scope(request, license_key)
    if not scope["is_master"] and not scope["owner_license_key"]:
        raise HTTPException(403, "Bu işlem için aktif bir lisans gerekli")
    feature = "blacklist_manage" if entry.list_type == "black" else "whitelist_manage"
    await _require_feature(scope, feature)
    obj = ListEntry(**entry.model_dump())
    doc = obj.model_dump()
    doc["owner_license_key"] = scope["owner_license_key"]
    await db.lists.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _authorize_list_action(entry_id: str, request: Request,
                                  license_key_arg: Optional[str]) -> dict:
    """Kayıt sahipliği kontrolü. Master hepsine, bayi sadece kendisine erişebilir."""
    scope = await _tenant_scope(request, license_key_arg)
    doc = await db.lists.find_one({"id": entry_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kayıt yok")
    if not scope["is_master"]:
        if not scope["owner_license_key"] or doc.get("owner_license_key") != scope["owner_license_key"]:
            raise HTTPException(403, "Bu kayıt sizin lisansınıza ait değil")
        # Bayi silmek istiyorsa yine feature kontrolü — plan kapalıysa engel
        feature = "blacklist_manage" if doc.get("list_type") == "black" else "whitelist_manage"
        await _require_feature(scope, feature)
    return doc


@api.delete("/lists/{entry_id}")
async def lists_delete(entry_id: str, request: Request, license_key: Optional[str] = None):
    await _authorize_list_action(entry_id, request, license_key)
    r = await db.lists.delete_one({"id": entry_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kayıt yok")
    return {"deleted": True}


# Apache/cPanel DELETE bloğu için POST alternatifi
@api.post("/lists/{entry_id}/delete")
async def lists_delete_post(entry_id: str, request: Request, license_key: Optional[str] = None):
    return await lists_delete(entry_id, request, license_key)


# ----- Rules -----
@api.get("/rules")
async def rules_get(request: Request, license_key: Optional[str] = None):
    """Kurallar listesi — bayi/master scope'a göre filtrelenir.

    • Master (x-master-key veya gws_master_session cookie): tüm kuralları görür,
      `?license_key=WS-…` ile belirli bir bayinin kurallarına drill-down yapabilir.
    • Bayi: sadece **kendi lisansının** eklediği kurallar görünür.
    """
    scope = await _tenant_scope(request, license_key)
    q = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            q = {"owner_license_key": scope["owner_license_key"]}
        # aksi halde tüm kurallar
    else:
        q = {"owner_license_key": scope["owner_license_key"]}
    return await db.rules.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


async def _rules_scope(request: Request, license_key_arg: Optional[str]) -> dict:
    """Rules izolasyon scope helper (`_tenant_scope`'un takma adı — geriye uyum)."""
    return await _tenant_scope(request, license_key_arg)


async def _plan_of_scope(scope: dict) -> str:
    """Verilen scope için efektif plan kodunu döner. Impersonation → hedef bayi
    planı. Master (non-impersonated) → enterprise. Bayi → kendi lisansının planı."""
    if scope.get("impersonated") and scope.get("owner_license_key"):
        lic = await db.licenses.find_one(
            {"license_key": scope["owner_license_key"]}, {"_id": 0, "plan": 1}
        )
        return str((lic or {}).get("plan", "starter")).lower()
    if scope.get("is_master"):
        return "enterprise"
    if scope.get("owner_license_key"):
        lic = await db.licenses.find_one(
            {"license_key": scope["owner_license_key"]}, {"_id": 0, "plan": 1}
        )
        return str((lic or {}).get("plan", "starter")).lower()
    return "starter"


async def _require_feature(scope: dict, feature: str) -> None:
    """Plan matris feature toggle kontrolü. Kapalıysa 403 ile net Türkçe mesaj döner.

    Master explicit bypass — impersonation aktif DEĞİLSE master her zaman geçer
    (self-lockout riskini önler; master'ın enterprise plan defaults'una bağımlılık
    yerine explicit kontrol)."""
    if scope.get("is_master") and not scope.get("impersonated"):
        return
    plan = await _plan_of_scope(scope)
    matrix = await _load_plan_matrix()
    allowed = bool((matrix.get(plan) or {}).get(feature, False))
    if not allowed:
        raise HTTPException(
            403,
            f"Bu özellik ({feature}) {plan} planınızda kapalı — üst versiyona geçin.",
        )


async def _tenant_scope(request: Request, license_key_arg: Optional[str]) -> dict:
    """Multi-tenant izolasyon scope helper — `tenant.resolve_tenant_scope`'a delege eder.

    Impersonation (master bayi görünümüne geçme) kontrolü sadece burada kalır çünkü
    IMPERSONATE_COOKIE server.py'a özel bir konsepttir.
    """
    from tenant import resolve_tenant_scope
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    hdr = request.headers.get("x-master-key") or ""
    cookie = request.cookies.get("gws_master_session") or ""
    impersonate = (
        request.cookies.get(IMPERSONATE_COOKIE)
        if "IMPERSONATE_COOKIE" in globals()
        else request.cookies.get("gws_impersonate")
    )
    if impersonate and master_env and (hdr == master_env or cookie == master_env or license_key_arg == master_env):
        return {"is_master": False, "owner_license_key": impersonate, "impersonated": True}
    return await resolve_tenant_scope(request, license_key_arg, db)


class RuleIn(BaseModel):
    name: str
    pattern: str
    score: float
    target: Literal["subject", "body", "header", "from", "any"] = "any"
    enabled: bool = True
    description: Optional[str] = ""


@api.post("/rules")
async def rules_add(rule: RuleIn, request: Request, license_key: Optional[str] = None):
    scope = await _tenant_scope(request, license_key)
    # Ziyaretçi (lisanssız ziyaretçi) kural ekleyemez — demo_write_guard zaten
    # engelliyor ama defense-in-depth için burada da doğrulayalım.
    if not scope["is_master"] and not scope["owner_license_key"]:
        raise HTTPException(403, "Kural eklemek için lisans gerekli")
    # Plan matrisi custom_rules kapalıysa engel (master her zaman geçer)
    if not scope["is_master"]:
        await _require_feature(scope, "custom_rules")
    obj = Rule(**rule.model_dump())
    doc = obj.model_dump()
    # scope.owner_license_key: bayi ise kendi lisansı; master global için "";
    # master drill-down için hedef bayi lisansı.
    doc["owner_license_key"] = scope["owner_license_key"]
    await db.rules.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def _authorize_rule_action(rule_id: str, request: Request, license_key: Optional[str]) -> dict:
    """Kural sahibi mi kontrol et. Master hepsine erişebilir; bayi sadece
    `owner_license_key == kendi lisansı` olanlara. Bulamazsa 404, izin yoksa 403.
    Ayrıca plan bazlı `custom_rules` kapalı ise 403."""
    scope = await _tenant_scope(request, license_key)
    rule = await db.rules.find_one({"id": rule_id}, {"_id": 0})
    if not rule:
        raise HTTPException(404, "Kural bulunamadı")
    if scope["is_master"]:
        return rule
    if not scope["owner_license_key"] or rule.get("owner_license_key") != scope["owner_license_key"]:
        raise HTTPException(403, "Bu kural sizin lisansınıza ait değil")
    # Plan matrisi kural düzenlemeyi kapatmış olabilir
    await _require_feature(scope, "custom_rules")
    return rule


@api.put("/rules/{rule_id}")
async def rules_update(rule_id: str, rule: RuleIn, request: Request, license_key: Optional[str] = None):
    existing = await _authorize_rule_action(rule_id, request, license_key)
    upd = rule.model_dump()
    upd["owner_license_key"] = existing.get("owner_license_key", "")  # sahiplik değişmez
    r = await db.rules.update_one({"id": rule_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"updated": True}


# Apache/cPanel PUT/DELETE bloğu için POST alternatifleri
@api.post("/rules/{rule_id}/update")
async def rules_update_post(rule_id: str, rule: RuleIn, request: Request, license_key: Optional[str] = None):
    return await rules_update(rule_id, rule, request, license_key)


@api.delete("/rules/{rule_id}")
async def rules_delete(rule_id: str, request: Request, license_key: Optional[str] = None):
    await _authorize_rule_action(rule_id, request, license_key)
    r = await db.rules.delete_one({"id": rule_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"deleted": True}


@api.post("/rules/{rule_id}/delete")
async def rules_delete_post(rule_id: str, request: Request, license_key: Optional[str] = None):
    return await rules_delete(rule_id, request, license_key)


# ----- Engines -----
async def _engines_for(owner: str) -> list:
    """Bir owner (bayi lisansı veya master boş) için motor listesi.
    Bayi tarafında ilk çağrıda global template'den bootstrap eder — her bayi
    kendi bağımsız engine on/off state'ine sahip olur."""
    rows = await db.engines.find({"owner_license_key": owner}, {"_id": 0}).to_list(20)
    if rows:
        return rows
    # Bootstrap: master global engines'i klonla, sahibi bayi olsun
    template = await db.engines.find({"owner_license_key": ""}, {"_id": 0}).to_list(20)
    if not template:
        template = await db.engines.find({"owner_license_key": {"$exists": False}}, {"_id": 0}).to_list(20)
    if not owner or not template:
        return template
    seed = []
    for t in template:
        t2 = {**t}
        t2.pop("_id", None)
        t2["owner_license_key"] = owner
        seed.append(t2)
    if seed:
        await db.engines.insert_many(seed)
    return await db.engines.find({"owner_license_key": owner}, {"_id": 0}).to_list(20)


@api.get("/engines")
async def engines_get(request: Request, license_key: Optional[str] = None):
    """Motor listesi — bayi/master scope'a göre izole edilir. Bayi kendi
    on/off state'ini görür; toggle diğer bayileri veya master WHM'i etkilemez.
    `scanned_today` / `caught_today` sayaçları bayinin kendi `mail_events`
    verisinden bugün için canlı hesaplanır — master'ın statik seed'i değil."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"] or ""
    engines = await _engines_for(owner)
    # Bugün başlangıcı (UTC)
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    # Owner filter: master (owner boş) → tüm eventler, bayi → sadece kendi lisansı
    match = {"ts": {"$gte": day_start}}
    if owner:
        match["license_key"] = owner
    # Toplam bugünkü mail sayısı = her motor için "scanned_today"
    total_scanned = await db.mail_events.count_documents(match)
    # Motor bazında bugünkü "caught" sayısı (spam/virus/phish/blocked verdict'leri)
    caught_verdicts = ["spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"]
    pipeline = [
        {"$match": {**match, "verdict": {"$in": caught_verdicts}}},
        {"$group": {"_id": "$engine", "n": {"$sum": 1}}},
    ]
    caught_by_engine: dict = {}
    async for row in db.mail_events.aggregate(pipeline):
        eng_name = (row.get("_id") or "").lower()
        caught_by_engine[eng_name] = int(row.get("n") or 0)
    # Motor dokümanlarına canlı sayaçları overlay et
    for e in engines:
        eng_name = (e.get("name") or "").lower()
        e["scanned_today"] = total_scanned
        e["caught_today"] = caught_by_engine.get(eng_name, 0)
    return engines


@api.post("/engines/{name}/toggle")
async def engines_toggle(name: str, request: Request, license_key: Optional[str] = None):
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    # Bootstrap edilmemişse yap
    await _engines_for(owner)
    doc = await db.engines.find_one({"name": name, "owner_license_key": owner})
    if not doc:
        raise HTTPException(404, "Motor bulunamadı")
    new_val = not doc.get("enabled", False)
    await db.engines.update_one(
        {"name": name, "owner_license_key": owner},
        {"$set": {"enabled": new_val}},
    )
    await db.logs.insert_one(ActivityLog(
        source=name, level="info",
        message=f"{doc.get('label', name)} {'etkinleştirildi' if new_val else 'devre dışı bırakıldı'} · scope={owner[:16] if owner else 'master'}",
    ).model_dump())
    return {"name": name, "enabled": new_val}


# ----- Settings -----
@api.get("/settings")
async def settings_get(request: Request, license_key: Optional[str] = None):
    """Politika ayarları — her bayi kendi threshold/quarantine/notification
    tercihine sahip olur. Master ise "policy" global default'unu görür."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    key = f"policy:{owner}" if owner else "policy"
    doc = await db.settings.find_one({"_key": key}, {"_id": 0, "_key": 0})
    if not doc and owner:
        # Bayi için ilk çağrı: master defaults'tan klonla
        default = await db.settings.find_one({"_key": "policy"}, {"_id": 0, "_key": 0})
        doc = default or PolicySettings().model_dump()
        await db.settings.update_one(
            {"_key": key}, {"$set": {**doc, "_key": key}}, upsert=True,
        )
    return doc or PolicySettings().model_dump()


@api.put("/settings")
async def settings_put(policy: PolicySettings, request: Request,
                       license_key: Optional[str] = None):
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    key = f"policy:{owner}" if owner else "policy"
    await db.settings.update_one(
        {"_key": key}, {"$set": {**policy.model_dump(), "_key": key}}, upsert=True
    )
    await db.logs.insert_one(ActivityLog(
        source="settings", level="info",
        message=f"Politika güncellendi (threshold {policy.spam_threshold_low}/{policy.spam_threshold_high}) · scope={owner[:16] if owner else 'master'}",
    ).model_dump())
    return policy.model_dump()


# Apache PUT bloğu için POST alternatifi
@api.post("/settings/update")
async def settings_put_post(policy: PolicySettings, request: Request,
                            license_key: Optional[str] = None):
    return await settings_put(policy, request, license_key)


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

    Accepts the license key from either the `license_key` query/body arg or the
    `X-Master-Key` HTTP header (parity with `demo_write_guard` middleware and
    `gws_master_session` cookie flow).
    """
    # Fallback: header (parity with mutating endpoints)
    if not license_key:
        license_key = request.headers.get("x-master-key") or None
    # Fallback: cookie (30-day master session)
    if not license_key:
        license_key = request.cookies.get("gws_master_session") or None

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
    resp = {
        "is_master": is_master,
        "ip_match": ip_match,
        "key_match": key_match,
        "client_ip": client_ip,
    }
    # SECURITY: Master IP/host bilgileri BAYIYE SIZMASIN. Sadece master
    # doğrulanmış çağrılarda döndür — bayi tarafında gizli kalır.
    if is_master:
        resp["master_ip"] = MASTER_IP
        resp["master_host"] = MASTER_HOST
    return resp


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


@api.get("/admin/resellers-live")
async def admin_resellers_live(request: Request, license_key: Optional[str] = None,
                               hours: int = 24):
    """Master-only. **Canlı Bayi Trafik Panosu** — her aktif bayi için son N saatlik
    mail trafiği, spam/virüs/phishing kırılımı, blok sayısı ve son aktivite zamanı
    döner. Master dashboard "yan yana bayi kartları" için tasarlandı.

    Response: {
      "hours": 24, "generated_at": iso, "total_resellers": N,
      "resellers": [
        { "id", "email", "company", "license_key", "plan", "active", "online",
          "last_seen_at", "counters": {"mails","spam","virus","phish","blocks","clean"},
          "spam_ratio_pct" }, ...
      ]
    }"""
    await _require_master(request, license_key)
    hours = max(1, min(hours, 168))  # 1 hour .. 1 week
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    online_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    out = []
    # Bayi kaynakları: hem db.resellers (auth'lı bayi hesapları) hem de
    # db.licenses (lisans olarak oluşturulan bayiler, master hariç). Aynı
    # license_key iki kez saymamak için seen set'i kullanılır.
    seen_keys = set()
    sources = []
    async for r in db.resellers.find({}, {"_id": 0, "password_hash": 0}):
        sources.append({"kind": "reseller", "doc": r})
        if r.get("license_key"):
            seen_keys.add(r["license_key"])
    master_key_env = os.environ.get("MASTER_LICENSE_KEY", "")
    async for l in db.licenses.find({"active": True}, {"_id": 0}):
        lk = l.get("license_key") or ""
        if not lk or lk == master_key_env or lk in seen_keys:
            continue
        seen_keys.add(lk)
        sources.append({"kind": "license", "doc": l})
    for src in sources:
        r = src["doc"]
        is_license = src["kind"] == "license"
        lic_key = r.get("license_key") or ""
        # count breakdown in a single aggregation
        pipeline = [
            {"$match": {"license_key": lic_key, "ts": {"$gte": cutoff}}},
            {"$group": {"_id": "$verdict", "n": {"$sum": 1}}},
        ]
        counters = {"mails": 0, "spam": 0, "virus": 0, "phish": 0, "blocks": 0, "clean": 0}
        try:
            async for row in db.mail_events.aggregate(pipeline):
                v = (row.get("_id") or "").lower()
                n = int(row.get("n") or 0)
                counters["mails"] += n
                if v in ("spam", "high_spam"):
                    counters["spam"] += n
                elif v == "virus":
                    counters["virus"] += n
                elif v in ("phish", "phishing"):
                    counters["phish"] += n
                elif v in ("block", "blocked"):
                    counters["blocks"] += n
                elif v == "clean":
                    counters["clean"] += n
        except Exception:
            pass
        # violations in period (attacks against license)
        violations_period = 0
        try:
            violations_period = await db.license_violations.count_documents(
                {"license_key": lic_key, "at": {"$gte": cutoff}}
            )
        except Exception:
            pass
        last_seen = r.get("last_heartbeat_at") or r.get("last_seen_at") or ""
        online = bool(last_seen and last_seen >= online_cutoff)
        spam_ratio = round(
            (counters["spam"] + counters["virus"] + counters["phish"]) / counters["mails"] * 100, 1
        ) if counters["mails"] else 0
        if is_license:
            email = r.get("customer_email") or ""
            company = r.get("customer_name") or r.get("customer_email") or "Bayi"
            plan_name = r.get("plan", "")
            active_flag = r.get("active", True)
            rid = r.get("id") or lic_key
        else:
            email = r.get("email") or ""
            company = r.get("company", "")
            plan_name = r.get("plan", "")
            active_flag = r.get("active", True)
            rid = r.get("id")
        out.append({
            "id": rid,
            "email": email,
            "company": company,
            "license_key": lic_key,
            "plan": plan_name,
            "active": active_flag,
            "online": online,
            "last_seen_at": last_seen,
            "counters": counters,
            "violations_period": violations_period,
            "spam_ratio_pct": spam_ratio,
            "source": src["kind"],  # frontend "lisans / bayi hesabı" ayrımı için
        })
    # Sort by activity: online first, then by mails desc
    out.sort(key=lambda x: (not x["online"], -x["counters"]["mails"]))
    # Sağlık rengi — her bayi için son heartbeat'e göre.
    #   green : son 5 dakika (aktif)
    #   yellow: 5-30 dakika (yavaşlamış)
    #   red   : 30+ dakika veya hiç yok (kopuk)
    now2 = datetime.now(timezone.utc)
    for x in out:
        ls = x.get("last_seen_at") or ""
        health = "red"
        minutes_since = None
        if ls:
            try:
                d = datetime.fromisoformat(str(ls).replace("Z", "+00:00"))
                minutes_since = int((now2 - d).total_seconds() // 60)
                if minutes_since < 5:
                    health = "green"
                elif minutes_since < 30:
                    health = "yellow"
                else:
                    health = "red"
            except Exception:
                pass
        x["health"] = health
        x["minutes_since_seen"] = minutes_since
    return {
        "hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_resellers": len(out),
        "online_count": sum(1 for x in out if x["online"]),
        "resellers": out,
    }


@api.post("/admin/plugin-health/{lic_key}/queue-update")
async def admin_plugin_health_queue_update(lic_key: str, request: Request,
                                            license_key: Optional[str] = None):
    """Master-only. Belirli bir bayinin plugin güncellemesini kuyruğa al.
    Bayi WHM sunucusundaki plugin daemon `/api/events/pending-actions` endpoint'ini
    poll ederken bu action'ı görür ve `install-bayi.sh` betiğini çalıştırır."""
    await _require_master(request, license_key)
    lic_doc = await db.licenses.find_one({"license_key": lic_key}, {"_id": 0, "license_key": 1})
    if not lic_doc:
        raise HTTPException(404, "Lisans bulunamadı")
    # Zaten bekleyen bir update aksiyonu var mı? (spam önleme)
    existing = await db.pending_quarantine_actions.find_one({
        "license_key": lic_key, "action_type": "plugin_update", "completed_at": None,
    }, {"_id": 0, "id": 1})
    if existing:
        return {"ok": True, "already_queued": True, "action_id": existing["id"]}
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    master_url = f"https://{MASTER_HOST}" if MASTER_HOST else ""
    action = {
        "id": aid,
        "license_key": lic_key,
        "action_type": "plugin_update",
        "command": (
            f"curl -fsSL {master_url}/api/scripts/install-bayi.sh | "
            f"sudo LICENSE_KEY={lic_key} MASTER_URL={master_url} bash"
        ),
        "created_at": now,
        "completed_at": None,
        "queued_by": "master",
    }
    await db.pending_quarantine_actions.insert_one(action)
    return {"ok": True, "action_id": aid, "queued_at": now}


@api.get("/admin/plugin-health/list")
async def admin_plugin_health_list(request: Request, license_key: Optional[str] = None,
                                     hours: int = 24):
    """Master-only. Tüm bayilerin son N saatteki plugin normalize sağlığı listesi.
    Dashboard için: kim ne kadar normalize etmiş, son alert zamanı, status.

    v42: Redis cache 15sn TTL (Plugin Health 30sn polling → ~%50 cache hit,
    ~5 count × N bayi hesaplamasını atlar)."""
    await _require_master(request, license_key)
    # Cache lookup — master-only endpoint, key global
    from cache import cache as _pcache
    _ck = f"plugin_health_list:h{int(hours)}"
    cached = await _pcache.get(_ck)
    if cached is not None:
        return cached
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    items = []
    async for r in db.resellers.find({}, {"_id": 0}):
        lk = r.get("license_key") or ""
        if not lk:
            continue
        total = await db.mail_events.count_documents({
            "license_key": lk, "ingested_at": {"$gte": since},
        })
        normalized = await db.mail_events.count_documents({
            "license_key": lk, "score_normalized": True, "ingested_at": {"$gte": since},
        })
        clamped = await db.mail_events.count_documents({
            "license_key": lk, "score_clamped": True, "ingested_at": {"$gte": since},
        })
        last_alert = await db.master_alerts.find_one(
            {"type": "plugin_normalization", "license_key": lk},
            {"_id": 0, "created_at": 1, "normalized_count": 1, "seen": 1},
            sort=[("created_at", -1)],
        )
        pending_update = await db.pending_quarantine_actions.find_one(
            {"license_key": lk, "action_type": "plugin_update", "completed_at": None},
            {"_id": 0, "id": 1, "created_at": 1},
        )
        last_update = await db.pending_quarantine_actions.find_one(
            {"license_key": lk, "action_type": "plugin_update", "completed_at": {"$ne": None}},
            {"_id": 0, "completed_at": 1, "result": 1},
            sort=[("completed_at", -1)],
        )
        ratio = (normalized / total * 100) if total else 0
        status = "healthy"
        if normalized > 100: status = "critical"
        elif ratio > 20 and total >= 20: status = "warning"
        items.append({
            "license_key": lk,
            "email": r.get("email") or "",
            "company": r.get("company") or "",
            "active": r.get("active", True),
            "total": total,
            "normalized": normalized,
            "clamped": clamped,
            "ratio": round(ratio, 1),
            "status": status,
            "last_alert_at": last_alert.get("created_at") if last_alert else None,
            "last_alert_count": last_alert.get("normalized_count") if last_alert else None,
            "last_alert_seen": last_alert.get("seen") if last_alert else None,
            "pending_update_at": pending_update.get("created_at") if pending_update else None,
            "last_update_at": last_update.get("completed_at") if last_update else None,
            "last_update_result": last_update.get("result") if last_update else None,
        })
    # Kritik ve uyarı olanları başa al
    order = {"critical": 0, "warning": 1, "healthy": 2}
    items.sort(key=lambda x: (order.get(x["status"], 3), -x["normalized"]))
    total_bayi = len(items)
    critical = sum(1 for i in items if i["status"] == "critical")
    warning = sum(1 for i in items if i["status"] == "warning")
    result = {
        "items": items, "total_bayi": total_bayi,
        "critical": critical, "warning": warning,
        "healthy": total_bayi - critical - warning,
        "hours": hours,
    }
    await _pcache.set(_ck, result, 15.0)
    return result


@api.post("/admin/plugin-health/scan")
async def admin_plugin_health_scan(request: Request, license_key: Optional[str] = None,
                                    threshold: int = 100, hours: int = 24,
                                    force: bool = False):
    """Master-only. Plugin normalization taramasını manuel tetikle.
    Test için: `threshold=1` yapıp mevcut normalize sayısını uyarı olarak yaz.
    `force=true` ile dedup'u atlar; aksi halde 1 saat dedup uygulanır."""
    await _require_master(request, license_key)
    dedupe = 0 if force else 1
    created = await _plugin_normalization_scan_once(
        threshold=threshold, hours=hours, dedupe_hours=dedupe
    )
    return {"ok": True, "created": created, "threshold": threshold,
            "hours": hours, "dedupe_hours": dedupe}


@api.get("/admin/threat-alerts")
async def admin_threat_alerts(request: Request, license_key: Optional[str] = None,
                              limit: int = 50, unseen_only: bool = False):
    """Master-only. Son N tehdit oranı alert'ini döner. Frontend zil ikonu polling yapar."""
    await _require_master(request, license_key)
    q = {"seen": False} if unseen_only else {}
    limit = max(1, min(limit, 200))
    items = []
    async for a in db.master_alerts.find(q, {"_id": 0}).sort("created_at", -1).limit(limit):
        items.append(a)
    unseen_count = await db.master_alerts.count_documents({"seen": False})
    return {"items": items, "unseen_count": unseen_count, "returned": len(items)}


@api.post("/admin/threat-alerts/{alert_id}/ack")
async def admin_threat_alert_ack(alert_id: str, request: Request,
                                 license_key: Optional[str] = None):
    """Master alert'i okundu (seen=True) işaretler."""
    await _require_master(request, license_key)
    r = await db.master_alerts.update_one({"id": alert_id}, {"$set": {"seen": True}})
    if r.matched_count == 0:
        raise HTTPException(404, "Alert bulunamadı")
    unseen_count = await db.master_alerts.count_documents({"seen": False})
    return {"ok": True, "unseen_count": unseen_count}


@api.post("/admin/threat-alerts/ack-all")
async def admin_threat_alerts_ack_all(request: Request, license_key: Optional[str] = None):
    """Master bütün unseen alert'leri okundu işaretler."""
    await _require_master(request, license_key)
    r = await db.master_alerts.update_many({"seen": False}, {"$set": {"seen": True}})
    return {"ok": True, "acked": r.modified_count}


@api.post("/admin/threat-alerts/scan")
async def admin_threat_alerts_scan(request: Request, license_key: Optional[str] = None,
                                   min_mails: int = 20, threshold_pct: int = 30,
                                   window_minutes: int = 60):
    """Master anında bir tarama tetikleyebilir (background scheduler bekleyip vakit
    kaybetmesin diye)."""
    await _require_master(request, license_key)
    created = await _threat_ratio_scan_once(
        min_mails=max(1, min_mails),
        threshold=max(0.01, min(0.99, threshold_pct / 100)),
        window_minutes=max(5, min(1440, window_minutes)),
    )
    return {"ok": True, "created": created}


# ------------------ Plan Upgrade Funnel Analytics ------------------
class PlanEventIn(BaseModel):
    event: str  # gate_view | gate_click | modal_open | cycle_change | checkout_click | purchase
    feature: Optional[str] = None
    current_plan: Optional[str] = None
    target_plan: Optional[str] = None
    cycle: Optional[str] = None  # monthly|yearly
    license_key: Optional[str] = None
    session_id: Optional[str] = None
    page: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


@api.post("/analytics/plan-event")
async def analytics_plan_event(payload: PlanEventIn, request: Request):
    """Frontend PlanGate/PlanUpgradeModal her aşamada bu endpoint'e event yazar.
    Ziyaretçilerden de gelebilir; demo-lock yok (allow-list'te)."""
    valid = {"gate_view", "gate_click", "modal_open", "cycle_change", "checkout_click", "purchase"}
    if payload.event not in valid:
        raise HTTPException(400, f"Geçersiz event: {payload.event}")
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["ip"] = _client_ip(request)
    doc["user_agent"] = (request.headers.get("user-agent") or "")[:250]
    await db.plan_events.insert_one(doc)
    return {"ok": True, "id": doc["id"]}


@api.get("/admin/plan-funnel")
async def admin_plan_funnel(request: Request, license_key: Optional[str] = None,
                            days: int = 30):
    """Master-only. Plan-upgrade huni raporu:
      • funnel: her aşamanın toplam sayısı ve önceki aşamadan dönüşüm oranı
      • by_feature: hangi PlanGate feature'ı en çok tıklandı → en çok satın alındı
      • by_target_plan: hedef plana göre dağılım
      • recent: son 20 event (debug için)"""
    await _require_master(request, license_key)
    days = max(1, min(days, 365))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    match = {"created_at": {"$gte": cutoff}}

    # Aşama sayaçları
    stages = ["gate_view", "gate_click", "modal_open", "checkout_click", "purchase"]
    counts = {s: 0 for s in stages}
    async for row in db.plan_events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$event", "n": {"$sum": 1}}},
    ]):
        ev = row.get("_id")
        if ev in counts:
            counts[ev] = int(row.get("n") or 0)

    funnel = []
    prev = None
    for s in stages:
        n = counts[s]
        # Cap conversion at 100% (later stages may exceed earlier when older
        # events fall outside the same window — surface as "≥100%" cap).
        if prev:
            conv = round(min(100.0, n / prev * 100), 1)
        else:
            conv = 100.0
        funnel.append({"stage": s, "count": n, "conversion_pct": conv})
        prev = n if n else prev  # keep last non-zero to avoid /0

    # Feature breakdown (gate_click → purchase)
    by_feature: Dict[str, Dict[str, int]] = {}
    async for row in db.plan_events.aggregate([
        {"$match": {**match, "event": {"$in": ["gate_click", "purchase"]}}},
        {"$group": {"_id": {"feature": "$feature", "event": "$event"}, "n": {"$sum": 1}}},
    ]):
        f = row["_id"].get("feature") or "unknown"
        ev = row["_id"].get("event")
        by_feature.setdefault(f, {"gate_click": 0, "purchase": 0})
        by_feature[f][ev] = int(row.get("n") or 0)
    feature_rows = []
    for f, s in by_feature.items():
        clicks = s.get("gate_click", 0)
        purchases = s.get("purchase", 0)
        feature_rows.append({
            "feature": f,
            "clicks": clicks,
            "purchases": purchases,
            "conversion_pct": round(purchases / clicks * 100, 1) if clicks else 0,
        })
    feature_rows.sort(key=lambda x: -x["clicks"])

    # Target-plan breakdown
    by_target_plan = []
    async for row in db.plan_events.aggregate([
        {"$match": {**match, "event": {"$in": ["gate_click", "purchase"]}}},
        {"$group": {"_id": {"target_plan": "$target_plan", "event": "$event"}, "n": {"$sum": 1}}},
    ]):
        by_target_plan.append({
            "target_plan": row["_id"].get("target_plan") or "unknown",
            "event": row["_id"].get("event"),
            "count": int(row.get("n") or 0),
        })

    # Recent events (last 20)
    recent = []
    async for r in db.plan_events.find(match, {"_id": 0}).sort("created_at", -1).limit(20):
        recent.append(r)

    return {
        "days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "funnel": funnel,
        "by_feature": feature_rows,
        "by_target_plan": by_target_plan,
        "recent": recent,
    }


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

    dl_host = f"https://{MASTER_HOST}/api/plugin/download/{version}"
    dl_ip   = f"http://{MASTER_IP}/api/plugin/download/{version}"
    release_date = datetime.now(timezone.utc).isoformat()

    # Dist klasöründe bu versiyon dosyasını hazırla (yoksa latest'ten kopyala,
    # varsa latest → bu versiyon olarak alias'la). Yeni sürüm çıkarıldığında
    # /api/plugin/download otomatik bu paketi servis edecek.
    promoted = _promote_dist_version(version)

    manifest = {
        "_key": "version_manifest",
        "latest_version": version,
        "download_url": dl_host,
        "download_url_ip": dl_ip,
        "download_url_generic": f"https://{MASTER_HOST}/api/plugin/download",
        "package_path": promoted,
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
    # Yeni lisans oluşturulduğunda revoke listesinden ilgili tüm kayıtları temizle
    # (aynı license_key / hostname / IP daha önce silinmiş olabilir). Aksi halde
    # verify çağrısı hâlâ "master tarafından iptal edildi" der.
    or_conds = [{"license_key": obj.license_key}]
    for host in (obj.panel_domains or []):
        or_conds.append({"hostname": host.lower()})
    for ip in (obj.ip_addresses or []):
        or_conds.append({"ip": ip})
    if or_conds:
        cleanup = await db.revoked_licenses.delete_many({"$or": or_conds})
        if cleanup.deleted_count:
            await db.logs.insert_one(ActivityLog(
                source="license", level="info",
                message=f"Yeni lisans oluşturuldu, {cleanup.deleted_count} revoke kaydı otomatik temizlendi",
            ).model_dump())
    # plugin_state cache'ini de sıfırla ki eski revoke bilgisi kalmasın
    await db.settings.update_one(
        {"_key": "plugin_state"},
        {"$unset": {"revoked_at": ""}},
    )
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Yeni lisans oluşturuldu: {obj.customer_name} → {obj.license_key} (IP: {', '.join(obj.ip_addresses) or 'yok'})",
    ).model_dump())
    return obj.model_dump()


@api.put("/licenses/{lid}")
async def licenses_update(lid: str, payload: LicenseIn):
    # Önceki plan/state → diff için kaydet
    prev = await db.licenses.find_one({"id": lid}, {"_id": 0}) or {}
    r = await db.licenses.update_one({"id": lid}, {"$set": payload.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Lisans bulunamadı")
    # Update sonrası revoke temizle — kullanıcı yeni IP eklediyse veya aktifleştirdiyse
    # eski revoke kayıtları verify'ı bloklamasın. license_key ve panel_domains
    # LicenseIn içinde yok (immutable/DB-managed), o yüzden mevcut kayıttan oku.
    existing = await db.licenses.find_one({"id": lid}, {"_id": 0, "license_key": 1, "panel_domains": 1}) or {}
    or_conds = []
    if existing.get("license_key"):
        or_conds.append({"license_key": existing["license_key"]})
    for host in (existing.get("panel_domains") or []):
        or_conds.append({"hostname": host.lower()})
    for ip in (payload.ip_addresses or []):
        or_conds.append({"ip": ip})
    if or_conds and payload.active:
        await db.revoked_licenses.delete_many({"$or": or_conds})
    # Plan değişimi → bayiye WS bildirim (panel canlı olarak yeni yetkileri görsün)
    try:
        old_plan = (prev.get("plan") or "").lower()
        new_plan = (payload.plan or "").lower()
        if old_plan != new_plan and new_plan:
            from routes.maintenance import push_attack_event
            await push_attack_event({
                "type": "plan_changed",
                "license_key": existing.get("license_key"),
                "old_plan": old_plan or "-",
                "new_plan": new_plan,
                "customer_name": prev.get("customer_name") or "",
                "ts": _iso(),
            })
            await db.logs.insert_one(ActivityLog(
                source="license", level="info",
                message=f"Plan değişti: {existing.get('license_key','?')[:16]}… "
                        f"{old_plan or '-'} → {new_plan}",
            ).model_dump())
    except Exception:
        pass
    return {"updated": True}


@api.delete("/licenses/{lid}")
async def licenses_delete(lid: str):
    # id ile dene, bulamazsa license_key olarak dene (eski seed'ler id-siz olabilir)
    doc = await db.licenses.find_one({"id": lid}, {"_id": 0})
    if not doc:
        doc = await db.licenses.find_one({"license_key": lid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Lisans bulunamadı")
    # Silinen lisansı revoke listesine ekle → NS auto-license bunu tekrar
    # oluşturmaz (kullanıcı manuel sildikten sonra kalıcı olarak silinsin diye)
    ip_addrs = doc.get("ip_addresses") or []
    revoke_entry = {
        "license_key": doc.get("license_key"),
        "hostname": (doc.get("panel_domains") or [None])[0] if doc.get("panel_domains") else None,
        "ip": ip_addrs[0] if ip_addrs else None,
        "ips_all": ip_addrs,
        "customer_name": doc.get("customer_name"),
        "revoked_at": datetime.now(timezone.utc).isoformat(),
        "reason": "manual_delete",
    }
    await db.revoked_licenses.update_one(
        {"license_key": revoke_entry["license_key"]},
        {"$set": revoke_entry},
        upsert=True,
    )
    # Ayrıca her ip için ayrı revoke kaydı — verify $or match'lesin
    for ip in ip_addrs:
        await db.revoked_licenses.update_one(
            {"ip": ip, "license_key": doc.get("license_key")},
            {"$set": {**revoke_entry, "ip": ip}},
            upsert=True,
        )
    r = await db.licenses.delete_one({"id": doc["id"]})
    return {"deleted": True, "revoked": True, "license_key": doc.get("license_key")}


@api.post("/licenses/{lid}/update")
async def licenses_update_post(lid: str, payload: LicenseIn):
    """POST alternatifi — cPanel/Apache/WAF ortamlarında PUT bloklu olabildiği
    için birebir aynı işlemi POST üzerinden sunar."""
    return await licenses_update(lid, payload)


@api.post("/licenses/{lid}/delete")
async def licenses_delete_post(lid: str):
    """POST alternatifi — DELETE method'u proxy/WAF tarafından bloklu olabilir.
    Bu endpoint aynı silme işlemini POST ile yapar."""
    return await licenses_delete(lid)


@api.post("/licenses/{lid}/toggle-active")
async def licenses_toggle_active(lid: str, request: Request, license_key: Optional[str] = None):
    """Tek tıkla aktif/pasif — mevcut durumu tersine çevirir. WAF-safe POST.
    Deaktive edildiyse bayinin panelinde bir sonraki `plugin/status` çağrısında
    `session_expired:true` bayrağı düşer ve panel oturumu otomatik kapanır.
    Broadcast: `type=license_state_changed` WS mesajı."""
    await _require_master(request, license_key)
    doc = await db.licenses.find_one({"id": lid}, {"_id": 0, "active": 1, "license_key": 1, "plan": 1, "customer_name": 1})
    if not doc:
        raise HTTPException(404, "Lisans bulunamadı")
    new_active = not doc.get("active", True)
    await db.licenses.update_one({"id": lid}, {"$set": {"active": new_active}})
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Lisans {lid[:8]}… → {'aktif' if new_active else 'pasif'}",
    ).model_dump())
    # WS broadcast — bayi paneli anında yeni durumu görsün
    try:
        from routes.maintenance import push_attack_event
        await push_attack_event({
            "type": "license_state_changed",
            "license_key": doc.get("license_key"),
            "active": new_active,
            "customer_name": doc.get("customer_name") or "",
            "ts": _iso(),
        })
    except Exception:
        pass
    return {"ok": True, "id": lid, "active": new_active}


@api.post("/licenses/{lid}/broadcast-refresh")
async def licenses_broadcast_refresh(lid: str, request: Request, license_key: Optional[str] = None):
    """**Zorla Güncelleme İletimi** — Master lisans üzerinde değişiklik yaptıktan sonra
    hedef panel(ler)in cache'lerini bir sonraki `plugin/verify-license` çağrısında
    yenilemesini garantiler.

    Uygulama: lisans belgesindeki `license_version` sayacını 1 arttırır. Uzak
    plugin script'i (`mailshield-logtail.pl` ve panel frontend) her polling'de
    bu değeri okur; değiştiğinde yerel `.mailshield/license.cache` dosyasını
    yeniden yükler ve panel React query cache'ini invalidate eder.

    Ayrıca `license_events` collection'ına bir `refresh_requested` kaydı düşer
    (heartbeat frontend'i son 60 saniye içindeki bu kayıtları toast ile bildirir)."""
    await _require_master(request, license_key)
    doc = await db.licenses.find_one({"id": lid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Lisans bulunamadı")
    new_ver = int(doc.get("license_version") or 0) + 1
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.licenses.update_one(
        {"id": lid},
        {"$set": {"license_version": new_ver, "refresh_requested_at": now_iso}},
    )
    await db.license_events.insert_one({
        "id": str(uuid.uuid4()),
        "license_key": doc.get("license_key"),
        "license_id": lid,
        "event": "refresh_requested",
        "version": new_ver,
        "created_at": now_iso,
    })
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Lisans {lid[:8]}… için zorla güncelleme iletildi (v{new_ver})",
    ).model_dump())
    return {"ok": True, "id": lid, "license_version": new_ver, "at": now_iso}


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
        # Silmeden ÖNCE revoke listesine ekle ki NS auto-license
        # kalıcı silinen lisansları tekrar oluşturmasın.
        docs = await db.licenses.find(match, {"_id": 0}).to_list(1000)
        now = datetime.now(timezone.utc).isoformat()
        if docs:
            for d in docs:
                if not d.get("license_key"):
                    continue
                ips = d.get("ip_addresses") or []
                base = {
                    "license_key": d.get("license_key"),
                    "hostname": (d.get("panel_domains") or [None])[0] if d.get("panel_domains") else None,
                    "ip": ips[0] if ips else None,
                    "ips_all": ips,
                    "customer_name": d.get("customer_name"),
                    "revoked_at": now,
                    "reason": "bulk_delete",
                }
                await db.revoked_licenses.update_one(
                    {"license_key": base["license_key"]}, {"$set": base}, upsert=True
                )
                for ip in ips:
                    await db.revoked_licenses.update_one(
                        {"ip": ip, "license_key": d.get("license_key")},
                        {"$set": {**base, "ip": ip}},
                        upsert=True,
                    )
        r = await db.licenses.delete_many(match)
        affected = r.deleted_count
    elif payload.action == "suspend":
        r = await db.licenses.update_many(match, {"$set": {"active": False}})
        affected = r.modified_count
    elif payload.action == "activate":
        r = await db.licenses.update_many(match, {"$set": {"active": True}})
        affected = r.modified_count
        # Aktifleştirilen lisansların revoke kayıtlarını da temizle
        docs = await db.licenses.find(match, {"_id": 0, "license_key": 1, "panel_domains": 1, "ip_addresses": 1}).to_list(1000)
        for d in docs:
            or_conds = [{"license_key": d.get("license_key")}]
            for host in (d.get("panel_domains") or []):
                or_conds.append({"hostname": host.lower()})
            for ip in (d.get("ip_addresses") or []):
                or_conds.append({"ip": ip})
            if or_conds:
                await db.revoked_licenses.delete_many({"$or": or_conds})
    else:
        raise HTTPException(400, "Geçersiz aksiyon")
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Toplu aksiyon: {payload.action} → {affected} lisans etkilendi",
    ).model_dump())
    return {"affected": affected, "action": payload.action}


@api.get("/licenses/revoked")
async def licenses_revoked_list():
    """Silinmiş (revoke edilmiş) lisanslar — NS auto-license tekrar oluşturmasın diye
    kalıcı olarak saklanır. Restore için POST /licenses/revoked/restore."""
    items = await db.revoked_licenses.find({}, {"_id": 0}).sort("revoked_at", -1).to_list(500)
    return {"items": items, "count": len(items)}


@api.post("/licenses/revoked/clear")
async def licenses_revoked_clear(payload: dict):
    """Revoke listesinden bir kaydı IP / hostname / license_key ile temizle.
    Master 'yeni lisans ekledim ama hâlâ iptal diyor' durumunda tek tıkla kullanır.
    Payload: {ip?: str, hostname?: str, license_key?: str, all?: bool}
    all:true → TÜM revoke kayıtlarını sil (nükleer opsiyon)."""
    if payload.get("all") is True:
        r = await db.revoked_licenses.delete_many({})
        await db.settings.update_many({"_key": "plugin_state"}, {"$unset": {"revoked_at": ""}})
        await db.logs.insert_one(ActivityLog(
            source="license", level="info",
            message=f"TÜM revoke kayıtları temizlendi ({r.deleted_count} satır)",
        ).model_dump())
        return {"cleared": r.deleted_count, "ok": True, "scope": "all"}
    or_conds = []
    if payload.get("license_key"):
        or_conds.append({"license_key": payload["license_key"]})
    if payload.get("hostname"):
        or_conds.append({"hostname": payload["hostname"].lower()})
    if payload.get("ip"):
        or_conds.append({"ip": payload["ip"]})
    if not or_conds:
        raise HTTPException(400, "ip / hostname / license_key veya all:true gerekli")
    r = await db.revoked_licenses.delete_many({"$or": or_conds})
    await db.settings.update_one({"_key": "plugin_state"}, {"$unset": {"revoked_at": ""}})
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Revoke kayıtları manuel temizlendi ({r.deleted_count} satır)",
    ).model_dump())
    return {"cleared": r.deleted_count, "ok": True}


class RevokeRestoreIn(BaseModel):
    license_key: str


@api.post("/licenses/revoked/restore")
async def licenses_revoked_restore(payload: RevokeRestoreIn):
    """Yanlışlıkla silinen bir lisansı revoke listesinden çıkar. Sonraki verify'da
    NS auto-license tekrar oluşturur (eğer hostname NS check'i geçerse)."""
    r = await db.revoked_licenses.delete_one({"license_key": payload.license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Revoke kaydı bulunamadı")
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Revoke kaldırıldı: {payload.license_key} — NS auto-license artık tekrar oluşturabilir",
    ).model_dump())
    return {"restored": True, "license_key": payload.license_key}


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
    # Eski 'violations' + yeni 'license_violations' iki collection'ı birleştir
    # (geçmişten kalan kayıtlar da görünsün diye)
    rows_new = await db.license_violations.find({}, {"_id": 0}).sort("at", -1).to_list(limit)
    if len(rows_new) < limit:
        rows_old = await db.violations.find({}, {"_id": 0}).sort("at", -1).to_list(limit - len(rows_new))
        return rows_new + rows_old
    return rows_new


@api.delete("/license/violations")
async def license_violations_clear():
    # Her iki collection'ı da temizle — legacy 'violations' + yeni 'license_violations'
    r1 = await db.license_violations.delete_many({})
    r2 = await db.violations.delete_many({})
    return {"deleted": r1.deleted_count + r2.deleted_count}


@api.post("/license/violations/clear")
async def license_violations_clear_post():
    """POST alternative — cPanel/Apache DELETE method'unu bloklu tutabilir."""
    r1 = await db.license_violations.delete_many({})
    r2 = await db.violations.delete_many({})
    total = r1.deleted_count + r2.deleted_count
    await db.logs.insert_one(ActivityLog(
        source="license", level="info",
        message=f"Lisans ihlalleri temizlendi ({total} kayıt silindi)",
    ).model_dump())
    return {"deleted": total, "ok": True}


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
async def blacklist_check(payload: BlacklistCheckIn, request: Request, license_key: Optional[str] = None):
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "blacklist_check")
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
async def blacklist_delist(payload: DelistRequestIn, request: Request, license_key: Optional[str] = None):
    scope = await _tenant_scope(request, license_key)
    await _require_feature(scope, "blacklist_manage")
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


# Apache/cPanel proxy PUT/DELETE metodlarını bloklayabildiği için POST alternatifi.
# Frontend `blacklistUpdateRequest` bu endpoint'i kullanır.
@api.post("/blacklist/requests/{req_id}/update")
async def blacklist_update_request_post(req_id: str, upd: DelistStatusUpdate):
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
            else:
                # license_key plugin_state'te var ama db.licenses'ta yok → silinmiş
                license_active_flag = False
        except Exception:
            pass

    # Revoke kontrolü — master manuel silmişse licensed=false zorla, gated=true.
    # (plugin_state cache'ini geçersiz kılar)
    if licensed and st.get("license_key"):
        try:
            rev = await db.revoked_licenses.find_one(
                {"license_key": st.get("license_key")}, {"_id": 0}
            )
            if rev:
                licensed = False
                license_active_flag = False
                gated = PLUGIN_MODE == "customer"
                # plugin_state'i de temizle ki bir daha yanlış "licensed" dönmesin
                await db.settings.update_one(
                    {"_key": "plugin_state"},
                    {"$set": {
                        "licensed": False,
                        "license_key": "",
                        "license_expires": "",
                        "revoked_at": rev.get("revoked_at"),
                    }},
                )
        except Exception:
            pass

    # Lisans pasife alınmışsa modülleri kilit — licensed'i false say
    if licensed and not license_active_flag:
        licensed = False
        gated = PLUGIN_MODE == "customer"

    # license_version — master "Zorla Güncelle" bastığında artar; frontend/plugin
    # buradaki değeri kaydeder ve değiştiğinde cache'i temizler.
    license_version = 0
    if licensed and st.get("license_key"):
        try:
            lv_doc = await db.licenses.find_one(
                {"license_key": st.get("license_key")}, {"_id": 0, "license_version": 1}
            )
            if lv_doc:
                license_version = int(lv_doc.get("license_version") or 0)
        except Exception:
            pass

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
        "license_version": license_version,
        "gated": gated,
        "gate_reason": (
            "license_suspended" if licensed is False and st.get("license_key") and not license_active_flag else
            "license_required" if gated else
            ("demo_active" if is_demo and not demo_over else "ok")
        ),
    }


@api.get("/plugin/status")
async def plugin_status(request: Request):
    """Ziyaretçi IP'sine göre lisans durumu döner.

    v43.3 GÜVENLİK: Eskiden `plugin_state` GLOBAL bir belgeydi — bir kişi
    lisansını doğruladığında herkes o lisansı görüyordu (Ateş bug'ı).
    Yeni davranış:
      1. `gws_impersonate` cookie varsa → o bayinin lisansı görünür (master flow)
      2. Master (X-Master-Key veya gws_master_session) → master lisansı
      3. Ziyaretçi IP'si `licenses.authorized_ips` içinde ise → o bayinin lisansı
      4. Aksi hâlde → **HER ZAMAN DEMO/UNLICENSED**. plugin_state global state
         artık authoritative kaynak değildir (sadece geriye dönük uyumluluk).
    """
    # (1) Impersonation — master bayi görünümüne geçmişse
    imp = request.cookies.get("gws_impersonate")
    if imp:
        lic = await db.licenses.find_one({"license_key": imp}, {"_id": 0}) or {}
        base = await _plugin_status_payload()
        base.update({
            "licensed": bool(lic and lic.get("active", True)),
            "license_key": imp,
            "license_customer_name": lic.get("customer_name", ""),
            "license_plan": lic.get("plan", "starter"),
            "license_expires": lic.get("valid_until", ""),
            "license_active": lic.get("active", True),
            "impersonated": True,
        })
        return base

    # (2) Master session?
    master_key_env = os.environ.get("MASTER_LICENSE_KEY", "")
    header_key = request.headers.get("x-master-key") or ""
    cookie_key = request.cookies.get("gws_master_session") or ""
    is_master_visitor = (
        (header_key and header_key == master_key_env) or
        (cookie_key and cookie_key == master_key_env)
    )
    if is_master_visitor:
        payload = await _plugin_status_payload()
        payload.update({
            "licensed": True,
            "license_key": master_key_env,
            "license_customer_name": "Master",
            "license_plan": "enterprise",
            "license_active": True,
            "is_master": True,
        })
        return payload

    # (3) Ziyaretçi IP'sini kontrol et — authorized_ips içinde mi?
    client_ip = _client_ip(request)
    lic_by_ip = None
    if client_ip:
        # authorized_ips array VEYA legacy ip field'ı
        lic_by_ip = await db.licenses.find_one(
            {"$or": [
                {"authorized_ips": client_ip},
                {"ip": client_ip},
            ], "active": True},
            {"_id": 0},
        )
    if lic_by_ip:
        # Bu IP kayıtlı bir bayiye ait — o bayinin lisansı görünsün
        valid_until = lic_by_ip.get("valid_until") or ""
        now_iso = datetime.now(timezone.utc).isoformat()
        expired = valid_until and valid_until < now_iso
        licensed = not expired and bool(lic_by_ip.get("active", True))
        # Revoke kontrolü
        if licensed:
            rev = await db.revoked_licenses.find_one(
                {"license_key": lic_by_ip.get("license_key")}, {"_id": 1}
            )
            if rev:
                licensed = False
        return {
            "mode": PLUGIN_MODE,
            "installed_at": lic_by_ip.get("created_at"),
            "is_demo": not licensed,
            "demo_expires": "",
            "demo_days_remaining": 0,
            "demo_over": False,
            "licensed": licensed,
            "license_key": lic_by_ip.get("license_key", ""),
            "license_expires": valid_until,
            "license_customer_name": lic_by_ip.get("customer_name", ""),
            "license_plan": lic_by_ip.get("plan", "starter"),
            "license_active": bool(lic_by_ip.get("active", True)),
            "license_version": int(lic_by_ip.get("license_version") or 0),
            "gated": (not licensed and PLUGIN_MODE == "customer"),
            "gate_reason": (
                "license_expired" if expired
                else "license_suspended" if not lic_by_ip.get("active", True)
                else "license_revoked" if not licensed
                else "ok"
            ),
            "visitor_ip": client_ip,
        }

    # (4) IP tanımlı değil → DEMO. plugin_state'i AUTHORITATIVE OLARAK KULLANMA.
    # Yalnızca demo süresi / bilgilendirme için okuruz. licensed=false zorla.
    st = await _plugin_state()
    now = datetime.now(timezone.utc)
    demo_exp = _parse_iso(st.get("demo_expires", ""))
    demo_days_remaining = 0
    demo_over = False
    if demo_exp:
        delta = demo_exp - now
        demo_days_remaining = max(0, delta.days)
        demo_over = delta.total_seconds() <= 0
    gated = PLUGIN_MODE == "customer" and demo_over
    return {
        "mode": PLUGIN_MODE,
        "installed_at": st.get("installed_at"),
        "is_demo": True,
        "demo_expires": st.get("demo_expires"),
        "demo_days_remaining": demo_days_remaining,
        "demo_over": demo_over,
        "licensed": False,
        "license_key": "",
        "license_expires": "",
        "license_customer_name": "",
        "license_plan": "",
        "license_active": False,
        "license_version": 0,
        "gated": gated,
        "gate_reason": "license_required" if gated else "demo_active",
        "visitor_ip": client_ip,
    }


@api.post("/plugin/reset-global-state")
async def plugin_reset_global_state(request: Request, license_key: Optional[str] = None):
    """Master-only. Master panel'inde eskiden bir bayi lisans doğrulaması yaptığında
    `plugin_state` global belgesine yazılan `licensed:true, license_key:X` bilgisi
    tüm ziyaretçilere sızıyordu (v43.3 öncesi Ateş bug). Bu endpoint eski state'i
    temizler; artık plugin_status authoritative değil ama tutarlılık için sıfırla."""
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "plugin_state"},
        {"$set": {
            "licensed": False,
            "license_key": "",
            "license_expires": "",
            "reset_at": datetime.now(timezone.utc).isoformat(),
            "reset_reason": "v43.3_security_cleanup",
        }},
        upsert=True,
    )
    return {"ok": True, "message": "plugin_state global lisans binding'i temizlendi"}


# ================== PLUGIN DOWNLOAD (Stabil) ==================
# Yükleme mimarisi:
#   1) `dist/` klasörünün konumu: BACKEND_DIST_DIR env veya /app/backend/dist
#   2) `gokyuzuwebspam-latest.tar.gz` her zaman en son sürümdür.
#   3) `gokyuzuwebspam-{X.Y.Z}.tar.gz` versiyon-pin edilmiş paketlerdir.
#   4) `/api/plugin/download` → latest (302 → versioned URL, tarayıcıda dostane isim).
#   5) `/api/plugin/download/{version}` → belirli sürüm (dosya yoksa 404).
#   6) version_manifest güncellendiğinde publish akışı otomatik `latest`'i o
#      versiyon dosyasına linkler (aşağıdaki _promote_dist_version helper).
BACKEND_DIST_DIR = os.environ.get("BACKEND_DIST_DIR", "/app/backend/dist")
Path(BACKEND_DIST_DIR).mkdir(parents=True, exist_ok=True)


def _dist_path(filename: str) -> Path:
    """Traversal-safe dist dosya yolu üretir."""
    safe = "".join(c for c in filename if c.isalnum() or c in "-._")
    return Path(BACKEND_DIST_DIR) / safe


async def _current_version() -> str:
    mf = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0}) or {}
    return str(mf.get("latest_version") or "2.6.0").lstrip("v")


def _promote_dist_version(version: str) -> Optional[str]:
    """`gokyuzuwebspam-{version}.tar.gz` dosyasını `gokyuzuwebspam-latest.tar.gz`
    olarak alias'lar. Dosya yoksa varsa `latest`'ten kopyalar ve dönüş verir."""
    ver = version.lstrip("v")
    versioned = _dist_path(f"gokyuzuwebspam-{ver}.tar.gz")
    latest = _dist_path("gokyuzuwebspam-latest.tar.gz")
    if versioned.exists():
        try:
            if latest.exists() or latest.is_symlink():
                latest.unlink()
            latest.symlink_to(versioned.name)
        except Exception:
            # symlink başarısız → dosyayı kopyala
            try:
                import shutil
                shutil.copy2(str(versioned), str(latest))
            except Exception:
                return None
        return str(versioned)
    if latest.exists():
        try:
            import shutil
            shutil.copy2(str(latest), str(versioned))
        except Exception:
            return None
        return str(versioned)
    return None


@api.get("/plugin/download")
async def plugin_download_latest(request: Request):
    """En son plugin paketini indirir. Öncelik:
      1) BACKEND_DIST_DIR/gokyuzuwebspam-{latest_version}.tar.gz
      2) BACKEND_DIST_DIR/gokyuzuwebspam-latest.tar.gz
      3) frontend/public/gokyuzuwebspam-source.tar.gz (son çare fallback)
    """
    ver = await _current_version()
    versioned = _dist_path(f"gokyuzuwebspam-{ver}.tar.gz")
    latest = _dist_path("gokyuzuwebspam-latest.tar.gz")
    fallback = Path("/app/frontend/public/gokyuzuwebspam-source.tar.gz")
    target = versioned if versioned.exists() else (latest if latest.exists() else (fallback if fallback.exists() else None))
    if not target:
        raise HTTPException(
            503,
            "Plugin paketi henüz build edilmemiş. Master lütfen /api/version/publish çağırıp yeni bir sürüm yayınlasın.",
        )
    from fastapi.responses import FileResponse
    return FileResponse(
        str(target),
        media_type="application/gzip",
        filename=f"gokyuzuwebspam-{ver}.tar.gz",
        headers={
            "X-Plugin-Version": ver,
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="gokyuzuwebspam-{ver}.tar.gz"',
        },
    )


@api.get("/plugin/download/{version}")
async def plugin_download_versioned(version: str):
    """Belirli sürümü indir. Örn: /api/plugin/download/2.6.0"""
    ver = version.lstrip("v")
    p = _dist_path(f"gokyuzuwebspam-{ver}.tar.gz")
    if not p.exists():
        raise HTTPException(404, f"Sürüm bulunamadı: gokyuzuwebspam-{ver}.tar.gz")
    from fastapi.responses import FileResponse
    return FileResponse(
        str(p),
        media_type="application/gzip",
        filename=f"gokyuzuwebspam-{ver}.tar.gz",
        headers={"X-Plugin-Version": ver, "Cache-Control": "no-store"},
    )


@api.get("/plugin/versions")
async def plugin_versions_list():
    """Mevcut dist paketlerinin listesi. Master `Version Publish` UI'da dropdown için."""
    files = []
    try:
        for p in sorted(Path(BACKEND_DIST_DIR).glob("gokyuzuwebspam-*.tar.gz")):
            name = p.name
            if name == "gokyuzuwebspam-latest.tar.gz":
                continue
            ver = name.replace("gokyuzuwebspam-", "").replace(".tar.gz", "")
            files.append({
                "version": ver,
                "filename": name,
                "size_bytes": p.stat().st_size,
                "download_url": f"/api/plugin/download/{ver}",
            })
    except Exception:
        pass
    current = await _current_version()
    return {"current": current, "versions": files}


@api.get("/scripts/install-bayi.sh", response_class=None)
async def scripts_install_bayi(request: Request):
    """Bayi tek-satır kurulum akışında kullanılan bash script. Kullanım:
       curl -sSL https://{MASTER_HOST}/api/scripts/install-bayi.sh | \
         sudo LICENSE_KEY=MS-XXX MASTER_URL=https://... bash

    Betik: paketi indirir, /opt/gokyuzuwebspam altına açar, systemd unit'i
    yükler, mailshield-logtail'i enable eder ve durumu kontrol eder."""
    from fastapi.responses import PlainTextResponse
    ver = await _current_version()
    master_url = f"https://{MASTER_HOST}" if MASTER_HOST else str(request.base_url).rstrip("/")
    # GitHub release override: master admin bunu Settings > System'da set edebilir
    github_release_url = os.environ.get("GITHUB_RELEASE_URL", "").strip()
    # Betikte iki DOWNLOAD_URL kaynağı: master API veya GitHub release
    script = f'''#!/usr/bin/env bash
# GokyuzuWebSpam — Bayi WHM/cPanel Kurulum & Guncelleme Betigi
# Kullanim (kurulum ve guncelleme AYNI komuttur):
#   curl -sSL {master_url}/api/scripts/install-bayi.sh | \\
#     sudo LICENSE_KEY=MS-XXXX MASTER_URL={master_url} bash
#
# Opsiyonel: GITHUB_RELEASE_URL environment var'i ile master API yerine direkt
# GitHub release'inden cekme:
#   sudo LICENSE_KEY=MS-XXXX \\
#        GITHUB_RELEASE_URL=https://github.com/user/repo/releases/latest/download/gokyuzuwebspam.tar.gz \\
#        MASTER_URL={master_url} bash
set -e
: "${{LICENSE_KEY:?LICENSE_KEY environment variable is required}}"
: "${{MASTER_URL:={master_url}}}"
: "${{GITHUB_RELEASE_URL:={github_release_url}}}"
VERSION="{ver}"
INSTALL_DIR="/opt/gokyuzuwebspam"
if [ -n "${{GITHUB_RELEASE_URL}}" ]; then
  DOWNLOAD_URL="${{GITHUB_RELEASE_URL}}"
  SRC_LABEL="GitHub Release"
else
  DOWNLOAD_URL="${{MASTER_URL}}/api/plugin/download"
  SRC_LABEL="Master API"
fi

echo "==> GokyuzuWebSpam v${{VERSION}} kurulum/guncelleme basliyor"
echo "    Master        : ${{MASTER_URL}}"
echo "    Lisans        : ${{LICENSE_KEY:0:16}}..."
echo "    Kaynak        : ${{SRC_LABEL}}"
echo "    Install path  : ${{INSTALL_DIR}}"

# 1) Bagimlilik kontrolu
command -v wget >/dev/null || (echo "wget kurulmali" >&2; exit 1)
command -v tar  >/dev/null || (echo "tar kurulmali" >&2; exit 1)

# 2) Onceki kurulumu yedekle
if [ -d "${{INSTALL_DIR}}" ]; then
  BAK="/opt/gokyuzuwebspam.bak.$(date +%s)"
  echo "==> Onceki kurulum yedekleniyor -> ${{BAK}}"
  mv "${{INSTALL_DIR}}" "${{BAK}}"
fi
mkdir -p "${{INSTALL_DIR}}"

# 3) Paketi indir + ac
cd /tmp
echo "==> Paket indiriliyor: ${{DOWNLOAD_URL}}"
wget -q -O gws.tar.gz "${{DOWNLOAD_URL}}"
tar -xzf gws.tar.gz -C "${{INSTALL_DIR}}" --strip-components=1 2>/dev/null || \\
  tar -xzf gws.tar.gz -C "${{INSTALL_DIR}}"
rm -f gws.tar.gz

# 4) Lisans + master URL kaydet
cat > "${{INSTALL_DIR}}/config.env" <<EOF
LICENSE_KEY=${{LICENSE_KEY}}
MASTER_URL=${{MASTER_URL}}
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VERSION=${{VERSION}}
EOF
chmod 600 "${{INSTALL_DIR}}/config.env"

# 5) systemd unit (varsa)
if [ -f "${{INSTALL_DIR}}/mailshield-logtail.pl" ]; then
  cat > /etc/systemd/system/gokyuzuwebspam-logtail.service <<EOF
[Unit]
Description=GokyuzuWebSpam Mail Log Tail Agent
After=network-online.target

[Service]
Type=simple
EnvironmentFile=${{INSTALL_DIR}}/config.env
ExecStart=/usr/bin/perl ${{INSTALL_DIR}}/mailshield-logtail.pl --license=\\${{LICENSE_KEY}} --master=\\${{MASTER_URL}}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now gokyuzuwebspam-logtail
  echo "==> systemd servisi enable edildi: gokyuzuwebspam-logtail"
fi

# 6) Baglanti testi
echo "==> Master ile test ping..."
curl -sf -X POST "${{MASTER_URL}}/api/events/ingest" \\
  -H "Content-Type: application/json" \\
  -d "{{\\"license_key\\":\\"${{LICENSE_KEY}}\\",\\"from_addr\\":\\"install@test.local\\",\\"to_addr\\":\\"you@bayi.local\\",\\"subject\\":\\"Kurulum baglanti testi\\",\\"verdict\\":\\"clean\\"}}" \\
  && echo || echo "!! Test ping basarisiz — firewall / lisans kontrol edin"

echo ""
echo "GokyuzuWebSpam kuruldu — v${{VERSION}}"
echo "  Panel : ${{MASTER_URL}}/panel/my-server"
echo "  Log   : journalctl -u gokyuzuwebspam-logtail -f"
'''
    return PlainTextResponse(script, media_type="text/x-shellscript")


@api.get("/plugin/renewal-info")
async def plugin_renewal_info():
    """Panel içi banner için lisans bitişi bilgisi. Her istekte kalan gün + banner
    şiddeti + tek-tık yenileme URL'i döner. Ziyaretçi (licensed=false) için
    should_show_banner=False."""
    s = await _plugin_status_payload()
    if not s.get("licensed") or not s.get("license_expires"):
        return {
            "licensed": False,
            "days_left": None,
            "expires_at": None,
            "should_show_banner": False,
            "severity": None,
            "plan": s.get("license_plan", ""),
            "renewal_url": "/panel/subscription",
        }
    try:
        exp = datetime.fromisoformat(str(s["license_expires"]).replace("Z", "+00:00"))
        days_left = (exp - datetime.now(timezone.utc)).days
    except Exception:
        return {
            "licensed": True, "days_left": None, "expires_at": s.get("license_expires"),
            "should_show_banner": False, "severity": None,
            "plan": s.get("license_plan", ""), "renewal_url": "/panel/subscription",
        }

    severity = None
    if days_left <= 3:
        severity = "critical"
    elif days_left <= 14:
        severity = "warning"
    elif days_left <= 30:
        severity = "info"
    return {
        "licensed": True,
        "days_left": days_left,
        "expires_at": s.get("license_expires"),
        "should_show_banner": days_left <= 30,
        "severity": severity,
        "plan": s.get("license_plan", ""),
        "customer_name": s.get("license_customer_name", ""),
        "license_key": s.get("license_key", ""),
        "renewal_url": "/panel/subscription?renew=1",
    }


class SubscriptionRenewIn(BaseModel):
    billing_period: Literal["monthly", "yearly"] = "yearly"
    plan_code: Optional[str] = None  # None → mevcut planla yenile
    origin_url: Optional[str] = None
    gateway: Optional[Literal["havale", "stripe", "auto"]] = "auto"


@api.post("/subscription/renew")
async def subscription_renew(payload: SubscriptionRenewIn, request: Request):
    """Tek-tık lisans yenileme. Mevcut lisansın plan/e-posta bilgilerini otomatik
    çeker ve Stripe checkout başlatır. Ödeme tamamlandığında `checkout/success`
    akışı `valid_until` alanını uzatır (mevcut checkout webhook mantığı devreye girer)."""
    s = await _plugin_status_payload()
    if not s.get("licensed") or not s.get("license_key"):
        raise HTTPException(400, "Yenileme için aktif bir lisans gerekli. Önce bir plan satın alın.")
    # DB'den mevcut lisansı çek — e-posta / müşteri adı için
    lic = await db.licenses.find_one({"license_key": s["license_key"]}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Lisans kaydı bulunamadı")
    plan_code = payload.plan_code or s.get("license_plan") or lic.get("plan") or "pro"
    customer_email = lic.get("customer_email") or ""
    customer_name = lic.get("customer_name") or ""
    if not customer_email or "@" not in customer_email:
        raise HTTPException(400, "Lisansta kayıtlı e-posta yok — önce Aboneliğim sayfasından e-posta güncelleyin")

    # Ödeme yöntemi: müşteri seçimi > master default > 'havale'
    pay_cfg = await db.settings.find_one({"_key": "payment_settings"}, {"_id": 0}) or {}
    requested = (payload.gateway or "auto").lower()
    if requested in ("stripe", "havale"):
        if requested == "havale" and pay_cfg.get("havale_enabled", True) is False:
            raise HTTPException(400, "Havale/EFT şu an devre dışı — kredi kartını deneyin")
        if requested == "stripe" and pay_cfg.get("stripe_enabled", True) is False:
            raise HTTPException(400, "Kredi kartı ödemesi şu an devre dışı — havale deneyin")
        gateway = requested
    else:
        gateway = (pay_cfg.get("default_gateway") or "havale").lower()

    # Fiyatı çek
    pricing = await _pricing_settings()
    plan = next((p for p in pricing["plans"] if p["code"] == plan_code and p.get("active", True)), None)
    if not plan:
        raise HTTPException(404, "Plan bulunamadı veya pasif")
    amount = plan["yearly_price"] if payload.billing_period == "yearly" else plan["monthly_price"]
    if amount <= 0:
        raise HTTPException(400, "Bu plan için ödeme alınamaz — Master fiyatlandırma sayfasından güncelleyin")

    if gateway == "havale":
        # Havale/EFT akışı — ücretsiz, API key gerekmez
        import uuid as _uuid
        merchant_oid = f"REN{_uuid.uuid4().hex[:20].upper()}"
        bank_iban = os.environ.get("BANK_IBAN", "TR00 0000 0000 0000 0000 0000 00")
        bank_name = os.environ.get("BANK_NAME", "Banka Adı")
        bank_beneficiary = os.environ.get("BANK_BENEFICIARY", "Şirket Adı")
        await db.payments.insert_one({
            "id": merchant_oid, "merchant_oid": merchant_oid,
            "provider": "havale", "status": "awaiting_transfer",
            "email": customer_email, "user_name": customer_name,
            "amount": amount, "currency": plan.get("currency", "TRY"),
            "plan_code": plan_code, "billing_period": payload.billing_period,
            "is_renewal": True, "renewal_license_key": s["license_key"],
            "created_at": _iso(),
        })
        await db.settings.update_one(
            {"_key": f"renewal_intent:{customer_email}:{plan_code}"},
            {"$set": {"license_key": s["license_key"], "plan_code": plan_code,
                      "billing_period": payload.billing_period,
                      "customer_email": customer_email,
                      "merchant_oid": merchant_oid,
                      "requested_at": _iso()}},
            upsert=True,
        )
        return {
            "renewal": True, "gateway": "havale", "session_id": merchant_oid,
            "url": f"/panel/payment/havale?ref={merchant_oid}",
            "amount": amount, "currency": plan.get("currency", "TRY"),
            "iban": bank_iban, "bank": bank_name, "beneficiary": bank_beneficiary,
            "reference": merchant_oid, "plan": plan.get("name", plan_code),
            "current_plan": s.get("license_plan"),
            "current_expires": s.get("license_expires"),
            "instructions": (
                f"Kayıtlı IBAN'a {amount:.2f} {plan.get('currency','TRY')} havale yapın; "
                f"AÇIKLAMA alanına '{merchant_oid}' yazmayı unutmayın. "
                f"Ödemeniz doğrulandıktan sonra lisansınız otomatik uzatılır (max 24 saat)."
            ),
        }

    # Stripe akışı (fallback)
    origin = payload.origin_url or str(request.base_url).rstrip("/")
    ck = CheckoutCreateIn(
        plan_code=plan_code,
        billing_period=payload.billing_period,
        customer_email=customer_email,
        customer_name=customer_name,
        origin_url=origin,
    )
    result = await checkout_create_session(ck)  # aynı dosyada tanımlı
    # Yenileme intent'i işaretle (webhook success sonrası valid_until +period yapılsın).
    # Anahtar: customer_email + plan (Stripe metadata bize sadece email geri getirir).
    await db.settings.update_one(
        {"_key": f"renewal_intent:{customer_email}:{plan_code}"},
        {"$set": {"license_key": s["license_key"], "plan_code": plan_code,
                  "billing_period": payload.billing_period,
                  "customer_email": customer_email,
                  "requested_at": _iso()}},
        upsert=True,
    )
    return {**result, "renewal": True, "current_plan": s.get("license_plan"),
            "current_expires": s.get("license_expires")}


# Plan bazlı özellik matrisi — her plan için hangi feature aktif olduğunu tanımlar.
# Frontend bunları usePlanFeatures ile okuyup UI'de gate eder,
# backend de yazma endpoint'lerinde bu limitleri zorlar.
PLAN_FEATURES_DEFAULT = {
    "starter": {
        # Kapasite
        "max_domains": 1,
        "max_mails_per_day": 5000,
        # Temel modüller
        "attack_map": True,
        "dashboard": True,
        "live_traffic": True,
        "blacklist_check": True,     # RBL sorgu / delist
        "whitelist_manage": False,   # Whitelist ekleme (kapalı = üst plan)
        "blacklist_manage": False,   # Blacklist ekleme (kapalı = üst plan)
        "quarantine_view": True,     # Karantina görüntüleme
        "quarantine_release": False, # Karantinadan çıkarma
        "quarantine_delete": False,  # Karantinadan silme
        "logs_view": True,
        # Güvenlik ekranı
        "security_view": True,       # Güvenlik sayfası görüntüleme
        "security_config": False,    # Güvenlik ayarları değiştirme
        "engine_toggle": False,      # Motor aç/kapa
        # Giden mail
        "outbound_view": True,       # Giden mail görüntüleme
        "outbound_control": False,   # Giden mail askıya alma/silme
        # İleri modüller
        "custom_rules": False,       # Kural editörü (Rules sayfası)
        "exploit_editor": False,     # Exploit/Webshell tarayıcı
        "ai_explanations": False,    # AI destekli açıklama
        "threat_intel": False,       # Tehdit zekası feed'i
        "bec_detection": False,      # Business Email Compromise
        "sandbox": False,            # Ek/URL sandbox
        "attachment_scan": True,     # Ek tarama
        "url_scan": True,            # URL taraması
        # Bildirim & Raporlama
        "alerts_rules": False,       # Custom alert kuralları
        "reports_view": True,        # Rapor sayfası görüntüleme
        "reports_weekly": False,     # Haftalık AI raporu
        "reports_export": False,     # CSV/PDF export
        "email_notifications": True, # Basit e-posta bildirim
        "smtp_settings": False,      # SMTP relay yapılandırma
        # Yönetim
        "bulk_actions": False,       # Toplu işlem
        "sub_users": False,          # Alt kullanıcı
        "reseller_mode": False,      # Alt bayi
        "api_access": False,         # REST API
        "webhooks": False,           # Webhook entegrasyon
        "two_factor_auth": False,    # 2FA
        "priority_support": False,   # Öncelikli destek
        "custom_branding": False,    # Beyaz etiket / logo
        "settings_customize": False, # Genel ayarları değiştirme
        "label": "Starter",
    },
    "pro": {
        "max_domains": 10, "max_mails_per_day": 50000,
        "attack_map": True, "dashboard": True, "live_traffic": True,
        "blacklist_check": True, "whitelist_manage": True, "blacklist_manage": True,
        "quarantine_view": True, "quarantine_release": True, "quarantine_delete": True,
        "logs_view": True,
        "security_view": True, "security_config": True, "engine_toggle": True,
        "outbound_view": True, "outbound_control": True,
        "custom_rules": True, "exploit_editor": True, "ai_explanations": True,
        "threat_intel": True, "bec_detection": True, "sandbox": True,
        "attachment_scan": True, "url_scan": True,
        "alerts_rules": True, "reports_view": True, "reports_weekly": True,
        "reports_export": True, "email_notifications": True, "smtp_settings": True,
        "bulk_actions": True, "sub_users": True, "reseller_mode": False,
        "api_access": True, "webhooks": True, "two_factor_auth": True,
        "priority_support": True, "custom_branding": False, "settings_customize": True,
        "label": "Pro",
    },
    "enterprise": {
        "max_domains": 999999, "max_mails_per_day": 999999999,
        "attack_map": True, "dashboard": True, "live_traffic": True,
        "blacklist_check": True, "whitelist_manage": True, "blacklist_manage": True,
        "quarantine_view": True, "quarantine_release": True, "quarantine_delete": True,
        "logs_view": True,
        "security_view": True, "security_config": True, "engine_toggle": True,
        "outbound_view": True, "outbound_control": True,
        "custom_rules": True, "exploit_editor": True, "ai_explanations": True,
        "threat_intel": True, "bec_detection": True, "sandbox": True,
        "attachment_scan": True, "url_scan": True,
        "alerts_rules": True, "reports_view": True, "reports_weekly": True,
        "reports_export": True, "email_notifications": True, "smtp_settings": True,
        "bulk_actions": True, "sub_users": True, "reseller_mode": True,
        "api_access": True, "webhooks": True, "two_factor_auth": True,
        "priority_support": True, "custom_branding": True, "settings_customize": True,
        "label": "Enterprise",
    },
}

# Backward-compat alias
PLAN_FEATURES = PLAN_FEATURES_DEFAULT


async def _load_plan_matrix() -> dict:
    """DB-backed plan matrisi. Master `/panel/plan-config` sayfasından her plan
    için modül-modül aç/kapa yapabilir. Kayıt yoksa varsayılan matrix döner."""
    doc = await db.settings.find_one({"_key": "plan_matrix"}, {"_id": 0, "matrix": 1})
    if doc and isinstance(doc.get("matrix"), dict):
        # Boş plan varsa varsayılanla birleştir (güvenlik)
        merged = {}
        for k, defaults in PLAN_FEATURES_DEFAULT.items():
            merged[k] = {**defaults, **(doc["matrix"].get(k) or {})}
        return merged
    return PLAN_FEATURES_DEFAULT


@api.get("/admin/plan-matrix")
async def admin_plan_matrix_get(request: Request, license_key: Optional[str] = None):
    """Master-only. Mevcut plan matrisini ve varsayılanları döner."""
    await _require_master(request, license_key)
    current = await _load_plan_matrix()
    return {"matrix": current, "defaults": PLAN_FEATURES_DEFAULT}


@api.get("/admin/plan-matrix/history")
async def admin_plan_matrix_history(request: Request, license_key: Optional[str] = None,
                                     limit: int = 100):
    """Master-only. Plan matrisinde yapılan değişikliklerin tarihçesi.
    Her POST /admin/plan-matrix veya /reset çağrısı bir kayıt oluşturur."""
    await _require_master(request, license_key)
    limit = max(1, min(limit, 500))
    items = []
    async for r in db.plan_matrix_history.find({}, {"_id": 0}).sort("at", -1).limit(limit):
        items.append(r)
    return {"items": items, "count": len(items)}


class PlanMatrixIn(BaseModel):
    matrix: Dict[str, Dict[str, Any]]


@api.post("/admin/plan-matrix")
async def admin_plan_matrix_set(payload: PlanMatrixIn, request: Request,
                                 license_key: Optional[str] = None):
    """Master-only. Plan matrisini kaydeder. `starter`/`pro`/`enterprise` üç anahtar
    beklenir; ek anahtar yok sayılır. Her plan altında sadece bilinen özellik
    anahtarları saklanır (defense against arbitrary keys)."""
    await _require_master(request, license_key)
    allowed_plans = {"starter", "pro", "enterprise"}
    allowed_keys = set(PLAN_FEATURES_DEFAULT["starter"].keys())
    sanitized: Dict[str, Dict[str, Any]] = {}
    for plan_code, feats in (payload.matrix or {}).items():
        if plan_code not in allowed_plans or not isinstance(feats, dict):
            continue
        sanitized[plan_code] = {}
        for k, v in feats.items():
            if k not in allowed_keys:
                continue
            # numeric fields → int; label → str; rest → bool
            if k in ("max_domains", "max_mails_per_day"):
                try: sanitized[plan_code][k] = int(v)
                except Exception: pass
            elif k == "label":
                sanitized[plan_code][k] = str(v)[:32]
            else:
                sanitized[plan_code][k] = bool(v)
    # Diff için önceki matrisi al
    before_doc = await db.settings.find_one({"_key": "plan_matrix"}, {"_id": 0, "matrix": 1})
    await db.settings.update_one(
        {"_key": "plan_matrix"},
        {"$set": {"_key": "plan_matrix", "matrix": sanitized,
                  "updated_at": _iso()}},
        upsert=True,
    )
    # History — hangi alanların değiştiğini diff'le
    prev_matrix = (before_doc.get("matrix") if before_doc else PLAN_FEATURES_DEFAULT) or PLAN_FEATURES_DEFAULT
    now_matrix = await _load_plan_matrix()
    changes = []
    for plan_code, feats in now_matrix.items():
        for k, v in feats.items():
            prev_v = (prev_matrix.get(plan_code) or {}).get(k, PLAN_FEATURES_DEFAULT[plan_code].get(k))
            if prev_v != v:
                changes.append({"plan": plan_code, "feature": k, "from": prev_v, "to": v})
    if changes:
        await db.plan_matrix_history.insert_one({
            "id": str(uuid.uuid4()),
            "action": "update",
            "actor_ip": _client_ip(request),
            "changes": changes,
            "changes_count": len(changes),
            "at": _iso(),
        })
    await db.logs.insert_one(ActivityLog(
        source="plan_matrix", level="info",
        message=f"Plan matrisi güncellendi — {len(changes)} alan değişti",
    ).model_dump())
    # Bayilerin panellerinde plan_features cache'i tazelensin — WS broadcast
    try:
        from routes.maintenance import push_attack_event
        await push_attack_event({
            "type": "plan_matrix_updated",
            "changes_count": len(changes),
            "affected_plans": list({c["plan"] for c in changes}),
            "ts": _iso(),
        })
    except Exception:
        pass
    return {"ok": True, "matrix": now_matrix, "changes": len(changes)}


@api.post("/admin/plan-matrix/reset")
async def admin_plan_matrix_reset(request: Request, license_key: Optional[str] = None):
    """Master-only. Plan matrisini varsayılana döndürür."""
    await _require_master(request, license_key)
    await db.settings.delete_one({"_key": "plan_matrix"})
    await db.plan_matrix_history.insert_one({
        "id": str(uuid.uuid4()),
        "action": "reset",
        "actor_ip": _client_ip(request),
        "changes": [],
        "changes_count": 0,
        "at": _iso(),
    })
    try:
        from routes.maintenance import push_attack_event
        await push_attack_event({"type": "plan_matrix_updated", "reset": True, "ts": _iso()})
    except Exception:
        pass
    return {"ok": True, "matrix": PLAN_FEATURES_DEFAULT}


# ================== BAYİ TOPLU CANLAN PING ==================
@api.post("/admin/bayi-health/ping/{target_license}")
async def admin_bayi_health_ping_single(target_license: str, request: Request,
                                          license_key: Optional[str] = None):
    """Master-only. Tek bir bayiye canlan pingi yollar. Aynı toplu ping ile
    aynı wake-signal + WS broadcast + history kaydı akışını kullanır."""
    await _require_master(request, license_key)
    lic = await db.licenses.find_one({"license_key": target_license}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı")
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(minutes=5)).isoformat()
    batch_id = str(uuid.uuid4())
    await db.bayi_wake_signals.update_one(
        {"license_key": target_license},
        {"$set": {
            "license_key": target_license,
            "signaled_at": now.isoformat(),
            "expires_at": expires,
            "signaled_by": "master_single_ping",
            "batch_id": batch_id,
        }},
        upsert=True,
    )
    customer = lic.get("customer_name") or lic.get("customer_email") or "Bayi"
    await db.wake_history.insert_one({
        "id": batch_id,
        "at": now.isoformat(),
        "count": 1,
        "kind": "single",
        "licenses": [{"license_key": target_license, "customer_name": customer}],
    })
    try:
        from routes.maintenance import push_attack_event
        await push_attack_event({
            "type": "bayi_wake_bulk",
            "licenses": [target_license],
            "ts": now.isoformat(),
        })
    except Exception:
        pass
    await db.logs.insert_one(ActivityLog(
        source="bayi_health", level="info",
        message=f"TEK CANLAN PİNG · {customer} ({target_license[:16]}…)",
    ).model_dump())
    return {"ok": True, "license_key": target_license, "customer_name": customer}


@api.post("/admin/bayi-health/ping-all-red")
async def admin_bayi_health_ping_all_red(request: Request,
                                          license_key: Optional[str] = None):
    """Master-only. Kırmızı (30dk+ heartbeat yok) bayilere toplu "canlan" pingi
    atar. Mekanizma:
      1) WS broadcast → connected bayilere `wake` sinyali
      2) `db.bayi_wake_signals` koleksiyonuna 5dk TTL flag koyar — bayi plugin
         bir sonraki plugin/status çağrısında flag'i görüp anında heartbeat atar
      3) ActivityLog + master toast düşer
    Frontend polling ile 60sn boyunca yeşile dönenleri listeden çıkarır."""
    await _require_master(request, license_key)
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    red_cutoff = (now - timedelta(minutes=30)).isoformat()
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")

    red_licenses = []
    async for l in db.licenses.find({"active": True}, {"_id": 0}):
        lk = l.get("license_key") or ""
        if not lk or lk == master_env:
            continue
        ls = l.get("last_heartbeat_at") or ""
        if not ls or ls < red_cutoff:
            red_licenses.append({
                "license_key": lk,
                "customer_name": l.get("customer_name") or l.get("customer_email") or "Bayi",
            })

    # Wake sinyali kayıtları (5dk TTL, bayi plugin polling ile alacak)
    expires = (now + timedelta(minutes=5)).isoformat()
    batch_id = str(uuid.uuid4())
    for r in red_licenses:
        await db.bayi_wake_signals.update_one(
            {"license_key": r["license_key"]},
            {"$set": {
                "license_key": r["license_key"],
                "signaled_at": now.isoformat(),
                "expires_at": expires,
                "signaled_by": "master_bulk_ping",
                "batch_id": batch_id,
            }},
            upsert=True,
        )
    # Kalıcı geçmiş kaydı (wake_history — Master analizi için)
    if red_licenses:
        await db.wake_history.insert_one({
            "id": batch_id,
            "at": now.isoformat(),
            "count": len(red_licenses),
            "licenses": [{"license_key": r["license_key"],
                          "customer_name": r["customer_name"]} for r in red_licenses],
            "resulted_green": [],  # daha sonra tamamlayıcı endpoint güncelleyebilir
        })
    # WS broadcast
    try:
        from routes.maintenance import push_attack_event
        await push_attack_event({
            "type": "bayi_wake_bulk",
            "licenses": [r["license_key"] for r in red_licenses],
            "ts": now.isoformat(),
        })
    except Exception:
        pass
    # Master toast + activity log
    await _push_master_toast(
        kind="bulk_ping",
        title=f"🔔 {len(red_licenses)} kırmızı bayiye ping gönderildi",
        body=("Bayi panelleri 5 dakika içinde bir sonraki heartbeat'te "
              "yeşile dönmeli — dönmezlerse manuel kontrol gerekebilir."),
        link="/panel/master-live",
        meta={"count": len(red_licenses)},
    )
    await db.logs.insert_one(ActivityLog(
        source="bayi_health", level="info",
        message=f"TOPLU CANLAN PİNG · {len(red_licenses)} kırmızı bayi tetiklendi",
    ).model_dump())
    return {"ok": True, "pinged": len(red_licenses), "licenses": red_licenses,
            "batch_id": batch_id}


@api.get("/admin/wake-history")
async def admin_wake_history(request: Request, license_key: Optional[str] = None,
                              limit: int = 50):
    """Master-only. Toplu canlan ping geçmişi — hangi ping'te kaç bayi
    tetiklendi, sonuç ne oldu. Frontend `/panel/wake-history` sayfası için."""
    await _require_master(request, license_key)
    limit = max(10, min(int(limit), 500))
    items = []
    # Şu anki aktif kırmızı lisansları hesapla (green_at değerlendirmesi için)
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    red_cutoff = (now - timedelta(minutes=30)).isoformat()
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    still_red: set = set()
    async for l in db.licenses.find({"active": True}, {"_id": 0, "license_key": 1, "last_heartbeat_at": 1}):
        lk = l.get("license_key") or ""
        if not lk or lk == master_env:
            continue
        ls = l.get("last_heartbeat_at") or ""
        if not ls or ls < red_cutoff:
            still_red.add(lk)
    # Geçmişi topla
    async for h in db.wake_history.find({}, {"_id": 0}).sort("at", -1).limit(limit):
        total = h.get("count") or 0
        ping_licenses = [x.get("license_key") for x in (h.get("licenses") or [])]
        # ping edilenlerden şu an yeşil olanları hesapla
        turned_green = [lk for lk in ping_licenses if lk not in still_red]
        h["turned_green"] = len(turned_green)
        h["still_red"] = total - len(turned_green)
        h["success_pct"] = round((len(turned_green) / total) * 100, 1) if total else 0
        items.append(h)
    return {"total": len(items), "items": items}


@api.get("/plugin/wake-signal")
async def plugin_wake_signal(request: Request, license_key: Optional[str] = None):
    """Bayi plugin bu endpoint'i her plugin/status çağrısında check eder.
    Master tarafından wake sinyali yollanmışsa `wake=true` döner. Bayi de bir
    sonraki cycle'da heartbeat atarak yeşile döner."""
    scope = await _tenant_scope(request, license_key)
    lk = scope.get("owner_license_key") or ""
    if not lk:
        return {"wake": False}
    sig = await db.bayi_wake_signals.find_one({"license_key": lk}, {"_id": 0})
    if not sig:
        return {"wake": False}
    # Süresi geçmişse temizle
    exp = sig.get("expires_at") or ""
    if exp and exp < _iso():
        await db.bayi_wake_signals.delete_one({"license_key": lk})
        return {"wake": False}
    # Sinyal alındığına göre bir defalık temizle
    await db.bayi_wake_signals.delete_one({"license_key": lk})
    return {
        "wake": True,
        "signaled_at": sig.get("signaled_at"),
        "signaled_by": sig.get("signaled_by"),
    }


# ================== E-POSTA ŞABLON EDİTÖRÜ ==================
# Master otomatik sistem maillerinin metnini + marka rengini + logosunu
# panelden özelleştirir. Şablonlar `db.email_templates` içinde saklanır.
# Değişken interpolasyonu: {{customer_name}}, {{plan}}, {{amount}}, vs.

_EMAIL_TEMPLATE_DEFAULTS = {
    "havale_confirmed": {
        "subject": "GökyüzüWebSpam · Havale Ödemeniz Onaylandı",
        "body": (
            "Merhaba {{customer_name}},\n\n"
            "Havale ödemeniz doğrulandı, teşekkür ederiz!\n\n"
            "Referans: {{reference}}\n"
            "Plan: {{plan}} ({{billing_period}})\n"
            "Tutar: {{amount}} {{currency}}\n\n"
            "Lisansınız otomatik olarak {{action}}. "
            "Panele girmek için: https://gokyuzuhosting.com/panel/subscription\n\n"
            "GökyüzüWebSpam ekibi"
        ),
    },
    "session_deactivated": {
        "subject": "GökyüzüWebSpam · Lisansınız Pasifleştirildi",
        "body": (
            "Merhaba {{customer_name}},\n\n"
            "Lisansınız yönetici tarafından pasifleştirildi ve paneliniz "
            "erişilemez duruma geldi.\n\nSebep hakkında bilgi almak için "
            "destek@gokyuzuhosting.com adresi ile iletişime geçin.\n\n"
            "GökyüzüWebSpam ekibi"
        ),
    },
    "plan_changed": {
        "subject": "GökyüzüWebSpam · Planınız Güncellendi",
        "body": (
            "Merhaba {{customer_name}},\n\n"
            "Aboneliğiniz {{old_plan}} → {{new_plan}} planına güncellendi. "
            "Yeni modüller ve limitler panelinizde aktif.\n\n"
            "Detay: https://gokyuzuhosting.com/panel/subscription\n\n"
            "GökyüzüWebSpam ekibi"
        ),
    },
    "bulk_ping_bayi": {
        "subject": "GökyüzüWebSpam · Panel Bağlantı Kontrol",
        "body": (
            "Merhaba {{customer_name}},\n\n"
            "Sunucunuzdan uzun süredir bize heartbeat gelmiyor. Lütfen:\n\n"
            "  1) systemctl status gokyuzuwebspam-logtail\n"
            "  2) Firewall (443 çıkış)\n"
            "  3) journalctl -u gokyuzuwebspam-logtail -n 50\n\n"
            "kontrolü yapın. Sorun sürerse destek@gokyuzuhosting.com'a başvurun.\n\n"
            "GökyüzüWebSpam ekibi"
        ),
    },
}


@api.get("/admin/email-templates")
async def admin_email_templates_get(request: Request, license_key: Optional[str] = None):
    """Master-only. Tüm sistem mail şablonlarını + branding ayarlarını döner."""
    await _require_master(request, license_key)
    brand_doc = await db.settings.find_one({"_key": "email_branding"}, {"_id": 0}) or {}
    brand = {
        "color": brand_doc.get("color", "#10b981"),
        "logo_url": brand_doc.get("logo_url", ""),
        "company_name": brand_doc.get("company_name", "GökyüzüWebSpam"),
        "footer_text": brand_doc.get("footer_text", "Bu bildirim otomatik olarak gönderildi."),
        "from_name": brand_doc.get("from_name", "GökyüzüWebSpam"),
        "from_email": brand_doc.get("from_email", f"noreply@{MASTER_HOST or 'gokyuzuhosting.com'}"),
    }
    templates = {}
    for key, default in _EMAIL_TEMPLATE_DEFAULTS.items():
        doc = await db.email_templates.find_one({"_key": key}, {"_id": 0}) or {}
        templates[key] = {
            "key": key,
            "subject": doc.get("subject") or default["subject"],
            "body": doc.get("body") or default["body"],
            "enabled": doc.get("enabled", True),
            "customized": bool(doc),
            "default_subject": default["subject"],
            "default_body": default["body"],
        }
    return {"branding": brand, "templates": templates}


class EmailTemplateSave(BaseModel):
    key: Literal["havale_confirmed", "session_deactivated", "plan_changed", "bulk_ping_bayi"]
    subject: str
    body: str
    enabled: bool = True


@api.post("/admin/email-templates/save")
async def admin_email_templates_save(payload: EmailTemplateSave, request: Request,
                                       license_key: Optional[str] = None):
    """Master-only. Belirli bir template'i kaydeder."""
    await _require_master(request, license_key)
    await db.email_templates.update_one(
        {"_key": payload.key},
        {"$set": {
            "_key": payload.key,
            "subject": payload.subject,
            "body": payload.body,
            "enabled": payload.enabled,
            "updated_at": _iso(),
        }},
        upsert=True,
    )
    return {"ok": True, "key": payload.key}


@api.post("/admin/email-templates/{key}/reset")
async def admin_email_templates_reset(key: str, request: Request,
                                        license_key: Optional[str] = None):
    """Template'i default'a geri döndürür."""
    await _require_master(request, license_key)
    await db.email_templates.delete_one({"_key": key})
    return {"ok": True, "key": key, "reset": True}


class EmailBrandingSave(BaseModel):
    color: str = "#10b981"
    logo_url: str = ""
    company_name: str = "GökyüzüWebSpam"
    footer_text: str = "Bu bildirim otomatik olarak gönderildi."
    from_name: str = "GökyüzüWebSpam"
    from_email: str = ""


@api.post("/admin/email-branding/save")
async def admin_email_branding_save(payload: EmailBrandingSave, request: Request,
                                      license_key: Optional[str] = None):
    """Master mail markası: renk, logo, imza, gönderici. Şablonlarda HTML
    render'da bu renk arkaplan gradient'i olarak kullanılır."""
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "email_branding"},
        {"$set": {"_key": "email_branding", **payload.model_dump(), "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True}


# ================== BAYİ SUNUCU KAYIT ==================
class BayiServerIn(BaseModel):
    """Bayi kendi WHM sunucusunu master paneline tanıtır."""
    hostname: str        # cpanel.bayi.com
    primary_ip: str      # 1.2.3.4
    ns_records: List[str] = []      # ns1.bayi.com, ns2.bayi.com
    mail_domains: List[str] = []    # Korunan domain'ler
    contact_email: str = ""
    server_notes: Optional[str] = ""


@api.post("/bayi/register-server")
async def bayi_register_server(payload: BayiServerIn, request: Request,
                               license_key: Optional[str] = None):
    """Bayi kendi WHM sunucu bilgilerini kaydeder (hostname/IP/NS/mail domain).
    Master bunları `/admin/bayi-servers`'da görür. Lisans yoksa 403."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    if not owner:
        raise HTTPException(403, "Sunucu kaydı için aktif bir lisans gerekli")
    doc = payload.model_dump()
    doc["owner_license_key"] = owner
    doc["updated_at"] = _iso()
    doc["verified"] = False  # master onaylayacak (opsiyonel)
    existing = await db.bayi_servers.find_one({"owner_license_key": owner}, {"_id": 0})
    if existing:
        await db.bayi_servers.update_one({"owner_license_key": owner}, {"$set": doc})
        doc["id"] = existing.get("id")
        is_new = False
    else:
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = _iso()
        await db.bayi_servers.insert_one(doc)
        is_new = True
    doc.pop("_id", None)
    # Master'a canlı bildirim yalnızca yeni kayıtta
    if is_new:
        lic = await db.licenses.find_one({"license_key": owner}, {"_id": 0}) or {}
        await _push_master_toast(
            kind="bayi_registered",
            title="🎉 Yeni bayi sunucusu bağlandı",
            body=(f"{lic.get('customer_name') or lic.get('customer_email') or 'Bayi'} "
                  f"({doc.get('hostname','?')} · {doc.get('primary_ip','?')}) "
                  f"sunucusunu tanıttı. Doğrulamak ister misiniz?"),
            link=f"/panel/resellers-admin?highlight={doc['id']}",
            meta={"server_id": doc["id"], "owner_license_key": owner,
                  "hostname": doc.get("hostname",""), "primary_ip": doc.get("primary_ip","")},
        )
    return {"ok": True, "server": doc}


@api.get("/bayi/my-server")
async def bayi_my_server(request: Request, license_key: Optional[str] = None):
    """Bayi kendi kayıtlı sunucu bilgilerini + install komutlarını görür.
    Ek olarak `verification` kısmı son 24s ingest edilen mail sayısını + son ingest
    zamanını döner — bayi kurulum sonrası widget'ta canlı sayaç gösterir."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    if not owner:
        return {"server": None, "install": None, "verification": None}
    doc = await db.bayi_servers.find_one({"owner_license_key": owner}, {"_id": 0})
    # Master public API URL öncelik sırası:
    #  1) DB override (master panel'de canlıya alındıysa)
    #  2) MASTER_PUBLIC_API_URL env
    #  3) https://{MASTER_HOST}  (env'den — gokyuzuhosting.com)
    #  4) request.base_url  (son çare — asla 127.0.0.1 dönmemesi için önce host bakılır)
    settings_row = await db.settings.find_one({"_key": "master_public_url"}, {"_id": 0}) or {}
    master_api = (
        settings_row.get("url")
        or os.environ.get("MASTER_PUBLIC_API_URL")
        or (f"https://{MASTER_HOST}" if MASTER_HOST else None)
        or str(request.base_url).rstrip("/")
    ).rstrip("/")
    # request.base_url güvence ağı: eğer localhost/127.0.0.1 döndüyse (container'da)
    # ve MASTER_HOST varsa, gerçek public host'a zorla çevir.
    if MASTER_HOST and ("127.0.0.1" in master_api or "localhost" in master_api):
        master_api = f"https://{MASTER_HOST}"
    install = {
        "master_api_url": master_api,
        "license_key": owner,
        "install_cmd": (
            f"curl -sSL {master_api}/api/scripts/install-bayi.sh | "
            f"sudo LICENSE_KEY={owner} MASTER_URL={master_api} bash"
        ),
        "logtail_cmd": (
            f"sudo /opt/gokyuzuwebspam/mailshield-logtail.pl "
            f"--license={owner} --master={master_api} --daemon"
        ),
        "test_ingest_cmd": (
            f"curl -X POST {master_api}/api/events/ingest "
            f"-H 'Content-Type: application/json' "
            f"-d '{{\"license_key\":\"{owner}\",\"from_addr\":\"test@example.com\","
            f"\"to_addr\":\"you@bayi.com\",\"subject\":\"Bağlantı testi\",\"verdict\":\"clean\"}}'"
        ),
    }
    # Canlı doğrulama sayaçları
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_1h = (now - timedelta(hours=1)).isoformat()
    ingested_24h = await db.mail_events.count_documents(
        {"license_key": owner, "ts": {"$gte": since_24h}}
    )
    ingested_1h = await db.mail_events.count_documents(
        {"license_key": owner, "ts": {"$gte": since_1h}}
    )
    # Son ingest zamanı
    last_ev = await db.mail_events.find_one(
        {"license_key": owner}, {"_id": 0, "ts": 1, "ingested_at": 1},
        sort=[("ts", -1)],
    ) or {}
    last_seen = last_ev.get("ts") or last_ev.get("ingested_at") or None
    connected = False
    minutes_since = None
    if last_seen:
        try:
            last_dt = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
            minutes_since = int((now - last_dt).total_seconds() // 60)
            connected = minutes_since < 10  # son 10dk içinde event geldiyse "canlı"
        except Exception:
            pass
    verification = {
        "connected": connected,
        "ingested_24h": ingested_24h,
        "ingested_1h": ingested_1h,
        "last_seen_at": last_seen,
        "minutes_since_last": minutes_since,
        "status": "live" if connected else ("stale" if ingested_24h > 0 else "not_started"),
        "hint": (
            "🟢 Log ajanı canlı — mailler geliyor" if connected else
            f"🟡 Son ingest {minutes_since}dk önce (10dk üstü = ajan durmuş olabilir)"
            if minutes_since is not None else
            "🔴 Henüz ingest yok — kurulum komutunu WHM sunucunuzda çalıştırın"
        ),
    }
    return {"server": doc, "install": install, "verification": verification}


@api.get("/admin/bayi-servers")
async def admin_bayi_servers(request: Request, license_key: Optional[str] = None):
    """Master-only. Tüm bayi sunucu kayıtlarını döner."""
    await _require_master(request, license_key)
    items = []
    async for r in db.bayi_servers.find({}, {"_id": 0}).sort("updated_at", -1):
        # Bayi bilgilerini enrich et
        lic = await db.licenses.find_one(
            {"license_key": r.get("owner_license_key")},
            {"_id": 0, "customer_name": 1, "customer_email": 1, "plan": 1, "active": 1},
        ) or {}
        r["customer_name"] = lic.get("customer_name", "")
        r["plan"] = lic.get("plan", "")
        r["license_active"] = lic.get("active", False)
        items.append(r)
    return {"items": items, "count": len(items)}


@api.post("/admin/bayi-servers/{server_id}/verify")
async def admin_bayi_server_verify(server_id: str, request: Request,
                                    license_key: Optional[str] = None):
    """Master bayi sunucusunu onaylı olarak işaretler."""
    await _require_master(request, license_key)
    r = await db.bayi_servers.update_one({"id": server_id}, {"$set": {"verified": True, "verified_at": _iso()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Sunucu bulunamadı")
    return {"ok": True}


# ================== IMPERSONATION MODU ==================
IMPERSONATE_COOKIE = "gws_impersonate"


@api.post("/admin/impersonate/start")
async def admin_impersonate_start(request: Request, response: Response,
                                    license_key: Optional[str] = None,
                                    target_license_key: Optional[str] = None):
    """Master seçili bayi lisansı ile impersonate başlatır. Sonraki isteklerde
    `_tenant_scope` bayi context'ine düşer → plan/features/kurallar/motorlar
    hepsi bayi görünümü olur. Master session cookie'si korunur (istediği an çıkar)."""
    await _require_master(request, license_key)
    if not target_license_key:
        raise HTTPException(400, "target_license_key parametresi zorunlu")
    lic = await db.licenses.find_one({"license_key": target_license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Hedef lisans bulunamadı")
    # Cookie ile impersonation
    response.set_cookie(
        IMPERSONATE_COOKIE, target_license_key,
        httponly=False, samesite="lax", secure=False, max_age=3600,
    )
    await db.logs.insert_one(ActivityLog(
        source="impersonate", level="info",
        message=f"Master → bayi görünümüne geçti: {lic.get('customer_name','')} ({target_license_key[:16]}…)",
    ).model_dump())
    return {"ok": True, "impersonating": target_license_key,
            "customer_name": lic.get("customer_name",""), "plan": lic.get("plan","")}


@api.post("/admin/impersonate/stop")
async def admin_impersonate_stop(response: Response):
    """Impersonation cookie'sini siler — master normal görünüme döner."""
    response.delete_cookie(IMPERSONATE_COOKIE)
    return {"ok": True}


@api.get("/admin/impersonate/status")
async def admin_impersonate_status(request: Request):
    """Frontend banner için: şu an impersonate ediliyor mu?"""
    key = request.cookies.get(IMPERSONATE_COOKIE)
    if not key:
        return {"active": False}
    lic = await db.licenses.find_one({"license_key": key}, {"_id": 0}) or {}
    return {"active": True, "target_license_key": key,
            "customer_name": lic.get("customer_name",""),
            "plan": lic.get("plan","")}


@api.get("/plan/features")
async def plan_features(request: Request, license_key: Optional[str] = None):
    """Mevcut lisansın plan bazlı özellik matrisini döner (DB-backed).
    Frontend UI gating için kullanır. Master her zaman enterprise görür.
    Impersonation aktifken (gws_impersonate cookie) hedef bayinin planı döner."""
    # Impersonation önceliği — master `Bayi Görüntüle` modunda bayi planını görür
    imp = request.cookies.get("gws_impersonate")
    if imp and not license_key:
        license_key = imp
    plan = "starter"  # default
    if license_key:
        lic = await db.licenses.find_one({"license_key": license_key, "active": True}, {"_id": 0, "plan": 1})
        if lic:
            plan = str(lic.get("plan", "starter")).lower()
    # Master her zaman enterprise (impersonation değilse)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    if not imp and license_key and license_key == master_key:
        plan = "enterprise"
    matrix = await _load_plan_matrix()
    features = matrix.get(plan, matrix["starter"])
    return {"plan": plan, "features": features,
            "labels": {k: matrix[k]["label"] for k in matrix},
            "impersonated": bool(imp)}


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

    # 0) REVOKE KONTROLÜ — master manuel silmişse burada dur, hiçbir yolla
    # lisans oluşturma/geri getirme. Ancak master aynı IP/hostname için YENİDEN
    # aktif bir lisans oluşturduysa (re-license), stale revoke kaydı verify'ı
    # bloklamamalı. Bu yüzden ÖNCE aktif eşleşen lisans var mı bak.
    active_license_exists = False
    active_check_conds = []
    if payload.license_key:
        active_check_conds.append({"license_key": payload.license_key})
    if payload.hostname:
        active_check_conds.append({"panel_domains": payload.hostname.lower()})
    if payload.ip:
        active_check_conds.append({"ip_addresses": payload.ip})
    if active_check_conds:
        existing = await db.licenses.find_one(
            {"$and": [{"active": True}, {"$or": active_check_conds}]}, {"_id": 0, "id": 1, "license_key": 1}
        )
        if existing:
            active_license_exists = True

    revoke_conditions = []
    if payload.license_key:
        revoke_conditions.append({"license_key": payload.license_key})
    if payload.hostname:
        revoke_conditions.append({"hostname": payload.hostname.lower()})
    if payload.ip:
        revoke_conditions.append({"ip": payload.ip})
    if revoke_conditions:
        blocked = await db.revoked_licenses.find_one({"$or": revoke_conditions}, {"_id": 0})
        if blocked and active_license_exists:
            # Master re-license yapmış — stale revoke kaydını otomatik temizle
            await db.revoked_licenses.delete_many({"$or": revoke_conditions})
            await db.settings.update_one({"_key": "plugin_state"}, {"$unset": {"revoked_at": ""}})
            await db.logs.insert_one(ActivityLog(
                source="license", level="info",
                message=f"Stale revoke otomatik temizlendi (aktif lisans mevcut): IP={payload.ip} host={payload.hostname}",
            ).model_dump())
            blocked = None  # devam et, verify başarılı olacak
        if blocked:
            logging.info(f"Verify BLOCKED — revoked: {blocked}")
            v = LicenseViolation(
                ip=payload.ip or "unknown",
                hostname=payload.hostname or "",
                license_key=payload.license_key or "",
                reason="license_revoked",
                version="",
                raw={"revoked_by_master": True, "revoked_at": blocked.get("revoked_at")},
            )
            await db.license_violations.insert_one(v.model_dump())
            return {
                "licensed": False,
                "gated": True,
                "reason": "license_revoked",
                "message": "Bu lisans master tarafından iptal edildi (revoked). Yeniden lisans için destek ile iletişime geçin.",
            }

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
        # ÖNCE revoke edilmiş bir lisans var mı bak — master lisansı manuel
        # silmişse (blacklist), aynı hostname için tekrar AUTO-* oluşturma.
        revoked = await db.revoked_licenses.find_one(
            {"hostname": payload.hostname.lower()}, {"_id": 0}
        )
        if revoked:
            logging.info(f"NS auto-license SKIP (revoked): {payload.hostname}")
        else:
            authorized_ns = [
            ns.strip().lower().rstrip(".")
            for ns in os.environ.get(
                "AUTHORIZED_NAMESERVERS",
                "ns1.gokyuzuhosting.com,ns2.gokyuzuhosting.com"
            ).split(",")
            if ns.strip()
        ]
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
                        # Ekstra güvenlik: bu auto_key revoke edildiyse dokunma
                        if not await db.revoked_licenses.find_one({"license_key": auto_key}):
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
    """Tek tıkla plugin güncelleme — bayi WHM sunucusunda `install-bayi.sh` (auto.sh)
    betiğini gerçekten çalıştırır:
        curl -sSL {MASTER_URL}/api/scripts/install-bayi.sh | \\
           sudo LICENSE_KEY=<key> MASTER_URL=<master> bash

    Bu betik master'dan (veya GitHub release URL'inden, `GITHUB_RELEASE_URL` env
    var'ı ile) son sürümü indirir, eskisini yedekler, systemd servisini yeniden
    başlatır. Preview'da subprocess bulunamayabilir → simülasyon yapılır."""
    import subprocess
    cur = await db.settings.find_one({"_key": "version"}, {"_id": 0, "_key": 0}) or {"version": "1.1.0"}
    mf  = await db.settings.find_one({"_key": "version_manifest"}, {"_id": 0, "_key": 0}) or VersionManifest().model_dump()
    old = cur["version"]; new = mf["latest_version"]
    def _parts(v): return tuple(int(x) for x in v.replace("v", "").split(".") if x.isdigit())
    if _parts(new) <= _parts(old):
        return UpgradeResult(ok=False, message="Zaten güncel — yeni sürüm yok.",
                             old_version=old, new_version=new).model_dump()

    # Kendi lisans anahtarımızı ve master URL'ini oku
    state = await db.plugin_state.find_one({"_id": "main"}, {"_id": 0}) or {}
    license_key = state.get("license_key") or ""
    master_url = f"https://{MASTER_HOST}" if MASTER_HOST else ""
    if not master_url:
        return UpgradeResult(ok=False, message="MASTER_HOST tanımsız, güncelleme betiği indirilemedi.",
                             old_version=old, new_version=new).model_dump()

    # Bayi WHM sunucusunda: install-bayi.sh betiğini indir + çalıştır
    cmd = (
        f'curl -fsSL {master_url}/api/scripts/install-bayi.sh | '
        f'sudo LICENSE_KEY={license_key} MASTER_URL={master_url} bash'
    )
    await db.logs.insert_one(ActivityLog(source="version", level="info",
        message=f"Plugin upgrade başlatıldı: {old} → {new} | cmd: install-bayi.sh").model_dump())

    # WHM/cPanel dışı ortamlarda (preview, sandbox) subprocess'i hiç çalıştırma —
    # 300s timeout + Cloudflare 100s edge timeout birlikte 502'ye yol açar.
    is_whm = (
        os.path.exists("/usr/local/cpanel")
        or os.environ.get("IS_WHM") in ("1", "true", "yes")
    )
    if not is_whm:
        await db.settings.update_one({"_key": "version"},
            {"$set": {"version": new, "installed_at": _iso()}}, upsert=True)
        await db.logs.insert_one(ActivityLog(source="version", level="info",
            message=f"[SIMULATED preview] Plugin güncellendi: {old} → {new} (WHM tespit edilmedi)").model_dump())
        return UpgradeResult(ok=True,
            message=f"[önizleme] Güncelleme simüle edildi: v{old} → v{new} "
                    f"(WHM sunucuda install-bayi.sh gerçek çalışır)",
            old_version=old, new_version=new).model_dump()

    try:
        proc = subprocess.run(
            ["bash", "-lc", cmd],
            capture_output=True, timeout=90, text=True,
        )
        if proc.returncode == 0:
            await db.settings.update_one({"_key": "version"},
                {"$set": {"version": new, "installed_at": _iso()}}, upsert=True)
            await db.logs.insert_one(ActivityLog(source="version", level="info",
                message=f"Plugin güncellendi: {old} → {new}\n{proc.stdout[-500:]}").model_dump())
            return UpgradeResult(ok=True,
                message=f"Güncelleme tamamlandı: v{old} → v{new}",
                old_version=old, new_version=new).model_dump()
        # Non-zero exit code — betikten gelen hata
        err = (proc.stderr or proc.stdout or "").strip()[-400:]
        await db.logs.insert_one(ActivityLog(source="version", level="error",
            message=f"Plugin upgrade başarısız (exit={proc.returncode}): {err}").model_dump())
        return UpgradeResult(ok=False,
            message=f"Güncelleme betiği hata verdi (exit {proc.returncode}): {err[:200]}",
            old_version=old, new_version=new).model_dump()
    except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError) as ex:
        # Preview / sandbox: gerçek WHM yok, simüle et
        await db.settings.update_one({"_key": "version"},
            {"$set": {"version": new, "installed_at": _iso()}}, upsert=True)
        await db.logs.insert_one(ActivityLog(source="version", level="info",
            message=f"[SIMULATED preview] Plugin güncellendi: {old} → {new} ({type(ex).__name__})").model_dump())
        return UpgradeResult(ok=True,
            message=f"[önizleme] Güncelleme simüle edildi: v{old} → v{new} "
                    f"(WHM sunucuda install-bayi.sh gerçek çalışır)",
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
    # Müşteri ödeme yöntemi seçimi. None → master default'u.
    gateway: Optional[Literal["havale", "stripe", "auto"]] = "auto"


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


@api.get("/admin/stripe-config")
async def admin_stripe_config_get(request: Request, license_key: Optional[str] = None):
    """Master-only. Şu anki Stripe key mode'unu (test/live/emergent/none) döner.
    Gerçek key değeri döndürülmez — sadece son 4 karakter + mode."""
    await _require_master(request, license_key)
    env_key = os.environ.get("STRIPE_API_KEY", "").strip()
    stored = await db.settings.find_one({"_key": "stripe_config"}, {"_id": 0}) or {}
    active_key = stored.get("api_key") or env_key
    mode = "none"
    if active_key:
        if active_key == "sk_test_emergent":
            mode = "emergent_sandbox"
        elif active_key.startswith("sk_test_"):
            mode = "test"
        elif active_key.startswith("sk_live_"):
            mode = "live"
        else:
            mode = "custom"
    tail = active_key[-4:] if len(active_key) >= 4 else ""
    return {
        "mode": mode,
        "source": "db" if stored.get("api_key") else "env",
        "key_tail": tail,
        "has_key": bool(active_key),
        "updated_at": stored.get("updated_at"),
    }


class StripeConfigIn(BaseModel):
    api_key: str
    mode: Optional[str] = None  # info için


@api.get("/admin/payment-settings")
async def admin_payment_settings_get(request: Request, license_key: Optional[str] = None):
    """Master-only. Aktif ödeme gateway ('havale' veya 'stripe')."""
    await _require_master(request, license_key)
    doc = await db.settings.find_one({"_key": "payment_settings"}, {"_id": 0}) or {}
    return {
        "default_gateway": doc.get("default_gateway", "havale"),
        "havale_enabled": doc.get("havale_enabled", True),
        "stripe_enabled": doc.get("stripe_enabled", True),
        "bank_iban": os.environ.get("BANK_IBAN", ""),
        "bank_name": os.environ.get("BANK_NAME", ""),
        "bank_beneficiary": os.environ.get("BANK_BENEFICIARY", ""),
    }


class PaymentSettingsIn(BaseModel):
    default_gateway: Literal["havale", "stripe"] = "havale"
    havale_enabled: bool = True
    stripe_enabled: bool = True


@api.post("/admin/payment-settings")
async def admin_payment_settings_set(payload: PaymentSettingsIn, request: Request,
                                       license_key: Optional[str] = None):
    """Master-only. Varsayılan gateway'i günceller. Havale seçiliyken bayi
    'Yükselt' dediğinde IBAN/referans döner (Stripe API key gerekmez)."""
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "payment_settings"},
        {"$set": {**payload.model_dump(), "_key": "payment_settings", "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **payload.model_dump()}


@api.get("/payment/havale/status")
async def payment_havale_status(ref: str):
    """Havale ödemesinin durumunu döner — HavalePayment.js sayfası 15sn'de
    bir polling yapar. Ref (merchant_oid) ile eşleşen `db.payments` dokümanı
    yoksa 404. Doküman `status` alanına göre `awaiting_transfer / paid /
    failed` durumu döner ve banka bilgileri her istekte tazelenir (master IBAN
    değişse bile bayi yeniden yükleyince güncel görsün)."""
    doc = await db.payments.find_one({"merchant_oid": ref}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Ödeme referansı bulunamadı: {ref}")
    return {
        "reference": doc.get("merchant_oid") or ref,
        "status": doc.get("status") or "awaiting_transfer",
        "amount": doc.get("amount") or 0,
        "currency": doc.get("currency") or "TRY",
        "plan": doc.get("plan_code") or "",
        "billing_period": doc.get("billing_period") or "yearly",
        "is_renewal": bool(doc.get("is_renewal")),
        "customer_email": doc.get("email") or "",
        "customer_name": doc.get("user_name") or "",
        "created_at": doc.get("created_at"),
        "paid_at": doc.get("paid_at"),
        # Master her istekte güncel IBAN'ı görsün
        "iban": os.environ.get("BANK_IBAN", "TR00 0000 0000 0000 0000 0000 00"),
        "bank": os.environ.get("BANK_NAME", "Banka Adı"),
        "beneficiary": os.environ.get("BANK_BENEFICIARY", "Şirket Adı"),
    }


@api.post("/admin/payment/havale/mark-paid")
async def admin_payment_havale_mark_paid(request: Request, ref: str,
                                          license_key: Optional[str] = None):
    """Master-only. Havale ödemesini elle 'ödendi' olarak işaretler ve
    _finalize_purchase mekanizmasını tetikler (lisans oluştur/uzat)."""
    await _require_master(request, license_key)
    doc = await db.payments.find_one({"merchant_oid": ref}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Ödeme bulunamadı")
    if doc.get("status") == "paid":
        return {"ok": True, "already_paid": True}
    await db.payments.update_one(
        {"merchant_oid": ref},
        {"$set": {"status": "paid", "paid_at": _iso(), "paid_by": "master_manual"}},
    )
    # `_finalize_purchase` PaymentTransaction bekliyor — havale için de aynı
    # akışa girmek üzere bir PaymentTransaction stub kaydedelim.
    tx_existing = await db.payment_transactions.find_one({"session_id": ref})
    if not tx_existing:
        tx = PaymentTransaction(
            session_id=ref, plan_code=doc.get("plan_code", "pro"),
            billing_period=doc.get("billing_period", "yearly"),
            amount=float(doc.get("amount") or 0),
            currency=doc.get("currency", "TRY"),
            customer_email=doc.get("email", ""),
            customer_name=doc.get("user_name", ""),
            metadata={
                "plan_code": doc.get("plan_code", "pro"),
                "billing_period": doc.get("billing_period", "yearly"),
                "customer_email": doc.get("email", ""),
                "customer_name": doc.get("user_name", ""),
                "gateway": "havale",
            },
            origin_url="",
        ).model_dump()
        await db.payment_transactions.insert_one(tx)
    metadata = {
        "plan_code": doc.get("plan_code", "pro"),
        "billing_period": doc.get("billing_period", "yearly"),
        "customer_email": doc.get("email", ""),
        "customer_name": doc.get("user_name", ""),
        "gateway": "havale",
    }
    await _finalize_purchase(ref, metadata)
    # Müşteriye onay maili
    cust_email = doc.get("email") or ""
    if cust_email and "@" in cust_email:
        try:
            body = (
                f"Merhaba{(' ' + doc.get('user_name')) if doc.get('user_name') else ''},\n\n"
                f"Havale ödemeniz doğrulandı, teşekkür ederiz! 🎉\n\n"
                f"────────────────────────────────────────────\n"
                f"  ÖDEME DETAYLARI\n"
                f"────────────────────────────────────────────\n"
                f"  Referans     : {ref}\n"
                f"  Plan         : {doc.get('plan_code')} ({doc.get('billing_period')})\n"
                f"  Tutar        : {doc.get('amount')} {doc.get('currency','TRY')}\n"
                f"  Onay tarihi  : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"Lisansınız otomatik olarak {'uzatıldı' if doc.get('is_renewal') else 'oluşturuldu'}. "
                f"Panele girmek için: https://{MASTER_HOST}/panel/subscription\n\n"
                f"GökyüzüWebSpam ekibi"
            )
            await _send_email(cust_email, "GökyüzüWebSpam · Havale Ödemeniz Onaylandı", body)
        except Exception:
            pass
    # Master için toast (dashboard'a bilgi düşsün)
    await _push_master_toast(
        kind="payment_confirmed",
        title="💸 Havale ödemesi onaylandı",
        body=f"{cust_email or 'Müşteri'} · {doc.get('plan_code','')}/{doc.get('billing_period','')} · {doc.get('amount')} {doc.get('currency','TRY')}",
        link="/panel/payments-admin",
        meta={"reference": ref},
    )
    await db.logs.insert_one(ActivityLog(
        source="payment", level="info",
        message=f"HAVALE ONAY: {ref} · {doc.get('email','')} · {doc.get('plan_code','')}/{doc.get('billing_period','')} · {doc.get('amount')} {doc.get('currency','TRY')}",
    ).model_dump())
    return {"ok": True, "paid": True, "reference": ref}


@api.post("/bayi/test-ping")
async def bayi_test_ping(request: Request, license_key: Optional[str] = None):
    """Verification widget "🚀 Test Ping" butonu — bayi lisansı ile sahte bir
    mail_event yaratıp aynı sunucuya push eder. Widget 10sn içinde `ingested_1h`
    sayacında artışı görür."""
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    if not owner:
        raise HTTPException(403, "Test ping için aktif bir lisans gerekli")
    ev = {
        "id": str(uuid.uuid4()),
        "license_key": owner,
        "from_addr": "test@gokyuzuwebspam.local",
        "to_addr": "verify@bayi.local",
        "subject": "[Bağlantı Testi] Widget doğrulama",
        "verdict": "clean",
        "score": 0.0,
        "engine": "test_ping",
        "ts": _iso(),
        "ingested_at": _iso(),
        "test_ping": True,
    }
    await db.mail_events.insert_one(ev)
    return {"ok": True, "event_id": ev["id"], "ts": ev["ts"]}


# ================== BAYİ SAĞLIK & HAVALE PANOSU & PUSH ==================
@api.get("/admin/bayi-health")
async def admin_bayi_health(request: Request, license_key: Optional[str] = None):
    """Master-only. Tüm bayilerin panel bağlantı sağlık durumunu döner.
    Heartbeat kaynağı: `licenses.last_heartbeat_at` (plugin/status her istekte
    günceller). Renk kuralı:
       - green  : < 5 dk
       - yellow : 5-30 dk (yavaşlamış)
       - red    : > 30 dk veya hiç heartbeat yok
    """
    await _require_master(request, license_key)
    now = datetime.now(timezone.utc)
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    out = []
    async for l in db.licenses.find({"active": True}, {"_id": 0}):
        lk = l.get("license_key") or ""
        if not lk or lk == master_env:
            continue
        ls = l.get("last_heartbeat_at") or ""
        health = "red"
        minutes = None
        if ls:
            try:
                d = datetime.fromisoformat(str(ls).replace("Z", "+00:00"))
                minutes = int((now - d).total_seconds() // 60)
                if minutes < 5:
                    health = "green"
                elif minutes < 30:
                    health = "yellow"
                else:
                    health = "red"
            except Exception:
                pass
        out.append({
            "license_key": lk,
            "customer_name": l.get("customer_name", "") or l.get("customer_email", ""),
            "plan": l.get("plan", "starter"),
            "health": health,
            "minutes_since_heartbeat": minutes,
            "last_heartbeat_at": ls or None,
            "last_heartbeat_ip": l.get("last_heartbeat_ip") or "",
            "last_heartbeat_version": l.get("last_heartbeat_version") or "",
        })
    # Sağlık ordering: red > yellow > green (dikkat çekmesi için önce sorunlular)
    order = {"red": 0, "yellow": 1, "green": 2}
    out.sort(key=lambda x: (order.get(x["health"], 3), (x.get("minutes_since_heartbeat") or 9999) * -1))
    totals = {"green": 0, "yellow": 0, "red": 0}
    for x in out:
        totals[x["health"]] = totals.get(x["health"], 0) + 1
    return {
        "total": len(out),
        "totals": totals,
        "generated_at": now.isoformat(),
        "bayis": out,
    }


@api.get("/admin/payments/pending-havale")
async def admin_payments_pending_havale(request: Request, license_key: Optional[str] = None):
    """Master-only. `awaiting_transfer` durumundaki tüm havale ödemelerini
    listeler — Master Ödeme Panosu 'Havale Bekleyen' sekmesi için."""
    await _require_master(request, license_key)
    items = []
    async for p in db.payments.find(
        {"provider": "havale", "status": "awaiting_transfer"}, {"_id": 0}
    ).sort("created_at", -1).limit(200):
        items.append({
            "reference": p.get("merchant_oid"),
            "customer_email": p.get("email"),
            "customer_name": p.get("user_name") or "",
            "plan_code": p.get("plan_code"),
            "billing_period": p.get("billing_period"),
            "amount": p.get("amount"),
            "currency": p.get("currency", "TRY"),
            "is_renewal": bool(p.get("is_renewal")),
            "renewal_license_key": p.get("renewal_license_key") or "",
            "created_at": p.get("created_at"),
            "age_hours": _hours_since(p.get("created_at")),
        })
    return {"total": len(items), "items": items}


def _hours_since(iso_str: Optional[str]) -> Optional[float]:
    if not iso_str:
        return None
    try:
        d = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        return round((datetime.now(timezone.utc) - d).total_seconds() / 3600, 1)
    except Exception:
        return None


@api.post("/admin/payments/reject-havale")
async def admin_payments_reject_havale(request: Request, ref: str,
                                        license_key: Optional[str] = None,
                                        reason: Optional[str] = ""):
    """Master-only. Bekleyen bir havale ödemesini iptal eder (müşteri banka
    üzerinden geri iade almalı; sadece sistemde durumu 'failed' yap)."""
    await _require_master(request, license_key)
    r = await db.payments.update_one(
        {"merchant_oid": ref, "status": "awaiting_transfer"},
        {"$set": {"status": "failed", "failed_at": _iso(),
                  "failed_reason": reason or "master_rejected"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Bekleyen ödeme bulunamadı")
    await db.logs.insert_one(ActivityLog(
        source="payment", level="warning",
        message=f"HAVALE İPTAL: {ref} · sebep: {reason or 'master_rejected'}",
    ).model_dump())
    return {"ok": True, "reference": ref}


@api.get("/push/toasts")
async def push_toasts(request: Request, license_key: Optional[str] = None,
                       since: Optional[str] = None):
    """Master-only. Son toast bildirimlerini döner. Frontend `ThreatAlertBell`
    yanında sessizce polling yapıp yeni event'lerde tarayıcı bildirimi gösterir.

    Kaynak: `db.master_toasts` (yeni bayi kurulum, havale ödeme, tehdit alerti).
    """
    await _require_master(request, license_key)
    q = {}
    if since:
        q["created_at"] = {"$gt": since}
    items = []
    async for t in db.master_toasts.find(q, {"_id": 0}).sort("created_at", -1).limit(50):
        items.append(t)
    return {"total": len(items), "items": items,
            "server_time": datetime.now(timezone.utc).isoformat()}


async def _push_master_toast(kind: str, title: str, body: str,
                              link: Optional[str] = None, meta: Optional[dict] = None):
    """Yardımcı: master için yeni bir toast bildirim yaratır."""
    try:
        await db.master_toasts.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind, "title": title, "body": body,
            "link": link or "", "meta": meta or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "seen": False,
        })
    except Exception:
        pass


@api.post("/admin/stripe-config")
async def admin_stripe_config_set(payload: StripeConfigIn, request: Request,
                                   license_key: Optional[str] = None):
    """Master-only. Runtime Stripe API key'i günceller. DB'ye kaydeder → next
    request'te (`_stripe_client` içinde) DB önceliği alır."""
    await _require_master(request, license_key)
    k = (payload.api_key or "").strip()
    if not k:
        raise HTTPException(400, "API key boş olamaz")
    if not (k.startswith("sk_test_") or k.startswith("sk_live_") or k == "sk_test_emergent"):
        raise HTTPException(400, "Geçersiz format — Stripe key'leri sk_test_ veya sk_live_ ile başlamalı")
    if k != "sk_test_emergent" and len(k) < 20:
        raise HTTPException(400, "Stripe key çok kısa — dashboard'dan tam key'i kopyaladığınızdan emin olun")
    await db.settings.update_one(
        {"_key": "stripe_config"},
        {"$set": {"_key": "stripe_config", "api_key": k, "updated_at": _iso()}},
        upsert=True,
    )
    await db.logs.insert_one(ActivityLog(
        source="stripe", level="info",
        message=f"Stripe API key güncellendi (mode: {'live' if k.startswith('sk_live_') else 'test'})",
    ).model_dump())
    return {"ok": True, "mode": "live" if k.startswith("sk_live_") else "test"}


def _stripe_client(origin: str):
    """Legacy sync API — new code should use `_stripe_client_async` which honors
    the DB-first key override set via /admin/stripe-config."""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    api_key = os.environ.get("STRIPE_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            503,
            "Stripe yapılandırılmamış. Master lütfen /panel/settings → Stripe bölümünden API key girsin.",
        )
    return StripeCheckout(api_key=api_key, webhook_url=f"{origin}/api/checkout/webhook")


async def _stripe_client_async(origin: str):
    """DB-first Stripe client factory (async). checkout_create_session içinde
    kullanılır; DB'de override varsa env yerine onu kullanır."""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    stored = await db.settings.find_one({"_key": "stripe_config"}, {"_id": 0}) or {}
    api_key = (stored.get("api_key") or os.environ.get("STRIPE_API_KEY", "")).strip()
    if not api_key:
        raise HTTPException(
            503,
            "Stripe yapılandırılmamış. Master lütfen /panel/settings → Stripe bölümünden "
            "API key girsin.",
        )
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
        raise HTTPException(400, "Bu plan için ödeme alınamaz — Master fiyatlandırma sayfasından güncelleyin")
    currency = plan.get("currency", "USD").lower()
    origin = payload.origin_url.rstrip("/")

    # Ödeme yöntemi öncelik sırası:
    #   1) Müşteri seçimi (payload.gateway) — 'stripe' veya 'havale'
    #   2) Master default (payment_settings.default_gateway)
    #   3) 'havale' (Stripe API key gerekmediği için güvenli fallback)
    pay_cfg = await db.settings.find_one({"_key": "payment_settings"}, {"_id": 0}) or {}
    default_gw = (pay_cfg.get("default_gateway") or "havale").lower()
    requested = (payload.gateway or "auto").lower()
    if requested in ("stripe", "havale"):
        # Master ilgili gateway'i devre dışı bıraktıysa (havale_enabled/stripe_enabled=false), müşteri onu seçemez
        if requested == "havale" and pay_cfg.get("havale_enabled", True) is False:
            raise HTTPException(400, "Havale/EFT şu an devre dışı — kredi kartını deneyin")
        if requested == "stripe" and pay_cfg.get("stripe_enabled", True) is False:
            raise HTTPException(400, "Kredi kartı ödemesi şu an devre dışı — havale deneyin")
        gateway = requested
    else:
        gateway = default_gw

    if gateway == "havale":
        import uuid as _uuid
        merchant_oid = f"UPG{_uuid.uuid4().hex[:20].upper()}"
        bank_iban = os.environ.get("BANK_IBAN", "TR00 0000 0000 0000 0000 0000 00")
        bank_name = os.environ.get("BANK_NAME", "Banka Adı")
        bank_beneficiary = os.environ.get("BANK_BENEFICIARY", "Şirket Adı")
        await db.payments.insert_one({
            "id": merchant_oid, "merchant_oid": merchant_oid,
            "provider": "havale", "status": "awaiting_transfer",
            "email": payload.customer_email, "user_name": payload.customer_name or "",
            "amount": amount, "currency": plan.get("currency", "TRY"),
            "plan_code": payload.plan_code, "billing_period": payload.billing_period,
            "is_renewal": False,
            "created_at": _iso(),
        })
        # Yeni satın alım intent — success sonrası bu email/plan için lisans oluştur
        await db.settings.update_one(
            {"_key": f"purchase_intent:{payload.customer_email}:{payload.plan_code}"},
            {"$set": {
                "plan_code": payload.plan_code,
                "billing_period": payload.billing_period,
                "customer_email": payload.customer_email,
                "customer_name": payload.customer_name or "",
                "merchant_oid": merchant_oid,
                "requested_at": _iso(),
            }},
            upsert=True,
        )
        await db.logs.insert_one(ActivityLog(
            source="checkout", level="info",
            message=f"Havale çıkışı: {payload.plan_code}/{payload.billing_period} · {payload.customer_email} · {amount} {plan.get('currency','TRY')} · ref={merchant_oid}",
        ).model_dump())
        return {
            "gateway": "havale", "session_id": merchant_oid,
            "url": f"{origin}/panel/payment/havale?ref={merchant_oid}",
            "amount": amount, "currency": plan.get("currency", "TRY"),
            "iban": bank_iban, "bank": bank_name, "beneficiary": bank_beneficiary,
            "reference": merchant_oid, "plan": plan.get("name", payload.plan_code),
            "instructions": (
                f"Kayıtlı IBAN'a {amount:.2f} {plan.get('currency','TRY')} havale yapın; "
                f"AÇIKLAMA alanına '{merchant_oid}' yazmayı unutmayın. "
                f"Ödemeniz doğrulandıktan sonra lisansınız otomatik oluşturulur (max 24 saat)."
            ),
        }

    stripe = await _stripe_client_async(origin)
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
    try:
        session = await stripe.create_checkout_session(session_request)
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(
            502,
            f"Stripe checkout oluşturulamadı — API key geçersiz olabilir ({type(ex).__name__}). "
            f"Detay: {str(ex)[:200]}",
        )
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
    customer_email = metadata.get("customer_email") or tx.get("customer_email", "")

    # ✅ Yenileme senaryosu: `renewal_intent:{email}:{plan}` işareti varsa mevcut
    # lisansı yeni bir kayıt açmak yerine `valid_until` alanını uzat.
    renewal_marker_key = f"renewal_intent:{customer_email}:{plan_code}"
    renewal = await db.settings.find_one({"_key": renewal_marker_key}, {"_id": 0})
    if renewal and renewal.get("license_key"):
        target_lic = await db.licenses.find_one({"license_key": renewal["license_key"]}, {"_id": 0})
        if target_lic:
            # Bitiş tarihinden gelecekteyse ondan uzat, geçtiyse şimdiden uzat
            try:
                cur_exp = datetime.fromisoformat(str(target_lic["valid_until"]).replace("Z", "+00:00"))
            except Exception:
                cur_exp = now
            base = cur_exp if cur_exp > now else now
            new_exp = (base + timedelta(days=days)).isoformat()
            # Version'ı da arttır ki panel cache'ini tazelesin
            new_ver = int(target_lic.get("license_version") or 0) + 1
            await db.licenses.update_one(
                {"license_key": renewal["license_key"]},
                {"$set": {"valid_until": new_exp, "plan": plan_code,
                          "active": True, "license_version": new_ver,
                          "renewed_at": now.isoformat()}},
            )
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"status": "paid", "completed_at": now.isoformat(),
                          "license_key": renewal["license_key"], "is_renewal": True}},
            )
            await db.settings.delete_one({"_key": renewal_marker_key})
            await db.logs.insert_one(ActivityLog(
                source="checkout", level="info",
                message=f"LİSANS YENİLENDİ · {customer_email} · {plan_code}/{billing_period} · {renewal['license_key'][:16]}… → {new_exp[:10]}",
            ).model_dump())
            # Renewal onay maili
            try:
                subj = f"GökyüzüWebSpam · Lisans Yenilendi · {plan.get('name', plan_code)}"
                body = (
                    f"Merhaba,\n\n"
                    f"GökyüzüWebSpam lisansınız başarıyla yenilendi. 🎉\n\n"
                    f"  Lisans      : {renewal['license_key']}\n"
                    f"  Plan        : {plan.get('name', plan_code)} ({billing_period})\n"
                    f"  Yeni bitiş  : {new_exp[:10]}\n"
                    f"  Tutar       : {tx['amount']} {tx['currency']}\n\n"
                    f"Panelinizde ek adım gerekmez — yeni süre birkaç dakika içinde otomatik yansır.\n\n"
                    f"— GökyüzüWebSpam"
                )
                await _send_email(customer_email, subj, body)
            except Exception:
                pass
            # Yenilenen tx'i döndür
            return await db.payment_transactions.find_one({"session_id": session_id})

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
        f"  • Kurulum kılavuzu : {origin or f'https://{MASTER_HOST}'}/install\n"
        f"  • Mail             : destek@{MASTER_HOST}\n"
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
    stripe = await _stripe_client_async(origin)
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
    stripe = await _stripe_client_async(origin)
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
from routes.outbound import router as _outbound_router  # noqa: E402
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
app.include_router(_outbound_router, prefix="/api")

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
    "/api/events/pending-actions/", # plugin action tamamlama callback (bayi WHM sunucusundan)
    "/api/events/logtail-heartbeat", # logtail script canlılık heartbeat
    "/api/events/admin/migrate-ts-tz", # master timezone migration
    "/api/mail/ingest",        # alternatif mail ingest
    "/api/heartbeat",          # plugin heartbeat (license_key ile doğrulanır)
    "/api/threat/report",      # threat feed report
    "/api/blacklist/",         # RBL/blacklist sorgu + delisting (lisanslı panellerin
                               # kendi IP/domainlerini yönetmesi için — DNS lookup
                               # ve kendi delist takibi; demo yazma kilidi uygulanmaz)
    "/api/plan/features",      # plan matris sorgusu (ziyaretçi de görebilir)
    "/api/analytics/plan-event", # PlanGate funnel tracking (ziyaretçi de yazabilir)
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
        # ✅ Kritik: Panelde geçerli bir lisans yüklüyse (kendi bayi/pro lisansı)
        # yazma serbesttir. Aksi halde motor/blacklist/list vb. yazma işlemleri
        # lisanslı panelde bile 423 dönerdi.
        if status.get("licensed"):
            return await call_next(request)
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
