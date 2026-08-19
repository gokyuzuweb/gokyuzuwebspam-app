#!/usr/bin/env python3
"""
Kurulum Rehberi PDF — X firması cPanel sunucusuna nasıl kurar
v43.99.8 · Adım adım · Aptala anlatır gibi
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem, Preformatted,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime

try:
    pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("DejaVu-Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
    FONT, FONT_BOLD, FONT_MONO = "DejaVu", "DejaVu-Bold", "DejaVu-Mono"
except Exception:
    FONT, FONT_BOLD, FONT_MONO = "Helvetica", "Helvetica-Bold", "Courier"

INDIGO = HexColor("#4338CA")
ROSE = HexColor("#E11D48")
EMERALD = HexColor("#059669")
AMBER = HexColor("#D97706")
DARK = HexColor("#0F172A")
GRAY = HexColor("#64748B")
CODE_BG = HexColor("#0F172A")
CODE_TEXT = HexColor("#CBD5E1")

s = getSampleStyleSheet()
title = ParagraphStyle("T", parent=s["Title"], fontName=FONT_BOLD, fontSize=32, textColor=INDIGO, leading=38, spaceAfter=8, alignment=TA_LEFT)
h1 = ParagraphStyle("H1", parent=s["Heading1"], fontName=FONT_BOLD, fontSize=22, textColor=INDIGO, leading=26, spaceBefore=16, spaceAfter=10)
h2 = ParagraphStyle("H2", parent=s["Heading2"], fontName=FONT_BOLD, fontSize=15, textColor=DARK, leading=18, spaceBefore=10, spaceAfter=6)
body = ParagraphStyle("B", parent=s["Normal"], fontName=FONT, fontSize=11, textColor=DARK, leading=16, spaceAfter=6, alignment=TA_JUSTIFY)
step_num = ParagraphStyle("SN", parent=body, fontName=FONT_BOLD, fontSize=13, textColor=ROSE, leading=16, spaceAfter=6)
warn = ParagraphStyle("W", parent=body, fontSize=10, textColor=HexColor("#78350F"), leading=14, backColor=HexColor("#FEF3C7"), borderPadding=8)
info = ParagraphStyle("I", parent=body, fontSize=10, textColor=HexColor("#075985"), leading=14, backColor=HexColor("#E0F2FE"), borderPadding=8)


def code_block(text):
    return Table(
        [[Preformatted(text, ParagraphStyle("C", fontName=FONT_MONO, fontSize=9, textColor=CODE_TEXT, leading=13))]],
        colWidths=[16.5*cm]
    ).setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ])) or Table([[Preformatted(text, ParagraphStyle("C", fontName=FONT_MONO, fontSize=9, textColor=CODE_TEXT, leading=13))]], colWidths=[16.5*cm])


def code(text):
    tbl = Table(
        [[Preformatted(text, ParagraphStyle("C", fontName=FONT_MONO, fontSize=9, textColor=CODE_TEXT, leading=13))]],
        colWidths=[16.5*cm]
    )
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return tbl


def warn_box(text):
    tbl = Table([[Paragraph(f"<b>⚠ Dikkat:</b> {text}", ParagraphStyle('W', fontName=FONT, fontSize=10, textColor=HexColor('#78350F'), leading=14))]], colWidths=[16.5*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FEF3C7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 1, AMBER),
    ]))
    return tbl


def info_box(text):
    tbl = Table([[Paragraph(f"<b>ℹ Bilgi:</b> {text}", ParagraphStyle('I', fontName=FONT, fontSize=10, textColor=HexColor('#075985'), leading=14))]], colWidths=[16.5*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#E0F2FE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 1, HexColor("#0EA5E9")),
    ]))
    return tbl


def ok_box(text):
    tbl = Table([[Paragraph(f"<b>✓ Beklenen çıktı:</b> {text}", ParagraphStyle('OK', fontName=FONT, fontSize=10, textColor=HexColor('#064E3B'), leading=14))]], colWidths=[16.5*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#D1FAE5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 1, EMERALD),
    ]))
    return tbl


def step_header(n, tt, dur):
    return Table([[
        Paragraph(f"<font size='16' color='white'><b>ADIM {n}</b></font><br/>"
                  f"<font size='11' color='#F1F5F9'>{tt}</font><br/>"
                  f"<font size='9' color='#94A3B8'>⏱ Tahmini süre: {dur}</font>",
                  body)
    ]], colWidths=[16.5*cm])


def sh(n, tt, dur):
    t = Table([[
        Paragraph(
            f"<font size='16' color='white'><b>ADIM {n}</b></font>&nbsp;&nbsp;"
            f"<font size='13' color='#F1F5F9'>{tt}</font><br/>"
            f"<font size='9' color='#94A3B8'>⏱ Tahmini süre: {dur}</font>",
            ParagraphStyle("SH", fontName=FONT, fontSize=11, textColor=white, leading=15)
        )
    ]], colWidths=[16.5*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), INDIGO),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


story = []

# COVER
def cover(c, d):
    c.saveState()
    W, H = A4
    c.setFillColor(DARK); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(INDIGO); c.setFillAlpha(0.15)
    p = c.beginPath(); p.moveTo(0, H); p.lineTo(W, H - 8*cm); p.lineTo(W, H); p.close()
    c.drawPath(p, fill=1, stroke=0); c.setFillAlpha(1.0)
    c.setFillColor(INDIGO); c.roundRect(2.5*cm, H - 5*cm, 2.4*cm, 2.4*cm, 0.4*cm, fill=1, stroke=0)
    c.setFillColor(white); c.setFont(FONT_BOLD, 32); c.drawString(3.0*cm, H - 3.9*cm, "→")
    c.setFillColor(white); c.setFont(FONT_BOLD, 42); c.drawString(2.5*cm, H - 8*cm, "Kurulum Rehberi")
    c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 15); c.drawString(2.5*cm, H - 8.9*cm, "cPanel/WHM sunucusuna GökyüzüWebSpam kurulumu")
    c.setFillColor(HexColor("#F59E0B")); c.roundRect(2.5*cm, H - 10.5*cm, 5*cm, 0.9*cm, 0.15*cm, fill=1, stroke=0)
    c.setFillColor(DARK); c.setFont(FONT_BOLD, 11); c.drawString(2.85*cm, H - 10.24*cm, "APTALA ANLATIR GIBI · 8 ADIM")
    c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 12)
    lines = [
        "Bu belge, ürünü satın aldıktan sonra kendi",
        "cPanel/WHM sunucunuza nasıl kuracağınızı adım adım anlatır.",
        "",
        "Hedef kitle: Sunucu yöneticisi, teknik olmayan operatör",
        "Süre: Toplam ~30 dakika (Docker kurulu ise 12 dakika)",
        "Gerekli: SSH root erişimi, WHM login, satın alma sonrası e-posta",
    ]
    y = H - 12.5*cm
    for l in lines:
        c.drawString(2.5*cm, y, l); y -= 0.55*cm
    c.setStrokeColor(HexColor("#334155")); c.line(2.5*cm, 3*cm, W - 2.5*cm, 3*cm)
    c.setFillColor(HexColor("#94A3B8")); c.setFont(FONT, 9)
    c.drawString(2.5*cm, 2.5*cm, f"Rapor Tarihi: {datetime.now().strftime('%d %B %Y')}")
    c.drawString(2.5*cm, 2.1*cm, "Destek: destek@gokyuzuhosting.com")
    c.setFillColor(HexColor("#64748B")); c.setFont(FONT, 8)
    c.drawRightString(W - 2.5*cm, 1.7*cm, "© 2026 Gökyüzü Bilgisayar Ltd.")
    c.restoreState()


def footer(c, d):
    if d.page == 1: return
    c.saveState()
    W, H = A4
    c.setStrokeColor(HexColor("#E2E8F0")); c.line(2*cm, 1.5*cm, W - 2*cm, 1.5*cm)
    c.setFillColor(GRAY); c.setFont(FONT, 8)
    c.drawString(2*cm, 1*cm, "GökyüzüWebSpam · Kurulum Rehberi")
    c.drawRightString(W - 2*cm, 1*cm, f"Sayfa {d.page}")
    c.restoreState()


story.append(PageBreak())

# BAŞLANGIÇ
story.append(Paragraph("Başlamadan Önce", h1))
story.append(Paragraph(
    "Bu belge X firmasının sıfırdan GökyüzüWebSpam kurulumunu tamamlaması için hazırlanmıştır. "
    "Her komut kopyalanıp yapıştırılabilir. Anlamadığınız yer olursa <b>destek@gokyuzuhosting.com</b> "
    "adresine yazın, ekran görüntüsü ile birlikte gönderin.", body))
story.append(Spacer(1, 0.3*cm))

story.append(Paragraph("Elinizde olması gerekenler", h2))
gerekli = [
    "🖥 <b>WHM/cPanel yüklü bir Linux sunucu</b> (AlmaLinux 8+, CentOS 8+, Ubuntu 20.04+, RHEL 8+)",
    "🔑 <b>SSH root erişimi</b> (kullanıcı adı: root, port: 22 - varsayılan)",
    "🌐 <b>Sunucunuza yönlendirilmiş bir domain</b> (örn: panel.firmaniz.com)",
    "📧 <b>Satın alma sonrası size gönderilen e-posta</b> (lisans anahtarınız burada)",
    "💾 <b>4 GB RAM, 40 GB disk boş alan</b> minimum (100+ hesap için 8 GB RAM önerilir)",
]
for g in gerekli:
    story.append(Paragraph(g, body))
    story.append(Spacer(1, 0.1*cm))

story.append(Spacer(1, 0.3*cm))
story.append(warn_box("Bu kurulum <b>PRODUCTION</b> sunucuda yapılır. Test için ayrı bir sunucu kullanın veya "
                       "önce bir snapshot alın. Yanlış komut Exim mail servisini durdurabilir."))
story.append(PageBreak())

# ADIM 1
story.append(sh(1, "Satın Alma Sonrası E-postanızı Kontrol Edin", "2 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph(
    "Ürünü satın aldıktan hemen sonra size iki e-posta gelir:", body))
story.append(Paragraph(
    "<b>1. Fatura & Sözleşme</b> — muhasebe için PDF fatura, kullanım şartları<br/>"
    "<b>2. Lisans Bilgileri</b> — kurulum için gereken kritik veriler", body))
story.append(Paragraph("Lisans e-postasında şu bilgiler olacak:", body))
story.append(code(
    "Lisans Anahtarınız:  MS-XXXXXXXXXXXXXXXXXXXXXX\n"
    "Plan:                Enterprise (30 gün)\n"
    "IP Adresi:           123.45.67.89 (sunucunuzun IP'si)\n"
    "Panel Domain:        panel.firmaniz.com\n"
    "Kurulum URL'i:       https://gokyuzuhosting.com/install.sh\n"
    "Destek:              destek@gokyuzuhosting.com"
))
story.append(Spacer(1, 0.2*cm))
story.append(warn_box("Lisans anahtarınızı <b>ASLA</b> kimseyle paylaşmayın, forum ve chat kanallarına yazmayın. "
                       "Bu anahtar sunucunuzun kilididir."))
story.append(PageBreak())

# ADIM 2
story.append(sh(2, "Sunucuya SSH ile Bağlanın", "1 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Windows kullanıyorsanız <b>PowerShell</b> veya <b>PuTTY</b>; Mac/Linux'ta <b>Terminal</b> açın.", body))
story.append(Paragraph("Şu komutu yazın (kendi sunucu IP'nizi girin):", body))
story.append(code("ssh root@123.45.67.89"))
story.append(Paragraph("İlk kez bağlanıyorsanız 'yes' yazıp Enter, sonra root şifrenizi girin. Girerken şifre görünmez, "
                        "bu normaldir — yazıp Enter'a basın.", body))
story.append(Spacer(1, 0.2*cm))
story.append(ok_box("Şu satırı görmelisiniz:  <font face='Courier'>[root@sunucu ~]#</font>"))
story.append(Spacer(1, 0.3*cm))
story.append(info_box("SSH bağlantısı için port 22'nin açık olması gerekir. Güvenlik duvarınız kapalıysa "
                       "provider paneli üzerinden Console/VNC ile de girebilirsiniz."))
story.append(PageBreak())

# ADIM 3
story.append(sh(3, "Sistem Güncellemesi + Docker Kurulumu", "3-5 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("<b>Not:</b> Docker zaten kuruluysa bu adımı atlayabilirsiniz. Kontrol için:", body))
story.append(code("docker --version"))
story.append(Paragraph("Bir sürüm numarası gelirse (örn. <i>Docker version 24.0.7</i>) direkt Adım 4'e geçin. "
                        "'command not found' derse aşağıdaki komutu çalıştırın:", body))
story.append(Spacer(1, 0.2*cm))
story.append(code(
    "# Docker + Docker Compose tek komutla kur (universal script)\n"
    "curl -fsSL https://get.docker.com | bash\n"
    "\n"
    "# Docker servisini başlat + otomatik başlatma\n"
    "systemctl enable --now docker\n"
    "\n"
    "# Kontrol\n"
    "docker ps"
))
story.append(Spacer(1, 0.2*cm))
story.append(ok_box("Boş bir tablo görmelisiniz:  <font face='Courier'>CONTAINER ID   IMAGE   COMMAND   ...</font>"))
story.append(PageBreak())

# ADIM 4
story.append(sh(4, "GökyüzüWebSpam Kurulum Script'ini Çalıştırın", "8-12 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph(
    "Tek komutla tüm kurulum otomatik yapılacak: MongoDB + Backend + Frontend + Nginx (SSL dahil) + "
    "WHM plugin registration.", body))
story.append(code(
    "# Kurulum script'ini indirin\n"
    "curl -fsSL https://gokyuzuhosting.com/install.sh -o /root/install.sh\n"
    "\n"
    "# Çalıştırma iznini verin\n"
    "chmod +x /root/install.sh\n"
    "\n"
    "# Interactive kurulumu başlatın\n"
    "bash /root/install.sh"
))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph("Script size şu bilgileri sıra ile soracak:", body))
story.append(code(
    ">>> Lisans anahtarınızı girin: [buraya MS-... yapıştırın]\n"
    ">>> Panel domain'i:            panel.firmaniz.com\n"
    ">>> Admin e-posta:             siz@firmaniz.com\n"
    ">>> SSL sertifikası (E)vet/(H)ayır: E"
))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph("Bu adımdan sonra script otomatik yapacak:", body))
liste = [
    "MongoDB Docker container'ını indirir & başlatır",
    "Backend + Frontend Docker image'larını derler",
    "Nginx reverse proxy kurar (portlar: 80, 443)",
    "Let's Encrypt SSL sertifikasını otomatik alır",
    "WHM plugin'i /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/ dizinine kopyalar",
    "Exim milter entegrasyonunu ayarlar (giden mail denetimi)",
    "MASTER_LICENSE_KEY, MASTER_IP, MASTER_HOST .env dosyalarına yazılır",
    "Otomatik güncelleme cron'unu ekler (6 saatte bir yeni sürüm kontrol)",
]
for l in liste:
    story.append(Paragraph(f"• {l}", body))
    story.append(Spacer(1, 0.08*cm))
story.append(Spacer(1, 0.3*cm))
story.append(ok_box("Kurulum bitince ekranın en altında şunu göreceksiniz:<br/>"
                     "<font face='Courier'>🎉 Kurulum başarılı! WHM → MailShield ikonuna tıklayın.</font>"))
story.append(PageBreak())

# ADIM 5
story.append(sh(5, "WHM'e Giriş Yapın ve Plugin'i Açın", "1 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Tarayıcınızda şu adresi açın (kendi sunucu IP'niz):", body))
story.append(code("https://123.45.67.89:2087"))
story.append(Paragraph("Sertifika uyarısı gelirse 'Gelişmiş' → 'Yine de git' deyin (WHM default self-signed).", body))
story.append(Paragraph("WHM root kullanıcı adı + şifre ile giriş yapın.", body))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph("Ana ekranda sol menüde <b>Plugins</b> bölümüne kadar aşağı inin. "
                        "Buradaki <b>MailShield</b> ikonuna tıklayın.", body))
story.append(Spacer(1, 0.2*cm))
story.append(ok_box("<b>Panel otomatik açılır ve sağ üstte 'MASTER · 123.45.67.89' rozeti gelir.</b><br/>"
                     "Sol menüde tüm özellikler açıktır: Ayarlar, Lisanslar, Motorlar, Threat Defense..."))
story.append(Spacer(1, 0.2*cm))
story.append(warn_box("Sağ üstte 'MASTER' rozeti GÖRÜNMÜYORSA veya sadece 'Bayi' modu açıksa, muhtemelen "
                       "Master IP eşleşmiyor. Destek e-postası atın, IP'nizi manuel Trusted IP listesine ekleriz."))
story.append(PageBreak())

# ADIM 6
story.append(sh(6, "cPanel Hesaplarını Panele Bağlayın (Opsiyonel)", "3 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Kurulum bitince cPanel hesaplarınız otomatik keşfedilir. Panelinizde "
                        "<b>Kullanıcılar</b> sayfasına gidin — tüm hesaplarınızı görürsünüz.", body))
story.append(Paragraph("Hesap başına:", body))
liste2 = [
    "Bugün gönderdiği/aldığı mail sayısı",
    "Spam yakalama oranı",
    "Karantinadaki mail sayısı",
    "IP hijyeni skoru",
]
for l in liste2:
    story.append(Paragraph(f"• {l}", body))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph("İsterseniz her hesap için ayrı hız limiti, ayrı whitelist, ayrı bildirim kanalı "
                        "tanımlayabilirsiniz.", body))
story.append(PageBreak())

# ADIM 7
story.append(sh(7, "Mail Motorlarını Test Edin", "5 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Panelde <b>Motorlar</b> sayfasına gidin. Şu motorların yeşil olduğunu kontrol edin:", body))
motorlar = [
    ["Motor", "Amaç", "Durum"],
    ["SpamAssassin", "İçerik bazlı spam skorlaması", "🟢 Aktif"],
    ["ClamAV", "Virüs/malware taraması", "🟢 Aktif"],
    ["DCC / Razor / Pyzor", "Bulk mail parmak izi tespiti", "🟢 Aktif"],
    ["RBL / DNSBL", "IP kara listesi (Spamhaus, Barracuda)", "🟢 Aktif"],
    ["SPF / DKIM / DMARC", "Kimlik doğrulama", "🟢 Aktif"],
    ["LLM AI Classifier", "Yapay zeka sınıflandırma", "🟡 Opsiyonel"],
]
tbl = Table(motorlar, colWidths=[4.5*cm, 8.5*cm, 3.5*cm])
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
]))
story.append(tbl)
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("<b>Test mail gönderin:</b> Panelin <b>Mail Simulator</b> sayfasında hazır bir phishing "
                        ".eml örneği var. 'Simüle Et' butonuna basın — engellenip engellenmediğini "
                        "gerçek motorlar üzerinden test eder.", body))
story.append(Spacer(1, 0.2*cm))
story.append(ok_box("Simulator sonucu <b>QUARANTINE</b> ve skor 70+ ise koruma çalışıyor demektir."))
story.append(PageBreak())

# ADIM 8
story.append(sh(8, "Bildirim Kanallarını Bağlayın", "5 dk"))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph("Karantinada mail biriktiğinde veya kritik incident oluştuğunda size nasıl haber verilmesini "
                        "istiyorsunuz? Panelde <b>Sistem → Ayarlar → Bildirimler</b> sekmesine gidin.", body))
story.append(Paragraph("Aşağıdakilerden birini veya birkaçını yapılandırın:", body))
kanallar = [
    ["Kanal", "Nasıl Bağlanır", "Ücret"],
    ["E-posta", "SMTP ayarlarını girin (SendGrid/SES veya kendi Postfix'iniz)", "Ücretsiz*"],
    ["Slack", "Slack workspace → Incoming Webhook URL'i yapıştırın", "Ücretsiz"],
    ["Discord", "Discord server → Channel Webhook URL'i yapıştırın", "Ücretsiz"],
    ["Telegram", "@BotFather'dan bot token alın + chat_id girin", "Ücretsiz"],
    ["Tarayıcı Push", "Panel açık kaldığında otomatik izin isteyecek", "Ücretsiz"],
    ["SMS (Twilio)", "Ücretli — Twilio API key gerekir", "Ücretli"],
]
tbl2 = Table(kanallar, colWidths=[3.5*cm, 10*cm, 3*cm])
tbl2.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), ROSE),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
    ("FONTSIZE", (0, 0), (-1, 0), 10),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#FEF2F2")]),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 9),
    ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#FCA5A5")),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
]))
story.append(tbl2)
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph("<font size='9' color='#64748B'>*E-posta için SendGrid Free plan yeterlidir (100 mail/gün ücretsiz).</font>", body))
story.append(PageBreak())

# TROUBLESHOOTING
story.append(Paragraph("Sorun Giderme", h1))
story.append(Spacer(1, 0.2*cm))
sorunlar = [
    ("Panel açılmıyor / 502 Bad Gateway",
     "Docker container'lar başlamamış olabilir.",
     "cd /opt/gokyuzuwebspam-app/deployment && docker compose ps\n"
     "# Hepsi 'Up' değilse:\n"
     "docker compose up -d"),
    ("MASTER rozeti gelmiyor",
     "IP eşleşmesi olmadı. Anahtar geçerli mi kontrol edin.",
     "curl -H 'X-Master-Key: MS-...' http://127.0.0.1:8001/api/admin/whoami\n"
     "# is_master: true dönmeli"),
    ("Karantinada hiç mail yok",
     "Exim milter kayıtlı mı kontrol edin.",
     "cat /etc/exim.conf.local | grep -i milter\n"
     "# smtp_milters = inet:127.0.0.1:8891 satırı olmalı"),
    ("Docker build hatası (litellm çakışması)",
     "requirements.txt'de litellm URL'i redundant.",
     "sed -i '/^litellm @ https:\\/\\/customer-assets/d' backend/requirements.txt\n"
     "docker compose build --no-cache backend"),
    ("SSL sertifikası alınamadı",
     "Domain sunucuya yönlendirilmemiş olabilir.",
     "# DNS kontrol\n"
     "dig +short panel.firmaniz.com\n"
     "# Sunucu IP'niz görünmeli"),
]
for t, d, cmd in sorunlar:
    story.append(Paragraph(f"<b>{t}</b>", h2))
    story.append(Paragraph(d, body))
    story.append(code(cmd))
    story.append(Spacer(1, 0.3*cm))

story.append(PageBreak())

# GUNCELLEME
story.append(Paragraph("Sürekli Güncel Kalın", h1))
story.append(Paragraph("Yeni sürümler yayınlandığında panelinizin otomatik güncellenmesini sağlayan iki yol var:", body))
story.append(Paragraph("<b>Yol 1: Otomatik (Önerilen)</b>", h2))
story.append(Paragraph("Kurulum sırasında otomatik cron eklendi. Her 6 saatte bir yeni sürüm var mı kontrol eder, varsa "
                        "kendisini günceller.", body))
story.append(code(
    "# Cron durumunu kontrol\n"
    "cat /etc/cron.d/gws-autoupdate\n"
    "# Şu satırı görmelisiniz:\n"
    "# */360 * * * * root bash /opt/gokyuzuwebspam-app/auto-update.sh >> /var/log/gws-update.log 2>&1"
))
story.append(Paragraph("<b>Yol 2: Manuel</b>", h2))
story.append(Paragraph("İstediğiniz zaman elle güncellemek için:", body))
story.append(code(
    "cd /opt/gokyuzuwebspam-app\n"
    "bash auto-update.sh"
))
story.append(Spacer(1, 0.3*cm))
story.append(info_box("Güncelleme sırasında ~30 saniyelik bir kesinti olur. Gelen maillerin kaybolmaması için "
                       "Mail Continuity modülü otomatik olarak kuyruklama yapar; sunucu geri gelince replay eder."))

story.append(Spacer(1, 0.5*cm))

# DESTEK
story.append(Paragraph("Yardım & Destek", h1))
dstk = [
    ["Kanal", "Erişim", "Yanıt Süresi"],
    ["E-posta", "destek@gokyuzuhosting.com", "24 saat içinde"],
    ["Panel Chat", "Panel içi mesaj bloğu (sağ alt)", "Mesai saatleri"],
    ["Slack Community", "gokyuzu.slack.com", "Community"],
    ["Dokümantasyon", "panel içi Dokümantasyon sekmesi", "Anlık"],
]
tbl3 = Table(dstk, colWidths=[4*cm, 8*cm, 4.5*cm])
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
]))
story.append(tbl3)

story.append(Spacer(1, 1*cm))
closing = Table([[Paragraph(
    "<font color='white' size='16'><b>Kurulum Tamamlandı — Tebrikler! 🎉</b></font><br/>"
    "<font color='#E2E8F0' size='11'>Artık cPanel sunucunuz kurumsal seviyede mail güvenliği ile korunuyor. "
    "İlk 24 saat içinde binlerce spam mail'in engellendiğini panel dashboard'unda göreceksiniz.</font>",
    body
)]], colWidths=[16.5*cm])
closing.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), DARK),
    ("LEFTPADDING", (0, 0), (-1, -1), 20),
    ("RIGHTPADDING", (0, 0), (-1, -1), 20),
    ("TOPPADDING", (0, 0), (-1, -1), 18),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
]))
story.append(closing)

# BUILD
out = "/app/GokyuzuWebSpam-Kurulum-Rehberi-v43.99.pdf"
doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
                        title="GokyuzuWebSpam - Kurulum Rehberi",
                        author="Gokyuzu Bilgisayar Ltd.")
doc.build(story, onFirstPage=cover, onLaterPages=footer)
import os
print(f"✓ PDF: {out} ({os.path.getsize(out)/1024:.1f} KB)")
