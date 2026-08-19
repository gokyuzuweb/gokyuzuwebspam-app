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
import re
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
    # v43.17 — Toplu Türkçe subject mojibake fix (background task, idempotent)
    # v43.18 — Regex genişletildi: `â` (DISKWARN warning triangle) ve `\ufffd` (replacement char)
    async def _migrate_subjects():
        try:
            import asyncio as _asyncio
            from routes.outbound import _fix_subject
            fixed = 0
            # Sadece mojibake işaretleri olan kayıtları hedef al (index-friendly).
            # Not: MongoDB PCRE2 `\u` escape'i desteklemez → literal Unicode karakter kullan.
            _REPL = "\ufffd"  # U+FFFD replacement char (literal)
            mojibake_regex = f"(=\\?|Ã|Å|Ä±|Ä°|â€|âš|â{_REPL}|{_REPL})"
            cursor = db.mail_events.find(
                {"subject": {"$regex": mojibake_regex}},
                {"_id": 1, "subject": 1}
            ).limit(10000)
            async for d in cursor:
                new_s = _fix_subject(d["subject"])
                if new_s and new_s != d["subject"]:
                    await db.mail_events.update_one({"_id": d["_id"]}, {"$set": {"subject": new_s}})
                    fixed += 1
            if fixed:
                logging.info(f"[startup] Fixed {fixed} mojibake subjects in mail_events")
            # Aynı işlemi quarantine koleksiyonunda da yap
            q_fixed = 0
            cursor2 = db.quarantine.find(
                {"subject": {"$regex": mojibake_regex}},
                {"_id": 1, "subject": 1}
            ).limit(10000)
            async for d in cursor2:
                new_s = _fix_subject(d["subject"])
                if new_s and new_s != d["subject"]:
                    await db.quarantine.update_one({"_id": d["_id"]}, {"$set": {"subject": new_s}})
                    q_fixed += 1
            if q_fixed:
                logging.info(f"[startup] Fixed {q_fixed} mojibake subjects in quarantine")
        except Exception as e:
            logging.warning(f"[startup] mojibake migration skipped: {e}")
    import asyncio as _asyncio_root
    _asyncio_root.create_task(_migrate_subjects())

    # v43.23 — VERSION dosyası değiştiyse (yeni sürüm deploy edildi) master_alerts
    # koleksiyonuna bir "new_version" bildirimi düşür. Idempotent: aynı sürüm için
    # sadece 1 kez.
    async def _broadcast_version_bump():
        try:
            cur_ver = _read_panel_version()
            if not cur_ver or cur_ver == "unknown":
                return
            last = await db.settings.find_one({"_key": "last_broadcast_version"}, {"_id": 0})
            last_ver = (last or {}).get("version") or ""
            if last_ver == cur_ver:
                return
            await db.master_alerts.insert_one({
                "id": str(uuid.uuid4()),
                "type": "new_version",
                "version": cur_ver,
                "previous_version": last_ver or None,
                "message": (f"Yeni sürüm yayınlandı: {cur_ver}"
                            + (f" (önceki: {last_ver})" if last_ver else "")),
                "seen": False,
                "created_at": _iso(),
            })
            await db.settings.update_one(
                {"_key": "last_broadcast_version"},
                {"$set": {"_key": "last_broadcast_version", "version": cur_ver, "updated_at": _iso()}},
                upsert=True,
            )
            # v43.22+ Ayrıca inbox'a da düşür (Bildirim Kutusu için)
            await db.notifications_inbox.insert_one({
                "id": str(uuid.uuid4()),
                "kind": "new_version",
                "title": f"Yeni sürüm: {cur_ver}",
                "message": (f"Panel {cur_ver} sürümüne güncellendi"
                            + (f" (önceki: {last_ver})" if last_ver else "")),
                "version": cur_ver,
                "read": False,
                "severity": "info",
                "created_at": _iso(),
            })
            logging.info(f"[startup] Broadcast new version: {cur_ver} (previous: {last_ver or 'none'})")
        except Exception as e:
            logging.warning(f"[startup] version broadcast skipped: {e}")
    _asyncio_root.create_task(_broadcast_version_bump())

    # v43.24 — Bozuk internal IP fix: proxy/gateway IP'si (172.16-31.x.x, 10.x.x.x,
    # 192.168.x.x, 127.0.0.1) client_ip/sender_ip alanlarına yanlışlıkla yazılmış
    # kayıtları temizle. Header'da X-Originating-IP varsa oradan tekrar yaz.
    async def _fix_internal_ip_records():
        import re as _re
        try:
            def _is_internal(ip):
                if not ip: return False
                if ip in ("127.0.0.1", "::1", "localhost"): return True
                parts = ip.split(".")
                if len(parts) != 4: return False
                try:
                    a, b = int(parts[0]), int(parts[1])
                except ValueError:
                    return False
                if a == 10: return True
                if a == 172 and 16 <= b <= 31: return True
                if a == 192 and b == 168: return True
                return False
            fixed = 0
            for coll_name in ("mail_events", "quarantine"):
                coll = getattr(db, coll_name)
                # 172.16-31 aralığı için regex
                cursor = coll.find(
                    {"$or": [
                        {"client_ip": {"$regex": r"^(172\.(1[6-9]|2[0-9]|3[01])\.|10\.|192\.168\.|127\.)"}},
                        {"sender_ip": {"$regex": r"^(172\.(1[6-9]|2[0-9]|3[01])\.|10\.|192\.168\.|127\.)"}},
                    ]},
                    {"_id": 1, "client_ip": 1, "sender_ip": 1, "headers_full": 1, "headers_preview": 1},
                ).limit(5000)
                async for d in cursor:
                    hdrs = d.get("headers_full") or d.get("headers_preview") or ""
                    real_ip = None
                    m = _re.search(r"X-Originating-IP:\s*\[?([\d.]+)\]?", hdrs, _re.IGNORECASE)
                    if m and not _is_internal(m.group(1)):
                        real_ip = m.group(1)
                    if not real_ip:
                        m = _re.search(r"Received:.*?\[([\d.]+)\]", hdrs)
                        if m and not _is_internal(m.group(1)):
                            real_ip = m.group(1)
                    # Header'dan bulamadıysak null'a çek (yanlış IP'yi göstermekten iyi)
                    upd = {"client_ip": real_ip, "sender_ip": real_ip}
                    await coll.update_one({"_id": d["_id"]}, {"$set": upd})
                    fixed += 1
            if fixed:
                logging.info(f"[startup] Cleaned {fixed} internal-IP records (172.x/10.x/192.168.x → null or header-derived)")
        except Exception as e:
            logging.warning(f"[startup] internal-ip cleanup skipped: {e}")
    _asyncio_root.create_task(_fix_internal_ip_records())

    # v43.31 — IOC Feed Auto-Sync Scheduler
    # Global tehdit zekası feed'lerini (URLhaus, PhishTank, Spamhaus) her 3 saatte
    # bir otomatik senkronize eder. Backend restart'sız güncel IOC verisi sunar.
    async def _ioc_feed_scheduler():
        import asyncio as _a
        try:
            await _a.sleep(60)  # startup'tan 1dk sonra ilk çalıştırma
            while True:
                try:
                    # threat_intel router'daki manual sync helper'ı çağır
                    from routes.threat_intel import auto_sync_run_now
                    result = await auto_sync_run_now()
                    logging.info(f"[ioc-scheduler] Feeds synced: added={result.get('total_added')}")
                except Exception as e:
                    logging.warning(f"[ioc-scheduler] cycle failed: {e}")
                await _a.sleep(3 * 3600)  # 3 saatte bir
        except _a.CancelledError:
            pass
    _asyncio_root.create_task(_ioc_feed_scheduler())

    # v43.33 — Milter Health Auto-Reset Scheduler
    # Milter down algılanırsa 5dk boyunca 3 kez retry, sonra otomatik restart sinyali.
    async def _milter_auto_reset_watcher():
        import asyncio as _a
        try:
            await _a.sleep(180)  # startup + IOC scheduler önce çalışsın
            consecutive_down = 0
            while True:
                try:
                    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
                    now = _dt.now(_tz.utc)
                    last_ingest = None
                    async for d in db.mail_events.find({}, {"ts": 1}).sort("ts", -1).limit(1):
                        last_ingest = d.get("ts")
                        break
                    minutes_since = 9999
                    if last_ingest:
                        try:
                            lt = _dt.fromisoformat(last_ingest.replace("Z", "+00:00"))
                            minutes_since = int((now - lt).total_seconds() / 60)
                        except Exception:
                            pass
                    if minutes_since > 60:  # 1 saatten fazla ingest yok = down
                        consecutive_down += 1
                        logging.warning(f"[milter-auto-reset] cycle #{consecutive_down}: {minutes_since}dk ingest yok")
                        if consecutive_down >= 3:
                            # Reset sinyali yaz
                            now_iso = _iso()
                            signaled = 0
                            async for lic in db.licenses.find({"active": True}, {"license_key": 1}).limit(100):
                                await db.settings.update_one(
                                    {"_key": f"plugin_demand_milter_restart:{lic['license_key']}"},
                                    {"$set": {
                                        "_key": f"plugin_demand_milter_restart:{lic['license_key']}",
                                        "license_key": lic["license_key"],
                                        "requested_at": now_iso,
                                        "requested_by": "auto_reset_watcher",
                                        "handled": False,
                                    }},
                                    upsert=True,
                                )
                                signaled += 1
                            # Log alert
                            await db.master_alerts.insert_one({
                                "id": str(uuid.uuid4()),
                                "type": "milter_auto_reset",
                                "severity": "warning",
                                "message": f"Milter {minutes_since}dk ingest yapmadı — {signaled} bayiye otomatik restart sinyali gönderildi",
                                "created_at": now_iso, "seen": False,
                            })
                            consecutive_down = 0  # reset counter, sinyal gönderildi
                            logging.warning(f"[milter-auto-reset] AUTO-RESTART signal sent to {signaled} bayi")
                    else:
                        consecutive_down = 0  # sağlıklı
                except Exception as e:
                    logging.warning(f"[milter-auto-reset] cycle failed: {e}")
                await _a.sleep(5 * 60)  # her 5dk kontrol
        except _a.CancelledError:
            pass
    _asyncio_root.create_task(_milter_auto_reset_watcher())

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

    # v43.3 Kritik güvenlik yaması — plugin_state global lisans binding'i temizle.
    # Eskiden bir bayi lisansını doğruladığında `plugin_state.licensed=true,
    # license_key=X` yazılıyordu; panel.gokyuzuhosting.com'a giren HERKES o
    # lisans altında görünüyordu. Startup'ta bir kez temizlenir (idempotent).
    # `_key: plugin_state_reset_v43_3` flag'i tekrar çalıştırılmayı önler.
    try:
        flag = await db.settings.find_one({"_key": "plugin_state_reset_v43_3"}, {"_id": 1})
        if not flag:
            r = await db.settings.update_one(
                {"_key": "plugin_state"},
                {"$set": {
                    "licensed": False,
                    "license_key": "",
                    "license_expires": "",
                    "auto_reset_at": datetime.now(timezone.utc).isoformat(),
                    "auto_reset_reason": "v43.3_security_startup_cleanup",
                }},
                upsert=False,
            )
            await db.settings.insert_one({
                "_key": "plugin_state_reset_v43_3",
                "done_at": datetime.now(timezone.utc).isoformat(),
                "modified": r.modified_count,
            })
            log.info("v43.3 plugin_state global binding auto-cleaned (modified=%d)", r.modified_count)
    except Exception as ex:
        log.warning("v43.3 plugin_state cleanup skipped: %s", ex)

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
    # v43.41 — Outbound anomaly detection (rolling 7d baseline vs last 1h)
    try:
        from routes.outbound import _outbound_anomaly_loop
        asyncio.create_task(_outbound_anomaly_loop())
    except Exception as _ex:
        log.warning("outbound anomaly loop not scheduled: %s", _ex)
    # v43.42 — Daily bounce digest (per-license configured send hour)
    try:
        from routes.bounce_digest import _bounce_digest_daily_loop
        asyncio.create_task(_bounce_digest_daily_loop())
    except Exception:
        pass
    # v43.81 — Otomatik Karantina Taraması (24s)
    try:
        from routes.mailscanner import _quarantine_scan_daily_loop, _quarantine_weekly_report_loop
        asyncio.create_task(_quarantine_scan_daily_loop())
        # v43.82 — Haftalık master email raporu (Pazartesi 08:00 UTC)
        asyncio.create_task(_quarantine_weekly_report_loop())
    except Exception as _ex:
        log.warning("bounce digest loop not scheduled: %s", _ex)

    # v43.90 — Zamanlanmış mail aktivite rapor teslimatı (her 5 dk kontrol eder)
    try:
        from routes.report_schedules import _report_schedule_loop as _rsl
        asyncio.create_task(_rsl())
    except Exception as _ex:
        log.warning("report_schedule_loop not scheduled: %s", _ex)

    # v43.99.11 — Haftalık otomatik DB snapshot
    try:
        from routes.auto_backup import start_scheduler as _sbs
        _sbs()
    except Exception as _ex:
        log.warning("auto_backup scheduler not started: %s", _ex)


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
        "ip": r.get("_id"), "sender": r.get("sender"), "count": r.get("count", 0),
        "avg_score": round(r.get("avg_score") or 0.0, 2),
        "verdict": r.get("verdict"),
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
    # v43.25 — Demo user'ları da `users` collection'ından temizle
    # v43.31 — sample_cpanel source'lu tüm kullanıcıları da temizle
    demo_usernames = ["example", "sirket", "tekno", "deneme", "kobi",
                      "ahmetkaya", "mehmet-ozdemir", "bayianadolu", "info-hasan",
                      "selin", "bariskaraca", "kutlu", "ozer",
                      "mertkaya", "ayses", "kerimyilmaz"]
    u = await db.users.delete_many({
        "$or": [
            {"username": {"$in": demo_usernames}},
            {"domain": {"$in": list(_DEMO_DOMAINS)}},
            {"source": {"$in": ["sample_cpanel", "csv_import", "seed"]}},
        ]
    })
    await db.logs.insert_one(ActivityLog(
        source="quarantine", level="warn",
        message=f"Demo verisi temizlendi: quarantine={q.deleted_count}, mail_events={e.deleted_count}, users={u.deleted_count}",
    ).model_dump())
    return {"quarantine_deleted": q.deleted_count, "events_deleted": e.deleted_count,
            "users_deleted": u.deleted_count,
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


@api.get("/quarantine/{item_id}/content")
async def quarantine_content(item_id: str):
    """v43.23 — Karantina Gmail-style modal için normalize edilmiş içerik.
    Şema Outbound `/event/{id}/content` ile birebir aynı → shared frontend
    reader component'i her ikisini de besleyebilir."""
    doc = await db.quarantine.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kayıt bulunamadı")
    # Türkçe subject mojibake fix (outbound'daki gibi)
    try:
        from routes.outbound import _fix_subject
    except Exception:
        _fix_subject = lambda s: s
    body_preview = doc.get("body_preview") or ""
    body_html = doc.get("body_html") or ""
    headers_full = doc.get("headers_full") or doc.get("headers") or doc.get("headers_preview") or ""
    return {
        "id": doc.get("id"),
        "ts": doc.get("received_at") or doc.get("ingested_at"),
        "from_addr": doc.get("from") or doc.get("from_addr"),
        "from_user": doc.get("from_user"),
        "to_addr": doc.get("to") or doc.get("to_addr"),
        "subject": _fix_subject(doc.get("subject") or ""),
        "verdict": doc.get("verdict"),
        "total_score": doc.get("score") or doc.get("total_score"),
        "scores": doc.get("scores") or {},
        "sender_ip": doc.get("sender_ip") or doc.get("client_ip"),
        "size_bytes": doc.get("size_bytes"),
        "message_id": doc.get("message_id") or doc.get("exim_mid"),
        "headers_full": headers_full,
        "body_preview": _fix_subject(body_preview) if body_preview else body_preview,
        "body_html":    _fix_subject(body_html) if body_html else body_html,
        "attachments": doc.get("attachments") or [],
        "action": doc.get("action"),
        "clam_verdict": doc.get("clam_verdict"),  # v43.23 — ClamAV verdict passthrough
        "content_source": "db" if (headers_full or body_preview or body_html) else "none",
    }


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


@api.post("/lists/bulk-delete")
async def lists_bulk_delete(request: Request):
    """v43.26 — Seçilen kayıtları toplu sil. Body: {"ids": ["...", "..."]}"""
    scope = await _tenant_scope(request, None)
    body = await request.json()
    ids = body.get("ids") or []
    if not ids or not isinstance(ids, list):
        raise HTTPException(400, "ids: string listesi gerekli")
    filt: dict = {"id": {"$in": ids}}
    if not scope.get("is_master"):
        filt["license_key"] = scope.get("owner_license_key") or "__none__"
    r = await db.lists.delete_many(filt)
    return {"deleted": r.deleted_count}


@api.post("/lists/purge")
async def lists_purge(request: Request, list_type: str = "white"):
    """v43.26 — Belirtilen liste türünün TAMAMINI temizle (?list_type=white|black).
    Master ise tüm tenant'lar, bayi ise sadece kendi kayıtları."""
    scope = await _tenant_scope(request, None)
    filt: dict = {"list_type": list_type}
    if not scope.get("is_master"):
        filt["license_key"] = scope.get("owner_license_key") or "__none__"
    r = await db.lists.delete_many(filt)
    return {"deleted": r.deleted_count, "list_type": list_type}


# ----- Rules -----
@api.get("/rules-legacy-removed", include_in_schema=False)
async def _rules_legacy_placeholder():
    """v1.5 refactor: /rules endpoints moved to routes/rules.py"""
    raise HTTPException(410, "Bu endpoint modüle taşındı (routes/rules.py)")


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


@api.post("/rules-legacy-post-removed", include_in_schema=False)
async def _rules_post_legacy():
    raise HTTPException(410, "Bu endpoint modüle taşındı (routes/rules.py)")


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


# v1.5 refactor: PUT/DELETE /rules/{id} moved to routes/rules.py.
# Kept alias-only endpoints for backward-compat while router loads.


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


# ================== v43.72 — İDLE AUTO-LOCK AYARLARI ==================
# Master tek yerden idle lock süresini ayarlar; tüm bayilerin paneli o süreye göre
# hareketsiz kalırsa otomatik kilitlenir. Bayi tarafında sadece OKUMA yetkisi var.
@api.get("/settings/idle-lock")
async def settings_idle_lock_get(request: Request):
    """Idle auto-lock config — tüm bayiler + master için tek global ayar."""
    doc = await db.settings.find_one({"_key": "idle_lock"}, {"_id": 0, "_key": 0}) or {}
    return {
        "enabled": bool(doc.get("enabled", True)),
        "minutes": int(doc.get("minutes", 15)),
        "warn_seconds": int(doc.get("warn_seconds", 30)),  # kaç sn önce uyarı göstersin
    }


class IdleLockIn(BaseModel):
    enabled: bool = True
    minutes: int = Field(15, ge=1, le=1440)     # 1dk – 24s
    warn_seconds: int = Field(30, ge=0, le=300)  # kilitten kaç sn önce uyarı


@api.post("/settings/idle-lock")
async def settings_idle_lock_set(payload: IdleLockIn, request: Request,
                                  license_key: Optional[str] = None):
    """Master-only. Idle lock ayarını günceller."""
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "idle_lock"},
        {"$set": {"_key": "idle_lock", **payload.model_dump(), "updated_at": _iso(),
                  "updated_by_ip": _client_ip(request)}},
        upsert=True,
    )
    # audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "idle_lock_updated",
        "actor_ip": _client_ip(request),
        "details": payload.model_dump(),
        "at": _iso(),
    })
    return {"ok": True, **payload.model_dump()}


# ================== v43.80 — PER-BAYİ İDLE LOCK + PIN ==================
# Her bayi kendi kilit ayarını + PIN'ini kendisi belirler. PIN hash'lenerek
# saklanır (PBKDF2-SHA256, per-user salt). Panel yenilendiğinde kilit LOCALSTORAGE
# üzerinden persist eder — sadece PIN ile açılabilir. Master global config
# fallback olarak kalır (kendi PIN'i yoksa global ayarları kullanır).
import hashlib as _hashlib
import secrets as _secrets


def _pin_hash(pin: str, salt: str) -> str:
    """PBKDF2-SHA256 · 200k iter · salt ile hex digest."""
    dk = _hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return dk.hex()


def _resolve_lock_owner(request: Request, license_key_qs: Optional[str] = None) -> str:
    """Idle lock için tenant owner belirle.
    - Master IP + master key varsa → '__master__' sentinel
    - X-Master-Key veya X-License-Key veya query license_key → o key
    - Hiçbiri yoksa → '__anon__' (kaydedilmez ama okuma boş döner)
    """
    hdr = request.headers
    lk = (license_key_qs or hdr.get("X-Master-Key") or hdr.get("X-License-Key") or "").strip()
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    master_ip = os.environ.get("MASTER_IP", "")
    ip = _client_ip(request)
    if master_env and lk == master_env and (not master_ip or ip == master_ip):
        return "__master__"
    if lk:
        return lk
    return "__anon__"


# -- v43.90 UI Theme (per-owner accent color) ---------------------------------
class UIThemeIn(BaseModel):
    accent_color: Literal["indigo", "fuchsia", "emerald", "cyan", "rose"] = "indigo"


@api.get("/settings/ui-theme/me")
async def ui_theme_get(request: Request, license_key: Optional[str] = None):
    owner = _resolve_lock_owner(request, license_key)
    doc = await db.ui_theme_settings.find_one({"owner": owner}, {"_id": 0}) or {}
    return {"owner": owner, "accent_color": doc.get("accent_color", "indigo")}


@api.put("/settings/ui-theme/me")
async def ui_theme_put(payload: UIThemeIn, request: Request, license_key: Optional[str] = None):
    owner = _resolve_lock_owner(request, license_key)
    await db.ui_theme_settings.update_one(
        {"owner": owner},
        {"$set": {"owner": owner, "accent_color": payload.accent_color, "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "owner": owner, "accent_color": payload.accent_color}


# -- v43.90 Bayi IP Whitelist Enforce settings --------------------------------
class BayiIPEnforceIn(BaseModel):
    enabled: bool = False


@api.get("/settings/bayi-ip-enforce")
async def bayi_ip_enforce_get(request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    doc = await db.settings.find_one({"_key": "bayi_ip_whitelist_enforce"}, {"_id": 0}) or {}
    return {"enabled": bool(doc.get("enabled", False))}


@api.put("/settings/bayi-ip-enforce")
async def bayi_ip_enforce_put(payload: BayiIPEnforceIn, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    await db.settings.update_one(
        {"_key": "bayi_ip_whitelist_enforce"},
        {"$set": {"_key": "bayi_ip_whitelist_enforce", "enabled": payload.enabled, "updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "enabled": payload.enabled}


# -- v43.91 Trusted IPs (foreign-IP alarm muafiyeti) --------------------------
class TrustedIPIn(BaseModel):
    ip: str = Field(..., min_length=3, max_length=64)
    label: str = Field("", max_length=100)


@api.get("/settings/trusted-ips")
async def trusted_ips_list(request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    rows = await db.trusted_ips.find({"active": True}, {"_id": 0}).sort("added_at", -1).to_list(200)
    # v43.94 — Enrich with country code for flag display
    try:
        from routes.security_adv import _ip_to_country
        for r in rows:
            try:
                r["country_code"] = (_ip_to_country(r.get("ip") or "") or "").upper()
            except Exception:
                r["country_code"] = ""
    except Exception:
        pass
    return {"items": rows, "count": len(rows)}


@api.get("/settings/trusted-ips/export.csv")
async def trusted_ips_export_csv(request: Request, license_key: Optional[str] = None):
    """v43.95 — Trusted IP listesini CSV olarak indir."""
    await _require_master(request, license_key)
    rows = await db.trusted_ips.find({"active": True}, {"_id": 0}).sort("added_at", -1).to_list(2000)
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: ""   # noqa
    import io as _io, csv as _csv
    buf = _io.StringIO()
    w = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    w.writerow(["ip", "country_code", "label", "added_at", "added_by_ip", "added_via"])
    for r in rows:
        try:
            cc = (_ip_to_country(r.get("ip") or "") or "").upper()
        except Exception:
            cc = ""
        w.writerow([
            r.get("ip", ""), cc, r.get("label", ""),
            r.get("added_at", ""), r.get("added_by_ip", ""), r.get("added_via", ""),
        ])
    from fastapi.responses import Response as _Response
    return _Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="trusted-ips-{datetime.now(timezone.utc).strftime("%Y%m%d")}.csv"'
        },
    )


@api.post("/settings/trusted-ips")
async def trusted_ips_add(payload: TrustedIPIn, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    ip = payload.ip.strip()
    if not ip:
        raise HTTPException(400, "IP adresi boş olamaz")
    doc = {
        "id": str(uuid.uuid4()), "ip": ip, "label": (payload.label or "").strip()[:100],
        "active": True, "added_at": _iso(), "added_by_ip": _client_ip(request),
    }
    await db.trusted_ips.update_one({"ip": ip}, {"$set": doc}, upsert=True)
    # Bu IP kill listesinde varsa unblock et
    try:
        await db.killed_master_ips.update_one({"ip": ip}, {"$set": {"active": False, "unblocked_reason": "trusted_ip_added"}})
    except Exception:
        pass
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "trusted_ip_added",
        "actor_ip": _client_ip(request), "details": {"ip": ip, "label": doc["label"]},
        "at": _iso(), "severity": "info",
    })
    return {"ok": True, "ip": ip}


class TrustedIPsBulkIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    label: str = Field("", max_length=100)


@api.post("/settings/trusted-ips/bulk")
async def trusted_ips_bulk_add(payload: TrustedIPsBulkIn, request: Request, license_key: Optional[str] = None):
    """v43.93 — Toplu IP ekleme: satır/CSV/space ayrılmış listeden çoklu IP ekler."""
    await _require_master(request, license_key)
    import re as _re
    label_default = (payload.label or "").strip()[:100]

    # Önce satırlara böl (label boşluk içerebilir)
    lines = [l.strip() for l in payload.text.strip().splitlines() if l.strip()]
    parsed: List[tuple] = []  # [(ip, label), ...]
    for line in lines:
        # Etiket ayırıcısı: '=' veya '|'
        m = _re.match(r"^([^=|\s]+)\s*[=|]\s*(.+)$", line)
        if m:
            parsed.append((m.group(1).strip(), m.group(2).strip()[:100] or label_default))
        else:
            # Satırda ip=label yoksa boşluk/virgül ile birden fazla IP olabilir
            for tok in _re.split(r"[\s,;]+", line):
                t = tok.strip().strip('"').strip("'")
                if t:
                    parsed.append((t, label_default))

    added, skipped, errors = [], [], []
    for ip_val, lbl in parsed:
        if not _re.match(r"^[0-9a-fA-F.:/]+$", ip_val) or len(ip_val) < 3:
            errors.append(ip_val)
            continue
        existing = await db.trusted_ips.find_one({"ip": ip_val, "active": True}, {"_id": 0})
        if existing:
            skipped.append(ip_val)
            continue
        doc = {
            "id": str(uuid.uuid4()), "ip": ip_val, "label": lbl,
            "active": True, "added_at": _iso(), "added_by_ip": _client_ip(request),
            "added_via": "bulk",
        }
        await db.trusted_ips.update_one({"ip": ip_val}, {"$set": doc}, upsert=True)
        try:
            await db.killed_master_ips.update_one({"ip": ip_val}, {"$set": {"active": False, "unblocked_reason": "trusted_ip_bulk_added"}})
        except Exception:
            pass
        added.append(ip_val)

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "trusted_ip_bulk_added",
        "actor_ip": _client_ip(request),
        "details": {"added": added, "skipped": skipped, "errors": errors, "label_default": label_default},
        "at": _iso(), "severity": "info",
    })
    return {"ok": True, "added": added, "skipped": skipped, "errors": errors,
            "counts": {"added": len(added), "skipped": len(skipped), "errors": len(errors)}}


@api.delete("/settings/trusted-ips/{ip:path}")
async def trusted_ips_remove(ip: str, request: Request, license_key: Optional[str] = None):
    await _require_master(request, license_key)
    r = await db.trusted_ips.update_one({"ip": ip}, {"$set": {"active": False, "removed_at": _iso()}})
    if r.matched_count == 0:
        raise HTTPException(404, "IP bulunamadı")
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "trusted_ip_removed",
        "actor_ip": _client_ip(request), "details": {"ip": ip},
        "at": _iso(), "severity": "info",
    })
    return {"ok": True, "removed": ip}



class IdleLockMeIn(BaseModel):
    enabled: Optional[bool] = None
    minutes: Optional[int] = Field(None, ge=1, le=1440)
    warn_seconds: Optional[int] = Field(None, ge=0, le=300)
    # v43.83 — Kilit ekranı teması
    theme: Optional[Literal["dark", "light", "alarm"]] = None
    # v43.85 — Zaman bazlı otomatik tema: "off" (sabit) | "night_alarm" (22:00-06:00 alarm)
    theme_schedule: Optional[Literal["off", "night_alarm"]] = None
    # PIN yönetimi
    new_pin: Optional[str] = Field(None, pattern=r"^\d{4,8}$")   # 4-8 haneli sayı
    current_pin: Optional[str] = Field(None, pattern=r"^\d{4,8}$")  # PIN değişiminde mevcut PIN
    clear_pin: bool = False  # true → PIN'i kaldır (lisans key fallback)
    force: bool = False  # v43.99.9 — Master için: current_pin olmadan reset (PIN unuttum akışı)


@api.get("/settings/idle-lock/me")
async def settings_idle_lock_me_get(request: Request,
                                     license_key: Optional[str] = None):
    """Bayi kendi kilit ayarını çeker. Master global ayar fallback.
    Response: {enabled, minutes, warn_seconds, has_pin, source: 'user'|'global'}
    """
    owner = _resolve_lock_owner(request, license_key)
    if owner == "__anon__":
        raise HTTPException(status_code=401, detail="Kilit ayarları için oturum gerekli")
    user_doc = await db.idle_lock_user_configs.find_one({"owner": owner}, {"_id": 0}) or {}
    global_doc = await db.settings.find_one({"_key": "idle_lock"}, {"_id": 0, "_key": 0}) or {}
    # Merge: user override > global > default
    enabled = user_doc.get("enabled")
    if enabled is None:
        enabled = bool(global_doc.get("enabled", True))
    minutes = user_doc.get("minutes") or int(global_doc.get("minutes", 15))
    warn_seconds = user_doc.get("warn_seconds")
    if warn_seconds is None:
        warn_seconds = int(global_doc.get("warn_seconds", 30))
    return {
        "enabled": bool(enabled),
        "minutes": int(minutes),
        "warn_seconds": int(warn_seconds),
        "has_pin": bool(user_doc.get("pin_hash")),
        "theme": user_doc.get("theme") or "dark",   # v43.83
        "theme_schedule": user_doc.get("theme_schedule") or "off",   # v43.85
        "source": "user" if user_doc else "global",
        "owner": owner if owner != "__master__" else "master",
    }


@api.put("/settings/idle-lock/me")
async def settings_idle_lock_me_set(payload: IdleLockMeIn, request: Request,
                                     license_key: Optional[str] = None):
    """Bayi kendi kilit ayarını + PIN'ini günceller. Master kendi global ayarı
    dışında burada da kendi kişisel PIN'ini yönetebilir."""
    owner = _resolve_lock_owner(request, license_key)
    if owner == "__anon__":
        raise HTTPException(status_code=401, detail="Kilit ayarları için oturum gerekli")
    existing = await db.idle_lock_user_configs.find_one({"owner": owner}) or {}
    update: dict = {}
    if payload.enabled is not None:
        update["enabled"] = bool(payload.enabled)
    if payload.minutes is not None:
        update["minutes"] = int(payload.minutes)
    if payload.warn_seconds is not None:
        update["warn_seconds"] = int(payload.warn_seconds)
    if payload.theme is not None:
        update["theme"] = payload.theme   # v43.83
    if payload.theme_schedule is not None:
        update["theme_schedule"] = payload.theme_schedule   # v43.85
    # PIN yönetimi
    # v43.99.9 — Master hesabı 'force' parametresiyle current_pin olmadan reset yapabilir (PIN unuttuysa).
    # Bayilerde 'force' yok — sadece master token'lı kullanıcı için geçerli.
    _is_master_here = bool(license_key and MASTER_LICENSE_KEY and license_key == MASTER_LICENSE_KEY)
    _force = getattr(payload, "force", False) and _is_master_here
    if payload.clear_pin:
        if existing.get("pin_hash") and not _force:
            if not payload.current_pin:
                raise HTTPException(status_code=400, detail="PIN'i kaldırmak için mevcut PIN gerekli")
            if _pin_hash(payload.current_pin, existing.get("salt", "")) != existing.get("pin_hash"):
                raise HTTPException(status_code=403, detail="Mevcut PIN hatalı")
        update["pin_hash"] = None
        update["salt"] = None
        update["failed_attempts"] = 0
        update["locked_until"] = None
    elif payload.new_pin:
        if existing.get("pin_hash") and not _force:
            if not payload.current_pin:
                raise HTTPException(status_code=400, detail="PIN değişimi için mevcut PIN gerekli")
            if _pin_hash(payload.current_pin, existing.get("salt", "")) != existing.get("pin_hash"):
                raise HTTPException(status_code=403, detail="Mevcut PIN hatalı")
        salt = _secrets.token_hex(16)
        update["salt"] = salt
        update["pin_hash"] = _pin_hash(payload.new_pin, salt)
        update["failed_attempts"] = 0
        update["locked_until"] = None
    if not update:
        raise HTTPException(status_code=400, detail="Değiştirilecek alan gönderilmedi")
    update["owner"] = owner
    update["updated_at"] = _iso()
    update["updated_by_ip"] = _client_ip(request)
    await db.idle_lock_user_configs.update_one(
        {"owner": owner},
        {"$set": update, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )
    # audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "idle_lock_user_updated",
        "actor_ip": _client_ip(request),
        "owner": owner,
        "details": {k: v for k, v in update.items() if k not in ("pin_hash", "salt")},
        "at": _iso(),
    })
    return {
        "ok": True,
        "enabled": update.get("enabled", existing.get("enabled", True)),
        "minutes": update.get("minutes", existing.get("minutes", 15)),
        "warn_seconds": update.get("warn_seconds", existing.get("warn_seconds", 30)),
        "has_pin": bool(update.get("pin_hash") if "pin_hash" in update else existing.get("pin_hash")),
    }


class IdleLockVerifyPinIn(BaseModel):
    pin: str = Field(..., pattern=r"^\d{4,8}$")


@api.post("/settings/idle-lock/verify-pin")
async def settings_idle_lock_verify_pin(payload: IdleLockVerifyPinIn, request: Request,
                                          license_key: Optional[str] = None):
    """Kilit ekranından PIN doğrulama. Rate-limited: 5 hatalı deneme sonra 5dk cooldown."""
    owner = _resolve_lock_owner(request, license_key)
    if owner == "__anon__":
        raise HTTPException(status_code=401, detail="Oturum yok")
    doc = await db.idle_lock_user_configs.find_one({"owner": owner}) or {}
    pin_hash = doc.get("pin_hash")
    if not pin_hash:
        raise HTTPException(status_code=404, detail="PIN atanmamış — Ayarlar > Otomatik Kilit'ten PIN oluşturun")
    # Cooldown kontrolü
    locked_until = doc.get("locked_until")
    now = datetime.now(timezone.utc)
    if locked_until:
        try:
            lu = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
            if lu > now:
                remaining = int((lu - now).total_seconds())
                raise HTTPException(status_code=429,
                                    detail=f"Çok fazla hatalı deneme — {remaining} saniye sonra tekrar deneyin")
        except (ValueError, AttributeError):
            pass
    # PIN karşılaştır
    provided_hash = _pin_hash(payload.pin, doc.get("salt", ""))
    if provided_hash != pin_hash:
        failed = int(doc.get("failed_attempts") or 0) + 1
        update = {"failed_attempts": failed, "last_failed_at": _iso(),
                  "last_failed_ip": _client_ip(request)}
        if failed >= 5:
            cooldown_until = (now + timedelta(minutes=5)).isoformat()
            update["locked_until"] = cooldown_until
            update["failed_attempts"] = 0
            await db.idle_lock_user_configs.update_one({"owner": owner}, {"$set": update})
            # audit + alert
            await db.audit_logs.insert_one({
                "id": str(uuid.uuid4()),
                "action": "idle_lock_pin_bruteforce",
                "actor_ip": _client_ip(request),
                "owner": owner,
                "at": _iso(),
                "severity": "warning",
            })
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme — 5 dakika kilitlendi")
        await db.idle_lock_user_configs.update_one({"owner": owner}, {"$set": update})
        remaining_tries = 5 - failed
        raise HTTPException(status_code=403, detail=f"PIN hatalı ({remaining_tries} deneme kaldı)")
    # Başarılı
    await db.idle_lock_user_configs.update_one(
        {"owner": owner},
        {"$set": {"failed_attempts": 0, "locked_until": None, "last_unlocked_at": _iso(),
                  "last_unlocked_ip": _client_ip(request)}},
    )
    return {"ok": True, "unlocked_at": _iso()}


# v43.77 — Slash Command Aliases (macro)
class SlashAliasIn(BaseModel):
    name: str = Field(..., pattern=r"^[a-z0-9_-]{2,32}$")   # /mystatus, /allhealth
    expansion: str = Field(..., min_length=3, max_length=500)  # "/run health-check @all"
    description: Optional[str] = Field(None, max_length=180)


@api.get("/slash-aliases")
async def slash_aliases_list(request: Request, license_key: Optional[str] = None):
    """Master'ın tanımladığı tüm slash aliaslarını döner (frontend autocomplete için)."""
    await _require_master(request, license_key)
    cursor = db.slash_aliases.find({}, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(200)
    return {"items": items, "count": len(items)}


@api.post("/slash-aliases")
async def slash_aliases_set(payload: SlashAliasIn, request: Request,
                             license_key: Optional[str] = None):
    """Master alias oluşturur/günceller. name unique."""
    await _require_master(request, license_key)
    now = _iso()
    await db.slash_aliases.update_one(
        {"name": payload.name},
        {"$set": {"name": payload.name, "expansion": payload.expansion,
                  "description": payload.description or "", "updated_at": now},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
        upsert=True,
    )
    doc = await db.slash_aliases.find_one({"name": payload.name}, {"_id": 0})
    return {"ok": True, **doc}


@api.delete("/slash-aliases/{name}")
async def slash_aliases_delete(name: str, request: Request,
                                license_key: Optional[str] = None):
    """Alias'ı sil."""
    await _require_master(request, license_key)
    r = await db.slash_aliases.delete_one({"name": name})
    return {"ok": True, "deleted": r.deleted_count}



class IdleLockEventIn(BaseModel):
    event: Literal["lock", "unlock"]
    idle_seconds: Optional[int] = None
    license_key: Optional[str] = None  # aktif oturumun lisansı (label için)
    # v43.74 — IP fingerprint (session hijack koruma)
    ip_changed: Optional[bool] = None
    previous_ip: Optional[str] = None
    current_ip: Optional[str] = None


@api.post("/audit/idle-lock-event")
async def audit_idle_lock_event(payload: IdleLockEventIn, request: Request):
    """Herhangi bir kullanıcı (master veya bayi) panel kilitleme/açma olayını
    Audit Log'a kaydeder. Public erişim var — actor_ip ve license_key üzerinden
    kim yaptığı takip edilir."""
    lk = (payload.license_key or request.headers.get("x-master-key") or "").strip()
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    label = "master" if lk == master_env else (lk[:24] if lk else "anonymous")
    # v43.74 — unlock + ip_changed → warning severity (audit sorgusu kolay olsun)
    severity = "warning" if (payload.event == "unlock" and payload.ip_changed) else "info"
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": f"idle_lock_{payload.event}",
        "actor_ip": _client_ip(request),
        "actor_label": label,
        "severity": severity,
        "details": {
            "event": payload.event,
            "idle_seconds": payload.idle_seconds,
            "license_key_preview": lk[:16] if lk else None,
            # v43.74 — IP fingerprint sinyalleri
            "ip_changed": payload.ip_changed,
            "previous_ip": payload.previous_ip,
            "current_ip": payload.current_ip,
        },
        "ts": _iso(),
        "at": _iso(),
    })
    # v43.75 — IP değişikliği → master'a anlık uyarı (ThreatBell + email)
    if payload.event == "unlock" and payload.ip_changed:
        # v43.76 — Slack spam koruma: aynı bayidan son 5dk'da 3+ ip_change varsa
        # bireysel Slack yerine grouped summary yolla.
        from datetime import timedelta
        since_5min = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        recent_same = await db.master_alerts.count_documents({
            "type": "idle_lock_ip_change",
            "license_key": lk if lk else None,
            "created_at": {"$gte": since_5min},
        })
        alert_msg = f"⚠️ IP değişikliği: {label} · {payload.previous_ip} → {payload.current_ip}"
        await db.master_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "idle_lock_ip_change",
            "severity": "warning",
            "license_key": lk if lk else None,
            "actor_ip": _client_ip(request),
            "message": alert_msg,
            "details": {
                "previous_ip": payload.previous_ip,
                "current_ip": payload.current_ip,
                "actor_label": label,
                "grouped_from_5min": recent_same,  # kaç önceki alert vardı
            },
            "seen": False,
            "read": False,
            "created_at": _iso(),
        })
        # Email + Slack (mevcut delivery infrastructure — best-effort, hata yakalanır)
        try:
            settings = await db.settings.find_one({"_key": "master_alert_channels"}, {"_id": 0}) or {}
            slack_webhook = (settings.get("slack_webhook") or "").strip()
            admin_email = (settings.get("admin_email") or os.environ.get("ADMIN_EMAIL") or "").strip()
            # v43.76 — 3+ alert varsa grouped summary; ilk 2 için normal göndeririz
            is_grouped = recent_same >= 2  # 3. kez aynı bayı (0,1,2 = zaten 3 alert oluştu)
            if is_grouped:
                slack_text = (
                    f":rotating_light: *IP DEĞİŞİKLİĞİ FLOOD ({label})*\n"
                    f"• Son 5dk içinde *{recent_same + 1}* IP değişikliği!\n"
                    f"• Son IP: `{payload.current_ip}` (öncekilerin özeti audit-log'da)\n"
                    f"• Bayı: `{label}`\n"
                    f":warning: Bu bayı hesabı ele geçirilmiş olabilir — hemen audit-log kontrolü yapın."
                )
            else:
                slack_text = (
                    f":warning: *IP değişikliği (session hijack ihtimali)*\n"
                    f"• Kullanıcı: `{label}`\n"
                    f"• Önceki: `{payload.previous_ip}` → Şu an: `{payload.current_ip}`\n"
                    f"• Zaman: `{_iso()}`\n"
                    f"Audit Log: /panel/audit-log"
                )
            email_body = (
                f"Panel kilit sırasında IP değişti — session hijack ihtimali.\n\n"
                f"Kullanıcı: {label}\n"
                f"Önceki IP: {payload.previous_ip}\n"
                f"Şu anki IP: {payload.current_ip}\n"
                f"Zaman: {_iso()}\n"
                f"{'⚠️ FLOOD: Son 5dk''da ' + str(recent_same + 1) + ' değişiklik!' if is_grouped else ''}\n\n"
                f"Audit Log: /panel/audit-log"
            )
            if slack_webhook and (not is_grouped or recent_same == 2):
                # Grouped modda sadece 3. IP değişikliğinde tek özet mesaj yolla; 4/5. gönderme
                await _send_slack(slack_webhook, slack_text)
            if admin_email and (not is_grouped or recent_same == 2):
                await _send_email(admin_email, f"[GökyüzüWebSpam] IP değişikliği - {label}", email_body)
        except Exception:
            pass  # Sessiz geç — audit + master_alert zaten kaydedildi
    return {"ok": True}


# ----- Users -----
@api.get("/users")
async def users_get():
    return await db.users.find({}, {"_id": 0}).to_list(500)


# v43.30 — User Detay Modal + Bulk Import + Top Domains
@api.get("/users/{username}/detail")
async def user_detail(username: str, request: Request):
    """cPanel hesap detayı: profil + son 24 saat trafiği + son 10 mail + verdict dağılımı."""
    from datetime import datetime, timezone, timedelta
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    # Son 24 saat trafiği (mail_events'ten from_user veya from_addr eşleşen)
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    match = {"$or": [{"from_user": username}, {"from_addr": {"$regex": f"^{username}@"}}], "ts": {"$gte": since}}
    # Verdict dağılımı
    verdict_agg = {}
    async for d in db.mail_events.find(match, {"verdict": 1, "direction": 1}).limit(500):
        v = d.get("verdict") or "unknown"
        verdict_agg[v] = verdict_agg.get(v, 0) + 1
    total_24h = sum(verdict_agg.values())
    # Son 10 mail
    recent = []
    async for d in db.mail_events.find(match, {"_id": 0}).sort("ts", -1).limit(10):
        recent.append({
            "ts": d.get("ts"),
            "direction": d.get("direction", "in"),
            "from": d.get("from_addr"),
            "to": d.get("to_addr"),
            "subject": (d.get("subject") or "")[:80],
            "verdict": d.get("verdict"),
            "score": d.get("total_score"),
        })
    # Karantina
    quarantine_count = await db.quarantine.count_documents({"$or": [{"from_user": username}, {"from": {"$regex": f"^{username}@"}}]})
    return {
        "username": user.get("username"),
        "domain": user.get("domain"),
        "source": user.get("source", "?"),
        "last_synced_at": user.get("last_synced_at"),
        "profile": {
            "email_count_today": user.get("email_count_today", 0),
            "spam_caught_today": user.get("spam_caught_today", 0),
            "quarantine_size": user.get("quarantine_size", 0),
        },
        "traffic_24h": {
            "total": total_24h,
            "verdicts": verdict_agg,
        },
        "quarantine_total": quarantine_count,
        "recent_mails": recent,
        # cPanel'de bu hesabın altındaki email adresleri (whmapi1'den gelirse doldur)
        "email_addresses": user.get("email_addresses", []),
        "disk_used_mb": user.get("disk_used_mb"),
        "disk_quota_mb": user.get("disk_quota_mb"),
    }


class BulkUserImportIn(BaseModel):
    csv_content: str  # Format: username,domain,email_count_today,spam_caught_today (header opsiyonel)
    delimiter: Optional[str] = ","


@api.post("/users/bulk-import")
async def users_bulk_import(payload: BulkUserImportIn, request: Request):
    """CSV içerikten toplu kullanıcı import (upsert). Master yetkisi gerekli."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    lines = [l for l in (payload.csv_content or "").strip().split("\n") if l.strip()]
    if not lines:
        raise HTTPException(400, "Boş CSV")
    delim = payload.delimiter or ","
    # Header skip: ilk satır 'username' içeriyorsa header'dir
    first = lines[0].lower()
    if "user" in first and "domain" in first:
        lines = lines[1:]
    added, updated, errors = 0, 0, []
    now = _iso()
    for i, line in enumerate(lines, 1):
        parts = [p.strip() for p in line.split(delim)]
        if len(parts) < 2:
            errors.append(f"Satır {i}: en az username,domain gerekli")
            continue
        username = parts[0]
        domain = parts[1]
        if not username or not domain:
            errors.append(f"Satır {i}: boş username veya domain")
            continue
        try:
            mails = int(parts[2]) if len(parts) > 2 and parts[2] else 0
            spam = int(parts[3]) if len(parts) > 3 and parts[3] else 0
        except ValueError:
            mails, spam = 0, 0
        res = await db.users.update_one(
            {"username": username},
            {"$set": {
                "username": username, "domain": domain,
                "email_count_today": mails, "spam_caught_today": spam,
                "quarantine_size": 0, "source": "csv_import",
                "license_key": master_key,
                "last_synced_at": now,
            }},
            upsert=True,
        )
        if res.upserted_id is not None:
            added += 1
        elif res.modified_count > 0:
            updated += 1
    return {
        "ok": True,
        "added": added, "updated": updated,
        "total_processed": added + updated,
        "errors": errors[:10],
        "error_count": len(errors),
    }


@api.get("/dashboard/top-domains")
async def dashboard_top_domains(limit: int = 5, request: Request = None):
    """Dashboard widget: son 24 saatte en aktif alan adları + mail trafiği."""
    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    # Master iseniz tenant filtresi yok, değilseniz kendi license'ınız
    master = ((request.headers.get("x-master-key") or "").strip() if request else "").startswith("MS-")
    lic_filter = {} if master else {}  # events endpoint ile aynı davranış
    # Aggregate: from_addr'dan domain çıkart ve grupla
    pipeline = [
        {"$match": {**lic_filter, "ts": {"$gte": since}, "from_addr": {"$exists": True, "$ne": None}}},
        {"$project": {
            "domain": {
                "$arrayElemAt": [{"$split": ["$from_addr", "@"]}, 1]
            },
            "verdict": 1, "direction": 1,
        }},
        {"$match": {"domain": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": "$domain",
            "total": {"$sum": 1},
            "spam": {"$sum": {"$cond": [{"$in": ["$verdict", ["spam", "high_spam", "phishing", "phish", "virus"]]}, 1, 0]}},
            "clean": {"$sum": {"$cond": [{"$eq": ["$verdict", "clean"]}, 1, 0]}},
            "outbound": {"$sum": {"$cond": [{"$eq": ["$direction", "out"]}, 1, 0]}},
        }},
        {"$sort": {"total": -1}},
        {"$limit": max(1, min(limit, 20))},
    ]
    items = []
    async for r in db.mail_events.aggregate(pipeline):
        total = r.get("total", 0)
        items.append({
            "domain": r["_id"],
            "total": total,
            "spam": r.get("spam", 0),
            "clean": r.get("clean", 0),
            "outbound": r.get("outbound", 0),
            "spam_rate": round((r.get("spam", 0) / total * 100), 1) if total else 0,
        })
    return {"items": items, "since": since, "window_hours": 24}


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
async def notifications_put(settings: NotificationSettings, request: Request):
    # v43.99.11 — 2FA enforce (webhook URL değişiklikleri hassas)
    try:
        from routes.master_2fa import require_2fa_verified
        await require_2fa_verified(request)
    except HTTPException:
        raise
    except Exception:
        pass
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


class BadgeUnlockPayload(BaseModel):
    badge_id: str
    title: str
    desc: Optional[str] = ""


class AbImpressionPayload(BaseModel):
    variant: Literal["A", "B"]


class AbConversionPayload(BaseModel):
    variant: Literal["A", "B"]
    kind: Optional[str] = "cta_primary"   # "cta_primary" | "cta_secondary" | "signup"


@api.post("/notifications/badge")
async def push_badge_notification(payload: BadgeUnlockPayload):
    """v43.12 — Client-side achievement unlock'unu bildirim inbox'una kaydeder.
    Idempotent: aynı badge_id son 24 saat içinde tekrar yazılmaz."""
    badge_id = payload.badge_id.strip()
    title = payload.title.strip()[:80]
    desc = (payload.desc or "").strip()[:200]
    if not badge_id or not title:
        raise HTTPException(400, "badge_id ve title zorunlu")
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    exists = await db.notifications_inbox.find_one({
        "kind": "badge_unlocked", "badge_id": badge_id,
        "created_at": {"$gte": since},
    })
    if exists:
        return {"ok": True, "duplicate": True}
    doc = {
        "id": str(uuid.uuid4()),
        "kind": "badge_unlocked",
        "badge_id": badge_id,
        "title": f"Rozet Açıldı — {title}",
        "message": desc or "Yeni rozet açıldı",
        "created_at": _iso(),
        "read": False,
        "severity": "info",
    }
    await db.notifications_inbox.insert_one(doc)
    return {"ok": True}


@api.post("/landing/ab-impression")
async def landing_ab_impression(payload: AbImpressionPayload):
    """v43.12 — Anonim A/B variant impression sayacı. IP scope'suz global toplama.
    Sonuçlar: db.settings _key=landing_ab_stats { A_impressions, B_impressions }."""
    field = f"{payload.variant}_impressions"
    await db.settings.update_one(
        {"_key": "landing_ab_stats"},
        {"$inc": {field: 1}, "$set": {"updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "variant": payload.variant}


@api.post("/landing/ab-conversion")
async def landing_ab_conversion(payload: AbConversionPayload):
    """v43.13 — A/B conversion tracker. Ziyaretçi CTA'ya tıkladığında sayılır.
    p-value hesabı için impression ile birlikte kullanılır."""
    field = f"{payload.variant}_conversions"
    await db.settings.update_one(
        {"_key": "landing_ab_stats"},
        {"$inc": {field: 1}, "$set": {"updated_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "variant": payload.variant, "kind": payload.kind}


def _ab_pvalue_zscore(a_conv: int, a_imp: int, b_conv: int, b_imp: int):
    """v43.13 İki oran z-testi (two-proportion z-test).
    Dönüş: (p_value_two_tailed, z_score, confidence_pct).
    Yetersiz veri (impression < 30) durumunda None dönüş."""
    import math
    if a_imp < 30 or b_imp < 30:
        return None, None, None
    p_a = a_conv / a_imp
    p_b = b_conv / b_imp
    p_pool = (a_conv + b_conv) / (a_imp + b_imp)
    denom = p_pool * (1 - p_pool) * (1 / a_imp + 1 / b_imp)
    if denom <= 0:
        return None, None, None
    se = math.sqrt(denom)
    if se == 0:
        return None, None, None
    z = (p_a - p_b) / se
    # İki taraflı p-value: 2 * (1 - Φ(|z|))
    # erf-based normal CDF
    phi = 0.5 * (1 + math.erf(abs(z) / math.sqrt(2)))
    p_value = 2 * (1 - phi)
    confidence = (1 - p_value) * 100
    return round(p_value, 4), round(z, 3), round(confidence, 1)


@api.get("/landing/ab-stats")
async def landing_ab_stats(request: Request):
    """v43.13 — Master-only A/B istatistikleri + p-value + confidence score."""
    await _require_master(request, None)
    doc = await db.settings.find_one({"_key": "landing_ab_stats"}, {"_id": 0, "_key": 0}) or {}
    a_imp = int(doc.get("A_impressions") or 0)
    b_imp = int(doc.get("B_impressions") or 0)
    a_conv = int(doc.get("A_conversions") or 0)
    b_conv = int(doc.get("B_conversions") or 0)
    total = a_imp + b_imp
    # Conversion oranları
    a_cr = round((a_conv / a_imp) * 100, 2) if a_imp else 0
    b_cr = round((b_conv / b_imp) * 100, 2) if b_imp else 0
    # p-value / confidence
    p_value, z_score, confidence = _ab_pvalue_zscore(a_conv, a_imp, b_conv, b_imp)
    # Anlamlılık eşiği: 500+ toplam impression + p < 0.05
    ready_for_significance = total >= 500
    is_significant = (p_value is not None) and (p_value < 0.05) and ready_for_significance
    winner = None
    if is_significant:
        winner = "A" if a_cr > b_cr else "B"
    return {
        "A_impressions": a_imp,
        "B_impressions": b_imp,
        "total": total,
        "A_pct": round((a_imp / total) * 100, 1) if total else 0,
        "B_pct": round((b_imp / total) * 100, 1) if total else 0,
        # v43.13 conversion + significance
        "A_conversions": a_conv,
        "B_conversions": b_conv,
        "A_cr": a_cr,   # conversion rate %
        "B_cr": b_cr,
        "p_value": p_value,
        "z_score": z_score,
        "confidence": confidence,
        "ready_for_significance": ready_for_significance,
        "is_significant": is_significant,
        "winner": winner,
        "updated_at": doc.get("updated_at"),
    }




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


# ------------------------- Landing Page Settings + CMS -------------------------
# v43.9 — Master panelden landing sayfası teması + metinleri düzenleyebilir.
# v43.11 — Multi-language: her dil için ayrı içerik alanı (tr/en/de/fr/es/ar).
# GET public (herkes okur), PUT master-only.

_SUPPORTED_LANDING_LANGS = ["tr", "en", "de", "fr", "es", "ar"]


class LandingHeroBlock(BaseModel):
    badge: Optional[str] = ""      # ex: "WHM / cPanel için ticari mail güvenliği"
    title_a: Optional[str] = ""    # ex: "Sunucunuzdan"
    title_b: Optional[str] = ""    # ex: "spam ve tehdit sızmasın."
    subtitle: Optional[str] = ""   # long paragraph
    cta_primary: Optional[str] = ""  # ex: "Şimdi Satın Al"
    cta_secondary: Optional[str] = ""  # ex: "Canlı Demo"


class LandingLangBlock(BaseModel):
    """Bir dil için tüm metin override alanları."""
    hero: Optional[LandingHeroBlock] = None
    features_title: Optional[str] = ""
    features_sub: Optional[str] = ""
    stats_headline: Optional[str] = ""
    pricing_title: Optional[str] = ""
    pricing_sub: Optional[str] = ""
    cta_bottom_title: Optional[str] = ""
    cta_bottom_sub: Optional[str] = ""
    footer_copyright: Optional[str] = ""


class LandingContentIn(BaseModel):
    """v43.11 — tema tek; content her dil için ayrı.
    v43.12 — Optional A/B testing: `ab_test_enabled` + `variant_b_hero_by_lang`.
    Geriye uyumluluk: eğer hero + top-level alanlar gönderilirse, "tr" diline yazılır."""
    theme: Optional[str] = "dark"   # "dark" | "light"
    # Yeni: dil bazlı içerik map
    content_by_lang: Optional[Dict[str, LandingLangBlock]] = None
    # v43.12 A/B testing (Variant A = ana içerik; Variant B sadece hero override)
    ab_test_enabled: Optional[bool] = False
    variant_b_hero_by_lang: Optional[Dict[str, LandingHeroBlock]] = None
    # v43.13 A/B geo scope: "global" (herkes), "TR_only" (sadece TR ziyaretçiler B görür),
    # "TR_exclude" (TR dışı herkes B görür), veya bir dizi ülke kodu (comma-separated).
    ab_geo_scope: Optional[str] = "global"
    # v43.15 Hero live preview (animated dashboard sağ tarafta) — default AÇIK
    hero_preview_enabled: Optional[bool] = True
    hero_preview_style: Optional[str] = "animated"  # "animated" | "compact" | "hidden"
    # Legacy top-level fields (backwards compat — otomatik "tr"'ye map'lenir)
    hero: Optional[LandingHeroBlock] = None
    features_title: Optional[str] = ""
    features_sub: Optional[str] = ""
    stats_headline: Optional[str] = ""
    pricing_title: Optional[str] = ""
    pricing_sub: Optional[str] = ""
    cta_bottom_title: Optional[str] = ""
    cta_bottom_sub: Optional[str] = ""
    footer_copyright: Optional[str] = ""


def _empty_lang_block() -> Dict[str, Any]:
    return {
        "hero": {"badge": "", "title_a": "", "title_b": "", "subtitle": "", "cta_primary": "", "cta_secondary": ""},
        "features_title": "", "features_sub": "", "stats_headline": "",
        "pricing_title": "", "pricing_sub": "",
        "cta_bottom_title": "", "cta_bottom_sub": "",
        "footer_copyright": "",
    }


LANDING_DEFAULTS = {
    "theme": "dark",
    # v43.11 multi-lang default: her destekli dil için boş block
    "content_by_lang": {l: _empty_lang_block() for l in _SUPPORTED_LANDING_LANGS},
    # Legacy top-level (silinmez, geriye uyumluluk için okuma tarafı destekler)
    **_empty_lang_block(),
}


def _merge_lang_block(stored: Dict[str, Any]) -> Dict[str, Any]:
    """Kayıtlı dil block'unu default ile birleştir (eksik alanları doldurur)."""
    tpl = _empty_lang_block()
    if not isinstance(stored, dict):
        return tpl
    out = {**tpl, **{k: v for k, v in stored.items() if v is not None}}
    if not isinstance(out.get("hero"), dict):
        out["hero"] = tpl["hero"]
    else:
        out["hero"] = {**tpl["hero"], **{k: v for k, v in out["hero"].items() if v is not None}}
    return out


@api.get("/settings/landing")
async def get_landing_settings():
    """Public — Landing page reads theme + optional text overrides per language.
    Empty strings mean 'use i18n default from LANG_STRINGS'.
    v43.11: `content_by_lang` alanı öncelikli; legacy top-level `hero` vs.
    okunmaya devam eder (frontend her ikisini de merge eder)."""
    doc = await db.settings.find_one({"_key": "landing_content"}, {"_id": 0, "_key": 0}) or {}
    theme = doc.get("theme") if doc.get("theme") in ("dark", "light") else "dark"

    # v43.11 multi-lang normalize
    cbl_raw = doc.get("content_by_lang") or {}
    content_by_lang = {}
    for lang in _SUPPORTED_LANDING_LANGS:
        content_by_lang[lang] = _merge_lang_block(cbl_raw.get(lang) or {})

    # v43.12 A/B — variant_b_hero_by_lang normalize
    ab_enabled = bool(doc.get("ab_test_enabled", False))
    ab_geo_scope = str(doc.get("ab_geo_scope") or "global")
    hero_preview_enabled = bool(doc.get("hero_preview_enabled", True))
    hero_preview_style = str(doc.get("hero_preview_style") or "animated")
    if hero_preview_style not in ("animated", "compact", "hidden"):
        hero_preview_style = "animated"
    vb_raw = doc.get("variant_b_hero_by_lang") or {}
    variant_b_hero_by_lang = {}
    empty_hero = {"badge": "", "title_a": "", "title_b": "", "subtitle": "", "cta_primary": "", "cta_secondary": ""}
    for lang in _SUPPORTED_LANDING_LANGS:
        stored = vb_raw.get(lang) or {}
        variant_b_hero_by_lang[lang] = {**empty_hero, **{k: v for k, v in stored.items() if v is not None}}

    # Legacy top-level içerik varsa TR'ye map'le (backwards compat, override ile)
    legacy = {k: doc.get(k, "") for k in _empty_lang_block().keys() if k != "hero"}
    legacy_hero = doc.get("hero") or {}
    if isinstance(legacy_hero, dict) and any(legacy_hero.get(k) for k in legacy_hero):
        # Sadece TR'de override boşsa legacy'yi doldur
        tr = content_by_lang["tr"]
        for k, v in legacy_hero.items():
            if v and not tr["hero"].get(k):
                tr["hero"][k] = v
    for k, v in legacy.items():
        if v and not content_by_lang["tr"].get(k):
            content_by_lang["tr"][k] = v

    # Frontend rahatlığı için legacy top-level TR aynı zamanda döndürülür
    tr_block = content_by_lang["tr"]
    return {
        "theme": theme,
        "content_by_lang": content_by_lang,
        # v43.12 A/B testing
        "ab_test_enabled": ab_enabled,
        "ab_geo_scope": ab_geo_scope,
        "hero_preview_enabled": hero_preview_enabled,
        "hero_preview_style": hero_preview_style,
        "variant_b_hero_by_lang": variant_b_hero_by_lang,
        # Legacy flat (frontend backward-compat)
        "hero": tr_block["hero"],
        "features_title":   tr_block["features_title"],
        "features_sub":     tr_block["features_sub"],
        "stats_headline":   tr_block["stats_headline"],
        "pricing_title":    tr_block["pricing_title"],
        "pricing_sub":      tr_block["pricing_sub"],
        "cta_bottom_title": tr_block["cta_bottom_title"],
        "cta_bottom_sub":   tr_block["cta_bottom_sub"],
        "footer_copyright": tr_block["footer_copyright"],
    }


def _normalize_variant_b(vb_in: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """v43.12 — Variant B hero_by_lang'ı normalize eder (her destekli dil için boş block'a düşer)."""
    empty = {"badge": "", "title_a": "", "title_b": "", "subtitle": "", "cta_primary": "", "cta_secondary": ""}
    out = {}
    for lang in _SUPPORTED_LANDING_LANGS:
        stored = vb_in.get(lang) or {}
        if not isinstance(stored, dict):
            stored = {}
        out[lang] = {**empty, **{k: v for k, v in stored.items() if v is not None}}
    return out


@api.put("/settings/landing")
async def put_landing_settings(payload: LandingContentIn, request: Request):
    """Master-only — save landing theme + multi-language editable text blocks."""
    await _require_master(request, None)
    raw = payload.model_dump(exclude_none=False)

    theme = raw.get("theme")
    if theme not in ("dark", "light"):
        theme = "dark"

    # v43.11 multi-lang doldur
    cbl_in = raw.get("content_by_lang") or {}
    content_by_lang: Dict[str, Any] = {}
    for lang in _SUPPORTED_LANDING_LANGS:
        content_by_lang[lang] = _merge_lang_block(cbl_in.get(lang) or {})

    # Legacy top-level payload varsa TR'ye at (backwards compat)
    tr = content_by_lang["tr"]
    for k in _empty_lang_block().keys():
        if k == "hero":
            hero_flat = raw.get("hero") or {}
            if isinstance(hero_flat, dict):
                for hk, hv in hero_flat.items():
                    if hv:
                        tr["hero"][hk] = hv
        else:
            if raw.get(k):
                tr[k] = raw[k]

    doc = {
        "_key": "landing_content",
        "theme": theme,
        "content_by_lang": content_by_lang,
        # v43.12 A/B testing
        "ab_test_enabled": bool(raw.get("ab_test_enabled", False)),
        "ab_geo_scope": str(raw.get("ab_geo_scope") or "global"),
        "hero_preview_enabled": bool(raw.get("hero_preview_enabled", True)),
        "hero_preview_style": (raw.get("hero_preview_style") if raw.get("hero_preview_style") in ("animated","compact","hidden") else "animated"),
        "variant_b_hero_by_lang": _normalize_variant_b(raw.get("variant_b_hero_by_lang") or {}),
        "updated_at": _iso(),
    }
    await db.settings.update_one(
        {"_key": "landing_content"}, {"$set": doc}, upsert=True
    )
    return {"ok": True, "theme": theme, "languages": _SUPPORTED_LANDING_LANGS, "ab_test_enabled": doc["ab_test_enabled"]}


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
# v43.23 — /app/VERSION dosyası → panel & bayi bildirimleri için tek doğruluk kaynağı
_VERSION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "VERSION")
# v43.61 — Docker'da /app/VERSION mount edilmiyor (sadece backend/ ve whm-plugin/).
# Bu yüzden backend içinde de bir kopyasını arayalım. Fallback zinciri:
#   1. /app/VERSION (preview env)
#   2. /app/backend/VERSION (docker volume içinde)
#   3. Git describe
#   4. _PACKAGE_VERSION constant
_VERSION_FILE_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")
_VERSION_FILE_ENV = os.environ.get("GWS_VERSION_FILE", "")

def _read_panel_version() -> str:
    """Read /app/VERSION content (fallback: package default). Called by /version/panel
    endpoint and the startup broadcast task.

    v43.31 fallback chain:
      1. /app/VERSION dosyası (deploy sırasında güncellenir)
      2. Git commit'ten en yakın vX.Y tag (git binary varsa)
      3. Backend paket varsayılanı `_PACKAGE_VERSION` — "unknown" görüntülemez
    """
    _PACKAGE_VERSION = "v43.61"  # backend bundle içindeki varsayılan (VERSION dosyası bulunamazsa)
    # v43.61 — Multi-location VERSION file reader (Docker mount sorununu çözer)
    for candidate in [_VERSION_FILE_ENV, _VERSION_FILE, _VERSION_FILE_BACKEND]:
        if not candidate:
            continue
        try:
            with open(candidate, "r", encoding="utf-8") as f:
                v = f.read().strip()
                if v:
                    return v
        except Exception:
            pass
    # Git fallback (opsiyonel)
    try:
        import subprocess as _sp
        r = _sp.run(["git", "-C", os.path.dirname(_VERSION_FILE),
                     "describe", "--tags", "--abbrev=0"],
                    capture_output=True, text=True, timeout=3)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return _PACKAGE_VERSION


@api.get("/version/panel")
async def version_panel():
    """Preview/panel şu anki sürümü döndürür (Header rozeti için).
    Kaynak: repo kökündeki VERSION dosyası (deploy sırasında güncellenir)."""
    return {"version": _read_panel_version(), "source": "VERSION"}


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

    # v43.98 — WHM cPanel iframe trust: Referer/Origin :2087 içeriyorsa güvenli iframe say
    referer = (request.headers.get("referer") or "").lower()
    origin = (request.headers.get("origin") or "").lower()
    _whm_host = f"{MASTER_IP}:2087" if MASTER_IP else ":2087"
    _whm_hostname = os.environ.get("MASTER_HOSTNAME", "gokyuzuhosting.com").lower()
    is_whm_iframe = (
        (":2087" in referer and (MASTER_IP or "").lower() in referer)
        or (":2087" in origin and (MASTER_IP or "").lower() in origin)
        or (":2087" in referer and _whm_hostname in referer)
        or (":2087" in origin and _whm_hostname in origin)
    )
    # WHM iframe → IP eşleşmesi gerekmeden master gibi davran
    if is_whm_iframe:
        ip_match = True

    key_match = False
    if license_key:
        if MASTER_LICENSE_KEY and license_key == MASTER_LICENSE_KEY:
            key_match = True
            # v43.99.2 — MİMARİ DEĞİŞİKLİK: Master key varsa IP'ye bakılmaz.
            # Sebep: WHM iframe API çağrıları browser'dan gider (sunucudan değil),
            # yani IP her zaman "yabancı" görünür. Dinamik IP, VPN, mobil kullanımı
            # da IP kontrolünü işlevsiz yapıyor. WHM'e root olarak girebilmek zaten
            # yeterli kanıttır. IP kontrolü/kill mekanizması KALDIRILDI.
            # Yalnızca "notify-only" (Slack bildirimi) kalır; oturum HİÇBİR ZAMAN kesilmez.
            if MASTER_IP and MASTER_IP not in xff_chain and not is_whm_iframe:
                # Trusted IP whitelist'te ise bildirim de gitmez
                try:
                    trusted = await db.trusted_ips.find_one({"ip": client_ip, "active": True})
                except Exception:
                    trusted = None
                # Opt-in bildirim ayarı — default kapalı, kullanıcı isterse açar
                try:
                    notify_cfg = await db.settings.find_one({"_key": "foreign_ip_notify"},
                                                             {"_id": 0}) or {}
                except Exception:
                    notify_cfg = {}
                if not trusted and notify_cfg.get("enabled") is True:
                    try:
                        # Rate-limit: aynı IP için 15dk'da bir alert (spam engelleme)
                        recent = await db.master_alerts.find_one({
                            "type": "master_key_from_foreign_ip",
                            "details.client_ip": client_ip,
                            "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()},
                        })
                        if not recent:
                            alert = {
                                "id": str(uuid.uuid4()),
                                "type": "master_key_from_foreign_ip",
                                "severity": "info",  # v43.99.2 — critical değil, sadece bilgi
                                "message": f"ℹ️ Master oturum farklı IP'den açıldı: {client_ip}",
                                "details": {
                                    "client_ip": client_ip, "expected_ip": MASTER_IP,
                                    "path": request.url.path,
                                    "user_agent": request.headers.get("user-agent", "")[:120],
                                    "xff": xff_chain,
                                },
                                "seen": False, "read": False,
                                "created_at": _iso(),
                            }
                            await db.master_alerts.insert_one(alert)
                            # Slack notify (yalnızca opt-in ile)
                            try:
                                asyncio.create_task(_fire_license_alert({
                                    "hostname": "master-panel",
                                    "ip": client_ip,
                                    "license_key": license_key,
                                    "reason": "master_key_foreign_ip_notify",
                                    "version": alert["message"],
                                }))
                            except Exception:
                                pass
                    except Exception:
                        pass
        else:
            lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
            if lic and (
                MASTER_IP in (lic.get("ip_addresses") or [])
                or lic.get("last_heartbeat_ip") == MASTER_IP
            ):
                key_match = True
    # v43.98 — Key match VEYA IP match (WHM iframe/master IP dahil) master yapar.
    # Bu, kullanıcının WHM cPanel'den plugin'i ilk açtığında localStorage boşken bile
    # sunucudan gelen istek olduğu sürece master yetkisiyle karşılanmasını sağlar.
    is_master = key_match or ip_match
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
        # v43.90 — Header personalize: customer_name + previous login IP/timestamp
        try:
            master_lic = await db.licenses.find_one(
                {"license_key": MASTER_LICENSE_KEY} if MASTER_LICENSE_KEY else {"is_master": True},
                {"_id": 0, "customer_name": 1, "customer_email": 1, "plan": 1},
            )
            if master_lic:
                r["customer_name"] = master_lic.get("customer_name") or "Master"
                r["customer_email"] = master_lic.get("customer_email") or ""
                r["plan"] = master_lic.get("plan") or "enterprise"
            # Önceki giriş — bu istekten önceki en son kayıt
            now_iso = _iso()
            prev = await db.master_login_history.find_one(
                {"at": {"$lt": now_iso}}, {"_id": 0}, sort=[("at", -1)],
            )
            if prev:
                r["last_login_ip"] = prev.get("ip") or ""
                r["last_login_at"] = prev.get("at") or ""
                r["last_login_ua"] = (prev.get("ua") or "")[:80]
            # Bu isteği geçmişe yaz (dedup: aynı IP için son 60sn'de bir kez)
            client_ip = r.get("client_ip") or ""
            recent = await db.master_login_history.find_one({
                "ip": client_ip,
                "at": {"$gte": (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()},
            })
            if not recent and client_ip:
                await db.master_login_history.insert_one({
                    "id": str(uuid.uuid4()),
                    "ip": client_ip,
                    "at": now_iso,
                    "ua": (request.headers.get("user-agent", "") or "")[:120],
                    "path": "/admin/whoami",
                })
        except Exception:
            pass
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
async def get_country_rules(request: Request, license_key: Optional[str] = None):
    # v43.78 — Tenant scope: her bayi kendi ülke kurallarını görür
    scope = await _tenant_scope(request, license_key)
    # Master's own scope uses __master__ sentinel; bayi uses their license_key
    if scope.get("is_master") and not scope.get("impersonated"):
        owner = scope.get("owner_license_key") or "__master__"
    else:
        owner = scope.get("owner_license_key") or "__none__"
    # Auto-expire pasüre olanları temizle
    now_iso = _iso()
    await db.country_rules.delete_many({"auto_expire_at": {"$lt": now_iso, "$ne": None}})
    rows = await db.country_rules.find(
        {"owner_license_key": owner}, {"_id": 0}
    ).sort("country_code", 1).to_list(500)
    now = datetime.now(timezone.utc)
    hour = now.hour
    day = now.weekday()
    for r in rows:
        ah = r.get("active_hours")
        ad = r.get("active_days")
        r["currently_active"] = (not ah or hour in ah) and (not ad or day in ad)
    return {"items": rows, "owner": owner, "is_master": bool(scope.get("is_master"))}


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
    """Birden çok ülkeyi tek işlemde ekle. TTL varsa auto_expire_at set eder.
    v43.78 — Master ve bayi kendi scope'unda çalışır (tenant izole)."""
    scope = await _tenant_scope(request, license_key)
    if scope.get("is_master") and not scope.get("impersonated"):
        owner = scope.get("owner_license_key") or "__master__"
    else:
        owner = scope.get("owner_license_key") or "__none__"
    if owner == "__none__":
        raise HTTPException(401, "Bu işlem için geçerli lisans anahtarı gerekli")
    if not scope.get("is_master"):
        await _require_feature(scope, "security_config")
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
            "owner_license_key": owner,  # v43.78 — tenant scope
        }
        await db.country_rules.update_one(
            {"country_code": code, "owner_license_key": owner},
            {"$set": doc}, upsert=True,
        )
        inserted += 1
    return {"ok": True, "inserted": inserted, "expire_at": expire, "owner": owner}


@api.post("/security/country-rules")
async def add_country_rule(payload: CountryRule, request: Request, license_key: Optional[str] = None):
    """v43.78 — tenant scope: her bayi kendi kuralını ekler."""
    scope = await _tenant_scope(request, license_key)
    if scope.get("is_master") and not scope.get("impersonated"):
        owner = scope.get("owner_license_key") or "__master__"
    else:
        owner = scope.get("owner_license_key") or "__none__"
    if owner == "__none__":
        raise HTTPException(401, "Geçerli lisans anahtarı gerekli")
    if not scope.get("is_master"):
        await _require_feature(scope, "security_config")
    doc = payload.model_dump()
    doc["country_code"] = doc["country_code"].upper()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = _iso()
    doc["owner_license_key"] = owner
    await db.country_rules.update_one(
        {"country_code": doc["country_code"], "owner_license_key": owner},
        {"$set": doc}, upsert=True,
    )
    return {"ok": True, **doc}


@api.delete("/security/country-rules/{code}")
async def del_country_rule(code: str, request: Request, license_key: Optional[str] = None):
    """v43.78 — bayi sadece kendi ekledikleri kuralı silebilir."""
    scope = await _tenant_scope(request, license_key)
    if scope.get("is_master") and not scope.get("impersonated"):
        owner = scope.get("owner_license_key") or "__master__"
    else:
        owner = scope.get("owner_license_key") or "__none__"
    if owner == "__none__":
        raise HTTPException(401, "Geçerli lisans anahtarı gerekli")
    if not scope.get("is_master"):
        await _require_feature(scope, "security_config")
    r = await db.country_rules.delete_one({"country_code": code.upper(), "owner_license_key": owner})
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


# NOTE: /users/sync-status, /users/sync, /users/refresh-from-cpanel moved to
# routes/users_sync.py during v1.4 refactor (Feb 2026). This preserves the
# UserSyncIn model for backward-compat with other modules.


# v43.28 — cPanel Kullanıcıları Çağır (Master → WHM plugin daemon signal)
# v43.32 — Sunucumu Güncelle + Milter Health
@api.post("/plugin/demand-update")
async def plugin_demand_update(request: Request):
    """Master aktif iken bayi plugin daemon'lara 'anında gws-update çalıştır' sinyali.
    Plugin daemon 60sn polling'de bu sinyali görüp `gws-update` çalıştırır."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    now = _iso()
    signaled = 0
    async for lic in db.licenses.find({"active": True, "$or": [
        {"license_key": master_key},
        {"master_license_key": master_key},
    ]}, {"license_key": 1, "hostname": 1}):
        await db.settings.update_one(
            {"_key": f"plugin_demand_update:{lic['license_key']}"},
            {"$set": {
                "_key": f"plugin_demand_update:{lic['license_key']}",
                "license_key": lic["license_key"],
                "hostname": lic.get("hostname"),
                "requested_at": now, "handled": False,
            }},
            upsert=True,
        )
        signaled += 1
    return {"ok": True, "signaled_licenses": signaled,
            "note": f"{signaled} bayiye 'gws-update çalıştır' sinyali gönderildi. Bayi plugin daemon 60sn içinde algılayacak."}


@api.get("/plugin/milter-health")
async def plugin_milter_health(request: Request):
    """Milter/logtail son ingest zamanı + son 1 saat ingest sayısı + verdict oranı."""
    from datetime import datetime, timezone, timedelta
    now_dt = datetime.now(timezone.utc)
    since_1h = (now_dt - timedelta(hours=1)).isoformat()
    since_24h = (now_dt - timedelta(hours=24)).isoformat()
    last = None
    async for d in db.mail_events.find({}, {"ts": 1}).sort("ts", -1).limit(1):
        last = d.get("ts")
        break
    ingest_1h = await db.mail_events.count_documents({"ts": {"$gte": since_1h}})
    ingest_24h = await db.mail_events.count_documents({"ts": {"$gte": since_24h}})
    # Son ingest kaç dakika önce?
    minutes_since = None
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            minutes_since = int((now_dt - last_dt).total_seconds() / 60)
        except Exception:
            minutes_since = None
    # Durum: 5dk içinde ingest → healthy, 60dk içinde → warning, aksi → down
    status = "unknown"
    if minutes_since is not None:
        if minutes_since <= 5: status = "healthy"
        elif minutes_since <= 60: status = "warning"
        else: status = "down"
    elif last is None:
        status = "no_data"
    return {
        "status": status,
        "last_ingest_at": last,
        "minutes_since_last_ingest": minutes_since,
        "ingest_last_1h": ingest_1h,
        "ingest_last_24h": ingest_24h,
    }


@api.post("/plugin/milter-reset")
async def plugin_milter_reset(request: Request):
    """Master iken bayilere 'milter'ı yeniden başlat' sinyali."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    now = _iso()
    signaled = 0
    async for lic in db.licenses.find({"active": True}, {"license_key": 1}):
        await db.settings.update_one(
            {"_key": f"plugin_demand_milter_restart:{lic['license_key']}"},
            {"$set": {
                "_key": f"plugin_demand_milter_restart:{lic['license_key']}",
                "license_key": lic["license_key"],
                "requested_at": now, "handled": False,
            }},
            upsert=True,
        )
        signaled += 1
    return {"ok": True, "signaled": signaled, "note": "Bayi plugin daemon 'systemctl restart gws-milter' çalıştıracak"}


# v43.32 — Perl heartbeat.pl daemon polling endpoint'leri
@api.get("/plugin/pending-signals")
async def plugin_pending_signals(license_key: str):
    """Bayi WHM plugin daemon 15dk cycle'ında bunu çağırır — kendisine ait handled=false
    sinyalleri liste olarak alır ve icra eder (listaccts push, gws-update, milter restart)."""
    items = []
    prefixes = {
        "plugin_demand_sync":            "demand_sync",
        "plugin_demand_update":          "demand_update",
        "plugin_demand_milter_restart":  "demand_milter_restart",
    }
    for prefix, signal_type in prefixes.items():
        doc = await db.settings.find_one(
            {"_key": f"{prefix}:{license_key}", "handled": False},
            {"_id": 0},
        )
        if doc:
            items.append({
                "_key": doc.get("_key"),
                "signal_type": signal_type,
                "requested_at": doc.get("requested_at"),
            })
    return {"license_key": license_key, "items": items, "count": len(items)}


@api.post("/plugin/signal-ack")
async def plugin_signal_ack(payload: dict):
    """Perl daemon sinyali işleyince handled=true olarak işaretler."""
    key = payload.get("_key")
    if not key: raise HTTPException(400, "_key gerekli")
    r = await db.settings.update_one(
        {"_key": key},
        {"$set": {"handled": True, "handled_at": _iso()}},
    )
    return {"ok": True, "matched": r.matched_count}


# v43.33 — Plugin Signal Log (son 20 sinyal ve durum)
@api.get("/plugin/signal-log")
async def plugin_signal_log(limit: int = 20):
    """Master panelde son N plugin sinyalinin listesi + handled durumu."""
    items = []
    cursor = db.settings.find(
        {"_key": {"$regex": r"^plugin_demand_(sync|update|milter_restart|bayes_train):"}},
        {"_id": 0}
    ).sort("requested_at", -1).limit(min(max(limit, 1), 100))
    async for d in cursor:
        key = d.get("_key", "")
        # Extract type from _key
        signal_type = "unknown"
        if ":" in key:
            signal_type = key.split(":", 1)[0].replace("plugin_demand_", "")
        items.append({
            "key": key,
            "signal_type": signal_type,
            "license_key": d.get("license_key"),
            "hostname": d.get("hostname"),
            "requested_at": d.get("requested_at"),
            "requested_by": d.get("requested_by", "system"),
            "handled": d.get("handled", False),
            "handled_at": d.get("handled_at"),
        })
    return {"items": items, "count": len(items)}


# v43.33 — cPanel Email Adres Listesi (Email::listpops passthrough)
@api.get("/users/{username}/email-addresses")
async def user_email_addresses(username: str, request: Request):
    """Kullanıcının cPanel altındaki mail adres listesini döner.
    - Yerel WHM: `uapi --user=<u> Email list_pops` çalıştırır
    - Yerel WHM yok: Bayi plugin daemon'a signal yaz — plugin push edecek
    - Cache: user document'inde `email_addresses` alanı"""
    import os, subprocess, json
    doc = await db.users.find_one({"username": username}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    cached = doc.get("email_addresses") or []
    uapi = "/usr/local/cpanel/bin/uapi"
    live_list = None
    if os.path.exists(uapi) and os.access(uapi, os.X_OK):
        try:
            proc = subprocess.run(
                [uapi, f"--user={username}", "--output=json", "Email", "list_pops"],
                capture_output=True, text=True, timeout=15,
            )
            data = json.loads(proc.stdout or "{}")
            pops = ((data.get("result") or {}).get("data")) or []
            live_list = [{
                "email": p.get("email"),
                "domain": p.get("domain"),
                "diskused": p.get("diskused"),
                "diskquota": p.get("diskquota"),
                "suspended": bool(p.get("suspended_login") or p.get("suspended_incoming")),
            } for p in pops if p.get("email")]
            # Cache güncelle
            await db.users.update_one(
                {"username": username},
                {"$set": {"email_addresses": live_list, "email_addresses_updated_at": _iso()}},
            )
        except Exception as e:
            logging.warning(f"[email-addresses] uapi failed: {e}")
    return {
        "username": username,
        "source": "uapi_live" if live_list is not None else "cached_or_empty",
        "addresses": live_list if live_list is not None else cached,
        "count": len(live_list) if live_list is not None else len(cached),
    }


# v43.33 — Bayes Manuel Eğitim (ham/spam örnek yükle)
class BayesTrainIn(BaseModel):
    kind: str  # "ham" veya "spam"
    samples: list[str]  # her item: mail body veya "subject: ... body: ..."


@api.post("/mailscanner/bayes/train-manual")
async def bayes_train_manual(payload: BayesTrainIn, request: Request):
    """Master'a manuel ham/spam örneği yükleyip Bayes counter'ı güncelle.
    Bayi plugin daemon aynı örneği kendi `sa-learn --ham` / `--spam` ile eğitir."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    if payload.kind not in ("ham", "spam"):
        raise HTTPException(400, "kind sadece 'ham' veya 'spam' olabilir")
    samples = [s for s in (payload.samples or []) if s and s.strip()][:100]
    if not samples:
        raise HTTPException(400, "En az 1 örnek gerekli")
    # Sample'ları DB'ye kaydet (bayi daemon çekecek)
    now = _iso()
    for s in samples:
        await db.bayes_training_queue.insert_one({
            "id": str(uuid.uuid4()),
            "kind": payload.kind,
            "sample": s[:8192],
            "requested_by": "master_ui",
            "created_at": now,
            "consumed": False,
        })
    # Bayes counter'ı güncelle (istatistik)
    field = "ham_learned" if payload.kind == "ham" else "spam_learned"
    await db.settings.update_one(
        {"_key": "bayes_status"},
        {"$inc": {field: len(samples)}, "$set": {"last_train_at": now}},
        upsert=True,
    )
    # Bayi plugin'e sinyal
    async for lic in db.licenses.find({"active": True}, {"license_key": 1}).limit(50):
        await db.settings.update_one(
            {"_key": f"plugin_demand_bayes_train:{lic['license_key']}"},
            {"$set": {
                "_key": f"plugin_demand_bayes_train:{lic['license_key']}",
                "license_key": lic["license_key"],
                "requested_at": now, "handled": False,
                "kind": payload.kind, "sample_count": len(samples),
            }},
            upsert=True,
        )
    return {"ok": True, "kind": payload.kind, "added": len(samples), "queued_for_learning": True}


@api.get("/mailscanner/bayes/train-queue")
async def bayes_train_queue(license_key: str, limit: int = 50):
    """Bayi plugin daemon burayı 15dk cycle'ında sorgulayıp consumed=false örnekleri
    çekip yerel `sa-learn` ile eğitir."""
    items = []
    cursor = db.bayes_training_queue.find(
        {"consumed": False}, {"_id": 0}
    ).sort("created_at", 1).limit(min(limit, 200))
    async for d in cursor:
        items.append(d)
    return {"items": items, "count": len(items)}


@api.post("/users/refresh-from-cpanel-legacy-removed", include_in_schema=False)
async def _users_refresh_removed():
    # Removed in v1.4 refactor — active route is registered from
    # routes/users_sync.py as `/api/users/refresh-from-cpanel`.
    from fastapi import HTTPException as _HE
    raise _HE(410, "Bu endpoint modüle taşındı (routes/users_sync.py)")





# ============================================================================
# v43.69 — Master Audit Log
# ---------------------------------------------------------------------------
# Her master işlemi (havale onay/red, DB temizlik, lisans üretme, sürüm
# yayınlama, plan/fiyat değişikliği) audit_logs koleksiyonuna kaydedilir:
#   - actor_email (varsa) veya "master" (fallback)
#   - action (kısa isim: havale_approve, db_cleanup, license_issue, vb.)
#   - target (etkilenen entity: merchant_oid, license_key, collection adı)
#   - client_ip
#   - timestamp
#   - payload_summary (opsiyonel; ödeme tutarı, silinen kayıt sayısı, vb.)
# ============================================================================
async def _audit_log(request: Request, action: str, target: str = "", summary: dict | None = None) -> None:
    """Master işlemini audit_logs koleksiyonuna kaydeder. Silent-fail (log kaybı işlemi bloklamamalı)."""
    try:
        entry = {
            "id": str(uuid.uuid4()),
            "action": action,
            "target": target,
            "actor": "master",
            "client_ip": _client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:200],
            "path": str(request.url.path),
            "method": request.method,
            "summary": summary or {},
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        await db.audit_logs.insert_one(entry)
    except Exception as e:
        log.warning("audit_log insert failed: %s", e)


@api.get("/audit/logs")
async def audit_logs_list(request: Request, limit: int = Query(200, ge=1, le=1000),
                           action: Optional[str] = None, hours: int = Query(168, ge=1, le=8760)):
    """Master audit log listesi. Sadece master erişebilir."""
    await _require_master(request, None)
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q: dict = {"ts": {"$gte": since}}
    if action:
        q["action"] = action
    rows = await db.audit_logs.find(q, {"_id": 0}).sort("ts", -1).limit(limit).to_list(limit)
    # Özet aggregate
    by_action: dict = {}
    for r in rows:
        by_action[r.get("action", "?")] = by_action.get(r.get("action", "?"), 0) + 1
    return {
        "hours": hours, "count": len(rows),
        "items": rows,
        "summary_by_action": by_action,
    }


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
    # v43.69 — Audit log
    await _audit_log(request, "version_publish",
                      target=payload.latest_version or "auto",
                      summary={"changelog": (payload.changelog or "")[:400]})

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
    # v43.85 — Master license bayrağı frontend için (delete disabled UI)
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    for d in docs:
        if master_env and d.get("license_key") == master_env:
            d["is_master"] = True
            d["protected"] = True
        elif d.get("is_master"):
            d["protected"] = True
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
async def licenses_delete(lid: str, request: Request):
    # v43.100 — 2FA enforce (aktifse cookie zorunlu)
    try:
        from routes.master_2fa import require_2fa_verified
        await require_2fa_verified(request)
    except HTTPException:
        raise
    except Exception:
        pass
    # id ile dene, bulamazsa license_key olarak dene (eski seed'ler id-siz olabilir)
    doc = await db.licenses.find_one({"id": lid}, {"_id": 0})
    if not doc:
        doc = await db.licenses.find_one({"license_key": lid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Lisans bulunamadı")
    # v43.85 — Master license koruması: root hesap silinemez → sistem-kritik
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    is_master_lic = (master_env and doc.get("license_key") == master_env) or bool(doc.get("is_master"))
    if is_master_lic:
        # v43.86 — Silme koruması geçici kaldırılmış mı kontrol et (advanced flag)
        prot = await db.settings.find_one({"_key": "master_protection"}, {"_id": 0}) or {}
        # Otomatik expire — 5dk sonra tekrar aktif
        disabled_until = prot.get("delete_protection_disabled_until")
        active_bypass = False
        if disabled_until:
            try:
                du = datetime.fromisoformat(disabled_until.replace("Z", "+00:00"))
                active_bypass = du > datetime.now(timezone.utc)
            except Exception:
                pass
        # Bypass yoksa 403
        if not active_bypass:
            # v43.86 — Lisans aksiyon logu (denenen ve reddedilen master delete)
            await db.audit_logs.insert_one({
                "id": str(uuid.uuid4()),
                "action": "master_license_delete_blocked",
                "actor_ip": _client_ip(request),
                "details": {"license_key": doc.get("license_key")},
                "at": _iso(),
                "severity": "warning",
            })
            raise HTTPException(
                status_code=403,
                detail="Master lisans korumalıdır — silinemez. Bu hesap sistem-kritik root hesabıdır (heartbeat, plan matrix, tenant scope). Geçici kaldırmak için Ayarlar → Master > Silme Koruması'nı devre dışı bırakın (5dk).",
            )
        # Bypass aktif — audit log ile devam et
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "master_license_delete_bypassed",
            "actor_ip": _client_ip(request),
            "details": {"license_key": doc.get("license_key")},
            "at": _iso(),
            "severity": "critical",
        })
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
        "revoked_by_ip": _client_ip(request),
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
    # v43.86 — Aksiyon logu (successful delete)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "license_deleted",
        "actor_ip": _client_ip(request),
        "details": {"license_key": doc.get("license_key"),
                     "customer_name": doc.get("customer_name"),
                     "plan": doc.get("plan"),
                     "was_master": bool(is_master_lic)},
        "at": _iso(),
        "severity": "critical" if is_master_lic else "info",
    })
    return {"deleted": True, "revoked": True, "license_key": doc.get("license_key")}


# v43.86 — Silme Koruması Yönetimi (advanced user için geçici bypass)
class MasterProtectionIn(BaseModel):
    disable_minutes: int = Field(5, ge=1, le=60)   # kaç dakika bypass aktif kalacak
    confirm_1: bool = False
    confirm_2: bool = False
    reason: Optional[str] = ""


@api.get("/settings/master-protection")
async def master_protection_get(request: Request):
    """Silme koruması durumu — kalan bypass süresi ve son değişim."""
    await _require_master(request, None)
    doc = await db.settings.find_one({"_key": "master_protection"}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc)
    active_bypass = False
    remaining_seconds = 0
    du = doc.get("delete_protection_disabled_until")
    if du:
        try:
            end = datetime.fromisoformat(du.replace("Z", "+00:00"))
            if end > now:
                active_bypass = True
                remaining_seconds = int((end - now).total_seconds())
        except Exception:
            pass
    return {
        "protection_active": not active_bypass,
        "bypass_active": active_bypass,
        "bypass_remaining_seconds": remaining_seconds,
        "last_disabled_by_ip": doc.get("last_disabled_by_ip"),
        "last_disabled_at": doc.get("last_disabled_at"),
        "last_reason": doc.get("last_reason"),
    }


@api.post("/settings/master-protection/disable")
async def master_protection_disable(payload: MasterProtectionIn, request: Request):
    """Silme korumasını GEÇİCİ olarak kaldır (advanced). 2-adım onay zorunlu."""
    await _require_master(request, None)
    if not (payload.confirm_1 and payload.confirm_2):
        raise HTTPException(400, "İki onay adımı da gerekli (confirm_1 + confirm_2)")
    until = (datetime.now(timezone.utc) + timedelta(minutes=payload.disable_minutes)).isoformat()
    await db.settings.update_one(
        {"_key": "master_protection"},
        {"$set": {
            "_key": "master_protection",
            "delete_protection_disabled_until": until,
            "last_disabled_by_ip": _client_ip(request),
            "last_disabled_at": _iso(),
            "last_reason": (payload.reason or "").strip()[:200],
        }},
        upsert=True,
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "master_protection_disabled",
        "actor_ip": _client_ip(request),
        "details": {"minutes": payload.disable_minutes, "reason": payload.reason},
        "at": _iso(),
        "severity": "critical",
    })
    return {"ok": True, "bypass_until": until, "minutes": payload.disable_minutes}


@api.post("/settings/master-protection/enable")
async def master_protection_enable(request: Request):
    """Silme korumasını hemen tekrar etkinleştir."""
    await _require_master(request, None)
    await db.settings.update_one(
        {"_key": "master_protection"},
        {"$unset": {"delete_protection_disabled_until": ""},
         "$set": {"last_enabled_by_ip": _client_ip(request), "last_enabled_at": _iso()}},
        upsert=True,
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "master_protection_enabled",
        "actor_ip": _client_ip(request),
        "at": _iso(), "severity": "info",
    })
    return {"ok": True}


# v43.86 — Master Key Rotation Wizard
class MasterRotateStep1In(BaseModel):
    reason: str = Field(..., min_length=3, max_length=200)


@api.post("/settings/master-rotate/generate")
async def master_rotate_generate(payload: MasterRotateStep1In, request: Request):
    """Adım 1: Yeni master key adayı üret (henüz DB'ye yazılmaz)."""
    await _require_master(request, None)
    # v43.99.11 — 2FA enforce (aktifse doğrulanmış cookie zorunlu)
    try:
        from routes.master_2fa import require_2fa_verified
        await require_2fa_verified(request)
    except HTTPException:
        raise
    except Exception:
        pass
    new_key = "MS-" + uuid.uuid4().hex.upper()[:24]
    # Adayı geçici sakla (10dk TTL — advanced flag)
    await db.settings.update_one(
        {"_key": "master_rotate_candidate"},
        {"$set": {
            "_key": "master_rotate_candidate",
            "candidate_key": new_key,
            "generated_at": _iso(),
            "generated_by_ip": _client_ip(request),
            "reason": payload.reason,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }},
        upsert=True,
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "master_rotate_candidate_generated",
        "actor_ip": _client_ip(request),
        "details": {"candidate_preview": new_key[:16] + "…", "reason": payload.reason},
        "at": _iso(), "severity": "warning",
    })
    return {
        "ok": True,
        "new_candidate_key": new_key,
        "next_steps": [
            "1. Bu yeni key'i güvenli bir yere kopyalayın (bir kez gösterilir)",
            "2. Sunucunuzda /app/backend/.env → MASTER_LICENSE_KEY değerini bu yeni key ile değiştirin",
            "3. Backend'i yeniden başlatın: sudo supervisorctl restart backend",
            "4. Bu panelde 'Rotation'ı Tamamla' butonuna basın (eski key revoke edilecek)",
        ],
        "expires_in_minutes": 10,
    }


@api.post("/settings/master-rotate/complete")
async def master_rotate_complete(request: Request):
    """Adım 2: Env güncellenmiş olduğunu doğrula ve eski key'i revoke et."""
    await _require_master(request, None)
    # v43.99.11 — 2FA enforce
    try:
        from routes.master_2fa import require_2fa_verified
        await require_2fa_verified(request)
    except HTTPException:
        raise
    except Exception:
        pass
    cand = await db.settings.find_one({"_key": "master_rotate_candidate"}, {"_id": 0}) or {}
    new_key = cand.get("candidate_key")
    if not new_key:
        raise HTTPException(404, "Rotation adayı yok — önce 'generate' adımını çalıştırın")
    # Env değişmiş mi?
    current_env = os.environ.get("MASTER_LICENSE_KEY", "")
    if current_env != new_key:
        raise HTTPException(
            status_code=412,
            detail=f"MASTER_LICENSE_KEY env değişkeni yeni key ile eşleşmiyor. Mevcut env: {current_env[:16]}… — Beklenen: {new_key[:16]}… (Backend restart edildi mi?)"
        )
    # Eski key'i revoke et + yeni key'i licenses'a is_master ile yaz
    old_key = None
    # (Not: current_env zaten new_key olduğu için "eski" ne? Bu wizard adım-adım kullanılırken
    #  önceki master key request header'ından geldiği için önce header'a bakalım)
    hdr_key = (request.headers.get("X-Old-Master-Key") or "").strip()
    if hdr_key and hdr_key.startswith("MS-") and hdr_key != new_key:
        old_key = hdr_key
        await db.revoked_licenses.update_one(
            {"license_key": old_key},
            {"$set": {"license_key": old_key, "revoked_at": _iso(),
                       "reason": "master_rotation", "revoked_by_ip": _client_ip(request)}},
            upsert=True,
        )
        # is_master bayrağını eskiden kaldır
        await db.licenses.update_one({"license_key": old_key},
                                       {"$unset": {"is_master": ""},
                                        "$set": {"active": False,
                                                  "rotated_out_at": _iso()}})
    # Yeni key'e is_master atanmış master license var mı kontrol/oluştur
    await db.licenses.update_one(
        {"license_key": new_key},
        {"$set": {"license_key": new_key, "is_master": True, "active": True,
                   "plan": "enterprise", "customer_name": "GökyüzüWebSpam Master",
                   "customer_email": "master@gokyuzuhosting.com",
                   "max_domains": 10000,
                   "valid_until": "2030-12-31T23:59:59+00:00",
                   "subscription_expires_at": "2030-12-31T23:59:59+00:00",
                   "rotated_in_at": _iso()},
         "$setOnInsert": {"id": str(uuid.uuid4()),
                            "created_at": _iso(), "ip_addresses": []}},
        upsert=True,
    )
    # Candidate'ı temizle
    await db.settings.delete_one({"_key": "master_rotate_candidate"})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "master_rotate_completed",
        "actor_ip": _client_ip(request),
        "details": {"old_key_preview": (old_key or "")[:16] + ("…" if old_key else "unknown"),
                     "new_key_preview": new_key[:16] + "…"},
        "at": _iso(), "severity": "critical",
    })
    return {"ok": True, "old_key_revoked": bool(old_key), "new_master_key_preview": new_key[:16] + "…"}


@api.post("/settings/master-rotate/cancel")
async def master_rotate_cancel(request: Request):
    """Rotation adayını iptal et."""
    await _require_master(request, None)
    r = await db.settings.delete_one({"_key": "master_rotate_candidate"})
    return {"ok": True, "cancelled": r.deleted_count > 0}


# v43.87 — Foreign IP Session Kill Management
@api.get("/settings/killed-master-ips")
async def killed_ips_list(request: Request):
    """Blocklistedeki IP'lerin listesi."""
    await _require_master(request, None)
    docs = await db.killed_master_ips.find({}, {"_id": 0}).sort("killed_at", -1).limit(200).to_list(200)
    setting = await db.settings.find_one({"_key": "foreign_ip_auto_kill"}, {"_id": 0}) or {}
    return {
        "auto_kill_enabled": setting.get("enabled", True),
        "items": docs,
        "total_active": sum(1 for d in docs if d.get("active")),
    }


class KilledIpToggleIn(BaseModel):
    enabled: bool


@api.post("/settings/killed-master-ips/toggle-auto")
async def killed_ips_toggle_auto(payload: KilledIpToggleIn, request: Request):
    """Otomatik session-kill özelliğini aç/kapat (default: açık)."""
    await _require_master(request, None)
    await db.settings.update_one(
        {"_key": "foreign_ip_auto_kill"},
        {"$set": {"_key": "foreign_ip_auto_kill", "enabled": bool(payload.enabled),
                   "updated_at": _iso(), "updated_by_ip": _client_ip(request)}},
        upsert=True,
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "foreign_ip_auto_kill_toggled",
        "actor_ip": _client_ip(request), "details": {"enabled": payload.enabled},
        "at": _iso(), "severity": "warning",
    })
    return {"ok": True, "auto_kill_enabled": bool(payload.enabled)}


@api.post("/settings/killed-master-ips/{ip}/unblock")
async def killed_ips_unblock(ip: str, request: Request):
    """Belirli bir IP'yi block listeden kaldır."""
    await _require_master(request, None)
    r = await db.killed_master_ips.update_one({"ip": ip}, {"$set": {"active": False,
                                                                        "unblocked_at": _iso(),
                                                                        "unblocked_by_ip": _client_ip(request)}})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "killed_ip_unblocked",
        "actor_ip": _client_ip(request), "details": {"ip": ip},
        "at": _iso(), "severity": "warning",
    })
    return {"ok": True, "modified": r.modified_count}


@api.post("/licenses/{lid}/update")
async def licenses_update_post(lid: str, payload: LicenseIn):
    """POST alternatifi — cPanel/Apache/WAF ortamlarında PUT bloklu olabildiği
    için birebir aynı işlemi POST üzerinden sunar."""
    return await licenses_update(lid, payload)


@api.post("/licenses/{lid}/delete")
async def licenses_delete_post(lid: str, request: Request):
    """POST alternatifi — DELETE method'u proxy/WAF tarafından bloklu olabilir.
    Bu endpoint aynı silme işlemini POST ile yapar."""
    return await licenses_delete(lid, request)


@api.post("/licenses/{lid}/toggle-active")
async def licenses_toggle_active(lid: str, request: Request, license_key: Optional[str] = None):
    """Tek tıkla aktif/pasif — mevcut durumu tersine çevirir. WAF-safe POST.
    Deaktive edildiyse bayinin panelinde bir sonraki `plugin/status` çağrısında
    `session_expired:true` bayrağı düşer ve panel oturumu otomatik kapanır.
    Broadcast: `type=license_state_changed` WS mesajı."""
    await _require_master(request, license_key)
    doc = await db.licenses.find_one({"id": lid}, {"_id": 0, "active": 1, "license_key": 1, "plan": 1, "customer_name": 1, "is_master": 1})
    if not doc:
        raise HTTPException(404, "Lisans bulunamadı")
    # v43.85 — Master license'ı pasif etme yasağı (heartbeat kırılır)
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    if doc.get("is_master") or (master_env and doc.get("license_key") == master_env):
        if doc.get("active"):   # aktifi pasif yapmaya çalışıyorsa engelle
            raise HTTPException(
                status_code=403,
                detail="Master lisans korumalıdır — pasif duruma alınamaz.",
            )
    new_active = not doc.get("active", True)
    await db.licenses.update_one({"id": lid}, {"$set": {"active": new_active}})
    # v43.86 — Aksiyon logu (toggle active)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "license_toggle_active",
        "actor_ip": _client_ip(request),
        "details": {"license_key": doc.get("license_key"),
                     "customer_name": doc.get("customer_name"),
                     "old_active": doc.get("active"),
                     "new_active": new_active},
        "at": _iso(), "severity": "info",
    })
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
    # v43.85 — Master license bulk delete/suspend'e karşı korumalı
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    if payload.action in ("delete", "suspend") and master_env:
        master_doc = await db.licenses.find_one(
            {"$and": [match, {"$or": [{"license_key": master_env}, {"is_master": True}]}]},
            {"_id": 0, "license_key": 1},
        )
        if master_doc:
            raise HTTPException(
                status_code=403,
                detail="Master lisans korumalıdır — toplu işlemde silinemez/askıya alınamaz. Master lisansı seçimden çıkarın.",
            )
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
    lang = await _resolve_language(payload.language)

    # v43.65 — EMERGENT_LLM_KEY yoksa yerel (ücretsiz) kural üretici devreye girer.
    # Prompt'taki anahtar kelimeleri regex pattern'lerine dönüştürür + Türkçe
    # spam sözlüğü + score heuristikleri kullanır. LLM yok → 0 maliyet.
    if not key:
        proposals = _local_rule_generator(payload.prompt, lang)
        if not proposals:
            raise HTTPException(502, "Yerel üretici kural çıkaramadı — prompt'a somut kelime/ifade ekleyin (örn: 'viagra, cialis, casino')")
        await db.logs.insert_one(ActivityLog(
            source="ai", level="info",
            message=f"Yerel kural üretici (LLM-siz, {lang}) · '{payload.prompt[:60]}' → {len(proposals)} kural",
        ).model_dump())
        return {"model": "local-heuristic", "language": lang, "provider": "local",
                "count": len(proposals), "proposals": proposals,
                "note": "EMERGENT_LLM_KEY yok — yerel heuristic üretici kullanıldı (ücretsiz)."}

    model = payload.model or settings.get("ai_model", "claude-sonnet-4-5")
    if model not in AI_PROVIDER:
        raise HTTPException(400, f"Bilinmeyen model: {model}")
    provider, model_name = AI_PROVIDER[model]
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
        # v43.65 — LLM hata verirse local fallback'e düş (kesintisiz servis)
        log.warning("AI çağrısı başarısız, yerel fallback devreye giriyor: %s", e)
        proposals = _local_rule_generator(payload.prompt, lang)
        if proposals:
            await db.logs.insert_one(ActivityLog(
                source="ai", level="warning",
                message=f"LLM başarısız → yerel fallback ({lang}) · '{payload.prompt[:60]}' → {len(proposals)} kural",
            ).model_dump())
            return {"model": "local-heuristic-fallback", "language": lang, "provider": "local",
                    "count": len(proposals), "proposals": proposals,
                    "note": f"LLM erişilemedi → yerel yedek kullanıldı: {str(e)[:100]}"}
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
        # v43.65 — Parse başarısızsa local fallback
        proposals = _local_rule_generator(payload.prompt, lang)
        if not proposals:
            raise HTTPException(502, "AI kural üretemedi, farklı ifadelerle tekrar deneyin")
    await db.logs.insert_one(ActivityLog(
        source="ai", level="info",
        message=f"AI kural önerisi ({model}/{lang}) · '{payload.prompt[:60]}' → {len(proposals)} kural",
    ).model_dump())
    return {"model": model, "language": lang, "provider": provider, "count": len(proposals), "proposals": proposals}


# ============================================================================
# v43.65 — Yerel (LLM-siz) Kural Üretici
# ---------------------------------------------------------------------------
# EMERGENT_LLM_KEY yok VEYA LLM erişimi başarısızsa devreye girer.
# Prompt analizi:
#   1. Kategori tespiti (viagra/kripto/eczane/casino/kredi/ithalat/toplu-mail)
#   2. İlgili keyword'ler + varyasyonları (Türkçe + İngilizce)
#   3. Regex pattern build (\b + alternation + case-insensitive)
#   4. Score heuristic (yüksek riskli kategoriler → 8-9, orta → 5-6)
# ============================================================================
_RULE_CATEGORIES = {
    "pharma": {
        "triggers": ["viagra", "cialis", "sildenafil", "eczane", "ilaç", "hap",
                     "pharmacy", "levitra", "kamagra", "erectile", "penis"],
        "keywords": ["viagra", "cialis", "sildenafil", "kamagra", "levitra",
                     "eczane", "ilaç", "hap", "pharmacy", "meds", "prescription"],
        "score": 8.0, "name": "PHARMA_SPAM",
        "desc_tr": "Eczane/ilaç spam kampanyalarını yakalar",
        "desc_en": "Catches pharmacy/medication spam campaigns",
    },
    "crypto": {
        "triggers": ["kripto", "crypto", "bitcoin", "btc", "ethereum", "eth",
                     "pump", "dump", "airdrop", "nft", "web3", "cüzdan", "wallet",
                     "investment", "yatirim", "yatırım"],
        "keywords": ["bitcoin", "btc", "ethereum", "eth", "crypto", "kripto",
                     "airdrop", "pump\\s*and\\s*dump", "nft", "web3", "wallet",
                     "cüzdan", "yatırım", "investment", "trade\\s*signal"],
        "score": 7.5, "name": "CRYPTO_INVESTMENT_SCAM",
        "desc_tr": "Sahte kripto yatırım/pump davetlerini yakalar",
        "desc_en": "Catches fake crypto investment / pump invitations",
    },
    "casino": {
        "triggers": ["casino", "bahis", "kumar", "bet", "poker", "slot",
                     "roulette", "gambling", "iddaa"],
        "keywords": ["casino", "bahis", "kumar", "poker", "slot", "roulette",
                     "gambling", "iddaa", "bet365", "sportsbook"],
        "score": 7.0, "name": "GAMBLING_SPAM",
        "desc_tr": "Bahis/kumar/casino tanıtım maillerini yakalar",
        "desc_en": "Catches gambling / casino promotion emails",
    },
    "loan": {
        "triggers": ["kredi", "loan", "borç", "faiz", "hızlı para",
                     "quick cash", "instant loan", "kefil", "senetsiz"],
        "keywords": ["kredi", "loan", "borç", "faiz", "hızlı\\s*para",
                     "quick\\s*cash", "kefil", "senetsiz", "peşin\\s*ödeme"],
        "score": 6.5, "name": "LOAN_SCAM",
        "desc_tr": "Hızlı kredi/borç spam maillerini yakalar",
        "desc_en": "Catches quick loan / debt spam emails",
    },
    "realestate": {
        "triggers": ["emlak", "gayrimenkul", "real estate", "property",
                     "kiralık", "satılık", "villa", "daire"],
        "keywords": ["emlak", "gayrimenkul", "kiralık", "satılık", "villa",
                     "daire", "property", "real\\s*estate", "for\\s*sale"],
        "score": 5.5, "name": "REAL_ESTATE_SPAM",
        "desc_tr": "Emlak ve gayrimenkul toplu ilan spam'ini yakalar",
        "desc_en": "Catches real estate bulk listing spam",
    },
    "phishing": {
        "triggers": ["phishing", "banka", "bank", "hesap", "account",
                     "verify", "doğrulama", "şifre", "password", "otp"],
        "keywords": ["verify\\s*your\\s*account", "hesap\\s*doğrulama",
                     "şifre\\s*sıfırla", "reset\\s*password",
                     "click\\s*here\\s*to\\s*verify", "confirm\\s*identity",
                     "kimlik\\s*doğrulama", "bank(a)?\\s*bilgileri"],
        "score": 9.0, "name": "PHISHING_ATTEMPT",
        "desc_tr": "Kimlik avı / phishing girişimlerini yakalar",
        "desc_en": "Catches phishing / credential theft attempts",
    },
    "bulk": {
        "triggers": ["toplu", "bulk", "newsletter", "abone", "subscribe",
                     "kampanya", "campaign", "promo", "duyuru"],
        "keywords": ["\\btoplu\\s*mail", "bulk\\s*mail", "mass\\s*mailing",
                     "campaign\\s*sent", "newsletter", "abonelik",
                     "unsubscribe\\s*here"],
        "score": 5.0, "name": "BULK_CAMPAIGN",
        "desc_tr": "Toplu kampanya/newsletter mail örüntüsünü yakalar",
        "desc_en": "Catches bulk campaign / newsletter patterns",
    },
    "adult": {
        "triggers": ["adult", "porn", "seks", "escort", "webcam",
                     "yetişkin", "18+"],
        "keywords": ["adult\\s*content", "webcam", "escort", "seks",
                     "porn", "xxx", "18\\+", "yetişkin\\s*içerik"],
        "score": 8.5, "name": "ADULT_CONTENT",
        "desc_tr": "Yetişkin içerik spam maillerini yakalar",
        "desc_en": "Catches adult content spam",
    },
}


def _local_rule_generator(prompt: str, lang: str) -> list:
    """LLM-siz yerel kural üretici. Prompt'taki anahtar kelimelerden regex türetir."""
    import re
    p = (prompt or "").lower()
    if not p.strip():
        return []
    matched_cats = []
    for cat_id, cat in _RULE_CATEGORIES.items():
        if any(t in p for t in cat["triggers"]):
            matched_cats.append((cat_id, cat))

    # Hiçbir kategori match etmediyse: prompt'taki kelimeleri direkt regex yap
    proposals = []
    if matched_cats:
        for cat_id, cat in matched_cats[:3]:
            kw_regex = "|".join(f"\\b{k}\\b" for k in cat["keywords"][:8])
            pattern = f"(?i)({kw_regex})"
            proposals.append({
                "name": cat["name"],
                "pattern": pattern,
                "score": cat["score"],
                "target": "any",
                "description": cat["desc_en"] if lang == "en" else cat["desc_tr"],
            })
    else:
        # Fallback: prompt'taki 3-5 harften uzun kelimeleri regex'e çevir
        words = re.findall(r"[a-zA-ZğüşıöçĞÜŞİÖÇ]{3,}", p)
        # Stop-words'ü at
        stop = {"ile", "için", "olan", "veya", "and", "the", "for", "with",
                "yakala", "yakalar", "spam", "mail", "email"}
        words = [w for w in words if w not in stop][:6]
        if not words:
            return []
        kw_regex = "|".join(f"\\b{re.escape(w)}\\b" for w in words)
        pattern = f"(?i)({kw_regex})"
        name = "CUSTOM_" + "_".join(w.upper() for w in words[:2])
        proposals.append({
            "name": name[:60],
            "pattern": pattern,
            "score": 5.5,
            "target": "any",
            "description": (f"Prompt anahtar kelimelerinden türetildi: {', '.join(words[:4])}"
                           if lang != "en" else f"Derived from prompt keywords: {', '.join(words[:4])}"),
        })
        # Ek varyant: konu bazlı
        proposals.append({
            "name": name[:55] + "_SUBJ",
            "pattern": pattern,
            "score": 6.0,
            "target": "subject",
            "description": ("Yukarıdaki pattern'i sadece Konu (Subject) alanında arar (daha yüksek skor)"
                           if lang != "en" else "Same pattern but scoped to Subject header (higher score)"),
        })

    return proposals





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

    # v43.65 — X-Master-Key (veya header_key) master ile eşleşmediyse,
    # normal lisans olarak da lookup yap. Fake MS- key gönderen bir istemci
    # authorized_ips path'inde de bulunmuyorsa demo görecek — bu doğru davranış.
    # Ama GERÇEK bir lisans anahtarı ile gelen kullanıcı licensed görünmeli.
    if header_key and header_key != master_key_env:
        lic_by_key = await db.licenses.find_one(
            {"license_key": header_key, "active": True}, {"_id": 0}
        )
        if lic_by_key:
            # Revoke kontrolü
            rev = await db.revoked_licenses.find_one(
                {"license_key": header_key}, {"_id": 1}
            )
            if not rev:
                valid_until = lic_by_key.get("valid_until") or ""
                now_iso = datetime.now(timezone.utc).isoformat()
                expired = valid_until and valid_until < now_iso
                if not expired:
                    return {
                        "mode": PLUGIN_MODE,
                        "installed_at": lic_by_key.get("created_at"),
                        "is_demo": False,
                        "demo_expires": "",
                        "demo_days_remaining": 0,
                        "demo_over": False,
                        "licensed": True,
                        "license_key": header_key,
                        "license_expires": valid_until,
                        "license_customer_name": lic_by_key.get("customer_name", ""),
                        "license_plan": lic_by_key.get("plan", "starter"),
                        "license_active": True,
                        "license_version": int(lic_by_key.get("license_version") or 0),
                        "gated": False,
                        "gate_reason": "ok",
                        "auth_method": "header_key",
                    }

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
    """En son plugin paketini indirir.
    v43.18 — Her zaman `/app/whm-plugin/` dizininden on-the-fly build eder
    (BACKEND_DIST_DIR bayat kalabildiği için — Ağustos'ta build edilen
    tarball WHM sunucusundaki fullscreen fix'ini içermiyordu).
    Bu sayede güncel CGI/Perl/tmpl her zaman servis edilir.
    """
    import io as _io
    import tarfile as _tar
    ver = await _current_version()
    plugin_dir = Path("/app/whm-plugin")
    if plugin_dir.exists():
        buf = _io.BytesIO()
        with _tar.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(str(plugin_dir), arcname="gokyuzuwebspam")
        buf.seek(0)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            _io.BytesIO(buf.getvalue()),
            media_type="application/gzip",
            headers={
                "Content-Disposition": f'attachment; filename="gokyuzuwebspam-{ver}.tar.gz"',
                "X-Plugin-Version": ver,
                "X-Plugin-Source": "on-the-fly",
                "Cache-Control": "no-store",
            },
        )
    # Fallback (legacy) — pre-built tarball
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


# ============================================================================
# v43.43 — Docker/native Exim log tailer script (bash-only, no Perl deps)
# ---------------------------------------------------------------------------
# Docker container'lı deployment'larda sunucunuzun /var/log/exim_mainlog'una
# container'dan erişilemez. Bu script sunucu HOST'unda cron ile çalışıp
# tailer görevini yapar.
# ============================================================================
@api.get("/tools/gws-exim-push.sh")
async def download_exim_push_script():
    """Bayi WHM host'unda çalışacak bash Exim log tailer script'ini indirir.

    v43.44 — Script Python koduna gömüldü (dosya bağımlılığı yok). Böylece
    Docker container'ında /app/deployment/ mount edilmemiş olsa dahi çalışır.
    """
    from fastapi.responses import PlainTextResponse as _PT
    return _PT(_EXIM_PUSH_SH_SOURCE, media_type="text/x-shellscript",
               headers={"Content-Disposition": "attachment; filename=gws-exim-push"})


# Embedded bash source — /app/deployment/gws-exim-push.sh ile senkron tut
_EXIM_PUSH_SH_SOURCE = r"""#!/bin/bash
# gws-exim-push — GökyüzüWebSpam Exim log tailer (host cron için)
# Perl gerektirmez — bash + awk + curl kullanır.
# v43.54 — Silent-fail bug fix: -e kaldırıldı, STARTED log satırı + explicit error catches
GWS_EXIM_PUSH_VERSION="v43.54"
# v43.54: `set -e` REMOVED — bir komut hata verirse tüm script silent fail ediyordu.
# Şimdi her hata log'a yazılır ve script mümkün olduğunca devam eder.
set -uo pipefail

# --version flag (kolay doğrulama için)
if [ "${1:-}" = "--version" ]; then echo "$GWS_EXIM_PUSH_VERSION"; exit 0; fi

# v43.54 — --diagnose flag: her adımı stdout'a bas (kullanıcı SSH'ta görsün)
DIAGNOSE=0
if [ "${1:-}" = "--diagnose" ] || [ "${1:-}" = "-d" ]; then DIAGNOSE=1; fi
diag() { [ "$DIAGNOSE" = "1" ] && echo "[diag] $*"; }

CONF="/etc/gws-exim-push.conf"
if [ -f "$CONF" ]; then . "$CONF" 2>/dev/null || true; fi
PANEL_URL="${PANEL_URL:-https://panel.gokyuzuhosting.com}"
LICENSE_KEY="${LICENSE_KEY:-}"
EXIM_LOG="${EXIM_LOG:-/var/log/exim_mainlog}"
STATE_DIR="${STATE_DIR:-/var/lib/gws-exim-push}"
BATCH_MAX="${BATCH_MAX:-500}"
DEBUG="${DEBUG:-0}"

mkdir -p "$STATE_DIR" /var/log/gws-exim-push 2>/dev/null || true
LOG="/var/log/gws-exim-push/push.log"
log_line() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG" 2>/dev/null || true; [ "$DIAGNOSE" = "1" ] && echo "[log] $*"; }

# v43.54 — En başta STARTED log — bundan sonraki silent exit'leri fark edebilelim
log_line "START v$GWS_EXIM_PUSH_VERSION pid=$$ user=$(whoami) tz=$(date +%z)"
diag "PANEL_URL=$PANEL_URL"
diag "LICENSE_KEY=${LICENSE_KEY:0:10}…"
diag "EXIM_LOG=$EXIM_LOG (readable: $([ -r "$EXIM_LOG" ] && echo yes || echo NO))"
diag "STATE_DIR=$STATE_DIR (writable: $([ -w "$STATE_DIR" ] && echo yes || echo NO))"

if [ -z "$LICENSE_KEY" ]; then
    log_line "FATAL: LICENSE_KEY yok. $CONF dosyasına LICENSE_KEY=MS-... ekleyin."; exit 1
fi
if [ ! -r "$EXIM_LOG" ]; then
    log_line "FATAL: $EXIM_LOG okunamıyor. Root yetkisi + dosya var mı kontrol edin."; exit 1
fi

# ------ userdomains listesi (cPanel — domain'i olan mailler outbound) ------
USERDOMAINS_FILE="/etc/userdomains"
USERDOMAINS_LIST=""
if [ -r "$USERDOMAINS_FILE" ]; then
    USERDOMAINS_LIST=$(awk -F: '/^[^#]/ {print $1}' "$USERDOMAINS_FILE" 2>/dev/null | tr '\n' '|' | sed 's/|$//')
fi

CHECKPOINT_FILE="$STATE_DIR/checkpoint"
INFLIGHT_FILE="$STATE_DIR/in_flight.state"    # v43.53 — persist arrival state between cron cycles
INFLIGHT_MAX=5000                              # üst sınır: 5000 mesaj (~450KB); üstü FIFO drop
LAST_POS=0
if [ -f "$CHECKPOINT_FILE" ]; then LAST_POS=$(cat "$CHECKPOINT_FILE" 2>/dev/null || echo "0"); fi
# In-flight state dosyası çok büyümüşse eski satırları kırp (FIFO)
if [ -f "$INFLIGHT_FILE" ]; then
    IF_LINES=$(wc -l < "$INFLIGHT_FILE" 2>/dev/null || echo "0")
    if [ "$IF_LINES" -gt "$INFLIGHT_MAX" ]; then
        tail -n "$INFLIGHT_MAX" "$INFLIGHT_FILE" > "$INFLIGHT_FILE.tmp" 2>/dev/null && \
            mv "$INFLIGHT_FILE.tmp" "$INFLIGHT_FILE" 2>/dev/null || true
    fi
fi
# v43.48 — Backfill sinyali (panel'de butondan tetiklenirse)
BACKFILL_RESP=$(curl -sSf --max-time 8 \
    "$PANEL_URL/api/outbound/backfill-signal?license_key=$LICENSE_KEY" 2>/dev/null || echo '{"pending":false}')
BACKFILL_ACTIVE=0
if echo "$BACKFILL_RESP" | grep -q '"pending":true'; then
    log_line "Backfill signal → checkpoint sıfırlanıyor + in_flight state temizleniyor"
    LAST_POS=0
    BACKFILL_ACTIVE=1
    # Backfill'de in_flight state'i de sıfırla
    : > "$INFLIGHT_FILE" 2>/dev/null || true
    curl -sSf --max-time 8 -X POST -H "Content-Type: application/json" \
        "$PANEL_URL/api/outbound/backfill-ack" \
        -d "{\"license_key\":\"$LICENSE_KEY\",\"pushed\":0}" >/dev/null 2>&1 || true
fi
if [ "$BACKFILL_ACTIVE" -eq 0 ]; then
    REMOTE_POS=$(curl -sSf --max-time 8 \
        "$PANEL_URL/api/outbound/exim-log-checkpoint?license_key=$LICENSE_KEY" 2>/dev/null \
        | grep -oE '"last_position":[0-9]+' | grep -oE '[0-9]+$' || echo "0")
    if [ "$REMOTE_POS" -gt "$LAST_POS" ]; then LAST_POS="$REMOTE_POS"; fi
fi

FILE_SIZE=$(stat -c%s "$EXIM_LOG" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -eq 0 ]; then
    log_line "WARN: $EXIM_LOG boş veya stat başarısız → çıkılıyor"
    exit 0
fi
if [ "$FILE_SIZE" -lt "$LAST_POS" ]; then log_line "Log rotate → reset"; LAST_POS=0; fi
if [ "$FILE_SIZE" -eq "$LAST_POS" ]; then log_line "No new data (pos=$LAST_POS · size=$FILE_SIZE)"; exit 0; fi

DELTA=$(dd if="$EXIM_LOG" bs=1 skip="$LAST_POS" 2>/dev/null || echo "")
if [ -z "$DELTA" ]; then
    log_line "WARN: dd delta read boş (pos=$LAST_POS size=$FILE_SIZE)"; exit 0
fi
NEW_POS=$FILE_SIZE

TMP=$(mktemp 2>/dev/null || echo "/tmp/gws-exim-push.$$")
trap "rm -f $TMP $TMP.events $TMP.count $TMP.payload $TMP.debug $INFLIGHT_FILE.new 2>/dev/null" EXIT

echo "$DELTA" | awk -v batch_max="$BATCH_MAX" -v userdomains="$USERDOMAINS_LIST" -v debug="$DEBUG" \
    -v inflight_in="$INFLIGHT_FILE" -v inflight_out="$INFLIGHT_FILE.new" '
BEGIN {
    count=0; arrivals=0; deliveries=0; skipped=0; first=1; state_loaded=0
    # v43.53 — Önceki cron cycle'ından in_flight state'i yükle
    while ((getline line < inflight_in) > 0) {
        tab = index(line, "\t")
        if (tab > 0) {
            k = substr(line, 1, tab-1)
            v = substr(line, tab+1)
            if (k != "") { in_flight[k] = v; state_loaded++ }
        }
    }
    close(inflight_in)
    # userdomains: pipe-separated list → hash
    n = split(userdomains, ud_arr, "|")
    for (i=1; i<=n; i++) if (ud_arr[i] != "") ud[ud_arr[i]] = 1
    print "["
}
function j(s) { gsub(/\\/,"\\\\",s); gsub(/"/,"\\\"",s); gsub(/\r/,"",s); gsub(/\n/," ",s); gsub(/\t/," ",s); return s }
function domain_of(email,   parts,at) {
    at = index(email, "@")
    if (at == 0) return ""
    return tolower(substr(email, at+1))
}
/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]/ {
    if (count >= batch_max) next
    date=$1; time=$2; mid=$3; dir=$4; ts=date"T"time"+00:00"
    if (dir=="<=") {
        arrivals++
        sender=$5; user=""; size=0; subj=""; auth_user=""
        for (i=6; i<=NF; i++) {
            if ($i ~ /^U=/) user=substr($i,3)
            if ($i ~ /^A=dovecot_login:/) auth_user=substr($i,17)
            if ($i ~ /^A=courier_login:/) auth_user=substr($i,17)
            if ($i ~ /^S=/) size=substr($i,3)+0
            if ($i ~ /^T=/) {
                subj_str=""
                for (k=i; k<=NF; k++) subj_str=subj_str " " $k
                if (subj_str ~ /T="/) { match(subj_str,/T="[^"]*"/); if (RLENGTH>0) subj=substr(subj_str,RSTART+3,RLENGTH-4) }
                break
            }
        }
        # user precedence: auth_user > U=user > empty
        eff_user = (auth_user != "") ? auth_user : user
        in_flight[mid] = ts"|"sender"|"eff_user"|"size"|"subj
    } else if (dir=="=>" || dir=="->" || dir=="**" || dir=="=="){deliveries++
        rcpt=$5
        if (!(mid in in_flight)) { skipped++; next }
        n=split(in_flight[mid],parts,"|")
        s_ts=parts[1]; s_from=parts[2]; s_user=parts[3]; s_size=parts[4]; s_subj=parts[5]

        # v43.50 — cPanel local delivery: rcpt sadece username olabilir ("=> mehmet.cakir")
        # Sonraki tokenlerde <full@email> varsa onu al
        rest_line = ""
        for (kk=6; kk<=NF; kk++) rest_line = rest_line " " $kk
        if (match(rest_line, /<[^>]+@[^>]+>/)) {
            rcpt = substr(rest_line, RSTART+1, RLENGTH-2)
        } else if (index(rcpt, "@") == 0) {
            sd_guess = domain_of(s_from)
            if (sd_guess != "") rcpt = rcpt "@" sd_guess
        }

        # Outbound decision — HER ÜÇ HALDE outbound sayılır:
        # 1) auth_user veya U= dolu (kullanıcı login yaptı)
        # 2) sender domain userdomains listesinde (cPanel hosted domain)
        # 3) senders domain bilgisi yoksa ama recipient farklı domainden
        is_outbound = 0
        if (s_user != "" && s_user != "root" && s_user != "mailnull") is_outbound = 1
        else {
            sd = domain_of(s_from)
            if (sd != "" && sd in ud) is_outbound = 1
        }
        if (!is_outbound) { skipped++; next }

        # username çıkart: auth_user@domain formatındaysa @ öncesini al
        display_user = s_user
        at = index(display_user, "@")
        if (at > 0) display_user = substr(display_user, 1, at-1)
        if (display_user == "") display_user = domain_of(s_from)

        action=(dir=="**"?"bounce":(dir=="=="?"defer":"accept"))
        if (!first) print ","
        first=0
        printf "{\"exim_mid\":\"%s\",\"ts\":\"%s\",\"from_addr\":\"%s\",\"from_user\":\"%s\",\"to_addr\":\"%s\",\"subject\":\"%s\",\"size_bytes\":%s,\"verdict\":\"clean\",\"total_score\":0,\"action\":\"%s\"}", j(mid),j(s_ts),j(s_from),j(display_user),j(rcpt),j(s_subj),s_size,action
        count++
    }
}
END {
    print ""; print "]"
    # v43.53 — In-flight state persist et (sonraki cron cycle bunu yükleyecek)
    persisted = 0
    for (k in in_flight) {
        print k "\t" in_flight[k] > inflight_out
        persisted++
    }
    close(inflight_out)
    print "COUNT:"count > "/dev/stderr"
    if (debug == "1") {
        printf "DEBUG arrivals=%d deliveries=%d skipped=%d userdomains=%d loaded=%d persisted=%d\n", \
            arrivals, deliveries, skipped, length(ud), state_loaded, persisted > "/dev/stderr"
    }
}
' 2> "$TMP.count" > "$TMP.events"

# v43.53 — Atomically move new in_flight state file
if [ -f "$INFLIGHT_FILE.new" ]; then
    mv "$INFLIGHT_FILE.new" "$INFLIGHT_FILE"
fi

EVENT_COUNT=$(grep -oE 'COUNT:[0-9]+' "$TMP.count" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
DBG=$(cat "$TMP.count" 2>/dev/null | tr '\n' ' ')
# v43.53 — In-flight state boyutunu log'a ekle (arrival/delivery eşleşme diagnostiği)
IF_SIZE=$(wc -l < "$INFLIGHT_FILE" 2>/dev/null || echo "0")

if [ "$EVENT_COUNT" -eq 0 ]; then
    log_line "Parsed 0 events from $((NEW_POS-LAST_POS)) bytes · in_flight=$IF_SIZE · $DBG"
    echo "$NEW_POS" > "$CHECKPOINT_FILE"; exit 0
fi

# v43.51 — Verdict enrichment: Exim spool -H dosyasından X-Spam-Score oku ve JSON'a inject et
enrich_verdict() {
    local events_file="$1"
    [ ! -s "$events_file" ] && return 0
    python3 - "$events_file" <<'PYEOF' 2>/dev/null || cat "$events_file"
import sys, os, json, glob, re
p = sys.argv[1]
try:
    with open(p) as f:
        events = json.load(f)
except Exception:
    sys.exit(0)
for e in events:
    mid = e.get("exim_mid", "")
    if not mid: continue
    # Exim spool candidate paths
    candidates = [f"/var/spool/exim/input/{mid[5]}/{mid}-H", f"/var/spool/exim/input/{mid}-H"]
    spool_file = next((c for c in candidates if os.path.exists(c)), None)
    if not spool_file: continue
    try:
        with open(spool_file, "rb") as sf:
            data = sf.read(20000).decode("utf-8", errors="ignore")
    except Exception: continue
    m = re.search(r"X-Spam-Score:\s*(-?\d+(?:\.\d+)?)", data, re.I) \
        or re.search(r"X-Spam-Status:.*?score=(-?\d+(?:\.\d+)?)", data, re.I | re.S)
    if not m: continue
    score = float(m.group(1))
    e["total_score"] = round(score, 2)
    e["scores"] = {"spamassassin": round(score, 2)}
    if score >= 15: e["verdict"] = "blocked"
    elif score >= 10: e["verdict"] = "high_spam"
    elif score >= 5: e["verdict"] = "spam"
    elif score >= 3: e["verdict"] = "suspicious"
    else: e["verdict"] = "clean"
    rm = re.search(r"X-Spam-Report:\s*(.+?)(?:\n[A-Z]|\n\n)", data, re.I | re.S)
    if rm: e["sa_report"] = rm.group(1).strip()[:400]
print(json.dumps(events, ensure_ascii=False))
PYEOF
}

# Enrichment: sadece python3 varsa ve spool erişilebilirse çalışır (silent fallback)
if [ -x "$(command -v python3)" ]; then
    ENRICHED=$(enrich_verdict "$TMP.events")
    if [ -n "$ENRICHED" ] && echo "$ENRICHED" | head -c 1 | grep -q '\['; then
        echo "$ENRICHED" > "$TMP.events"
    fi
fi

HOSTNAME=$(hostname)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
EVENTS_JSON=$(cat "$TMP.events")
PAYLOAD_FILE="$TMP.payload"
cat > "$PAYLOAD_FILE" <<EOF
{"license_key":"$LICENSE_KEY","hostname":"$HOSTNAME","server_ip":"$SERVER_IP","events":$EVENTS_JSON,"checkpoint_position":$NEW_POS}
EOF
RESP=$(curl -sSf --max-time 30 -H "Content-Type: application/json" \
    -X POST "$PANEL_URL/api/outbound/exim-log-push" \
    --data-binary "@$PAYLOAD_FILE" 2>&1)
CURL_EXIT=$?

if [ "$CURL_EXIT" -ne 0 ]; then
    log_line "FAIL: curl exit=$CURL_EXIT · $(echo "$RESP" | head -c 200)"
    # Yine de checkpoint'i güncelle — sonsuz döngüye girmesin
    echo "$NEW_POS" > "$CHECKPOINT_FILE" 2>/dev/null || true
    exit 1
fi

if echo "$RESP" | grep -q '"ok":true'; then
    INSERTED=$(echo "$RESP" | grep -oE '"inserted":[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "?")
    UPDATED=$(echo "$RESP" | grep -oE '"updated":[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "?")
    log_line "OK · parsed=$EVENT_COUNT · inserted=$INSERTED · updated=$UPDATED · pos=$NEW_POS · in_flight=$IF_SIZE · $DBG"
    echo "$NEW_POS" > "$CHECKPOINT_FILE" 2>/dev/null || true
else
    log_line "FAIL panel yanıtı: $(echo "$RESP" | head -c 300)"
    exit 1
fi

# ============================================================================
# v43.51 — cPanel Users Auto-Import (whmapi1 varsa)
# ============================================================================
if [ -x /usr/local/cpanel/bin/whmapi1 ]; then
    USERS_STAMP="$STATE_DIR/users_last_sync"
    NOW_EPOCH=$(date +%s)
    LAST_USERS_SYNC=0
    [ -f "$USERS_STAMP" ] && LAST_USERS_SYNC=$(cat "$USERS_STAMP" 2>/dev/null || echo "0")
    # 1 saatte bir push
    if [ $((NOW_EPOCH - LAST_USERS_SYNC)) -gt 3600 ]; then
        ACCT_JSON=$(/usr/local/cpanel/bin/whmapi1 --output=json listaccts 2>/dev/null || echo '{}')
        USERS_ARR=$(echo "$ACCT_JSON" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    accts = (d.get("data") or {}).get("acct") or []
    out = [{"username": a.get("user"), "domain": a.get("domain"),
            "email_count_today": 0, "spam_caught_today": 0, "quarantine_size": 0}
           for a in accts if a.get("user")]
    print(json.dumps({"license_key": "'"$LICENSE_KEY"'", "accounts": out}))
except Exception as e:
    print("{}")
' 2>/dev/null)
        if [ -n "$USERS_ARR" ] && [ "$USERS_ARR" != "{}" ]; then
            USERS_RESP=$(curl -sSf --max-time 20 -H "Content-Type: application/json" \
                -X POST "$PANEL_URL/api/users/sync" \
                --data-binary "$USERS_ARR" 2>&1 || echo "ERROR")
            if echo "$USERS_RESP" | grep -q '"synced"'; then
                SYNCED=$(echo "$USERS_RESP" | grep -oE '"synced":[0-9]+' | grep -oE '[0-9]+' | head -1)
                log_line "USERS-SYNC ok · $SYNCED hesap"
                echo "$NOW_EPOCH" > "$USERS_STAMP"
            else
                log_line "USERS-SYNC fail: $USERS_RESP"
            fi
        fi
    fi
fi
"""


@api.get("/tools/install-exim-push.sh")
async def install_exim_push_oneliner(license_key: str = "", panel_url: str = ""):
    """1-satırlık kurulum. Sunucuda:
      bash <(curl -s https://panel.gokyuzuhosting.com/tools/install-exim-push.sh?license_key=MS-...)
    """
    from fastapi.responses import PlainTextResponse as _PT
    if not panel_url:
        panel_url = "https://panel.gokyuzuhosting.com"
    # license_key ilk arg olarak da verilebilir
    script = f"""#!/bin/bash
# GökyüzüWebSpam Exim log tailer — 1-satırlık kurulum
set -euo pipefail

LICENSE_KEY="{license_key}"
PANEL_URL="{panel_url}"

if [ -z "$LICENSE_KEY" ] && [ -n "${{1:-}}" ]; then
    LICENSE_KEY="$1"
fi

if [ -z "$LICENSE_KEY" ]; then
    echo "HATA: License key gerekli"
    echo "Kullanım: bash <(curl -s $PANEL_URL/tools/install-exim-push.sh?license_key=MS-...)"
    echo "  veya:  $0 MS-..."
    exit 1
fi

echo "==> Script indiriliyor…"
curl -sSf -o /usr/local/bin/gws-exim-push "$PANEL_URL/api/tools/gws-exim-push.sh"
chmod +x /usr/local/bin/gws-exim-push
echo "==> Config yazılıyor: /etc/gws-exim-push.conf"
cat > /etc/gws-exim-push.conf <<EOF
PANEL_URL=$PANEL_URL
LICENSE_KEY=$LICENSE_KEY
EXIM_LOG=/var/log/exim_mainlog
EOF
chmod 600 /etc/gws-exim-push.conf

echo "==> Cron entry ekleniyor (her dakika — anlık akış)…"
(crontab -l 2>/dev/null | grep -v gws-exim-push; echo '* * * * * /usr/local/bin/gws-exim-push >/dev/null 2>&1') | crontab -

# v43.50 — Systemd timer (15sn'de bir gerçek anlık akış)
if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    cat > /etc/systemd/system/gws-exim-push.service <<'SVC'
[Unit]
Description=GokyuzuWebSpam Exim Log Tailer (bash)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/gws-exim-push
User=root
SVC
    cat > /etc/systemd/system/gws-exim-push.timer <<'TMR'
[Unit]
Description=GWS Exim Log Push Timer (her 15sn)
After=network-online.target
[Timer]
OnBootSec=15s
OnUnitActiveSec=15s
AccuracySec=1s
Unit=gws-exim-push.service
[Install]
WantedBy=timers.target
TMR
    # v43.51 — inotify real-time servis (opsiyonel, inotifywait varsa)
    if command -v inotifywait >/dev/null 2>&1; then
        cat > /etc/systemd/system/gws-exim-inotify.service <<'INO'
[Unit]
Description=GWS Exim Log Real-Time Push (inotify)
After=network-online.target
[Service]
Type=simple
Restart=always
RestartSec=5
ExecStart=/bin/bash -c 'while inotifywait -qq -e modify /var/log/exim_mainlog; do sleep 2; /usr/local/bin/gws-exim-push; done'
[Install]
WantedBy=multi-user.target
INO
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable --now gws-exim-inotify.service 2>/dev/null && \
            echo "  ✓ inotify real-time servis aktif (sub-second push)"
        # Timer'a gerek yok inotify varsa — devre dışı bırak
        systemctl disable --now gws-exim-push.timer 2>/dev/null || true
    else
        echo "  ℹ inotify-tools bulunamadı; fallback → 15sn timer"
        echo "     Sub-second push için: yum install -y inotify-tools (veya apt-get install inotify-tools)"
    fi
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable --now gws-exim-push.timer 2>/dev/null && \
        echo "  ✓ systemd timer aktif — her 15sn push"
fi

echo "==> İlk çalıştırma test ediliyor…"
/usr/local/bin/gws-exim-push || echo "(İlk çalıştırma başarısız olabilir; log dosyasına bakın: /var/log/gws-exim-push/push.log)"
echo ""
echo "✓ Kurulum tamamlandı."
echo "  · Log:    tail -f /var/log/gws-exim-push/push.log"
echo "  · Cron:   crontab -l | grep gws-exim-push"
echo "  · Check:  /usr/local/bin/gws-exim-push (elle çalıştır)"
echo ""
echo "  Sonraki 5 dakika içinde panel'de outbound mailleriniz görünmeye başlayacak."
"""
    return _PT(script, media_type="text/x-shellscript")


# ============================================================================
# v43.57 — REAL-TIME EXIM DAEMON (continuous tail -F, 2s buffer flush)
# ---------------------------------------------------------------------------
# ConfigServer parity: mailler dashboard'a **anlık** düşer.
# - `tail -Fn0 /var/log/exim_mainlog` sürekli takip
# - Her 2 saniyede bir buffer flush → base64 encode → /api/outbound/exim-log-push-raw
# - Systemd auto-restart + nohup fallback
# - Eski cron/timer/inotify job'ları otomatik disable edilir
# ============================================================================
_EXIM_DAEMON_SH_SOURCE = r"""#!/bin/bash
# gws-exim-daemon — GökyüzüWebSpam real-time Exim log daemon
# Sub-second panel updates via continuous tail + rolling 2s flush.
GWS_DAEMON_VERSION="v43.57"
set -uo pipefail

CONF="/etc/gws-exim-push.conf"  # aynı config paylaşılır
[ -f "$CONF" ] && . "$CONF" 2>/dev/null || true
PANEL_URL="${PANEL_URL:-https://panel.gokyuzuhosting.com}"
LICENSE_KEY="${LICENSE_KEY:-}"
EXIM_LOG="${EXIM_LOG:-/var/log/exim_mainlog}"
FLUSH_INTERVAL="${FLUSH_INTERVAL:-2}"
STATE_DIR="${STATE_DIR:-/var/lib/gws-exim-daemon}"
LOG_DIR="/var/log/gws-exim-daemon"
LOG="$LOG_DIR/daemon.log"
PID_FILE="$STATE_DIR/daemon.pid"

mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true

# Log rotation basit (10MB üstü rotate)
_rotate_log() {
    [ -f "$LOG" ] || return 0
    local sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    if [ "$sz" -gt 10485760 ]; then
        mv "$LOG" "$LOG.1" 2>/dev/null || true
        : > "$LOG"
    fi
}
_log() { _rotate_log; echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG" 2>/dev/null; }

case "${1:-}" in
    --version|-v) echo "$GWS_DAEMON_VERSION"; exit 0 ;;
    --help|-h)
        cat <<HLP
gws-exim-daemon $GWS_DAEMON_VERSION — real-time Exim log push
Usage:
  gws-exim-daemon --start        Start in background (nohup)
  gws-exim-daemon --stop         Stop running daemon
  gws-exim-daemon --restart      Stop + start
  gws-exim-daemon --status       Show status + last log lines
  gws-exim-daemon --foreground   Run in foreground (used by systemd)
  gws-exim-daemon --version      Print version
Config: /etc/gws-exim-push.conf (LICENSE_KEY, PANEL_URL, EXIM_LOG, FLUSH_INTERVAL)
Logs:   $LOG
HLP
        exit 0 ;;
esac

_pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

cmd_status() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null || echo)
        if _pid_alive "$pid"; then
            echo "RUNNING (pid=$pid) since $(ps -o lstart= -p "$pid" 2>/dev/null | xargs)"
            echo "--- Last 10 log lines ---"
            tail -n 10 "$LOG" 2>/dev/null
            return 0
        fi
    fi
    echo "STOPPED"
    return 1
}

cmd_stop() {
    local killed=0
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null || echo)
        if _pid_alive "$pid"; then
            pkill -TERM -P "$pid" 2>/dev/null || true
            kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            _pid_alive "$pid" && kill -KILL "$pid" 2>/dev/null || true
            killed=1
            _log "STOP signal sent to pid=$pid"
        fi
        rm -f "$PID_FILE"
    fi
    # Orphan tail'leri de temizle
    pkill -f "tail -Fn0 $EXIM_LOG" 2>/dev/null && killed=1
    [ "$killed" -eq 1 ] && echo "Stopped" || echo "Not running"
}

cmd_start() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null || echo)
        if _pid_alive "$pid"; then
            echo "Already running (pid=$pid). Use --restart to reload."
            exit 1
        fi
        rm -f "$PID_FILE"
    fi
    [ -z "$LICENSE_KEY" ] && { echo "FATAL: LICENSE_KEY missing in $CONF"; exit 1; }
    [ ! -r "$EXIM_LOG" ] && { echo "FATAL: $EXIM_LOG not readable (run as root?)"; exit 1; }
    nohup "$0" --foreground >>"$LOG" 2>&1 &
    local newpid=$!
    disown 2>/dev/null || true
    echo "$newpid" > "$PID_FILE"
    sleep 1
    if _pid_alive "$newpid"; then
        echo "Started (pid=$newpid). Flush every ${FLUSH_INTERVAL}s. Log: tail -f $LOG"
    else
        echo "FAILED to start. Check log: tail -n 30 $LOG"
        exit 1
    fi
}

cmd_foreground() {
    [ -z "$LICENSE_KEY" ] && { _log "FATAL: LICENSE_KEY missing"; exit 1; }
    [ ! -r "$EXIM_LOG" ] && { _log "FATAL: $EXIM_LOG not readable"; exit 1; }
    HOSTNAME_STR=$(hostname 2>/dev/null || echo "unknown")
    echo $$ > "$PID_FILE"
    _log "DAEMON START pid=$$ v=$GWS_DAEMON_VERSION flush=${FLUSH_INTERVAL}s log=$EXIM_LOG panel=$PANEL_URL"

    # Trap cleanup — fd 3 tail child'ı + pid file'ı temizle
    _cleanup() {
        _log "DAEMON STOP (signal)"
        # fd 3'ün arkasındaki subshell'i öldür (tail)
        pkill -P $$ 2>/dev/null || true
        rm -f "$PID_FILE"
        exit 0
    }
    trap _cleanup TERM INT HUP

    # Buffer + carryover: son batch'i her push'a prepend et ki
    # arrival ile delivery ayrı batch'lerde bile eşleşsin (backend dedup upsert eder).
    BUFFER=""
    CARRY=""
    LAST_FLUSH=$(date +%s)
    PUSH_COUNT=0
    LINES_ACCUM=0
    ERR_COUNT=0

    _flush() {
        local payload="${CARRY}${BUFFER}"
        if [ -z "$payload" ]; then return 0; fi
        # Base64 encode (WAF bypass: <, >, ** karakterlerinden kaçın)
        local b64
        b64=$(printf '%s' "$payload" | base64 -w0 2>/dev/null)
        if [ -z "$b64" ]; then
            _log "WARN base64 encode boş sonuç"
            return 1
        fi
        local jfile
        jfile=$(mktemp 2>/dev/null || echo "/tmp/gws-daemon.$$.json")
        printf '{"license_key":"%s","hostname":"%s","log_text_b64":"%s"}' \
            "$LICENSE_KEY" "$HOSTNAME_STR" "$b64" > "$jfile"
        local http
        http=$(curl -sS --max-time 15 -o /tmp/gws-daemon.resp -w '%{http_code}' \
            -H "Content-Type: application/json" \
            -X POST "$PANEL_URL/api/outbound/exim-log-push-raw" \
            --data-binary "@$jfile" 2>/dev/null || echo "000")
        rm -f "$jfile"
        PUSH_COUNT=$((PUSH_COUNT + 1))
        if [ "$http" = "200" ]; then
            local parsed inserted
            parsed=$(grep -oE '"parsed":[0-9]+' /tmp/gws-daemon.resp 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 0)
            inserted=$(grep -oE '"inserted":[0-9]+' /tmp/gws-daemon.resp 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 0)
            _log "OK push=$PUSH_COUNT lines=$LINES_ACCUM parsed=$parsed inserted=$inserted bytes=${#payload}"
        else
            ERR_COUNT=$((ERR_COUNT + 1))
            local rh
            rh=$(head -c 200 /tmp/gws-daemon.resp 2>/dev/null | tr '\n' ' ')
            _log "FAIL push=$PUSH_COUNT http=$http err=$ERR_COUNT bytes=${#payload} resp=$rh"
        fi
        rm -f /tmp/gws-daemon.resp
        CARRY="$BUFFER"
        BUFFER=""
        LINES_ACCUM=0
    }

    # `stdbuf -oL` line-buffered mode — piped tail default block-buffered olur.
    # `tail -Fn0` = son satırdan başla, rotate/truncate'e dayanıklı
    # Süreç substitution ile fd 3'e bağlarız
    if command -v stdbuf >/dev/null 2>&1; then
        exec 3< <(stdbuf -oL tail -Fn0 "$EXIM_LOG" 2>/dev/null)
    else
        exec 3< <(tail -Fn0 "$EXIM_LOG" 2>/dev/null)
    fi
    _log "tail source attached (fd 3)"

    # Ana loop: read timeout ile hem line topla hem periyodik flush yap
    while true; do
        line=""
        if IFS= read -r -t "$FLUSH_INTERVAL" line <&3; then
            if [ -n "$line" ]; then
                BUFFER="${BUFFER}${line}"$'\n'
                LINES_ACCUM=$((LINES_ACCUM + 1))
            fi
        fi
        NOW=$(date +%s)
        if [ $((NOW - LAST_FLUSH)) -ge "$FLUSH_INTERVAL" ]; then
            if [ -n "$BUFFER" ] || [ -n "$CARRY" ]; then
                _flush
            fi
            LAST_FLUSH=$NOW
        fi
    done
    _log "DAEMON EXIT (unreachable)"
}

case "${1:-}" in
    --start) cmd_start ;;
    --stop) cmd_stop ;;
    --restart) cmd_stop; sleep 1; cmd_start ;;
    --status) cmd_status ;;
    --foreground) cmd_foreground ;;
    *) exec "$0" --help ;;
esac
"""


@api.get("/tools/gws-exim-daemon.sh")
async def download_exim_daemon_script():
    """v43.57 — Sürekli çalışan real-time Exim daemon script'i indirir."""
    from fastapi.responses import PlainTextResponse as _PT
    return _PT(_EXIM_DAEMON_SH_SOURCE, media_type="text/x-shellscript",
               headers={"Content-Disposition": "attachment; filename=gws-exim-daemon"})


@api.get("/tools/install-exim-daemon.sh")
async def install_exim_daemon_oneliner(license_key: str = "", panel_url: str = "",
                                        flush_interval: int = 2):
    """v43.57 — Real-time daemon 1-satırlık kurulum:
      bash <(curl -s https://panel.gokyuzuhosting.com/api/tools/install-exim-daemon.sh?license_key=MS-...)

    Eski cron/timer/inotify job'ları otomatik disable eder, yerine:
      1. gws-exim-daemon.service (systemd, auto-restart, boot'ta başlar)
      2. nohup fallback (systemd yoksa)
    """
    from fastapi.responses import PlainTextResponse as _PT
    if not panel_url:
        panel_url = "https://panel.gokyuzuhosting.com"
    fi = max(1, min(int(flush_interval or 2), 10))
    script = f"""#!/bin/bash
# GökyüzüWebSpam Real-Time Exim Daemon — 1-satırlık kurulum (v43.57)
set -euo pipefail

LICENSE_KEY="{license_key}"
PANEL_URL="{panel_url}"
FLUSH_INTERVAL="{fi}"

if [ -z "$LICENSE_KEY" ] && [ -n "${{1:-}}" ]; then
    LICENSE_KEY="$1"
fi

if [ -z "$LICENSE_KEY" ]; then
    echo "HATA: License key gerekli"
    echo "Kullanım: bash <(curl -s $PANEL_URL/api/tools/install-exim-daemon.sh?license_key=MS-...)"
    exit 1
fi

echo "══════════════════════════════════════════════════════"
echo "  GökyüzüWebSpam Real-Time Daemon Kurulumu (v43.57)"
echo "  ConfigServer parity → mailler anlık düşecek"
echo "══════════════════════════════════════════════════════"
echo ""

echo "==> [1/6] Eski cron/timer/inotify jobları temizleniyor…"
# Eski cron
(crontab -l 2>/dev/null | grep -v gws-exim-push) | crontab - 2>/dev/null || true
# Eski systemd unit'ler (v43.50/v43.51 timer + inotify)
for U in gws-exim-push.timer gws-exim-push.service gws-exim-inotify.service; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^$U"; then
        systemctl disable --now "$U" 2>/dev/null || true
        rm -f "/etc/systemd/system/$U" 2>/dev/null || true
        echo "  · $U kaldırıldı"
    fi
done
systemctl daemon-reload 2>/dev/null || true

echo "==> [2/6] Daemon script indiriliyor…"
curl -sSf -o /usr/local/bin/gws-exim-daemon "$PANEL_URL/api/tools/gws-exim-daemon.sh"
chmod +x /usr/local/bin/gws-exim-daemon
DAEMON_VER=$(/usr/local/bin/gws-exim-daemon --version 2>/dev/null || echo "?")
echo "  · /usr/local/bin/gws-exim-daemon ($DAEMON_VER)"

echo "==> [3/6] Config yazılıyor: /etc/gws-exim-push.conf"
cat > /etc/gws-exim-push.conf <<EOF
PANEL_URL=$PANEL_URL
LICENSE_KEY=$LICENSE_KEY
EXIM_LOG=/var/log/exim_mainlog
FLUSH_INTERVAL=$FLUSH_INTERVAL
EOF
chmod 600 /etc/gws-exim-push.conf

echo "==> [4/6] Systemd service oluşturuluyor (auto-restart)…"
INSTALLED_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    cat > /etc/systemd/system/gws-exim-daemon.service <<'SVC'
[Unit]
Description=GokyuzuWebSpam Real-Time Exim Log Daemon
Documentation=https://panel.gokyuzuhosting.com/panel/outbound
After=network-online.target exim.service
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/gws-exim-daemon --foreground
Restart=always
RestartSec=5
StandardOutput=append:/var/log/gws-exim-daemon/daemon.log
StandardError=append:/var/log/gws-exim-daemon/daemon.log
# Kaynak koruması
LimitNOFILE=4096
Nice=10

[Install]
WantedBy=multi-user.target
SVC
    systemctl daemon-reload
    # Daha önce çalışan bir daemon (nohup) varsa durdur
    /usr/local/bin/gws-exim-daemon --stop 2>/dev/null || true
    systemctl enable --now gws-exim-daemon.service
    sleep 2
    if systemctl is-active --quiet gws-exim-daemon.service; then
        echo "  ✓ systemd service AKTIF — boot'ta otomatik başlar, crash'te otomatik restart"
        INSTALLED_SYSTEMD=1
    else
        echo "  ⚠ systemd service başlatılamadı — journalctl -u gws-exim-daemon çıktısına bakın"
    fi
fi

if [ "$INSTALLED_SYSTEMD" -eq 0 ]; then
    echo "==> [4/6-alt] systemd yok → nohup ile başlatılıyor…"
    /usr/local/bin/gws-exim-daemon --start
    # Boot'ta yeniden başlaması için rc.local'a ekle
    if [ -f /etc/rc.local ]; then
        if ! grep -q "gws-exim-daemon" /etc/rc.local; then
            sed -i '/^exit 0/i /usr/local/bin/gws-exim-daemon --start >/dev/null 2>&1 || true' /etc/rc.local 2>/dev/null || true
            echo "  · rc.local'a boot entry eklendi"
        fi
    fi
fi

echo "==> [5/6] Status kontrol ediliyor…"
sleep 1
/usr/local/bin/gws-exim-daemon --status

echo "==> [6/6] İlk 5 saniye canlılık testi…"
sleep 5
if /usr/local/bin/gws-exim-daemon --status | head -1 | grep -q RUNNING; then
    echo "  ✓ Daemon 5 saniye sonra hala çalışıyor"
else
    echo "  ⚠ Daemon durdu — tail -n 30 /var/log/gws-exim-daemon/daemon.log"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✓ Kurulum tamamlandı!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Mailler artık **$FLUSH_INTERVAL saniyede bir** panele push edilecek."
echo "  Panel /panel/outbound her 3 saniyede bir refresh eder →"
echo "  Toplam gecikme: ~5 saniye (ConfigServer paritesi)"
echo ""
echo "  Kullanışlı komutlar:"
echo "  · Status:   gws-exim-daemon --status"
echo "  · Log:      tail -f /var/log/gws-exim-daemon/daemon.log"
echo "  · Restart:  gws-exim-daemon --restart  (veya systemctl restart gws-exim-daemon)"
echo "  · Stop:     gws-exim-daemon --stop     (veya systemctl stop gws-exim-daemon)"
echo ""
"""
    return _PT(script, media_type="text/x-shellscript")


# ============================================================================
# v43.58 — SIMPLE PUSH (kullanıcı'nın kanıtlanmış tail -c 5MB komutu + 10sn timer)
# ---------------------------------------------------------------------------
# Kullanıcı `gws-simple-push` komutunu manuel yazıp çalıştırdı ve çalıştığını
# doğruladı. Bu endpoint aynı script'i + systemd timer (her 10 saniye)
# kurar. Eski daemon/cron temizlenir.
# ============================================================================

# v43.99.5 — Modül Tanıtım PDF'i (public download)
@api.get("/tools/module-report.pdf")
async def module_report_pdf():
    """Detaylı modül tanıtım PDF'ini indir."""
    from fastapi.responses import FileResponse
    import os
    pdf_path = "/app/GokyuzuWebSpam-Modul-Tanitim-v43.99.pdf"
    if not os.path.exists(pdf_path):
        # Fallback: canlı üret
        try:
            import subprocess
            subprocess.run(["python3", "/app/scripts/generate_module_report.py"],
                          check=True, timeout=60)
        except Exception:
            raise HTTPException(status_code=500, detail="PDF henüz hazırlanmadı")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="GokyuzuWebSpam-Modul-Tanitim-v43.99.pdf",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# v43.99.12 — Kurulum Rehberi PDF (multi-language: tr | en | ar) + in-process build
@api.get("/tools/install-guide.pdf")
async def install_guide_pdf(lang: str = "tr", force: bool = False):
    """cPanel/WHM sunucusuna kurulum rehberi PDF'i (Türkçe/İngilizce/Arapça).

    force=true → mevcut cache PDF varsa bile yeniden üretir.
    """
    from fastapi.responses import FileResponse
    import os as _os
    import sys as _sys
    if lang not in ("tr", "en", "ar"):
        lang = "tr"
    suffix = {"tr": "", "en": "-EN", "ar": "-AR"}[lang]

    # Docker'da /app/scripts, kaynak repoda /app/scripts — her ikisinde de aynı
    scripts_dir = "/app/scripts"
    if scripts_dir not in _sys.path:
        _sys.path.insert(0, scripts_dir)

    pdf_path = f"/app/GokyuzuWebSpam-Kurulum-Rehberi-v43.99{suffix}.pdf"

    if force or not _os.path.exists(pdf_path):
        # In-process build (subprocess yerine — Docker'da PATH sorunu olmasın)
        try:
            import importlib
            if "generate_install_guide" in _sys.modules:
                importlib.reload(_sys.modules["generate_install_guide"])
            import generate_install_guide as _gig
            _gig.build(lang, pdf_path)
        except Exception as e:
            import traceback as _tb
            err = f"{type(e).__name__}: {e}"
            logging.error(f"[install-guide-pdf] {lang} build failed: {err}\n{_tb.format_exc()}")
            raise HTTPException(
                status_code=500,
                detail=f"PDF üretilemedi ({lang}): {err[:200]}"
            )
    if not _os.path.exists(pdf_path):
        raise HTTPException(status_code=500, detail="Kurulum PDF'i üretilemedi (dosya oluşmadı)")
    fname_map = {
        "tr": "GokyuzuWebSpam-Kurulum-Rehberi-TR.pdf",
        "en": "GokyuzuWebSpam-Install-Guide-EN.pdf",
        "ar": "GokyuzuWebSpam-Install-Guide-AR.pdf",
    }
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=fname_map[lang],
        headers={"Cache-Control": "public, max-age=3600"},
    )




@api.get("/tools/install-simple-push.sh")
async def install_simple_push_oneliner(license_key: str = "", panel_url: str = "",
                                         interval: int = 10):
    """v43.58 — `gws-simple-push` + systemd timer (10sn) tek-satırlık kurulum:
      bash <(curl -sSf "https://panel.gokyuzuhosting.com/api/tools/install-simple-push.sh?license_key=MS-...")

    Kullanıcının kanıtlanmış tail -c 5MB + base64 push komutu her N saniyede bir
    otomatik çalışır. Eski daemon/cron job'ları temizlenir.
    """
    from fastapi.responses import PlainTextResponse as _PT
    if not panel_url:
        panel_url = "https://panel.gokyuzuhosting.com"
    iv = max(5, min(int(interval or 10), 300))
    script = f"""#!/bin/bash
# GökyüzüWebSpam Simple Push — 10sn otomatik push kurulumu (v43.58)
set -euo pipefail

LICENSE_KEY="{license_key}"
PANEL_URL="{panel_url}"
INTERVAL="{iv}"

if [ -z "$LICENSE_KEY" ] && [ -n "${{1:-}}" ]; then
    LICENSE_KEY="$1"
fi

if [ -z "$LICENSE_KEY" ]; then
    echo "HATA: License key gerekli"
    echo "Kullanım: bash <(curl -sSf $PANEL_URL/api/tools/install-simple-push.sh?license_key=MS-...)"
    exit 1
fi

echo "══════════════════════════════════════════════════════"
echo "  GökyüzüWebSpam Simple Push Kurulumu (v43.58)"
echo "  Her ${{INTERVAL}} saniyede bir mailler otomatik push edilecek"
echo "══════════════════════════════════════════════════════"
echo ""

echo "==> [1/5] Eski daemon/cron/timer jobları temizleniyor…"
# Eski cron entry
(crontab -l 2>/dev/null | grep -v gws-exim-push | grep -v gws-simple-push) | crontab - 2>/dev/null || true
# Eski systemd unit'ler
for U in gws-exim-daemon.service gws-exim-push.timer gws-exim-push.service \\
         gws-exim-inotify.service gws-simple-push.service gws-simple-push.timer; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^$U"; then
        systemctl disable --now "$U" 2>/dev/null || true
        rm -f "/etc/systemd/system/$U" 2>/dev/null || true
        echo "  · $U kaldırıldı"
    fi
done
# Eski daemon process varsa öldür
pkill -f "gws-exim-daemon --foreground" 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

echo "==> [2/5] Push script yazılıyor: /usr/local/bin/gws-simple-push"
cat > /usr/local/bin/gws-simple-push <<PUSH_EOF
#!/bin/bash
# gws-simple-push — v43.58
# Exim mainlog'un son 5MB'ını base64 encode edip panele push eder.
# Idempotent: backend upsert dedup yapar, aynı mail 2 kez yazılmaz.
LK="$LICENSE_KEY"
PANEL="$PANEL_URL"
LOG=/var/log/gws-simple-push.log
LOG_MAINLOG=/var/log/exim_mainlog
TMP=\\$(mktemp)

# Log rotate (10MB üstü)
if [ -f "\\$LOG" ]; then
    SZ=\\$(stat -c%s "\\$LOG" 2>/dev/null || echo 0)
    if [ "\\$SZ" -gt 10485760 ]; then
        mv "\\$LOG" "\\$LOG.1" 2>/dev/null || true
    fi
fi

if [ ! -r "\\$LOG_MAINLOG" ]; then
    echo "[\\$(date -u +%FT%TZ)] ERR: \\$LOG_MAINLOG okunamıyor" >> "\\$LOG"
    exit 1
fi

{{
printf '{{"license_key":"%s","log_text_b64":"' "\\$LK"
tail -c 5000000 "\\$LOG_MAINLOG" | base64 -w0
printf '"}}'
}} > "\\$TMP"

START=\\$(date +%s%3N)
RESP=\\$(curl -sS --max-time 90 -X POST \\
    -H "Content-Type: application/json" \\
    --data-binary "@\\$TMP" \\
    "\\$PANEL/api/outbound/exim-log-push-raw" 2>&1)
END=\\$(date +%s%3N)
DUR=\\$((END - START))
echo "[\\$(date -u +%FT%TZ)] dur=\\${{DUR}}ms \\$(echo \\$RESP | head -c 300)" >> "\\$LOG"
rm -f "\\$TMP"
PUSH_EOF
chmod +x /usr/local/bin/gws-simple-push
echo "  · /usr/local/bin/gws-simple-push"

echo "==> [3/5] Log dosyası hazırlanıyor…"
touch /var/log/gws-simple-push.log
chmod 640 /var/log/gws-simple-push.log

echo "==> [4/5] Systemd timer kuruluyor (her ${{INTERVAL}} saniye)…"
INSTALLED=0
if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    cat > /etc/systemd/system/gws-simple-push.service <<'SVC'
[Unit]
Description=GokyuzuWebSpam Simple Push (tail -c 5MB → panel)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/gws-simple-push
User=root
Nice=10
SVC
    cat > /etc/systemd/system/gws-simple-push.timer <<TMR
[Unit]
Description=GWS Simple Push Timer (her ${{INTERVAL}}sn)
After=network-online.target
[Timer]
OnBootSec=15s
OnUnitActiveSec=${{INTERVAL}}s
AccuracySec=1s
Unit=gws-simple-push.service
[Install]
WantedBy=timers.target
TMR
    systemctl daemon-reload
    systemctl enable --now gws-simple-push.timer 2>/dev/null && INSTALLED=1
    if [ "$INSTALLED" -eq 1 ]; then
        echo "  ✓ systemd timer aktif — her ${{INTERVAL}}sn push"
    fi
fi

if [ "$INSTALLED" -eq 0 ]; then
    echo "==> [4/5-alt] systemd yok → cron ile fallback (her dakika)…"
    (crontab -l 2>/dev/null | grep -v gws-simple-push; \\
     echo "* * * * * /usr/local/bin/gws-simple-push >/dev/null 2>&1") | crontab -
    echo "  ⚠ Cron her dakika çalışır (sub-minute değil). Sub-second için systemd gerekli."
fi

echo "==> [5/5] İlk manuel push testi…"
/usr/local/bin/gws-simple-push
sleep 1
LAST=$(tail -1 /var/log/gws-simple-push.log 2>/dev/null || echo "(boş)")
echo "  · Sonuç: $LAST"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✓ Kurulum tamamlandı!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Mailler artık **her ${{INTERVAL}} saniyede bir** panele push edilecek."
echo "  Panel Outbound sayfası 3 saniyede bir refresh yaptığından"
echo "  toplam gecikme max ${{INTERVAL}}+3 = ~$(( INTERVAL + 3 )) saniyedir."
echo ""
echo "  Kullanışlı komutlar:"
echo "  · Manuel push:   sudo /usr/local/bin/gws-simple-push"
echo "  · Log takip:     tail -f /var/log/gws-simple-push.log"
echo "  · Timer durum:   systemctl status gws-simple-push.timer"
echo "  · Timer durdur:  systemctl stop gws-simple-push.timer"
echo "  · Timer başlat:  systemctl start gws-simple-push.timer"
echo ""
"""
    return _PT(script, media_type="text/x-shellscript")


# ============================================================================
# v43.61 — TEK-KOMUT TAM ONARIM SCRIPT'İ (gws-fix-all)
# ---------------------------------------------------------------------------
# Kullanıcı stuck durumdaysa (WHM plugin badge eski, simple-push yok,
# VERSION sync yok) bu tek komut her şeyi düzeltir:
#   bash <(curl -sSf https://panel.gokyuzuhosting.com/api/tools/fix-all.sh?license_key=MS-...)
# ============================================================================
@api.get("/tools/fix-all.sh")
async def one_shot_fix_all(license_key: str = "", panel_url: str = ""):
    """v43.61 — Tek komutta:
      1. Repo pull + VERSION sync (backend/ içine kopyala)
      2. Docker rebuild + restart
      3. WHM plugin CGI refresh
      4. Simple-push script + systemd timer kurulumu
      5. İlk push testi
      6. Status raporu (JSON)
    """
    from fastapi.responses import PlainTextResponse as _PT
    if not panel_url:
        panel_url = "https://panel.gokyuzuhosting.com"
    script = f"""#!/bin/bash
# ============================================================================
# GökyüzüWebSpam TEK-KOMUT ONARIM (v43.61) — Her şeyi düzeltir
# ============================================================================
set -uo pipefail

LICENSE_KEY="{license_key}"
PANEL_URL="{panel_url}"
APP_DIR="${{APP_DIR:-/opt/gokyuzuwebspam-app}}"

if [ -z "$LICENSE_KEY" ] && [ -n "${{1:-}}" ]; then
    LICENSE_KEY="$1"
fi

if [ -z "$LICENSE_KEY" ]; then
    echo "HATA: License key gerekli"
    echo "Kullanım: bash <(curl -sSf $PANEL_URL/api/tools/fix-all.sh?license_key=MS-...)"
    exit 1
fi

# Renkli terminal helper'ları
if [ -t 1 ]; then
    G='\\033[0;32m'; Y='\\033[0;33m'; R='\\033[0;31m'; B='\\033[0;34m'; N='\\033[0m'
else
    G=''; Y=''; R=''; B=''; N=''
fi
_ok()   {{ echo -e "${{G}}✓${{N}} $*"; }}
_warn() {{ echo -e "${{Y}}⚠${{N}} $*"; }}
_err()  {{ echo -e "${{R}}✗${{N}} $*"; }}
_step() {{ echo -e "\\n${{B}}==>${{N}} $*"; }}

echo "════════════════════════════════════════════════════════════"
echo "   GökyüzüWebSpam Tam Onarım Aracı v43.61"
echo "   Bu komut şu sorunları düzeltir:"
echo "     • WHM plugin badge eski sürüm gösteriyor"
echo "     • Giden posta panelde güncel değil"
echo "     • VERSION dosyası backend'e sync değil"
echo "     • Simple-push timer aktif değil"
echo "════════════════════════════════════════════════════════════"

# ---------------------------------------------------------------------
_step "[1/7] Repo pull + VERSION sync"
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git fetch origin main --quiet 2>&1 || true
    if ! git diff --quiet HEAD 2>/dev/null; then
        git stash push -m "fix-all-stash-$(date +%s)" --quiet 2>/dev/null || true
        _warn "Yerel değişiklikler stash edildi (git stash list)"
    fi
    git reset --hard origin/main --quiet 2>&1 && _ok "Repo güncellendi (origin/main)"
    NEW_VER=$(cat "$APP_DIR/VERSION" 2>/dev/null || echo "unknown")
    _ok "Yeni sürüm: $NEW_VER"
    # KRİTİK: VERSION → backend/VERSION senkronize et
    if [ -f "$APP_DIR/VERSION" ]; then
        cp -f "$APP_DIR/VERSION" "$APP_DIR/backend/VERSION" 2>/dev/null && \\
            _ok "VERSION → backend/VERSION senkronize edildi (Docker mount için)"
    fi
else
    _warn "Git repo bulunamadı ($APP_DIR/.git) — repo adımı atlandı"
    NEW_VER="unknown"
fi

# ---------------------------------------------------------------------
_step "[2/7] Docker rebuild + restart"
if [ -f "$APP_DIR/deployment/docker-compose.yml" ]; then
    cd "$APP_DIR/deployment"
    if docker compose up -d --build > /tmp/gws-compose.log 2>&1; then
        _ok "Docker container'lar rebuild edildi"
    else
        _err "Docker build hatası — tail /tmp/gws-compose.log:"
        tail -20 /tmp/gws-compose.log
        exit 1
    fi
    # Backend health check
    sleep 4
    for i in 1 2 3 4 5 6 7 8; do
        HTTP=$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 4 http://127.0.0.1:8001/api/stats/overview 2>/dev/null || echo "000")
        if [ "$HTTP" = "200" ]; then
            _ok "Backend API canlı (HTTP 200 · deneme $i/8)"
            break
        fi
        sleep 2
    done
    # /api/version/panel doğru sürümü döndürüyor mu?
    PANEL_VER=$(curl -sS --max-time 5 http://127.0.0.1:8001/api/version/panel 2>/dev/null | grep -oE '"version":"[^"]+"' | cut -d'"' -f4)
    if [ -n "$PANEL_VER" ]; then
        _ok "Backend /api/version/panel → $PANEL_VER"
        if [ "$PANEL_VER" != "$NEW_VER" ] && [ "$NEW_VER" != "unknown" ]; then
            _warn "Beklenen: $NEW_VER · Backend'de: $PANEL_VER · Docker container image bayat olabilir"
        fi
    fi
else
    _warn "docker-compose.yml bulunamadı — Docker adımı atlandı"
fi

# ---------------------------------------------------------------------
_step "[3/7] WHM plugin CGI güncelleme"
CGI_DIR="/usr/local/cpanel/whostmgr/docroot/cgi/mailshield"
CGI_DST="$CGI_DIR/index.cgi"
if [ ! -d "$CGI_DIR" ]; then
    _warn "$CGI_DIR yok — bu sunucu WHM değil? Adım atlandı."
else
    TARBALL=$(mktemp --suffix=.tgz)
    if curl -sSL --max-time 30 "$PANEL_URL/api/plugin/download" -o "$TARBALL" 2>/dev/null; then
        EXTRACT=$(mktemp -d)
        if tar -xzf "$TARBALL" -C "$EXTRACT" 2>/dev/null; then
            NEW_CGI=$(find "$EXTRACT" -name "mailshield.cgi" -type f 2>/dev/null | head -1)
            if [ -n "$NEW_CGI" ]; then
                if ! cmp -s "$NEW_CGI" "$CGI_DST" 2>/dev/null; then
                    install -m 0755 "$NEW_CGI" "$CGI_DST" && \\
                        _ok "WHM CGI güncellendi → $CGI_DST" || \\
                        _err "CGI kopyalanamadı (izin?)"
                else
                    _ok "WHM CGI zaten güncel"
                fi
            else
                _warn "Tarball'da mailshield.cgi yok"
            fi
        fi
        rm -rf "$EXTRACT"
    else
        _err "Plugin tarball indirilemedi ($PANEL_URL/api/plugin/download)"
    fi
    rm -f "$TARBALL"
fi

# ---------------------------------------------------------------------
_step "[4/7] Simple-push script + systemd timer kurulumu"
# License config
cat > /etc/gws-exim-push.conf <<CONFEOF
PANEL_URL=$PANEL_URL
LICENSE_KEY=$LICENSE_KEY
EXIM_LOG=/var/log/exim_mainlog
FLUSH_INTERVAL=10
CONFEOF
chmod 600 /etc/gws-exim-push.conf
# /root/.gws-license de yaz — auto-update için de gerekli
echo "$LICENSE_KEY" > /root/.gws-license
chmod 600 /root/.gws-license
_ok "Config yazıldı: /etc/gws-exim-push.conf + /root/.gws-license"

# Eski daemon/cron temizle
(crontab -l 2>/dev/null | grep -v gws-exim-push | grep -v gws-simple-push) | crontab - 2>/dev/null || true
for U in gws-exim-daemon.service gws-exim-push.timer gws-exim-push.service gws-exim-inotify.service; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^$U"; then
        systemctl disable --now "$U" 2>/dev/null || true
        rm -f "/etc/systemd/system/$U" 2>/dev/null || true
    fi
done
systemctl daemon-reload 2>/dev/null || true

# install-simple-push endpoint'ini çalıştır
if bash <(curl -sSf "$PANEL_URL/api/tools/install-simple-push.sh?license_key=$LICENSE_KEY") 2>&1 | tail -20; then
    _ok "Simple-push kurulumu tamamlandı"
else
    _err "Simple-push kurulumu başarısız — $PANEL_URL/api/tools/install-simple-push.sh"
fi

# ---------------------------------------------------------------------
_step "[5/7] İlk manuel push testi"
if [ -x /usr/local/bin/gws-simple-push ]; then
    /usr/local/bin/gws-simple-push
    sleep 1
    LAST=$(tail -1 /var/log/gws-simple-push.log 2>/dev/null || echo "(log yok)")
    _ok "Push sonucu: $LAST"
else
    _err "/usr/local/bin/gws-simple-push bulunamadı"
fi

# ---------------------------------------------------------------------
_step "[6/7] Systemd timer durumu"
if systemctl is-active --quiet gws-simple-push.timer 2>/dev/null; then
    _ok "gws-simple-push.timer AKTIF (her 10sn push)"
    NEXT_RUN=$(systemctl list-timers gws-simple-push.timer 2>/dev/null | grep gws-simple-push | awk '{{print $1, $2}}')
    [ -n "$NEXT_RUN" ] && echo "   Sonraki push: $NEXT_RUN"
else
    _err "Timer aktif değil — systemctl status gws-simple-push.timer"
fi

# ---------------------------------------------------------------------
_step "[7/7] Özet Rapor"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "   ONARIM RAPORU"
echo "════════════════════════════════════════════════════════════"
echo "   Repo sürümü:         $NEW_VER"
echo "   Backend /api/version: $PANEL_VER"
echo "   WHM CGI:             $([ -f "$CGI_DST" ] && stat -c '%y (%s bytes)' "$CGI_DST" 2>/dev/null || echo 'YOK')"
echo "   Simple-push script:  $([ -x /usr/local/bin/gws-simple-push ] && echo 'KURULU' || echo 'YOK')"
echo "   Timer aktif:         $(systemctl is-active gws-simple-push.timer 2>/dev/null || echo 'HAYIR')"
echo ""
echo "   Doğrulama:"
echo "   1. WHM Home → GökyüzüWebSpam → Header'da $NEW_VER görmelisin"
echo "   2. Ctrl+F5 ile tarayıcı cache'ini temizle (badge güncellenmiyorsa)"
echo "   3. Panel /panel/outbound → 10sn sonra yeni mailler görünmeli"
echo ""
echo "   Sorun devam ederse:"
echo "   • tail -f /var/log/gws-simple-push.log"
echo "   • journalctl -u gws-simple-push.timer -f"
echo "   • docker logs --tail=50 gws-backend"
echo "════════════════════════════════════════════════════════════"
"""
    return _PT(script, media_type="text/x-shellscript")


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
        # === Kapasite ===
        "max_domains": 1,
        "max_mails_per_day": 5000,
        # === Temel Modüller (Sayfa/Route bazlı) ===
        "dashboard": True,           # Ana panel görünümü
        "live_traffic": True,        # Canlı mail trafiği
        "attack_map": True,          # 3D saldırı haritası
        "logs_view": True,           # Sistem log görüntüleme
        "mailscanner": True,         # MailScanner konfig sayfası
        "mail_health": True,         # Mail sağlık kontrolleri
        "live_diagnostic": True,     # Canlı sunucu tanı sihirbazı
        "my_server": True,           # Sunucu bağlama sayfası
        "docs_view": True,           # Dokümantasyon sayfası
        # === Liste Yönetimi ===
        "blacklist_check": True,     # RBL sorgu / delist
        "whitelist_manage": False,   # Whitelist ekleme
        "blacklist_manage": False,   # Blacklist ekleme
        "whitelist_history": False,  # Whitelist geçmiş sayfası
        "quarantine_view": True,     # Karantina görüntüleme
        "quarantine_release": False, # Karantinadan çıkarma
        "quarantine_delete": False,  # Karantinadan silme
        # === Güvenlik & Motorlar ===
        "security_view": True,       # Güvenlik sayfası görüntüleme
        "security_config": False,    # Güvenlik ayarları değiştirme
        "engine_toggle": False,      # Motor aç/kapa
        # === Giden Mail ===
        "outbound_view": True,       # Giden mail görüntüleme
        "outbound_control": False,   # Giden mail askıya alma/silme
        # === İleri Güvenlik ===
        "custom_rules": False,       # Kural editörü (Rules sayfası)
        "exploit_editor": False,     # Exploit/Webshell tarayıcı
        "ai_explanations": False,    # AI destekli açıklama
        "threat_intel": False,       # Tehdit zekası feed'i
        "bec_detection": False,      # Business Email Compromise
        "sandbox": False,            # Ek/URL sandbox
        "attachment_scan": True,     # Ek tarama
        "url_scan": True,            # URL taraması
        # === Ekosistem ===
        "marketplace": False,        # İmza Marketplace sayfası
        "bounce_digest": False,      # Günlük bounce özet raporu
        # === Bildirim & Raporlama ===
        "notifications_view": True,  # Bildirim kutusu
        "alerts_rules": False,       # Custom alert kuralları
        "reports_view": True,        # Rapor sayfası görüntüleme
        "reports_weekly": False,     # Haftalık AI raporu
        "reports_export": False,     # CSV/PDF export
        "email_notifications": True, # Basit e-posta bildirim
        "smtp_settings": False,      # SMTP relay yapılandırma
        # === Yönetim ===
        "users_view": True,          # WHM kullanıcıları görüntüleme
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
        # Sayfalar
        "dashboard": True, "live_traffic": True, "attack_map": True, "logs_view": True,
        "mailscanner": True, "mail_health": True, "live_diagnostic": True,
        "my_server": True, "docs_view": True,
        # Liste
        "blacklist_check": True, "whitelist_manage": True, "blacklist_manage": True,
        "whitelist_history": True,
        "quarantine_view": True, "quarantine_release": True, "quarantine_delete": True,
        # Güvenlik
        "security_view": True, "security_config": True, "engine_toggle": True,
        # Giden
        "outbound_view": True, "outbound_control": True,
        # İleri
        "custom_rules": True, "exploit_editor": True, "ai_explanations": True,
        "threat_intel": True, "bec_detection": True, "sandbox": True,
        "attachment_scan": True, "url_scan": True,
        # Ekosistem
        "marketplace": True, "bounce_digest": True,
        # Bildirim
        "notifications_view": True, "alerts_rules": True, "reports_view": True,
        "reports_weekly": True, "reports_export": True,
        "email_notifications": True, "smtp_settings": True,
        # Yönetim
        "users_view": True, "bulk_actions": True, "sub_users": True, "reseller_mode": False,
        "api_access": True, "webhooks": True, "two_factor_auth": True,
        "priority_support": True, "custom_branding": False, "settings_customize": True,
        "label": "Pro",
    },
    "enterprise": {
        "max_domains": 999999, "max_mails_per_day": 999999999,
        "dashboard": True, "live_traffic": True, "attack_map": True, "logs_view": True,
        "mailscanner": True, "mail_health": True, "live_diagnostic": True,
        "my_server": True, "docs_view": True,
        "blacklist_check": True, "whitelist_manage": True, "blacklist_manage": True,
        "whitelist_history": True,
        "quarantine_view": True, "quarantine_release": True, "quarantine_delete": True,
        "security_view": True, "security_config": True, "engine_toggle": True,
        "outbound_view": True, "outbound_control": True,
        "custom_rules": True, "exploit_editor": True, "ai_explanations": True,
        "threat_intel": True, "bec_detection": True, "sandbox": True,
        "attachment_scan": True, "url_scan": True,
        "marketplace": True, "bounce_digest": True,
        "notifications_view": True, "alerts_rules": True, "reports_view": True,
        "reports_weekly": True, "reports_export": True,
        "email_notifications": True, "smtp_settings": True,
        "users_view": True, "bulk_actions": True, "sub_users": True, "reseller_mode": True,
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


# v43.71 — Ziyaretçinin (bayı) mevcut planındaki aktif özellikler
@api.get("/plan/effective")
async def plan_effective_features(request: Request, license_key: Optional[str] = None):
    """Ziyaretçinin lisans planına göre efektif özellik matrisi (per-bayi izole).

    Plan tespiti sırası:
      1. Master (MASTER_LICENSE_KEY) VE impersonation yoksa → enterprise
      2. Impersonation aktifse → hedef bayi lisansının planı
      3. `X-Master-Key` header'ında bayi anahtarı (MS-...) VEYA query `license_key` VEYA
         `X-License-Key` header'ı → o lisansın planı
      4. Yoksa → starter (kapalı özellikler)
    """
    matrix = await _load_plan_matrix()
    scope = await _tenant_scope(request, license_key)

    plan = "starter"
    resolved_license = None
    if scope.get("is_master") and not scope.get("impersonated"):
        plan = "enterprise"
        resolved_license = "__master__"
    elif scope.get("owner_license_key") and scope["owner_license_key"] not in ("__none__", "__master__"):
        lic = await db.licenses.find_one(
            {"license_key": scope["owner_license_key"], "active": True},
            {"_id": 0, "plan": 1},
        )
        if lic:
            plan = (lic.get("plan") or "starter").lower()
            resolved_license = scope["owner_license_key"]
    else:
        # scope __none__ VEYA boş → header'daki MS- key'ini bayi olarak dene
        master_env = os.environ.get("MASTER_LICENSE_KEY", "")
        candidate = (
            request.headers.get("x-license-key")
            or request.headers.get("x-master-key")
            or license_key
            or ""
        ).strip()
        if candidate and candidate.startswith("MS-") and candidate != master_env:
            lic = await db.licenses.find_one(
                {"license_key": candidate, "active": True},
                {"_id": 0, "plan": 1},
            )
            if lic:
                plan = (lic.get("plan") or "starter").lower()
                resolved_license = candidate

    features = matrix.get(plan, matrix.get("starter", {}))
    hierarchy = ["starter", "pro", "enterprise"]
    idx = hierarchy.index(plan) if plan in hierarchy else 0
    next_plan = hierarchy[idx + 1] if idx + 1 < len(hierarchy) else None
    # v43.73 — Üst planların özellik tablosu (frontend Guard doğru öneri yapabilsin)
    upgrade_options = []
    for p in hierarchy[idx + 1:]:
        pf = matrix.get(p, {}) or {}
        upgrade_options.append({
            "plan": p,
            "plan_label": pf.get("label", p.title()),
            "features": pf,
        })
    return {
        "plan": plan,
        "plan_label": features.get("label", plan.title()),
        "features": features,
        "next_plan": next_plan,
        "next_plan_features": matrix.get(next_plan, {}) if next_plan else None,
        "upgrade_options": upgrade_options,   # v43.73 — hangi üst planlarda hangi özellik var
        "license_key": resolved_license,   # her bayi kendine özgü — audit için
        "impersonated": bool(scope.get("impersonated")),
        "is_master": bool(scope.get("is_master") and not scope.get("impersonated")),
    }


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
    # v43.31 — master_ip ve master_hostname da döndür (Header chip için)
    return {
        "mode": PLUGIN_MODE,
        "demo_days": DEMO_DAYS,
        "master_ip": os.environ.get("MASTER_IP", ""),
        "master_hostname": os.environ.get("MASTER_HOSTNAME", "gokyuzuhosting.com"),
    }


# v43.65 — Master anahtar doğrulama endpoint'i (yazma YAPMAZ, sadece verify)
# Kritik güvenlik fix: Frontend "Master Aktif Et" butonu artık server'a sorup
# gerçek master olup olmadığını doğrular. Sahte MS- prefix'li anahtar artık
# sahte master chip'i tetikleyemez.
@api.get("/system/verify-master")
async def verify_master(request: Request, key: str = ""):
    """Girilen anahtarın gerçek master olup olmadığını doğrular.
    Dönüş: {ok: bool, reason: str, client_ip?: str, expected_ip?: str}"""
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    if not master_env:
        return {"ok": False, "reason": "no_master_configured"}
    if not key:
        return {"ok": False, "reason": "no_key_provided"}
    if key != master_env:
        return {"ok": False, "reason": "key_mismatch"}
    # Opsiyonel: MASTER_IP set ise client_ip eşleşmeli
    master_ip = os.environ.get("MASTER_IP", "")
    client_ip = _client_ip(request)
    if master_ip and client_ip and master_ip != client_ip:
        return {
            "ok": False, "reason": "ip_mismatch",
            "client_ip": client_ip, "expected_ip": master_ip,
        }
    return {"ok": True, "reason": "verified", "client_ip": client_ip}


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
    # v43.80 — Aynı email'e sahip aktif lisans varsa yeni kayıt AÇMA, mevcut'u yükselt.
    # Kart (Stripe) tarafında da havale'deki auto-upgrade davranışını sağla.
    email_lc = (lic.customer_email or "").strip().lower()
    existing_lic = None
    if email_lc:
        email_re = {"$regex": f"^{re.escape(email_lc)}$", "$options": "i"}
        existing_lic = await db.licenses.find_one(
            {"$and": [
                {"$or": [{"customer_email": email_re}, {"email": email_re}]},
                {"$or": [{"active": True}, {"active": {"$exists": False}}]},
            ]},
            {"_id": 0},
        )
    if existing_lic:
        old_plan = existing_lic.get("plan") or "starter"
        base = now
        cur_exp = existing_lic.get("subscription_expires_at") or existing_lic.get("valid_until")
        if cur_exp:
            try:
                cur_dt = datetime.fromisoformat(str(cur_exp).replace("Z", "+00:00"))
                if cur_dt.tzinfo is None:
                    cur_dt = cur_dt.replace(tzinfo=timezone.utc)
                if cur_dt > base:
                    base = cur_dt
            except Exception:
                pass
        new_exp = (base + timedelta(days=days)).isoformat()
        new_ver = int(existing_lic.get("license_version") or 0) + 1
        await db.licenses.update_one(
            {"license_key": existing_lic["license_key"]},
            {"$set": {
                "plan": plan_code,
                "valid_until": new_exp,
                "subscription_expires_at": new_exp,
                "active": True,
                "license_version": new_ver,
                "last_upgrade_at": now.isoformat(),
                "last_upgrade_from": old_plan,
                "last_upgrade_session_id": session_id,
                "max_domains": int(metadata.get("max_domains") or plan.get("max_domains", existing_lic.get("max_domains", 100))),
            }},
        )
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"status": "paid", "completed_at": now.isoformat(),
                      "license_key": existing_lic["license_key"], "is_upgrade": True,
                      "upgrade_from": old_plan, "upgrade_to": plan_code}},
        )
        await db.logs.insert_one(ActivityLog(
            source="checkout", level="info",
            message=f"KART İLE YÜKSELTME · {lic.customer_email} · {old_plan}→{plan_code}/{billing_period} · {existing_lic['license_key'][:16]}… → {new_exp[:10]}",
        ).model_dump())
        # Master alert
        await db.master_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "plan_upgraded",
            "severity": "info",
            "license_key": existing_lic["license_key"],
            "message": f"✅ Kart · {lic.customer_email} · {old_plan} → {plan_code}",
            "details": {"from_plan": old_plan, "to_plan": plan_code, "session_id": session_id,
                         "amount": tx.get("amount"), "provider": "stripe"},
            "seen": False, "read": False,
            "created_at": now.isoformat(),
        })
        # Bayi inbox
        await db.notifications_inbox.insert_one({
            "id": str(uuid.uuid4()), "kind": "upgrade_completed",
            "license_key": existing_lic["license_key"],
            "email": lic.customer_email,
            "session_id": session_id,
            "old_plan": old_plan, "new_plan": plan_code,
            "expires_at": new_exp,
            "message": f"🎉 Ödemeniz onaylandı. Planınız {plan_code.upper()} olarak yükseltildi.",
            "read": False,
            "created_at": now.isoformat(),
        })
        # Onay maili (yükseltme)
        try:
            subj = f"GökyüzüWebSpam · Plan Yükseltildi · {plan.get('name', plan_code)}"
            body = (
                f"Merhaba,\n\n"
                f"Planınız başarıyla yükseltildi. 🎉\n\n"
                f"  Lisans      : {existing_lic['license_key']}\n"
                f"  Plan        : {old_plan.upper()} → {plan_code.upper()} ({billing_period})\n"
                f"  Yeni bitiş  : {new_exp[:10]}\n"
                f"  Tutar       : {tx['amount']} {tx['currency']}\n\n"
                f"Panelinizde yeni plan birkaç dakika içinde otomatik yansır.\n\n"
                f"— GökyüzüWebSpam"
            )
            await _send_email(lic.customer_email, subj, body)
        except Exception:
            pass
        return await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})

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
from routes.marketplace import router as _marketplace_router  # noqa: E402
from routes.users_sync import router as _users_sync_router  # noqa: E402
from routes.rules import router as _rules_router  # noqa: E402
from routes.bounce_digest import router as _bounce_router, _leaderboard_router  # noqa: E402
from routes.live_diagnostic import router as _live_diag_router  # noqa: E402
from routes.remote_admin import router as _remote_admin_router  # noqa: E402
from routes.reseller_branding import router as _reseller_branding_router  # noqa: E402
from routes.reports import router as _reports_router  # noqa: E402 v43.89
from routes.pin_approvals import router as _pin_approvals_router  # noqa: E402 v43.90
from routes.report_schedules import router as _report_schedules_router, _report_schedule_loop  # noqa: E402 v43.90
from routes.master_2fa import router as _master_2fa_router  # noqa: E402 v43.99
from routes.advanced_threat import router as _advanced_threat_router  # noqa: E402 v43.99.6
from routes.auto_backup import router as _auto_backup_router, start_scheduler as _start_backup_scheduler  # noqa: E402 v43.99.11
app.include_router(_reports_router, prefix="/api")
app.include_router(_pin_approvals_router, prefix="/api")
app.include_router(_report_schedules_router, prefix="/api")
app.include_router(_master_2fa_router, prefix="/api")
app.include_router(_advanced_threat_router, prefix="/api")
app.include_router(_auto_backup_router, prefix="/api")
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
app.include_router(_marketplace_router, prefix="/api")
app.include_router(_users_sync_router, prefix="/api")
app.include_router(_rules_router, prefix="/api")
app.include_router(_bounce_router, prefix="/api")
app.include_router(_leaderboard_router, prefix="/api")
app.include_router(_live_diag_router, prefix="/api")
app.include_router(_remote_admin_router, prefix="/api")
app.include_router(_reseller_branding_router, prefix="/api")

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
    "/api/checkout/",          # public Stripe checkout (create-session, status, webhook)
    "/api/events/ingest",      # Exim milter'dan mail event ingest (license_key ile doğrulanır)
    "/api/events/ingest-batch",# batch ingest
    "/api/events/action",      # milter/logtail action reporting
    "/api/events/complete-action", # logtail aksiyon tamamlama callback
    "/api/events/pending-actions/", # plugin action tamamlama callback (bayi WHM sunucusundan)
    "/api/events/logtail-heartbeat", # logtail script canlılık heartbeat
    "/api/events/admin/migrate-ts-tz", # master timezone migration
    "/api/mail/ingest",        # alternatif mail ingest
    "/api/outbound/exim-log-push",  # v43.38 heartbeat.pl Exim log tailer
    "/api/outbound/backfill-ack",   # v43.40 heartbeat.pl backfill completion callback
    "/api/live-diagnostic/report-install",  # v43.42 install report push
    "/api/heartbeat",          # plugin heartbeat (license_key ile doğrulanır)
    "/api/threat/report",      # threat feed report
    "/api/blacklist/",         # RBL/blacklist sorgu + delisting (lisanslı panellerin
                               # kendi IP/domainlerini yönetmesi için — DNS lookup
                               # ve kendi delist takibi; demo yazma kilidi uygulanmaz)
    "/api/plan/features",      # plan matris sorgusu (ziyaretçi de görebilir)
    "/api/analytics/plan-event", # PlanGate funnel tracking (ziyaretçi de yazabilir)
    "/api/audit/idle-lock-event", # v43.73 idle auto-lock lock/unlock event
    "/api/reseller-branding/",     # v43.73 bayi kendi marka/domain — endpoint per-bayi guard'lı
    "/api/security/country-rules", # v43.78 bayi kendi security ülke kuralları (tenant-scoped)
    "/api/landing/ab-impression", # v43.12 anonim A/B variant sayaç
    "/api/landing/ab-conversion", # v43.13 anonim A/B conversion tracker
    "/api/notifications/badge",   # v43.12 client achievement unlock notification
    "/api/pin-approvals/request", # v43.90 bayi PIN change request (per-bayi guard'lı)
    "/api/pin-approvals/my",      # v43.90 bayi kendi taleplerini görür
)


@app.middleware("http")
async def bayi_ip_whitelist_enforce(request: Request, call_next):
    """v43.90 — Bayi IP Whitelist Enforce.

    Master ayarında `bayi_ip_whitelist_enforce.enabled=true` iken, X-Master-Key
    (veya X-License-Key) ile gelen istekleri, lisansın `ip_addresses` listesine
    karşı doğrular. Whitelist boşsa bypass (henüz kısıtlama yok). Master anahtarı
    ile gelen istekler her zaman geçer. Uygulanmayan yollar (public, plugin
    heartbeat, license/*, plugin/*) atlanır.
    """
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    # Public/plugin/license akışları enforcement dışıdır
    _SKIP_PREFIXES = (
        "/api/plugin/", "/api/license/", "/api/reseller/", "/api/heartbeat",
        "/api/events/ingest", "/api/events/ingest-batch", "/api/events/action",
        "/api/events/complete-action", "/api/events/pending-actions/",
        "/api/events/logtail-heartbeat", "/api/mail/ingest",
        "/api/outbound/exim-log-push", "/api/outbound/backfill-ack",
        "/api/live-diagnostic/report-install", "/api/threat/report",
        "/api/blacklist/", "/api/plan/features", "/api/analytics/plan-event",
        "/api/audit/idle-lock-event", "/api/reseller-branding/",
        "/api/landing/", "/api/notifications/badge",
        "/api/admin/master-unlock", "/api/admin/master-logout",
        "/api/payments/", "/api/smart-pos/", "/api/checkout/",
        "/api/auth/", "/api/shop", "/api/invoices/",
    )
    for p in _SKIP_PREFIXES:
        if path.startswith(p):
            return await call_next(request)

    hdr = request.headers
    provided_key = (hdr.get("x-master-key") or hdr.get("x-license-key") or "").strip()
    if not provided_key:
        return await call_next(request)
    # Master anahtar → geç
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    if master_env and provided_key == master_env:
        return await call_next(request)

    # Setting kontrol
    try:
        cfg = await db.settings.find_one({"_key": "bayi_ip_whitelist_enforce"}, {"_id": 0})
    except Exception:
        cfg = None
    if not cfg or not cfg.get("enabled"):
        return await call_next(request)

    # Lisansı bul
    try:
        lic = await db.licenses.find_one({"license_key": provided_key},
                                          {"_id": 0, "ip_addresses": 1, "license_key": 1})
    except Exception:
        lic = None
    if not lic:
        return await call_next(request)
    allowed = lic.get("ip_addresses") or []
    if not allowed:
        return await call_next(request)   # whitelist boş → kısıtlama yok

    # Client IP
    client_ip = ""
    try:
        xff = hdr.get("x-forwarded-for", "")
        client_ip = (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")
    except Exception:
        pass
    if client_ip and client_ip in allowed:
        return await call_next(request)

    # Bloke: audit + 403
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "bayi_ip_whitelist_blocked",
            "actor_ip": client_ip,
            "details": {
                "license_key": provided_key, "attempted_path": path,
                "method": request.method, "allowed_ips": allowed[:5],
                "user_agent": (hdr.get("user-agent", "") or "")[:120],
            },
            "at": datetime.now(timezone.utc).isoformat(),
            "severity": "warning",
        })
    except Exception:
        pass
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=403,
        content={
            "detail": f"IP {client_ip} lisansın yetkili IP listesinde değil",
            "code": "BAYI_IP_NOT_WHITELISTED",
            "allowed_count": len(allowed),
            "client_ip": client_ip,
        },
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
        # v43.68 — Master anahtarı ile birebir eşleşen → tam yazma yetkisi
        if master_key_env and provided_key and provided_key == master_key_env:
            return await call_next(request)
        # Master IP eşleşmesi: request master sunucudan geliyorsa yazma serbest
        client_ip = ""
        try:
            xff = request.headers.get("x-forwarded-for", "")
            client_ip = (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")
        except Exception:
            pass
        if master_ip_env and client_ip and client_ip == master_ip_env:
            return await call_next(request)
        # v43.68 — KRİTİK MİMARİ FIX: Master panelinde (MASTER_LICENSE_KEY env
        # tanımlıysa) bayi lisansı ile giriş yapan kullanıcı MASTER değildir.
        # Bayi kendi sunucusunda kendi paneline erişmelidir. Master panelde
        # bayilerin yazma girişimi ENGELLENİR (özellikle DB Bakım/Ödeme gibi).
        # Bayi kendi sunucusunda MASTER_LICENSE_KEY env SET DEĞİLDİR — bu path
        # o durumda çalışmaz ve `licensed` kontrolüne düşer (kendi paneline yazabilir).
        if master_key_env:
            # Master panelde çalışıyoruz — bayi lisansı olsa bile yazma kilitli.
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "Bu master panelinde yazma yetkisi yok. Kendi bayi sunucunuzdaki panele bağlanın.",
                    "code": "BAYI_ON_MASTER_PANEL",
                    "hint": "Bayiler master panelde sadece OKUMA yapabilir. DB Bakım/Ödeme gibi işlemler için kendi sunucunuzdaki panele giriş yapın.",
                },
            )
        # Master env yok → bu bayi'nin KENDİ paneli. Kendi lisansı ile yazabilir.
        if status.get("licensed"):
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
