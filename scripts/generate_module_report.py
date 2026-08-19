#!/usr/bin/env python3
"""
GökyüzüWebSpam — Detaylı Modül Tanıtım Raporu
v43.99 · 40+ modül · Türkçe kurumsal tanıtım
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from datetime import datetime

# ---- Turkish font (DejaVu supports full unicode) ----
try:
    pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"))
    FONT = "DejaVu"
    FONT_BOLD = "DejaVu-Bold"
except Exception:
    # Fallback path try
    try:
        pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
        FONT = "DejaVu"
        FONT_BOLD = "DejaVu-Bold"
    except Exception:
        FONT = "Helvetica"
        FONT_BOLD = "Helvetica-Bold"

# ---- Colors ----
PRIMARY = HexColor("#4338CA")     # indigo
ACCENT = HexColor("#F43F5E")      # rose
GOLD = HexColor("#F59E0B")        # amber
GREEN = HexColor("#10B981")       # emerald
SKY = HexColor("#0EA5E9")         # sky
DARK = HexColor("#0F172A")        # slate-950
GRAY = HexColor("#64748B")        # slate-500
BG = HexColor("#F8FAFC")          # slate-50

# ---- Styles ----
styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "TitleTR", parent=styles["Title"], fontName=FONT_BOLD, fontSize=28,
    textColor=PRIMARY, spaceAfter=6, alignment=TA_LEFT, leading=34,
)
sub_style = ParagraphStyle(
    "SubTR", parent=styles["Normal"], fontName=FONT, fontSize=12,
    textColor=GRAY, spaceAfter=12, alignment=TA_LEFT, leading=16,
)
h1_style = ParagraphStyle(
    "H1TR", parent=styles["Heading1"], fontName=FONT_BOLD, fontSize=20,
    textColor=PRIMARY, spaceBefore=18, spaceAfter=10, leading=24,
)
h2_style = ParagraphStyle(
    "H2TR", parent=styles["Heading2"], fontName=FONT_BOLD, fontSize=15,
    textColor=DARK, spaceBefore=12, spaceAfter=6, leading=18,
)
h3_style = ParagraphStyle(
    "H3TR", parent=styles["Heading3"], fontName=FONT_BOLD, fontSize=12,
    textColor=ACCENT, spaceBefore=8, spaceAfter=4, leading=15,
)
body_style = ParagraphStyle(
    "BodyTR", parent=styles["Normal"], fontName=FONT, fontSize=10.5,
    textColor=DARK, alignment=TA_JUSTIFY, leading=15, spaceAfter=6,
)
bullet_style = ParagraphStyle(
    "BulletTR", parent=body_style, fontName=FONT, fontSize=10, leftIndent=14,
    leading=14, spaceAfter=3, textColor=HexColor("#334155"),
)
caption_style = ParagraphStyle(
    "CaptionTR", parent=body_style, fontSize=9, textColor=GRAY,
    fontName=FONT, alignment=TA_CENTER,
)
tag_style = ParagraphStyle(
    "TagTR", parent=body_style, fontSize=8.5, fontName=FONT_BOLD,
    textColor=PRIMARY, alignment=TA_LEFT, spaceAfter=8,
)

# ---- Module catalog ----
MODULES = [
    # 📊 İZLEME
    {"g": "İzleme", "name": "Kontrol Paneli (Dashboard)",
     "desc": "Sistemin canlı sağlık durumunu tek ekranda özetleyen ana panel. Bugün engellenen mail sayısı, son 1 saat trend, saldırı haritası, kaynak ülke top 15, motor durumları, kuyrukta bekleyen mail, bayi sayısı ve onay bekleyen sipariş sayısı gibi 20+ kritik metrik gerçek zamanlı olarak burada gösterilir.",
     "features": ["Canlı istatistikler (5 saniyede bir yenilenir)", "Coğrafi tehdit haritası", "Trafik grafikleri", "Aksiyon merkezi", "Kurulum sihirbazı"],
     "role": "Herkes"},

    {"g": "İzleme", "name": "MailScanner",
     "desc": "Gelen ve giden e-postaların hangi kurallarla incelendiğini, hangi motorların hangi kararı verdiğini gösteren canlı akış. Her mailin başlıklarına, RBL kararlarına, SpamAssassin puanına, ClamAV virüs eşleşmesine ve LLM açıklamalarına drill-down yapılabilir.",
     "features": ["Canlı mail akışı (WebSocket)", "Karar filtresi (spam/temiz/karantina)", "RBL & DNSBL sonuçları", "AI açıklama"],
     "role": "Herkes"},

    {"g": "İzleme", "name": "Mail Sağlık",
     "desc": "SPF/DKIM/DMARC/BIMI kayıtlarının doğruluğu, IP reputasyonu, Barracuda/Spamhaus/SORBS gibi büyük RBL listelerinde sunucunun bulunma durumu. Blacklisted olan IP'ler için otomatik delisting başvurusu tetiklenebilir.",
     "features": ["SPF/DKIM/DMARC doğrulama", "12+ RBL sorgulama", "Auto-delisting", "MX record kontrolü", "TLS sertifika süresi"],
     "role": "Herkes"},

    {"g": "İzleme", "name": "Tehdit Zekası (Threat Intel)",
     "desc": "Global tehdit veritabanlarıyla (URLhaus, PhishTank, Spamhaus, AbuseIPDB) entegre çalışan istihbarat modülü. Her yeni URL, hash veya IP anında karşılaştırılır. Yeni bir phishing kampanyası tespit edildiğinde tüm bayilere otomatik senkronize edilir.",
     "features": ["URLhaus + PhishTank + AbuseIPDB", "Otomatik güncelleme", "Global IoC senkronizasyonu", "Manuel arama"],
     "role": "Herkes"},

    {"g": "İzleme", "name": "Bounce Digest",
     "desc": "Reddedilen (bounce) mailleri otomatik gruplandırarak günlük özet raporu üretir. Hard bounce (kalıcı hata) ve soft bounce (geçici) ayrımı yapar; disposable domain'leri işaretler; müşteri listesi hijyeni için CSV export sunar.",
     "features": ["Otomatik özetleme", "Hard/Soft bounce ayrımı", "Disposable domain flagleme", "Günlük mail raporu", "CSV export"],
     "role": "Herkes"},

    {"g": "İzleme", "name": "Canlı Bayi Trafiği",
     "desc": "Master özel — tüm bayilerin gerçek zamanlı mail trafiği, spam yakalama oranları ve sağlık skorları tek ekranda. Hangi bayı ne kadar mail işledi, hangi sunucular yavaş yanıt veriyor, kim MRR üretiyor bilgisi anlık.",
     "features": ["Canlı bayi haritası", "Volume / spam / sağlık sıralama", "Anomali alarmı", "Bayi başına drill-down"],
     "role": "Master"},

    {"g": "İzleme", "name": "Canlı Sunucu Tanı (Live Diagnostic)",
     "desc": "Bayı sunucusunun anlık teşhisi: Exim servisi çalışıyor mu, Milter aktif mi, MongoDB bağlı mı, disk doluluğu, RAM/CPU kullanımı, WebSocket bağlantısı sağlıklı mı. Sorunlu bileşenler için tek tıkla auto-repair.",
     "features": ["Exim/Milter/Mongo canlı health", "CPU/RAM/Disk monitörü", "Auto-repair butonları", "SSL sertifika durumu"],
     "role": "Herkes"},

    # 🛡 KORUMA
    {"g": "Koruma", "name": "İmza Marketplace",
     "desc": "Bayiler kendi kurallarını yayınlar, diğer bayiler bunları oy verip indirebilir. Haftanın en popüler imzası ödüllendirilir. Türkiye özelinde phishing pattern'lar, sektörel spam ipuçları (tekstil, e-ticaret, kripto) burada paylaşılır.",
     "features": ["Community-driven kural paylaşımı", "Oy sistemi", "Haftanın lideri rozet", "Bir tıkla indir & aktifleştir"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "Karantina",
     "desc": "Şüpheli mailler otomatik karantinaya alınır. Kullanıcı arayüzünden orijinal mail görüntülenebilir, HTML render edilebilir, whitelist'e eklenebilir veya gerçek gelen kutusuna iletilebilir. Toplu işlem (bulk action) desteği ile 100+ mail tek hareketle işlenir.",
     "features": ["Orijinal mail preview", "HTML güvenli render", "Toplu Onay/Sil", "Whitelist'e ekle", "Arama & filtre"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "Kara/Beyaz Liste",
     "desc": "Domain, IP, e-posta adresi, MD5 hash, hedef başlık kalıbı için white/black listing. Regex desteği, TTL (geçici blok), otomatik expiring, kaynak tag'i (nereden geldi: manuel/API/threat_intel).",
     "features": ["Domain/IP/Email/Hash listing", "Regex desteği", "TTL (geçici blok)", "Kaynak tracking", "CSV import/export"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "IP Blacklist Çıkışı",
     "desc": "Yanlışlıkla RBL'e (Spamhaus, Barracuda, SORBS vs.) düşen IP'ler için otomatik delisting formu oluşturur. Formu doldurur, göndeirir, sonucu takip eder. 12+ ana blacklist provider desteklenir.",
     "features": ["12+ RBL provider entegrasyonu", "Otomatik form gönderimi", "Sonuç takip", "Retry logic"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "Kurallar (Custom Rules)",
     "desc": "Bayının kendine özel spam kuralları. Görsel editor ile 'From başlığı X içeriyorsa VE konuda Y varsa → karantina' gibi karar ağaçları. SpamAssassin native kuralları da desteklenir. Kural bazında hit/miss istatistikleri.",
     "features": ["Görsel karar ağacı editörü", "SpamAssassin rule desteği", "Hit/Miss telemetrisi", "Test simülasyonu"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "Motorlar (Engines)",
     "desc": "SpamAssassin, ClamAV (virüs), DCC (bulk detection), Vipul's Razor (hash-based), Pyzor, Bayes, RBL, DKIM, SPF, DMARC, LLM AI classifier — hepsi tek panelden aç/kapa. Her motor için hassasiyet skalası, öğrenme moduna sokma, whitelist bypass ayarı.",
     "features": ["9+ scan engine aç/kapa", "Hassasiyet skalası", "Bayes öğrenme modu", "AI/LLM classifier", "Motor sağlık monitörü"],
     "role": "Herkes"},

    {"g": "Koruma", "name": "Güvenlik (Security)",
     "desc": "Sunucu güvenlik durumu: Login denemeleri, fail2ban logları, port taraması, brute-force alarmları, coğrafi ısı haritası (kimin nereden saldırdığı). WHM API üzerinden auto-blackhole tetiklenebilir.",
     "features": ["Coğrafi saldırı ısı haritası", "fail2ban entegrasyonu", "Auto-blackhole", "Brute-force alarmı"],
     "role": "Herkes"},

    # 📨 POSTA
    {"g": "Posta", "name": "Giden Posta (Outbound)",
     "desc": "cPanel hesaplarından çıkan mailleri denetler. Şüpheli mailler (yüksek gönderi hacmi, unsub linki yok, bounce oranı yüksek) otomatik hold edilir. Compromised hesap tespiti (kullanıcı şifresi çalınmış olabilir).",
     "features": ["Hesap bazlı hız limiti", "Otomatik hold", "Compromised alarmı", "Anlık rate throttle"],
     "role": "Herkes"},

    {"g": "Posta", "name": "Whitelist Geçmişi",
     "desc": "Kimin ne zaman hangi maili/domain'i whitelist'e eklediğinin denetim kaydı. Yanlış eklenen domain'ler geri alınabilir, audit için CSV export.",
     "features": ["Audit log", "Kaynak izleme", "Geri alma", "CSV export"],
     "role": "Herkes"},

    # 👥 KULLANICI & BAYİ
    {"g": "Kullanıcı & Bayi", "name": "Kullanıcılar",
     "desc": "Bayı sunucusundaki cPanel kullanıcı hesapları. Her hesap için: bugün gönderdiği/aldığı mail sayısı, spam yakalama oranı, karantinadaki mail sayısı, IP hijyeni skoru. Toplu ban/unban.",
     "features": ["Hesap bazlı istatistik", "Toplu işlem", "Şüpheli hesap flagleme"],
     "role": "Herkes"},

    {"g": "Kullanıcı & Bayi", "name": "Bayi Yönetimi (Resellers Admin)",
     "desc": "Master özel — sisteme kayıtlı tüm bayilerin listesi. Plan atama, süre uzatma/kısaltma, banlama, uzak yönetim (impersonation), MRR takibi, sağlık raporu.",
     "features": ["Bayi CRUD", "Plan / süre yönetimi", "Impersonation (bayiye giriş)", "MRR & churn", "Sağlık skoru"],
     "role": "Master"},

    {"g": "Kullanıcı & Bayi", "name": "Lisanslar",
     "desc": "Master özel — tüm lisans anahtarlarının yönetimi. Anahtar üretme, IP eşleme, plan atama, iptal, uzatma, kullanım limiti (tek IP / birden fazla IP), otomatik yenileme.",
     "features": ["Anahtar üret", "IP allowlist", "Plan/süre", "Iptal & yenileme", "Kullanım analytics"],
     "role": "Master"},

    {"g": "Kullanıcı & Bayi", "name": "Aboneliğim (Subscription)",
     "desc": "Bayının kendi abonelik detayları: hangi plan, ne zaman bitecek, yenileme fiyatı, ödeme geçmişi. Havale, PayTR, Stripe ile yenileme.",
     "features": ["Plan detayı", "Bitim tarihi", "Yenileme (3 gateway)", "Ödeme geçmişi"],
     "role": "Bayi"},

    # 💰 SATIŞ & ÖDEME
    {"g": "Satış & Ödeme", "name": "Fiyatlandırma (Pricing)",
     "desc": "Master özel — plan fiyatları, dönemsel indirimler, kampanyalar. Aylık/yıllık toggle, para birimi seçimi, ülkeye göre farklı fiyat. Landing sayfası ve /shop sayfası bu verileri kullanır.",
     "features": ["Plan CRUD", "Kampanya editörü", "Çoklu para birimi", "Ülke bazlı fiyat"],
     "role": "Master"},

    {"g": "Satış & Ödeme", "name": "Ödeme Panosu (Payments Admin)",
     "desc": "Master özel — havale/PayTR/Stripe ödemelerin merkezi yönetimi. Bekleyen havale onayı, refund, dispute takibi, MRR raporu, bayi başına LTV.",
     "features": ["Havale onayı", "Refund/dispute", "MRR/LTV/Churn analytics", "Fatura üretimi"],
     "role": "Master"},

    {"g": "Satış & Ödeme", "name": "Plan Analitiği",
     "desc": "Master özel — plan geçişleri, upgrade/downgrade trendleri, hangi feature en çok kullanılıyor, hangi plandan hangi plana geçiliyor (kohort analizi).",
     "features": ["Plan geçiş matrisi", "Feature adoption", "Kohort analizi", "Revenue forecast"],
     "role": "Master"},

    # 🔔 BİLDİRİM & RAPOR
    {"g": "Bildirim & Rapor", "name": "Bildirim Kutusu",
     "desc": "Sistem bildirimlerinin tek merkez inbox'ı. Slack, Discord, e-posta, tarayıcı push, mobil push - hepsi buradan tetiklenir ve arşivlenir.",
     "features": ["Multi-channel merkez", "Okundu/okunmadı", "Kategori filtresi", "Ses efekti"],
     "role": "Herkes"},

    {"g": "Bildirim & Rapor", "name": "Alarm Kuralları",
     "desc": "Hangi olayda kime nasıl bildirim gitsin: 'Karantinada 100+ mail birikirse Slack'e bildir', 'Motor duşer ise SMS at', 'Bayi sağlık skoru %70'in altına düşerse Discord alarmı'.",
     "features": ["Kural editörü", "Threshold ayarı", "Multi-channel routing", "Rate limit"],
     "role": "Herkes"},

    {"g": "Bildirim & Rapor", "name": "Raporlar",
     "desc": "Günlük/haftalık/aylık spam raporları. Zamanlanmış otomatik e-posta gönderimi, PDF export, dashboard link paylaşımı, karşılaştırmalı grafikler.",
     "features": ["Zamanlanmış otomasyon", "PDF export", "Karşılaştırma", "Test send", "Test geçmişi"],
     "role": "Herkes"},

    {"g": "Bildirim & Rapor", "name": "Mail Şablonları",
     "desc": "Master özel — tüm sistem e-postalarının şablonları (hoş geldin, süre uzatma, bounce raporu, aylık rapor). Görsel editör ile kişiselleştirme, dil desteği.",
     "features": ["WYSIWYG editör", "Şablon değişkenleri", "Çoklu dil", "Preview"],
     "role": "Master"},

    # 🎨 MASTER YÖNETİM
    {"g": "Master Yönetim", "name": "Landing CMS",
     "desc": "Master özel — panel.gokyuzuhosting.com karşılama sayfasının içerik yönetimi. Kahraman metni, özellikler, fiyat kartları, testimonial, SSS - hepsi kodsuz düzenlenir.",
     "features": ["WYSIWYG editör", "SEO meta yönetimi", "A/B test", "Multi-dil"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Plan Modülleri (Plan Config)",
     "desc": "Master özel — hangi plan hangi modüle erişebilir? 'Starter'da AI açıklama YOK, Pro'da VAR, Enterprise'da her şey VAR' gibi feature matrisi burada tanımlanır. Anlık uygulanır, tüm bayiler 30 sn içinde etkilenir.",
     "features": ["Feature toggle matrisi", "Anlık senkronizasyon", "Preset (Starter/Pro/Enterprise)", "Custom plan"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Sürüm Yayınla",
     "desc": "Master özel — yeni versiyon yayınlama merkezi. Changelog yaz, kritik/normal severity seç, tüm bayilere anlık push. Bayilerin auto-update cron'u sinyali görüp docker-compose rebuild eder.",
     "features": ["Changelog editör", "Severity", "Broadcast push", "Rollout takibi"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Plugin Sağlığı",
     "desc": "Master özel — tüm bayı WHM plugin'lerinin health check'i. Kim son 15 dk'da heartbeat atmadı, kimde Milter çalışmıyor, kimin diskinde 10 GB altı boş var. Auto-restart tetiklenebilir.",
     "features": ["Heartbeat monitör", "Component health", "Auto-restart", "Alarm eşiği"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Ping Geçmişi (Wake History)",
     "desc": "Master özel — hangi bayı ne zaman merkeze ping attı, hangisi çevrimdışı oldu, hangisi geri geldi. Uptime SLA raporlaması.",
     "features": ["Bayi başına uptime", "Downtime alarmı", "SLA raporu", "Trend grafiği"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Audit Log",
     "desc": "Master özel — sistemde yapılan her critical action (lisans üretme, ban, refund, plan değişikliği) buraya yazılır. Kimin yaptığı, IP, tarih, önceki/sonraki değer.",
     "features": ["Değişiklik geçmişi", "Actor tracking", "Diff görüntüleme", "CSV export"],
     "role": "Master"},

    {"g": "Master Yönetim", "name": "Bayı Uzak Yönetim",
     "desc": "Master özel — herhangi bir bayiye 'impersonate' edip onların panelinde gezinme. Sorun tespiti, destek verme, ayar düzeltme için. Her impersonation Audit Log'a yazılır.",
     "features": ["Impersonate girişi", "Session banner", "Otomatik audit", "Sıkı yetki"],
     "role": "Master"},

    # 🔧 SİSTEM
    {"g": "Sistem", "name": "Sunucumu Bağla",
     "desc": "Bayi kendi WHM sunucusunu sisteme bağlar. Kurulum scripti (install.sh), lisans anahtarı doğrulama, Docker container'ları başlatma, Milter kaydetme - hepsi tek adımda.",
     "features": ["Tek adım kurulum", "Otomatik doğrulama", "Docker deploy", "Milter register"],
     "role": "Bayi"},

    {"g": "Sistem", "name": "Mail (SMTP) Ayarları",
     "desc": "Sistem mail çıkışı için SMTP yapılandırması (SendGrid, Amazon SES, kendi Postfix'iniz). Test maili gönderme, bounce webhook, DKIM signing.",
     "features": ["Multi-provider (SendGrid/SES/SMTP)", "DKIM", "Test send", "Bounce webhook"],
     "role": "Herkes"},

    {"g": "Sistem", "name": "Kendi Marka & Domain",
     "desc": "Bayi kendi logosunu, renk paletini, favicon'unu ve custom domain'ini (mailkorumam.com gibi) bağlayabilir. Beyaz etiket (white-label) tam desteği.",
     "features": ["Logo/favicon upload", "Renk paleti", "Custom domain (SSL dahil)", "Beyaz etiket"],
     "role": "Bayi"},

    {"g": "Sistem", "name": "Loglar",
     "desc": "Master özel — backend uvicorn, nginx, exim, milter, worker log'larının canlı takibi. Regex arama, level filtresi, indirme.",
     "features": ["Canlı log stream", "Regex filtre", "Level (DEBUG/INFO/ERROR)", "İndir"],
     "role": "Master"},

    {"g": "Sistem", "name": "DB Bakım (Maintenance)",
     "desc": "Master özel — MongoDB TTL cleanup, index rebuild, koleksiyon boyutları, yavaş sorgu takibi. Manuel snapshot alma & restore.",
     "features": ["TTL cleanup", "Index yönetimi", "Snapshot/Restore", "Yavaş sorgu tespiti"],
     "role": "Master"},

    {"g": "Sistem", "name": "Ayarlar",
     "desc": "Master özel — sistem geneli ayarlar: 2FA/TOTP, Trusted IP whitelist, IdleAutoLock süresi, PIN yönetimi, tema, dil, bildirim tercihleri, foreign IP bildirimi.",
     "features": ["2FA/TOTP (Google Authenticator)", "Trusted IP CSV import", "PIN yönetimi", "Tema (5+ renk)", "İdle lock süre"],
     "role": "Master"},

    {"g": "Sistem", "name": "Kurulum",
     "desc": "Master özel — sıfır sunucudan üretim kurulumu için adım adım kılavuz. Install script, Docker compose, SSL sertifikası, cron, systemd - hepsi otomatik.",
     "features": ["install.sh generator", "SSL wizard", "Cron kurulumu", "Systemd service"],
     "role": "Master"},

    {"g": "Sistem", "name": "Dokümantasyon",
     "desc": "Kullanıcı el kitabı: modül modül nasıl kullanılır, API endpoint referansı, örnek entegrasyonlar. Full-text search.",
     "features": ["Modül rehberi", "API referans", "Full-text search", "Örnek kod"],
     "role": "Herkes"},

    {"g": "Sistem", "name": "Kendi Domain'im (Custom Domain)",
     "desc": "Master özel — bayi custom domain kurulum sihirbazı. DNS kayıt önerisi, Let's Encrypt SSL, nginx vhost otomasyonu.",
     "features": ["DNS wizard", "Auto SSL", "Nginx config", "Health check"],
     "role": "Master"},
]


def cover_page(canv, doc):
    """Custom kapak sayfası"""
    canv.saveState()
    W, H = A4
    # Gradient background (simulated with rectangles)
    canv.setFillColor(DARK)
    canv.rect(0, 0, W, H, fill=1, stroke=0)
    # Diagonal accent
    canv.setFillColor(PRIMARY)
    canv.setFillAlpha(0.15)
    path = canv.beginPath()
    path.moveTo(0, H)
    path.lineTo(W, H - 6*cm)
    path.lineTo(W, H)
    path.close()
    canv.drawPath(path, fill=1, stroke=0)
    # Rose accent bottom
    canv.setFillColor(ACCENT)
    canv.setFillAlpha(0.10)
    path2 = canv.beginPath()
    path2.moveTo(0, 0)
    path2.lineTo(W, 0)
    path2.lineTo(0, 5*cm)
    path2.close()
    canv.drawPath(path2, fill=1, stroke=0)
    canv.setFillAlpha(1.0)
    # Logo box
    canv.setFillColor(PRIMARY)
    canv.roundRect(2.5*cm, H - 5.5*cm, 2*cm, 2*cm, 0.3*cm, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.setFont(FONT_BOLD, 24)
    canv.drawString(3.0*cm, H - 4.8*cm, "🛡")
    # Title
    canv.setFillColor(white)
    canv.setFont(FONT_BOLD, 38)
    canv.drawString(2.5*cm, H - 8*cm, "GökyüzüWebSpam")
    canv.setFillColor(HexColor("#94A3B8"))
    canv.setFont(FONT, 14)
    canv.drawString(2.5*cm, H - 8.8*cm, "WHM / cPanel · Ticari Mail Güvenlik Platformu")
    # Badge line
    canv.setFillColor(GOLD)
    canv.roundRect(2.5*cm, H - 10.5*cm, 3.5*cm, 0.75*cm, 0.1*cm, fill=1, stroke=0)
    canv.setFillColor(DARK)
    canv.setFont(FONT_BOLD, 10)
    canv.drawString(2.85*cm, H - 10.28*cm, "SÜRÜM  v43.99")
    canv.setFillColor(GREEN)
    canv.roundRect(6.3*cm, H - 10.5*cm, 4.5*cm, 0.75*cm, 0.1*cm, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.drawString(6.55*cm, H - 10.28*cm, "40+ MODÜL · TAM ÇÖZÜM")
    # Subtitle blocks
    canv.setFillColor(HexColor("#E2E8F0"))
    canv.setFont(FONT_BOLD, 15)
    canv.drawString(2.5*cm, H - 13*cm, "Detaylı Modül Tanıtım Raporu")
    canv.setFillColor(HexColor("#94A3B8"))
    canv.setFont(FONT, 11)
    lines = [
        "Bu belge, GökyüzüWebSpam platformunun tüm modüllerini,",
        "yeteneklerini ve kullanım senaryolarını detaylı olarak sunar.",
        "",
        "Hedef kitle:  Master yöneticiler, potansiyel bayiler, kurumsal alıcılar",
        "Kapsam:       40+ modül, 8 grup, 3 kullanıcı rolü",
    ]
    y = H - 14*cm
    for line in lines:
        canv.drawString(2.5*cm, y, line)
        y -= 0.55*cm
    # Bottom info
    canv.setStrokeColor(HexColor("#334155"))
    canv.line(2.5*cm, 3*cm, W - 2.5*cm, 3*cm)
    canv.setFillColor(HexColor("#94A3B8"))
    canv.setFont(FONT, 9)
    canv.drawString(2.5*cm, 2.5*cm, f"Rapor Tarihi:  {datetime.now().strftime('%d %B %Y')}")
    canv.drawString(2.5*cm, 2.1*cm, "İletişim:      panel.gokyuzuhosting.com  ·  destek@gokyuzuhosting.com")
    canv.drawString(2.5*cm, 1.7*cm, "Kurulum:       Docker + WHM/cPanel · Tek komut deploy")
    canv.setFillColor(HexColor("#64748B"))
    canv.setFont(FONT, 8)
    canv.drawRightString(W - 2.5*cm, 1.7*cm, "© 2026 Gökyüzü Bilgisayar Ltd. Şti.")
    canv.restoreState()


def page_footer(canv, doc):
    """Sayfa alt bilgisi"""
    if doc.page == 1:
        return
    canv.saveState()
    W, H = A4
    canv.setStrokeColor(HexColor("#E2E8F0"))
    canv.line(2*cm, 1.5*cm, W - 2*cm, 1.5*cm)
    canv.setFillColor(GRAY)
    canv.setFont(FONT, 8)
    canv.drawString(2*cm, 1*cm, "GökyüzüWebSpam · Modül Tanıtım Raporu · v43.99")
    canv.drawRightString(W - 2*cm, 1*cm, f"Sayfa {doc.page}")
    canv.restoreState()


# ---- Build story ----
story = []
# Cover page will be drawn on first page
story.append(PageBreak())

# ---- Table of contents ----
story.append(Paragraph("İçindekiler", h1_style))
story.append(Spacer(1, 0.3*cm))
toc_data = [
    ["Bölüm", "Konu", "Modül Sayısı"],
    ["1", "Yönetici Özeti & Mimari", "—"],
    ["2", "İzleme Modülleri", "7"],
    ["3", "Koruma Modülleri", "7"],
    ["4", "Posta Modülleri", "2"],
    ["5", "Kullanıcı & Bayi Modülleri", "4"],
    ["6", "Satış & Ödeme Modülleri", "3"],
    ["7", "Bildirim & Rapor Modülleri", "4"],
    ["8", "Master Yönetim Modülleri", "7"],
    ["9", "Sistem Modülleri", "8"],
    ["10", "Teknik Şartname & Sistem Gereksinimleri", "—"],
    ["11", "Plan Karşılaştırma Tablosu", "—"],
    ["12", "Kurulum & Deploy", "—"],
]
tbl = Table(toc_data, colWidths=[1.5*cm, 12*cm, 3*cm])
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 11),
    ("ALIGN", (0, 0), (-1, 0), "CENTER"),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ("TOPPADDING", (0, 0), (-1, 0), 8),
    ("BACKGROUND", (0, 1), (-1, -1), HexColor("#F8FAFC")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F1F5F9")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 10),
    ("ALIGN", (0, 1), (0, -1), "CENTER"),
    ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ("TEXTCOLOR", (0, 1), (-1, -1), DARK),
    ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
    ("TOPPADDING", (0, 1), (-1, -1), 6),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CBD5E1")),
]))
story.append(tbl)
story.append(PageBreak())

# ---- 1. Executive Summary ----
story.append(Paragraph("1. Yönetici Özeti", h1_style))
story.append(Paragraph(
    "<b>GökyüzüWebSpam</b>, WHM/cPanel altyapısı üzerinde çalışan hostinci ve mail sunucu operatörleri için "
    "geliştirilmiş, tam ticari mail güvenlik ve tehdit istihbarat platformudur. 40'tan fazla modülü ile "
    "spam koruması, giden mail denetimi, karantina yönetimi, yapay zeka destekli mail sınıflandırma, "
    "coğrafi tehdit haritası, çok kademeli bayi yönetimi, otomatik faturalama ve beyaz etiket (white-label) "
    "olanaklarını tek çatı altında sunar.",
    body_style,
))
story.append(Paragraph(
    "Sistem <b>Master → Bayi → Son Kullanıcı</b> üç kademeli mimaride tasarlanmıştır. Master tüm bayileri yönetir, "
    "planları/fiyatları belirler, kritik güvenlik olaylarını izler. Bayi kendi cPanel kullanıcılarını korur ve "
    "kendi markası altında hizmet verir. Son kullanıcılar (hosting müşterileri) kendi mail hijyenlerini kontrol "
    "eder.",
    body_style,
))
story.append(Paragraph(
    "<b>Öne Çıkan Değerler:</b>",
    h3_style,
))
values = [
    ["🚀", "Tek Komut Kurulum", "Docker + install.sh ile sıfır sunucudan 10 dakikada üretime alım."],
    ["🛡", "9+ Tarama Motoru", "SpamAssassin, ClamAV, DCC, Razor, Pyzor, RBL/DNSBL, DKIM, SPF, DMARC + LLM AI classifier."],
    ["📊", "Gerçek Zamanlı", "5 saniyede bir güncellenen canlı dashboard, WebSocket bazlı bildirim, coğrafi ısı haritası."],
    ["💰", "Çoklu Ödeme", "Havale/EFT, PayTR (yerel kart), Stripe (yurt dışı kart) — 3 gateway aynı anda."],
    ["🎨", "Beyaz Etiket", "Bayi kendi logosu, renk paleti, favicon ve custom domain ile hizmet verir. Full white-label."],
    ["🔒", "Kurumsal Güvenlik", "2FA/TOTP, Trusted IP whitelist, PBKDF2 PIN, Audit Log, encrypted at-rest."],
    ["🌍", "Çok Dilli", "Türkçe, İngilizce, Arapça — anlık geçiş, kullanıcı bazlı tercih."],
    ["🤖", "Yapay Zeka", "Emergent LLM Key ile Claude/GPT/Gemini destekli mail açıklama, kural önerisi, phishing algılama."],
]
for icon, name, desc in values:
    row = Table([[icon, Paragraph(f"<b>{name}</b><br/><font size='9' color='#475569'>{desc}</font>", body_style)]],
                colWidths=[1*cm, 15*cm])
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTSIZE", (0, 0), (0, 0), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(row)
story.append(PageBreak())

# ---- 2-9. Module groups ----
GROUP_META = {
    "İzleme":            (2, "cyan",    HexColor("#0891B2"), "Sistemin gerçek zamanlı durumunu izleyen modüller. Panelin nabzıdır."),
    "Koruma":            (3, "emerald", HexColor("#059669"), "Aktif spam ve tehdit koruması sağlayan güvenlik motorları."),
    "Posta":             (4, "violet",  HexColor("#7C3AED"), "Giden ve gelen mail akışını yöneten modüller."),
    "Kullanıcı & Bayi":  (5, "amber",   HexColor("#D97706"), "Kullanıcı hesapları, bayi yönetimi ve lisans işlemleri."),
    "Satış & Ödeme":     (6, "rose",    HexColor("#E11D48"), "Fiyatlandırma, çoklu ödeme geçidi ve finansal analitik."),
    "Bildirim & Rapor":  (7, "sky",     HexColor("#0284C7"), "Multi-channel bildirim ve otomatik raporlama."),
    "Master Yönetim":    (8, "fuchsia", HexColor("#A21CAF"), "Sadece ana yöneticiye açık kritik operasyon modülleri."),
    "Sistem":            (9, "slate",   HexColor("#334155"), "Kurulum, bakım, log, dokümantasyon gibi altyapı işlevleri."),
}

# Group modules
from collections import defaultdict
by_group = defaultdict(list)
for m in MODULES:
    by_group[m["g"]].append(m)

# Fixed order
GROUP_ORDER = ["İzleme", "Koruma", "Posta", "Kullanıcı & Bayi", "Satış & Ödeme", "Bildirim & Rapor", "Master Yönetim", "Sistem"]

for g in GROUP_ORDER:
    if g not in by_group: continue
    sec_num, tone, color, intro = GROUP_META[g]
    story.append(Paragraph(f"{sec_num}. {g} Modülleri", h1_style))
    # Section intro bar
    bar_tbl = Table([[Paragraph(f"<font color='white' size='10'><b>{len(by_group[g])} MODÜL</b> · {intro}</font>", body_style)]],
                    colWidths=[16*cm])
    bar_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(bar_tbl)
    story.append(Spacer(1, 0.4*cm))

    for idx, m in enumerate(by_group[g], 1):
        # Role badge color
        role_color = PRIMARY if m["role"] == "Master" else (GOLD if m["role"] == "Bayi" else GREEN)
        role_bg = HexColor("#EEF2FF") if m["role"] == "Master" else (HexColor("#FEF3C7") if m["role"] == "Bayi" else HexColor("#D1FAE5"))

        # Module card
        role_label = m["role"].upper()
        header = Paragraph(
            f'<font size="12" color="#0F172A"><b>{sec_num}.{idx}  {m["name"]}</b></font>  '
            f'<font size="8" color="{role_color.hexval()}">  ●  {role_label}</font>',
            h2_style,
        )
        story.append(header)
        story.append(Paragraph(m["desc"], body_style))
        story.append(Paragraph("<b>Ana Özellikler:</b>", h3_style))
        items = [ListItem(Paragraph(f, bullet_style), leftIndent=10) for f in m["features"]]
        story.append(ListFlowable(items, bulletType="bullet", bulletFontSize=8, bulletColor=color, leftIndent=12))
        story.append(Spacer(1, 0.3*cm))
    story.append(PageBreak())

# ---- 10. Technical Specs ----
story.append(Paragraph("10. Teknik Şartname & Sistem Gereksinimleri", h1_style))
story.append(Paragraph("Backend Teknoloji Yığını", h2_style))
tech_tbl_data = [
    ["Bileşen", "Teknoloji", "Sürüm/Not"],
    ["Web framework", "FastAPI (Python 3.11)", "Async, WebSocket, OpenAPI"],
    ["Veritabanı", "MongoDB", "4.4+ (async motor)"],
    ["Yapay Zeka", "Emergent LLM Key + emergentintegrations", "Claude/GPT/Gemini/Nano Banana"],
    ["2FA", "PyOTP + qrcode", "Google Authenticator uyumlu"],
    ["Ödeme", "Stripe SDK + PayTR REST + havale", "3 gateway paralel"],
    ["Container", "Docker + docker-compose", "MongoDB + backend + frontend + nginx"],
    ["Mail motorları", "SpamAssassin, ClamAV, DCC, Pyzor, Vipul's Razor", "cPanel Exim milter"],
]
techt = Table(tech_tbl_data, colWidths=[4*cm, 6*cm, 6*cm])
techt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 10),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ("TOPPADDING", (0, 0), (-1, 0), 6),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F1F5F9")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 9),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CBD5E1")),
    ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
    ("TOPPADDING", (0, 1), (-1, -1), 5),
]))
story.append(techt)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph("Frontend Teknoloji Yığını", h2_style))
front_data = [
    ["Bileşen", "Teknoloji", "Sürüm/Not"],
    ["UI framework", "React 18 + React Router", "SPA, code-splitting"],
    ["State/data", "React Query (TanStack)", "5s polling + focus refetch"],
    ["Component library", "Shadcn/UI + Radix", "Erişilebilir primitive'ler"],
    ["İkon set", "Lucide Icons", "800+ SVG ikon"],
    ["Toast/notification", "Sonner", "Non-blocking"],
    ["Dil (i18n)", "Custom I18nProvider", "TR/EN/AR"],
    ["Build", "CRACO + Webpack 5", "Production-optimized"],
    ["Deploy", "Nginx (static) + supervisor", "Docker container"],
]
frontt = Table(front_data, colWidths=[4*cm, 6*cm, 6*cm])
frontt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 10),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ("TOPPADDING", (0, 0), (-1, 0), 6),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F1F5F9")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 9),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CBD5E1")),
    ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
    ("TOPPADDING", (0, 1), (-1, -1), 5),
]))
story.append(frontt)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph("Sunucu Gereksinimleri", h2_style))
req_body = (
    "<b>Minimum:</b> 2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 20.04+ / RHEL 8+ / AlmaLinux, WHM 100+, "
    "root SSH erişimi, açık portlar: 80, 443, 22, 2087.<br/><br/>"
    "<b>Önerilen (100+ hesap):</b> 4 vCPU, 8 GB RAM, 80 GB NVMe SSD, dedike IP, ters DNS kaydı, "
    "Let's Encrypt ile geçerli SSL.<br/><br/>"
    "<b>Enterprise (1000+ hesap):</b> 8 vCPU, 16 GB RAM, 200 GB NVMe, ayrı MongoDB sunucusu, "
    "load balancer önerilir."
)
story.append(Paragraph(req_body, body_style))
story.append(PageBreak())

# ---- 11. Plan comparison ----
story.append(Paragraph("11. Plan Karşılaştırma Tablosu", h1_style))
plan_data = [
    ["Özellik", "Starter", "Pro", "Enterprise"],
    ["Aylık Fiyat (yaklaşık)", "199 TL", "499 TL", "Özel"],
    ["Domain Sayısı", "1", "10", "Sınırsız"],
    ["Günlük Mail Limiti", "5.000", "50.000", "Sınırsız"],
    ["SpamAssassin + ClamAV", "✓", "✓", "✓"],
    ["Karantina & Whitelist", "✓", "✓", "✓"],
    ["RBL / DNSBL", "✓", "✓", "✓"],
    ["Özel Kural Editörü", "—", "✓", "✓"],
    ["AI/LLM Açıklama", "—", "✓", "✓"],
    ["Exploit Editor", "—", "—", "✓"],
    ["Marketplace (İmza)", "—", "✓", "✓"],
    ["API Erişimi", "—", "✓", "✓"],
    ["Bayi Modu (White-label)", "—", "—", "✓"],
    ["Öncelikli Destek", "—", "Chat", "7/24 Telefon"],
    ["Custom Domain", "—", "—", "✓"],
    ["SLA", "%99.5", "%99.9", "%99.95"],
]
pt = Table(plan_data, colWidths=[6*cm, 3.3*cm, 3.3*cm, 3.3*cm])
pt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 11),
    ("ALIGN", (1, 0), (-1, -1), "CENTER"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F1F5F9")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 10),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CBD5E1")),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    # Enterprise column highlight
    ("BACKGROUND", (3, 1), (3, -1), HexColor("#FEF3C7")),
    ("TEXTCOLOR", (3, 1), (3, -1), HexColor("#78350F")),
    ("FONTNAME", (3, 1), (3, -1), FONT_BOLD),
]))
story.append(pt)
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph(
    "<font size='9' color='#64748B'><i>Fiyatlar bilgi amaçlıdır ve zaman içinde güncellenebilir. "
    "Güncel fiyatlar için: panel.gokyuzuhosting.com/shop</i></font>",
    caption_style,
))
story.append(PageBreak())

# ---- 12. Install & Deploy ----
story.append(Paragraph("12. Kurulum & Deploy", h1_style))
story.append(Paragraph("Adım Adım Sunucu Kurulumu", h2_style))
steps = [
    "<b>1. Ubuntu/AlmaLinux sunucusuna SSH ile bağlanın</b> (root veya sudo yetkili kullanıcı).",
    "<b>2. Docker + Docker Compose kurun:</b><br/><font face='DejaVu' size='9' color='#0891B2'>curl -fsSL https://get.docker.com | bash &amp;&amp; systemctl enable --now docker</font>",
    "<b>3. GökyüzüWebSpam repo'sunu klonlayın:</b><br/><font size='9' color='#0891B2'>git clone https://github.com/gokyuzuhosting/gokyuzuwebspam.git /opt/gokyuzuwebspam-app</font>",
    "<b>4. install.sh çalıştırın:</b><br/><font size='9' color='#0891B2'>cd /opt/gokyuzuwebspam-app/deployment &amp;&amp; sudo bash install.sh</font><br/>Domain, e-posta ve Master anahtarını size soracak, gerisini otomatik yapacak.",
    "<b>5. WHM'e giriş yapın ve MailShield ikonuna tıklayın</b> — panel açılır.",
    "<b>6. İlk lisans anahtarınızı üretin ve pluginlere dağıtın.</b> Otomatik güncelleme cron'u her 6 saatte bir kod çeker.",
]
for s in steps:
    story.append(Paragraph(s, body_style))
    story.append(Spacer(1, 0.15*cm))

story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Otomatik Güncelleme", h2_style))
story.append(Paragraph(
    "Sistem, master panel üzerinden 'Sürüm Yayınla' modülü ile yeni bir versiyon yayınlandığında tüm bayilerin "
    "sunucularına 15 dakika içinde push edilir. Bayi sunucusundaki cron job kodu çeker, Docker container'ları "
    "yeniden inşa eder ve çalışan hizmete kesinti vermeden hot-swap yapar. Her sürüm için otomatik snapshot "
    "alındığı için sorun halinde <b>tek komutla önceki sürüme dönüş (rollback)</b> mümkündür.",
    body_style,
))

story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Destek & İletişim", h2_style))
support = [
    ["Kanal", "Erişim", "Yanıt Süresi"],
    ["E-posta", "destek@gokyuzuhosting.com", "24 saat"],
    ["Telefon (Enterprise)", "+90 XXX XXX XX XX", "7/24"],
    ["Panel Chat", "panel içinden ⌘K", "Anlık"],
    ["Slack Community", "gokyuzu.slack.com", "Community"],
    ["Dokümantasyon", "panel.gokyuzuhosting.com/docs", "Kendi başına"],
]
sup = Table(support, colWidths=[4.5*cm, 7*cm, 4.5*cm])
sup.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 10),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#FEF2F2")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 10),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#FCA5A5")),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
]))
story.append(sup)

# Closing
story.append(Spacer(1, 1.5*cm))
final_tbl = Table([[Paragraph(
    "<font color='white' size='14'><b>Teşekkürler.</b></font><br/>"
    "<font color='#E2E8F0' size='10'>GökyüzüWebSpam ile mail güvenliğinizi bir üst seviyeye taşıyın. "
    "Demo panel için: panel.gokyuzuhosting.com<br/>Kurumsal teklif ve özel entegrasyon için bize ulaşın.</font>",
    body_style
)]], colWidths=[16*cm])
final_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), DARK),
    ("LEFTPADDING", (0, 0), (-1, -1), 20),
    ("RIGHTPADDING", (0, 0), (-1, -1), 20),
    ("TOPPADDING", (0, 0), (-1, -1), 16),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
]))
story.append(final_tbl)

# ---- Build ----
output_path = "/app/GokyuzuWebSpam-Modul-Tanitim-v43.99.pdf"
doc = SimpleDocTemplate(
    output_path, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="GokyuzuWebSpam - Modul Tanitim Raporu",
    author="Gokyuzu Bilgisayar Ltd. Sti.",
)
doc.build(story, onFirstPage=cover_page, onLaterPages=page_footer)
print(f"✓ PDF hazır: {output_path}")

import os
size_kb = os.path.getsize(output_path) / 1024
print(f"✓ Boyut: {size_kb:.1f} KB")
