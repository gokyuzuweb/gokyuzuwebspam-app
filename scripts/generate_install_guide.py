#!/usr/bin/env python3
"""
Kurulum Rehberi PDF — Multi-Language (TR / EN / AR)
v43.99.9 · Step-by-step · Beginner friendly
Usage: python3 generate_install_guide.py [tr|en|ar]
"""
import os
import sys
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Preformatted,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------- Fonts ----------
try:
    pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
    FONT_LATIN, FONT_LATIN_BOLD, FONT_MONO = "DejaVu", "DejaVu-Bold", "DejaVu-Mono"
except Exception:
    FONT_LATIN, FONT_LATIN_BOLD, FONT_MONO = "Helvetica", "Helvetica-Bold", "Courier"

try:
    pdfmetrics.registerFont(TTFont("NotoAr", "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("NotoAr-Bold", "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"))
    FONT_AR, FONT_AR_BOLD = "NotoAr", "NotoAr-Bold"
except Exception:
    FONT_AR, FONT_AR_BOLD = FONT_LATIN, FONT_LATIN_BOLD


# ---------- Arabic shaping ----------
def ar_shape(text):
    """Shape Arabic text for correct RTL rendering."""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        return get_display(arabic_reshaper.reshape(text))
    except Exception:
        return text


# ---------- Colors ----------
INDIGO = HexColor("#4338CA")
ROSE = HexColor("#E11D48")
EMERALD = HexColor("#059669")
AMBER = HexColor("#D97706")
DARK = HexColor("#0F172A")
GRAY = HexColor("#64748B")
CODE_BG = HexColor("#0F172A")
CODE_TEXT = HexColor("#CBD5E1")


# ---------- I18N ----------
I18N = {
    "tr": {
        "meta_title": "GokyuzuWebSpam - Kurulum Rehberi",
        "cover_title": "Kurulum Rehberi",
        "cover_sub": "cPanel/WHM sunucusuna GökyüzüWebSpam kurulumu",
        "cover_badge": "APTALA ANLATIR GIBI · 8 ADIM",
        "cover_intro": [
            "Bu belge, ürünü satın aldıktan sonra kendi",
            "cPanel/WHM sunucunuza nasıl kuracağınızı adım adım anlatır.",
            "",
            "Hedef kitle: Sunucu yöneticisi, teknik olmayan operatör",
            "Süre: Toplam ~30 dakika (Docker kurulu ise 12 dakika)",
            "Gerekli: SSH root erişimi, WHM login, satın alma sonrası e-posta",
        ],
        "date_label": "Rapor Tarihi",
        "support_line": "Destek: destek@gokyuzuhosting.com",
        "copyright": "© 2026 Gökyüzü Bilgisayar Ltd.",
        "footer_left": "GökyüzüWebSpam · Kurulum Rehberi",
        "footer_page": "Sayfa",
        "pre_title": "Başlamadan Önce",
        "pre_intro": (
            "Bu belge X firmasının sıfırdan GökyüzüWebSpam kurulumunu tamamlaması için hazırlanmıştır. "
            "Her komut kopyalanıp yapıştırılabilir. Anlamadığınız yer olursa <b>destek@gokyuzuhosting.com</b> "
            "adresine yazın, ekran görüntüsü ile birlikte gönderin."
        ),
        "pre_need": "Elinizde olması gerekenler",
        "pre_items": [
            "<b>WHM/cPanel yüklü Linux sunucu</b> (AlmaLinux 8+, CentOS 8+, Ubuntu 20.04+, RHEL 8+)",
            "<b>SSH root erişimi</b> (kullanıcı: root, port: 22)",
            "<b>Domain</b> sunucunuza yönlendirilmiş (örn: panel.firmaniz.com)",
            "<b>Satın alma e-postası</b> (lisans anahtarınız burada)",
            "<b>4 GB RAM, 40 GB boş disk</b> (100+ hesap için 8 GB önerilir)",
        ],
        "pre_warn": ("Bu kurulum <b>PRODUCTION</b> sunucuda yapılır. Test için ayrı sunucu kullanın veya önce "
                     "snapshot alın. Yanlış komut Exim mail servisini durdurabilir."),
        "step_label": "ADIM",
        "duration_label": "Tahmini süre",
        "expected_output": "Beklenen çıktı",
        "warning_label": "Dikkat",
        "info_label": "Bilgi",
        "steps": [
            {
                "t": "Satın Alma Sonrası E-postanızı Kontrol Edin",
                "d": "2 dk",
                "body": [
                    "Ürünü satın aldıktan hemen sonra size iki e-posta gelir:",
                    "<b>1. Fatura & Sözleşme</b> — muhasebe için PDF fatura, kullanım şartları<br/>"
                    "<b>2. Lisans Bilgileri</b> — kurulum için gereken kritik veriler",
                    "Lisans e-postasında şu bilgiler olacak:",
                ],
                "code": (
                    "Lisans Anahtariniz:  MS-XXXXXXXXXXXXXXXXXXXXXX\n"
                    "Plan:                Enterprise (30 gun)\n"
                    "IP Adresi:           123.45.67.89 (sunucunuzun IP'si)\n"
                    "Panel Domain:        panel.firmaniz.com\n"
                    "Kurulum URL:         https://gokyuzuhosting.com/install.sh\n"
                    "Destek:              destek@gokyuzuhosting.com"
                ),
                "warn": ("Lisans anahtarınızı <b>ASLA</b> kimseyle paylaşmayın. Bu anahtar sunucunuzun "
                         "kilididir.")
            },
            {
                "t": "Sunucuya SSH ile Bağlanın",
                "d": "1 dk",
                "body": [
                    "Windows kullanıyorsanız <b>PowerShell</b> veya <b>PuTTY</b>; Mac/Linux'ta <b>Terminal</b> açın.",
                    "Şu komutu yazın (kendi sunucu IP'nizi girin):",
                ],
                "code": "ssh root@123.45.67.89",
                "body2": [
                    "İlk kez bağlanıyorsanız 'yes' yazıp Enter, sonra root şifrenizi girin. Girerken şifre "
                    "görünmez, bu normaldir — yazıp Enter'a basın.",
                ],
                "ok": "Şu satırı görmelisiniz:  <font face='{mono}'>[root@sunucu ~]#</font>",
                "info": ("SSH bağlantısı için port 22'nin açık olması gerekir. Kapalıysa provider paneli "
                         "üzerinden Console/VNC ile de girebilirsiniz.")
            },
            {
                "t": "Sistem Güncellemesi + Docker Kurulumu",
                "d": "3-5 dk",
                "body": [
                    "<b>Not:</b> Docker zaten kuruluysa bu adımı atlayabilirsiniz. Kontrol için:",
                ],
                "code": "docker --version",
                "body2": [
                    "Bir sürüm numarası gelirse direkt Adım 4'e geçin. 'command not found' derse aşağıdaki "
                    "komutu çalıştırın:",
                ],
                "code2": (
                    "# Docker + Docker Compose tek komutla kur\n"
                    "curl -fsSL https://get.docker.com | bash\n"
                    "systemctl enable --now docker\n"
                    "docker ps"
                ),
                "ok": "Boş bir tablo görmelisiniz:  <font face='{mono}'>CONTAINER ID   IMAGE   ...</font>",
            },
            {
                "t": "GökyüzüWebSpam Kurulum Script'ini Çalıştırın",
                "d": "8-12 dk",
                "body": [
                    "Tek komutla tüm kurulum otomatik yapılacak: MongoDB + Backend + Frontend + Nginx (SSL) + "
                    "WHM plugin registration.",
                ],
                "code": (
                    "curl -fsSL https://gokyuzuhosting.com/install.sh -o /root/install.sh\n"
                    "chmod +x /root/install.sh\n"
                    "bash /root/install.sh"
                ),
                "body2": [
                    "Script size şu bilgileri sıra ile soracak:",
                ],
                "code2": (
                    ">>> Lisans anahtarinizi girin: [buraya MS-... yapistirin]\n"
                    ">>> Panel domain'i:            panel.firmaniz.com\n"
                    ">>> Admin e-posta:             siz@firmaniz.com\n"
                    ">>> SSL sertifikasi (E)vet/(H)ayir: E"
                ),
                "list_title": "Bu adımdan sonra script otomatik yapacak:",
                "list": [
                    "MongoDB Docker container'ını indirir & başlatır",
                    "Backend + Frontend Docker image'larını derler",
                    "Nginx reverse proxy kurar (portlar: 80, 443)",
                    "Let's Encrypt SSL sertifikasını otomatik alır",
                    "WHM plugin'i /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/ dizinine kopyalar",
                    "Exim milter entegrasyonunu ayarlar",
                    "Otomatik güncelleme cron'unu ekler (6 saatte bir)",
                ],
                "ok": "Kurulum bitince ekranın en altında:<br/><font face='{mono}'>Kurulum basarili! WHM MailShield ikonuna tiklayin.</font>",
            },
            {
                "t": "WHM'e Giriş Yapın ve Plugin'i Açın",
                "d": "1 dk",
                "body": ["Tarayıcınızda şu adresi açın (kendi sunucu IP'niz):"],
                "code": "https://123.45.67.89:2087",
                "body2": [
                    "Sertifika uyarısı gelirse 'Gelişmiş' → 'Yine de git' deyin.",
                    "WHM root kullanıcı adı + şifre ile giriş yapın.",
                    "Ana ekranda sol menüde <b>Plugins</b> bölümüne kadar aşağı inin. Buradaki "
                    "<b>MailShield</b> ikonuna tıklayın.",
                ],
                "ok": ("<b>Panel otomatik açılır ve sağ üstte 'MASTER · 123.45.67.89' rozeti gelir.</b><br/>"
                       "Sol menüde tüm özellikler açıktır."),
                "warn": ("Sağ üstte 'MASTER' rozeti görünmüyorsa Master IP eşleşmiyor demektir. Destek "
                         "e-postası atın, IP'nizi manuel Trusted IP listesine ekleriz."),
            },
            {
                "t": "cPanel Hesaplarını Panele Bağlayın (Opsiyonel)",
                "d": "3 dk",
                "body": [
                    "Kurulum bitince cPanel hesaplarınız otomatik keşfedilir. Panelinizde <b>Kullanıcılar</b> "
                    "sayfasına gidin — tüm hesaplarınızı görürsünüz.",
                    "Hesap başına:",
                ],
                "list": [
                    "Bugün gönderdiği/aldığı mail sayısı",
                    "Spam yakalama oranı",
                    "Karantinadaki mail sayısı",
                    "IP hijyeni skoru",
                ],
                "body2": [
                    "İsterseniz her hesap için ayrı hız limiti, ayrı whitelist, ayrı bildirim kanalı "
                    "tanımlayabilirsiniz.",
                ],
            },
            {
                "t": "Mail Motorlarını Test Edin",
                "d": "5 dk",
                "body": [
                    "Panelde <b>Motorlar</b> sayfasına gidin. Şu motorların yeşil olduğunu kontrol edin:",
                ],
                "table_head": ["Motor", "Amaç", "Durum"],
                "table_rows": [
                    ["SpamAssassin", "İçerik bazlı spam skorlaması", "Aktif"],
                    ["ClamAV", "Virüs/malware taraması", "Aktif"],
                    ["DCC / Razor / Pyzor", "Bulk mail parmak izi", "Aktif"],
                    ["RBL / DNSBL", "IP kara listesi (Spamhaus vb.)", "Aktif"],
                    ["SPF / DKIM / DMARC", "Kimlik doğrulama", "Aktif"],
                    ["LLM AI Classifier", "Yapay zeka sınıflandırma", "Opsiyonel"],
                ],
                "body2": [
                    "<b>Test mail:</b> Panelin <b>Mail Simulator</b> sayfasında hazır phishing .eml var. "
                    "'Simüle Et' butonuna basın.",
                ],
                "ok": "Simulator sonucu <b>QUARANTINE</b> ve skor 70+ ise koruma çalışıyor demektir.",
            },
            {
                "t": "Bildirim Kanallarını Bağlayın",
                "d": "5 dk",
                "body": [
                    "Panelde <b>Sistem → Ayarlar → Bildirimler</b> sekmesine gidin. Aşağıdakilerden birini "
                    "veya birkaçını yapılandırın:",
                ],
                "table_head": ["Kanal", "Nasıl Bağlanır", "Ücret"],
                "table_rows": [
                    ["E-posta", "SMTP ayarları (SendGrid/SES/Postfix)", "Ücretsiz"],
                    ["Slack", "Incoming Webhook URL", "Ücretsiz"],
                    ["Discord", "Channel Webhook URL", "Ücretsiz"],
                    ["Telegram", "BotFather token + chat_id", "Ücretsiz"],
                    ["Tarayıcı Push", "Otomatik izin ister", "Ücretsiz"],
                    ["SMS (Twilio)", "Twilio API key gerekir", "Ücretli"],
                ],
            },
        ],
        "trouble_title": "Sorun Giderme",
        "trouble": [
            ("Panel açılmıyor / 502 Bad Gateway",
             "Docker container'lar başlamamış olabilir.",
             "cd /opt/gokyuzuwebspam-app/deployment && docker compose ps\ndocker compose up -d"),
            ("MASTER rozeti gelmiyor",
             "IP eşleşmesi olmadı. Anahtar geçerli mi kontrol edin.",
             "curl -H 'X-Master-Key: MS-...' http://127.0.0.1:8001/api/admin/whoami\n# is_master: true donmeli"),
            ("Karantinada hiç mail yok",
             "Exim milter kayıtlı mı kontrol edin.",
             "cat /etc/exim.conf.local | grep -i milter\n# smtp_milters = inet:127.0.0.1:8891 olmali"),
            ("SSL sertifikası alınamadı",
             "Domain sunucuya yönlendirilmemiş olabilir.",
             "dig +short panel.firmaniz.com\n# Sunucu IP'niz gorunmeli"),
        ],
        "update_title": "Sürekli Güncel Kalın",
        "update_body": "Yeni sürümler yayınlandığında otomatik güncelleme için iki yol vardır:",
        "update_auto_h": "Yol 1: Otomatik (Önerilen)",
        "update_auto_b": "Kurulum sırasında otomatik cron eklendi. Her 6 saatte bir yeni sürüm kontrol eder.",
        "update_auto_code": "cat /etc/cron.d/gws-autoupdate",
        "update_manual_h": "Yol 2: Manuel",
        "update_manual_b": "İstediğiniz zaman elle güncellemek için:",
        "update_manual_code": "cd /opt/gokyuzuwebspam-app\nbash auto-update.sh",
        "update_info": ("Güncelleme sırasında ~30 saniyelik kesinti olur. Mail Continuity modülü kuyruklama "
                        "yapar; sunucu geri gelince replay eder."),
        "support_title": "Yardım & Destek",
        "support_head": ["Kanal", "Erişim", "Yanıt Süresi"],
        "support_rows": [
            ["E-posta", "destek@gokyuzuhosting.com", "24 saat"],
            ["Panel Chat", "Panel içi mesaj (sağ alt)", "Mesai saatleri"],
            ["Slack Community", "gokyuzu.slack.com", "Community"],
            ["Dokümantasyon", "Panel içi Dokümantasyon", "Anlık"],
        ],
        "closing_h": "Kurulum Tamamlandı — Tebrikler!",
        "closing_b": ("Artık cPanel sunucunuz kurumsal seviyede mail güvenliği ile korunuyor. İlk 24 saatte "
                      "binlerce spam mail'in engellendiğini panelde göreceksiniz."),
    },

    # ---------------- ENGLISH ----------------
    "en": {
        "meta_title": "GokyuzuWebSpam - Installation Guide",
        "cover_title": "Installation Guide",
        "cover_sub": "Deploy GokyuzuWebSpam on your cPanel/WHM server",
        "cover_badge": "STEP-BY-STEP · 8 STEPS",
        "cover_intro": [
            "This document walks you through the full installation",
            "of GokyuzuWebSpam on your own cPanel/WHM server after purchase.",
            "",
            "Audience: Server administrators, non-technical operators",
            "Duration: ~30 minutes total (12 minutes if Docker is preinstalled)",
            "Required: SSH root access, WHM login, post-purchase email",
        ],
        "date_label": "Report Date",
        "support_line": "Support: destek@gokyuzuhosting.com",
        "copyright": "© 2026 Gokyuzu Bilgisayar Ltd.",
        "footer_left": "GokyuzuWebSpam · Installation Guide",
        "footer_page": "Page",
        "pre_title": "Before You Start",
        "pre_intro": (
            "This document is designed to help your team install GokyuzuWebSpam from scratch. "
            "Every command below is copy-paste ready. If you get stuck at any point, email "
            "<b>destek@gokyuzuhosting.com</b> with a screenshot."
        ),
        "pre_need": "What you will need",
        "pre_items": [
            "<b>A WHM/cPanel Linux server</b> (AlmaLinux 8+, CentOS 8+, Ubuntu 20.04+, RHEL 8+)",
            "<b>SSH root access</b> (user: root, port: 22)",
            "<b>A domain</b> pointing to your server (e.g. panel.yourcompany.com)",
            "<b>Your purchase email</b> (contains your license key)",
            "<b>4 GB RAM, 40 GB free disk</b> minimum (8 GB recommended for 100+ accounts)",
        ],
        "pre_warn": ("This installation runs on a <b>PRODUCTION</b> server. Use a separate host for testing "
                     "or take a snapshot first. A wrong command can stop Exim mail service."),
        "step_label": "STEP",
        "duration_label": "Estimated time",
        "expected_output": "Expected output",
        "warning_label": "Warning",
        "info_label": "Info",
        "steps": [
            {
                "t": "Check your post-purchase email",
                "d": "2 min",
                "body": [
                    "Right after purchase you receive two emails:",
                    "<b>1. Invoice & Terms</b> — PDF invoice + terms of use<br/>"
                    "<b>2. License Details</b> — the critical data needed for installation",
                    "The license email contains:",
                ],
                "code": (
                    "Your License Key:  MS-XXXXXXXXXXXXXXXXXXXXXX\n"
                    "Plan:              Enterprise (30 days)\n"
                    "IP Address:        123.45.67.89 (your server IP)\n"
                    "Panel Domain:      panel.yourcompany.com\n"
                    "Install URL:       https://gokyuzuhosting.com/install.sh\n"
                    "Support:           destek@gokyuzuhosting.com"
                ),
                "warn": ("<b>NEVER</b> share your license key with anyone. This key is the lock of your "
                         "server."),
            },
            {
                "t": "Connect to your server via SSH",
                "d": "1 min",
                "body": [
                    "On Windows use <b>PowerShell</b> or <b>PuTTY</b>; on Mac/Linux open <b>Terminal</b>.",
                    "Run this command (use your own server IP):",
                ],
                "code": "ssh root@123.45.67.89",
                "body2": [
                    "First time connecting? Type 'yes' + Enter, then your root password. The password does "
                    "not appear as you type — that is normal.",
                ],
                "ok": "You should see:  <font face='{mono}'>[root@server ~]#</font>",
                "info": ("SSH requires port 22 to be open. If closed, use the provider's Console/VNC "
                         "instead."),
            },
            {
                "t": "System update + Docker installation",
                "d": "3-5 min",
                "body": ["<b>Note:</b> If Docker is already installed, skip this step. To check:"],
                "code": "docker --version",
                "body2": [
                    "If a version appears (e.g. Docker version 24.0.7) skip to Step 4. If you see "
                    "'command not found', run:",
                ],
                "code2": (
                    "# Install Docker + Docker Compose in one line\n"
                    "curl -fsSL https://get.docker.com | bash\n"
                    "systemctl enable --now docker\n"
                    "docker ps"
                ),
                "ok": "You should see an empty table:  <font face='{mono}'>CONTAINER ID   IMAGE   ...</font>",
            },
            {
                "t": "Run the GokyuzuWebSpam install script",
                "d": "8-12 min",
                "body": [
                    "One command installs everything: MongoDB + Backend + Frontend + Nginx (with SSL) + "
                    "WHM plugin registration.",
                ],
                "code": (
                    "curl -fsSL https://gokyuzuhosting.com/install.sh -o /root/install.sh\n"
                    "chmod +x /root/install.sh\n"
                    "bash /root/install.sh"
                ),
                "body2": ["The script will prompt you for:"],
                "code2": (
                    ">>> Enter your license key: [paste MS-... here]\n"
                    ">>> Panel domain:            panel.yourcompany.com\n"
                    ">>> Admin email:             you@yourcompany.com\n"
                    ">>> SSL certificate (Y/N):   Y"
                ),
                "list_title": "The script will automatically:",
                "list": [
                    "Pull the MongoDB Docker container and start it",
                    "Build backend + frontend Docker images",
                    "Install Nginx reverse proxy (ports 80, 443)",
                    "Obtain a Let's Encrypt SSL certificate",
                    "Copy the WHM plugin to /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/",
                    "Wire up the Exim milter integration",
                    "Register an auto-update cron (every 6 hours)",
                ],
                "ok": "When finished:<br/><font face='{mono}'>Installation successful! Click the MailShield icon in WHM.</font>",
            },
            {
                "t": "Log in to WHM and open the plugin",
                "d": "1 min",
                "body": ["Open your browser and navigate to (your own IP):"],
                "code": "https://123.45.67.89:2087",
                "body2": [
                    "If a certificate warning appears, click 'Advanced' → 'Proceed' (WHM is self-signed).",
                    "Log in as root.",
                    "Scroll the left menu down to <b>Plugins</b>. Click the <b>MailShield</b> icon.",
                ],
                "ok": ("<b>The panel opens and a 'MASTER · 123.45.67.89' badge appears in the top-right.</b><br/>"
                       "All features are unlocked in the left menu."),
                "warn": ("If the MASTER badge is missing, your Master IP does not match. Email support so we "
                         "can add your IP to the Trusted IP list manually."),
            },
            {
                "t": "Bind cPanel accounts to the panel (Optional)",
                "d": "3 min",
                "body": [
                    "After installation your cPanel accounts are auto-discovered. Go to the <b>Users</b> "
                    "page in the panel — you will see all your accounts.",
                    "Per account:",
                ],
                "list": [
                    "Emails sent/received today",
                    "Spam catch rate",
                    "Quarantined mail count",
                    "IP hygiene score",
                ],
                "body2": [
                    "You can define per-account rate limits, whitelists and notification channels.",
                ],
            },
            {
                "t": "Test the mail engines",
                "d": "5 min",
                "body": ["Go to <b>Engines</b> in the panel. Verify these engines are green:"],
                "table_head": ["Engine", "Purpose", "Status"],
                "table_rows": [
                    ["SpamAssassin", "Content-based spam scoring", "Active"],
                    ["ClamAV", "Virus/malware scanning", "Active"],
                    ["DCC / Razor / Pyzor", "Bulk-mail fingerprint", "Active"],
                    ["RBL / DNSBL", "IP blacklists (Spamhaus etc.)", "Active"],
                    ["SPF / DKIM / DMARC", "Authentication", "Active"],
                    ["LLM AI Classifier", "AI classification", "Optional"],
                ],
                "body2": [
                    "<b>Test mail:</b> The <b>Mail Simulator</b> ships with a phishing .eml. Press "
                    "'Simulate' to test the pipeline.",
                ],
                "ok": "If the result is <b>QUARANTINE</b> with a score of 70+, protection is working.",
            },
            {
                "t": "Wire up your notification channels",
                "d": "5 min",
                "body": [
                    "Go to <b>System → Settings → Notifications</b> in the panel. Configure one or more:",
                ],
                "table_head": ["Channel", "How to connect", "Cost"],
                "table_rows": [
                    ["Email", "SMTP settings (SendGrid/SES/Postfix)", "Free"],
                    ["Slack", "Incoming Webhook URL", "Free"],
                    ["Discord", "Channel Webhook URL", "Free"],
                    ["Telegram", "BotFather token + chat_id", "Free"],
                    ["Browser Push", "Auto-permission prompt", "Free"],
                    ["SMS (Twilio)", "Twilio API key required", "Paid"],
                ],
            },
        ],
        "trouble_title": "Troubleshooting",
        "trouble": [
            ("Panel won't open / 502 Bad Gateway",
             "Docker containers may not be running.",
             "cd /opt/gokyuzuwebspam-app/deployment && docker compose ps\ndocker compose up -d"),
            ("MASTER badge is missing",
             "IP does not match. Verify the license.",
             "curl -H 'X-Master-Key: MS-...' http://127.0.0.1:8001/api/admin/whoami\n# is_master: true expected"),
            ("Quarantine is empty",
             "Check if the Exim milter is registered.",
             "cat /etc/exim.conf.local | grep -i milter\n# smtp_milters = inet:127.0.0.1:8891 expected"),
            ("SSL certificate failed",
             "The domain may not be pointing to the server.",
             "dig +short panel.yourcompany.com\n# Your server IP should appear"),
        ],
        "update_title": "Stay Up to Date",
        "update_body": "Two ways to keep the panel updated when new versions ship:",
        "update_auto_h": "Way 1: Automatic (Recommended)",
        "update_auto_b": "An auto-update cron is installed. It checks for a new version every 6 hours.",
        "update_auto_code": "cat /etc/cron.d/gws-autoupdate",
        "update_manual_h": "Way 2: Manual",
        "update_manual_b": "Update at any time with:",
        "update_manual_code": "cd /opt/gokyuzuwebspam-app\nbash auto-update.sh",
        "update_info": ("A ~30-second downtime happens during upgrade. Mail Continuity queues messages and "
                        "replays them once the server is back."),
        "support_title": "Help & Support",
        "support_head": ["Channel", "How", "Response Time"],
        "support_rows": [
            ["Email", "destek@gokyuzuhosting.com", "24 hours"],
            ["Panel Chat", "In-panel message (bottom-right)", "Business hours"],
            ["Slack Community", "gokyuzu.slack.com", "Community"],
            ["Documentation", "In-panel docs tab", "Instant"],
        ],
        "closing_h": "Installation Complete — Congratulations!",
        "closing_b": ("Your cPanel server is now protected by enterprise-grade mail security. Within the "
                      "first 24 hours you will see thousands of blocked spam messages in the panel dashboard."),
    },

    # ---------------- ARABIC ----------------
    "ar": {
        "meta_title": "GokyuzuWebSpam - دليل التثبيت",
        "cover_title": "دليل التثبيت",
        "cover_sub": "تثبيت GokyuzuWebSpam على خادم cPanel/WHM",
        "cover_badge": "خطوة بخطوة · ٨ خطوات",
        "cover_intro": [
            "هذا المستند يشرح لك خطوة بخطوة",
            "كيفية تثبيت GokyuzuWebSpam على خادم cPanel/WHM الخاص بك.",
            "",
            "الجمهور: مسؤول الخادم، مشغل غير تقني",
            "المدة: حوالي ٣٠ دقيقة (١٢ دقيقة إذا كان Docker مثبتاً)",
            "المتطلبات: صلاحية root عبر SSH، بريد إلكتروني بعد الشراء",
        ],
        "date_label": "تاريخ التقرير",
        "support_line": "الدعم: destek@gokyuzuhosting.com",
        "copyright": "© 2026 Gokyuzu Bilgisayar Ltd.",
        "footer_left": "GokyuzuWebSpam · دليل التثبيت",
        "footer_page": "صفحة",
        "pre_title": "قبل البدء",
        "pre_intro": ("هذا المستند مصمم لمساعدة فريقك على تثبيت GokyuzuWebSpam من الصفر. جميع الأوامر أدناه "
                      "جاهزة للنسخ واللصق. إذا واجهتك مشكلة، راسلنا على "
                      "<b>destek@gokyuzuhosting.com</b> مع لقطة شاشة."),
        "pre_need": "ما تحتاجه",
        "pre_items": [
            "<b>خادم Linux مع WHM/cPanel</b> (AlmaLinux 8+، Ubuntu 20.04+، RHEL 8+)",
            "<b>صلاحية root عبر SSH</b> (المستخدم: root، المنفذ: 22)",
            "<b>دومين</b> موجه إلى خادمك (مثال: panel.company.com)",
            "<b>بريد ما بعد الشراء</b> (يحتوي على مفتاح الترخيص)",
            "<b>٤ جيجا رام و ٤٠ جيجا مساحة حرة</b> على الأقل",
        ],
        "pre_warn": ("هذا التثبيت يتم على خادم <b>إنتاجي</b>. استخدم خادماً منفصلاً للاختبار أو خذ نسخة "
                     "احتياطية أولاً. الأمر الخاطئ قد يوقف خدمة Exim."),
        "step_label": "الخطوة",
        "duration_label": "المدة التقديرية",
        "expected_output": "الناتج المتوقع",
        "warning_label": "تحذير",
        "info_label": "معلومة",
        "steps": [
            {
                "t": "تحقق من بريد ما بعد الشراء",
                "d": "٢ دقيقة",
                "body": [
                    "بعد الشراء ستصلك رسالتان:",
                    "<b>١. الفاتورة والشروط</b> — فاتورة PDF وشروط الاستخدام<br/>"
                    "<b>٢. تفاصيل الترخيص</b> — البيانات الحرجة اللازمة للتثبيت",
                    "بريد الترخيص يحتوي على:",
                ],
                "code": (
                    "License Key:  MS-XXXXXXXXXXXXXXXXXXXXXX\n"
                    "Plan:         Enterprise (30 days)\n"
                    "IP Address:   123.45.67.89\n"
                    "Panel:        panel.company.com\n"
                    "Install URL:  https://gokyuzuhosting.com/install.sh"
                ),
                "warn": "<b>لا تشارك</b> مفتاح الترخيص مع أحد. هذا المفتاح هو قفل خادمك.",
            },
            {
                "t": "اتصل بالخادم عبر SSH",
                "d": "١ دقيقة",
                "body": [
                    "على Windows استخدم <b>PowerShell</b> أو <b>PuTTY</b>؛ على Mac/Linux افتح <b>Terminal</b>.",
                    "شغّل هذا الأمر (بعنوان IP خادمك):",
                ],
                "code": "ssh root@123.45.67.89",
                "body2": [
                    "أول مرة؟ اكتب 'yes' ثم Enter، ثم كلمة السر. لن تظهر كلمة السر أثناء الكتابة، هذا طبيعي.",
                ],
                "ok": "يجب أن ترى:  <font face='{mono}'>[root@server ~]#</font>",
                "info": "SSH يتطلب أن يكون المنفذ 22 مفتوحاً. إذا كان مغلقاً استخدم Console/VNC من المزود.",
            },
            {
                "t": "تحديث النظام + تثبيت Docker",
                "d": "٣-٥ دقائق",
                "body": ["<b>ملاحظة:</b> إذا كان Docker مثبتاً تخطى هذه الخطوة. للتحقق:"],
                "code": "docker --version",
                "body2": ["إذا ظهر رقم إصدار انتقل إلى الخطوة ٤. إذا لم يظهر، شغّل:"],
                "code2": (
                    "curl -fsSL https://get.docker.com | bash\n"
                    "systemctl enable --now docker\n"
                    "docker ps"
                ),
                "ok": "يجب أن ترى جدولاً فارغاً:  <font face='{mono}'>CONTAINER ID   IMAGE   ...</font>",
            },
            {
                "t": "شغّل سكربت تثبيت GokyuzuWebSpam",
                "d": "٨-١٢ دقيقة",
                "body": [
                    "أمر واحد يثبت كل شيء: MongoDB + Backend + Frontend + Nginx (مع SSL) + WHM plugin.",
                ],
                "code": (
                    "curl -fsSL https://gokyuzuhosting.com/install.sh -o /root/install.sh\n"
                    "chmod +x /root/install.sh\n"
                    "bash /root/install.sh"
                ),
                "body2": ["السكربت سيسألك:"],
                "code2": (
                    ">>> License key:  [ضع MS-... هنا]\n"
                    ">>> Panel domain: panel.company.com\n"
                    ">>> Admin email:  you@company.com\n"
                    ">>> SSL (Y/N):    Y"
                ),
                "list_title": "السكربت سيقوم تلقائياً بـ:",
                "list": [
                    "تحميل وتشغيل حاوية MongoDB",
                    "بناء صور Backend و Frontend",
                    "تركيب Nginx كوكيل عكسي (المنافذ 80، 443)",
                    "الحصول على شهادة Let's Encrypt",
                    "نسخ WHM plugin إلى /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/",
                    "ربط Exim milter",
                    "تسجيل مهمة cron للتحديث التلقائي (كل ٦ ساعات)",
                ],
                "ok": "عند الانتهاء:<br/><font face='{mono}'>Installation successful!</font>",
            },
            {
                "t": "سجّل الدخول إلى WHM وافتح الإضافة",
                "d": "١ دقيقة",
                "body": ["افتح المتصفح على العنوان (بعنوان IP خادمك):"],
                "code": "https://123.45.67.89:2087",
                "body2": [
                    "إذا ظهر تحذير الشهادة اضغط 'Advanced' → 'Proceed' (WHM self-signed).",
                    "سجّل الدخول كـ root.",
                    "انزل في القائمة اليسرى إلى <b>Plugins</b> واضغط أيقونة <b>MailShield</b>.",
                ],
                "ok": "<b>ستفتح اللوحة وستظهر شارة 'MASTER · 123.45.67.89' في الأعلى.</b>",
                "warn": ("إذا لم تظهر شارة MASTER فإن IP لا يطابق. راسل الدعم لإضافة IP إلى قائمة "
                         "Trusted IP يدوياً."),
            },
            {
                "t": "ربط حسابات cPanel باللوحة (اختياري)",
                "d": "٣ دقائق",
                "body": [
                    "بعد التثبيت يتم اكتشاف حسابات cPanel تلقائياً. اذهب إلى صفحة <b>Users</b>.",
                    "لكل حساب:",
                ],
                "list": [
                    "عدد الرسائل المرسلة/المستقبلة اليوم",
                    "نسبة اكتشاف السبام",
                    "عدد الرسائل في الحجر",
                    "درجة نظافة IP",
                ],
                "body2": ["يمكنك تعريف حد سرعة، قائمة بيضاء، وقناة تنبيه لكل حساب."],
            },
            {
                "t": "اختبر محركات البريد",
                "d": "٥ دقائق",
                "body": ["اذهب إلى <b>Engines</b> في اللوحة. تحقق أن هذه المحركات خضراء:"],
                "table_head": ["المحرك", "الوظيفة", "الحالة"],
                "table_rows": [
                    ["SpamAssassin", "تقييم السبام بالمحتوى", "نشط"],
                    ["ClamAV", "فحص الفيروسات", "نشط"],
                    ["DCC / Razor / Pyzor", "بصمة البريد الجماعي", "نشط"],
                    ["RBL / DNSBL", "قوائم IP السوداء", "نشط"],
                    ["SPF / DKIM / DMARC", "التحقق من الهوية", "نشط"],
                    ["LLM AI", "تصنيف الذكاء الاصطناعي", "اختياري"],
                ],
                "body2": [
                    "<b>اختبار:</b> صفحة <b>Mail Simulator</b> بها phishing .eml جاهز. اضغط 'Simulate'.",
                ],
                "ok": "إذا كانت النتيجة <b>QUARANTINE</b> ونقاط ٧٠+ فالحماية تعمل.",
            },
            {
                "t": "اربط قنوات التنبيهات",
                "d": "٥ دقائق",
                "body": [
                    "اذهب إلى <b>System → Settings → Notifications</b>. اضبط قناة أو أكثر:",
                ],
                "table_head": ["القناة", "طريقة الربط", "التكلفة"],
                "table_rows": [
                    ["البريد الإلكتروني", "SMTP (SendGrid/SES/Postfix)", "مجاني"],
                    ["Slack", "Incoming Webhook URL", "مجاني"],
                    ["Discord", "Channel Webhook URL", "مجاني"],
                    ["Telegram", "BotFather token + chat_id", "مجاني"],
                    ["إشعارات المتصفح", "طلب إذن تلقائي", "مجاني"],
                    ["SMS (Twilio)", "مفتاح Twilio مطلوب", "مدفوع"],
                ],
            },
        ],
        "trouble_title": "استكشاف الأخطاء",
        "trouble": [
            ("اللوحة لا تفتح / 502 Bad Gateway",
             "قد لا تعمل حاويات Docker.",
             "cd /opt/gokyuzuwebspam-app/deployment && docker compose ps\ndocker compose up -d"),
            ("شارة MASTER لا تظهر",
             "IP لا يطابق. تحقق من الترخيص.",
             "curl -H 'X-Master-Key: MS-...' http://127.0.0.1:8001/api/admin/whoami"),
            ("الحجر فارغ",
             "تحقق أن milter لـ Exim مسجّل.",
             "cat /etc/exim.conf.local | grep -i milter"),
            ("فشل شهادة SSL",
             "قد لا يشير الدومين إلى الخادم.",
             "dig +short panel.company.com"),
        ],
        "update_title": "ابقَ محدّثاً",
        "update_body": "طريقتان لإبقاء اللوحة محدّثة:",
        "update_auto_h": "الطريقة ١: تلقائي (موصى بها)",
        "update_auto_b": "تُثبَّت مهمة cron أثناء التثبيت. تفحص كل ٦ ساعات.",
        "update_auto_code": "cat /etc/cron.d/gws-autoupdate",
        "update_manual_h": "الطريقة ٢: يدوي",
        "update_manual_b": "للتحديث في أي وقت:",
        "update_manual_code": "cd /opt/gokyuzuwebspam-app\nbash auto-update.sh",
        "update_info": ("يحدث انقطاع بحوالي ٣٠ ثانية. Mail Continuity يضع الرسائل في الطابور ويعيد "
                        "تشغيلها عند عودة الخادم."),
        "support_title": "المساعدة والدعم",
        "support_head": ["القناة", "كيف", "زمن الرد"],
        "support_rows": [
            ["البريد الإلكتروني", "destek@gokyuzuhosting.com", "٢٤ ساعة"],
            ["دردشة اللوحة", "رسالة داخل اللوحة", "ساعات العمل"],
            ["Slack Community", "gokyuzu.slack.com", "المجتمع"],
            ["التوثيق", "تبويب داخل اللوحة", "فوري"],
        ],
        "closing_h": "اكتمل التثبيت — تهانينا!",
        "closing_b": ("خادم cPanel الآن محمي بأمان بريدي على مستوى المؤسسات. خلال أول ٢٤ ساعة سترى "
                      "آلاف رسائل السبام المحظورة في لوحة القيادة."),
    },
}


# ---------- Text helper (shape Arabic + basic HTML entity escape) ----------
def T(text, lang):
    """Return text ready for reportlab paragraph. Handles Arabic shaping."""
    if lang == "ar":
        # We can NOT reshape HTML tags. So we split by tags and shape only text parts.
        # Simple approach: run reshaping on the whole string. reportlab's Paragraph
        # renders bidi already but doesn't do Arabic joining, so we need reshaping.
        import re
        parts = re.split(r"(<[^>]+>)", text)
        return "".join(ar_shape(p) if not p.startswith("<") else p for p in parts)
    return text


def build(lang="tr", out_path=None):
    """Build the installation guide PDF in the requested language."""
    if lang not in I18N:
        lang = "tr"
    L = I18N[lang]
    RTL = lang == "ar"

    if lang == "ar":
        FONT, FONT_BOLD = FONT_AR, FONT_AR_BOLD
    else:
        FONT, FONT_BOLD = FONT_LATIN, FONT_LATIN_BOLD

    align = TA_RIGHT if RTL else TA_LEFT
    align_body = TA_RIGHT if RTL else TA_JUSTIFY

    s = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=s["Heading1"], fontName=FONT_BOLD, fontSize=22,
                        textColor=INDIGO, leading=26, spaceBefore=16, spaceAfter=10, alignment=align)
    h2 = ParagraphStyle("H2", parent=s["Heading2"], fontName=FONT_BOLD, fontSize=15,
                        textColor=DARK, leading=18, spaceBefore=10, spaceAfter=6, alignment=align)
    body = ParagraphStyle("B", parent=s["Normal"], fontName=FONT, fontSize=11,
                          textColor=DARK, leading=16, spaceAfter=6, alignment=align_body,
                          wordWrap="RTL" if RTL else None)

    def code(text_code):
        pre = Preformatted(text_code, ParagraphStyle("C", fontName=FONT_MONO, fontSize=9,
                                                     textColor=CODE_TEXT, leading=13))
        tbl = Table([[pre]], colWidths=[16.5*cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        return tbl

    def box(text, bg_hex, border_hex, fg_hex, label):
        content = f"<b>{T(label, lang)}:</b> {T(text.replace('{mono}', FONT_MONO), lang)}"
        p = Paragraph(content, ParagraphStyle("BX", fontName=FONT, fontSize=10,
                                              textColor=HexColor(fg_hex), leading=14,
                                              alignment=align_body,
                                              wordWrap="RTL" if RTL else None))
        tbl = Table([[p]], colWidths=[16.5*cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor(bg_hex)),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 1, HexColor(border_hex)),
        ]))
        return tbl

    def warn_box(text): return box(text, "#FEF3C7", "#D97706", "#78350F", L["warning_label"])
    def info_box(text): return box(text, "#E0F2FE", "#0EA5E9", "#075985", L["info_label"])
    def ok_box(text):  return box(text, "#D1FAE5", "#059669", "#064E3B", L["expected_output"])

    def sh(n, tt, dur):
        header_p = Paragraph(
            f"<font size='16' color='white'><b>{T(L['step_label'], lang)} {n}</b></font>&nbsp;&nbsp;"
            f"<font size='13' color='#F1F5F9'>{T(tt, lang)}</font><br/>"
            f"<font size='9' color='#94A3B8'>{T(L['duration_label'], lang)}: {T(dur, lang)}</font>",
            ParagraphStyle("SH", fontName=FONT, fontSize=11, textColor=white, leading=15, alignment=align)
        )
        t = Table([[header_p]], colWidths=[16.5*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), INDIGO),
            ("LEFTPADDING", (0, 0), (-1, -1), 14),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        return t

    story = []

    # ---- COVER (drawn via canvas onFirstPage; we still need one PageBreak to move past cover) ----
    story.append(PageBreak())

    # ---- BAŞLANGIÇ / Before You Start ----
    story.append(Paragraph(T(L["pre_title"], lang), h1))
    story.append(Paragraph(T(L["pre_intro"], lang), body))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(T(L["pre_need"], lang), h2))
    for g in L["pre_items"]:
        story.append(Paragraph("• " + T(g, lang), body))
        story.append(Spacer(1, 0.1*cm))
    story.append(Spacer(1, 0.3*cm))
    story.append(warn_box(L["pre_warn"]))
    story.append(PageBreak())

    # ---- STEPS ----
    for idx, st in enumerate(L["steps"], start=1):
        story.append(sh(idx, st["t"], st["d"]))
        story.append(Spacer(1, 0.4*cm))

        for para in st.get("body", []):
            story.append(Paragraph(T(para, lang), body))

        if "code" in st:
            story.append(code(st["code"]))
            story.append(Spacer(1, 0.15*cm))

        for para in st.get("body2", []):
            story.append(Paragraph(T(para, lang), body))

        if "code2" in st:
            story.append(code(st["code2"]))
            story.append(Spacer(1, 0.15*cm))

        if "list_title" in st:
            story.append(Paragraph(T(st["list_title"], lang), body))
        for li in st.get("list", []):
            story.append(Paragraph("• " + T(li, lang), body))
            story.append(Spacer(1, 0.06*cm))

        if "table_head" in st:
            headers = [T(x, lang) for x in st["table_head"]]
            rows = [[T(cell, lang) for cell in r] for r in st["table_rows"]]
            data = [headers] + rows
            tbl = Table(data, colWidths=[4.5*cm, 8.5*cm, 3.5*cm])
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), INDIGO),
                ("TEXTCOLOR", (0, 0), (-1, 0), white),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
                ("FONTSIZE", (0, 0), (-1, 0), 10),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#F1F5F9")]),
                ("FONTNAME", (0, 1), (-1, -1), FONT),
                ("FONTSIZE", (0, 1), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("ALIGN", (0, 0), (-1, -1), "RIGHT" if RTL else "LEFT"),
            ]))
            story.append(tbl)
            story.append(Spacer(1, 0.3*cm))

        if "ok" in st:
            story.append(Spacer(1, 0.15*cm))
            story.append(ok_box(st["ok"]))
        if "warn" in st:
            story.append(Spacer(1, 0.15*cm))
            story.append(warn_box(st["warn"]))
        if "info" in st:
            story.append(Spacer(1, 0.15*cm))
            story.append(info_box(st["info"]))
        story.append(PageBreak())

    # ---- TROUBLESHOOTING ----
    story.append(Paragraph(T(L["trouble_title"], lang), h1))
    story.append(Spacer(1, 0.2*cm))
    for t, d, cmd in L["trouble"]:
        story.append(Paragraph(f"<b>{T(t, lang)}</b>", h2))
        story.append(Paragraph(T(d, lang), body))
        story.append(code(cmd))
        story.append(Spacer(1, 0.3*cm))
    story.append(PageBreak())

    # ---- UPDATE ----
    story.append(Paragraph(T(L["update_title"], lang), h1))
    story.append(Paragraph(T(L["update_body"], lang), body))
    story.append(Paragraph(T(L["update_auto_h"], lang), h2))
    story.append(Paragraph(T(L["update_auto_b"], lang), body))
    story.append(code(L["update_auto_code"]))
    story.append(Paragraph(T(L["update_manual_h"], lang), h2))
    story.append(Paragraph(T(L["update_manual_b"], lang), body))
    story.append(code(L["update_manual_code"]))
    story.append(Spacer(1, 0.3*cm))
    story.append(info_box(L["update_info"]))
    story.append(Spacer(1, 0.5*cm))

    # ---- SUPPORT ----
    story.append(Paragraph(T(L["support_title"], lang), h1))
    headers = [T(x, lang) for x in L["support_head"]]
    rows = [[T(c, lang) for c in r] for r in L["support_rows"]]
    tbl3 = Table([headers] + rows, colWidths=[4*cm, 8*cm, 4.5*cm])
    tbl3.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), EMERALD),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#ECFDF5")]),
        ("FONTNAME", (0, 1), (-1, -1), FONT),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#6EE7B7")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT" if RTL else "LEFT"),
    ]))
    story.append(tbl3)

    story.append(Spacer(1, 1*cm))
    closing_txt = (
        f"<font color='white' size='16'><b>{T(L['closing_h'], lang)}</b></font><br/>"
        f"<font color='#E2E8F0' size='11'>{T(L['closing_b'], lang)}</font>"
    )
    closing_p = Paragraph(closing_txt, ParagraphStyle(
        "CL", fontName=FONT, fontSize=11, textColor=white, leading=16, alignment=align
    ))
    closing = Table([[closing_p]], colWidths=[16.5*cm])
    closing.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 20),
        ("RIGHTPADDING", (0, 0), (-1, -1), 20),
        ("TOPPADDING", (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
    ]))
    story.append(closing)

    # ---- COVER + FOOTER ----
    def cover(c, d):
        c.saveState()
        W, H = A4
        c.setFillColor(DARK); c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(INDIGO); c.setFillAlpha(0.15)
        p = c.beginPath(); p.moveTo(0, H); p.lineTo(W, H - 8*cm); p.lineTo(W, H); p.close()
        c.drawPath(p, fill=1, stroke=0); c.setFillAlpha(1.0)
        c.setFillColor(INDIGO); c.roundRect(2.5*cm, H - 5*cm, 2.4*cm, 2.4*cm, 0.4*cm, fill=1, stroke=0)
        c.setFillColor(white); c.setFont(FONT_BOLD, 32); c.drawString(3.0*cm, H - 3.9*cm, "→")
        c.setFillColor(white); c.setFont(FONT_BOLD, 42)
        c.drawString(2.5*cm, H - 8*cm, T(L["cover_title"], lang))
        c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 15)
        c.drawString(2.5*cm, H - 8.9*cm, T(L["cover_sub"], lang))
        c.setFillColor(HexColor("#F59E0B")); c.roundRect(2.5*cm, H - 10.5*cm, 6.5*cm, 0.9*cm, 0.15*cm, fill=1, stroke=0)
        c.setFillColor(DARK); c.setFont(FONT_BOLD, 11)
        c.drawString(2.85*cm, H - 10.24*cm, T(L["cover_badge"], lang))
        c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 12)
        y = H - 12.5*cm
        for line in L["cover_intro"]:
            c.drawString(2.5*cm, y, T(line, lang)); y -= 0.55*cm
        c.setStrokeColor(HexColor("#334155")); c.line(2.5*cm, 3*cm, W - 2.5*cm, 3*cm)
        c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 9)
        c.drawString(2.5*cm, 2.5*cm, f"{T(L['date_label'], lang)}: {datetime.now().strftime('%d.%m.%Y')}")
        c.drawString(2.5*cm, 2.1*cm, T(L["support_line"], lang))
        c.setFillColor(HexColor("#64748B")); c.setFont(FONT, 8)
        c.drawRightString(W - 2.5*cm, 1.7*cm, T(L["copyright"], lang))
        c.restoreState()

    def footer(c, d):
        if d.page == 1:
            return
        c.saveState()
        W, H = A4
        c.setStrokeColor(HexColor("#E2E8F0")); c.line(2*cm, 1.5*cm, W - 2*cm, 1.5*cm)
        c.setFillColor(GRAY); c.setFont(FONT, 8)
        c.drawString(2*cm, 1*cm, T(L["footer_left"], lang))
        c.drawRightString(W - 2*cm, 1*cm, f"{T(L['footer_page'], lang)} {d.page}")
        c.restoreState()

    # ---- Output path ----
    if out_path is None:
        suffix = {"tr": "", "en": "-EN", "ar": "-AR"}.get(lang, "")
        out_path = f"/app/GokyuzuWebSpam-Kurulum-Rehberi-v43.99{suffix}.pdf"

    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
        title=L["meta_title"], author="Gokyuzu Bilgisayar Ltd."
    )
    doc.build(story, onFirstPage=cover, onLaterPages=footer)
    return out_path


if __name__ == "__main__":
    langs = sys.argv[1:] or ["tr", "en", "ar"]
    for lang in langs:
        try:
            out = build(lang)
            size_kb = os.path.getsize(out) / 1024
            print(f"✓ [{lang}] {out} ({size_kb:.1f} KB)")
        except Exception as e:
            print(f"✗ [{lang}] {e}")
            raise
