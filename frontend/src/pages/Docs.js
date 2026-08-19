import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  BookOpen, Filter, Bug, Globe2, Inbox, Mail, ArrowUpRight, Bell, BellRing,
  Cpu, Wrench, Radar, Terminal, Users, PackageOpen, Settings2, Key, Beaker,
  ShieldCheck, Brain, Server, LinkIcon, UserX, Activity, X, Search, Sparkles,
  Play, Volume2, ExternalLink, HelpCircle, Rocket,
} from "lucide-react";

const MODULES = [
  {
    key: "dashboard", cat: "Ana", label: "Dashboard", Icon: Activity, tone: "sky",
    what: "Sistemin genel sağlık kontrolü. 7 tab (Genel Bakış · Coğrafi · Trafik · Karantina · Sağlık · Canlı · Tümü). Üstteki 6 renkli kart 'Advanced Control Bar' → tıklanabilir.",
    features: [
      "Kuyrukta Bekleyen kartına tıkla → Exim kuyruk modalı açılır (toplu sil/ilet/dondur)",
      "Trafik tab'ında IP çubuğuna tıkla → o IP'nin son 50 maili sağ drawer'da açılır",
      "Coğrafi tab → canlı saldırı haritası (hover'da IP, from, to, ülke, verdict)",
    ],
    how: [
      "Her 15 sn'de bir metrikler otomatik yenilenir.",
      "Tab bar'daki 'Tümünü Göster' ile her şeyi tek ekranda gör.",
      "Onboarding wizard ilk kurulumda üstte çıkar (SMTP, brand vb).",
    ],
    testid: "docs-module-dashboard",
  },
  {
    key: "mailscanner", cat: "Motor", label: "MailScanner (Bağımsız)", Icon: Filter, tone: "indigo",
    what: "ConfigServer'a bağlı olmayan kendi geliştirdiğimiz mail tarama motoru. SpamAssassin uyumlu regex kuralları + Bayes classifier + BEC + URL koruma + kullanıcı politikaları.",
    features: [
      "6 tab: Yapılandırma · İstatistik · Kurallar · Bayes · Kullanıcı Politika · URL Koruma",
      "AI Sistem Analizi butonu (Claude) → mevcut konfigi analiz eder, aksiyon önerisi verir",
      "Bayes trainer: spam/ham örnek yapıştır → dinamik istatistiksel motor",
      "Kural editörü: regex + hedef alan (subject/from/body/header) + skor",
      "URL rewrite: /r/{token} time-of-click analiz",
    ],
    how: [
      "Yapılandırma tab'ında threshold ve motor toggle'ları yönet.",
      "Bayes 5000+ token'a ulaşana kadar 'training' modunda kabul et.",
      "Rules tab'ında `/tebrikler.*kazand[ıi]n/i` gibi regex ekle, skor 5+ ver.",
      "URL Koruma: outbound mail içine token bas, tıklandığında sunucu doğrular.",
    ],
    testid: "docs-module-mailscanner",
  },
  {
    key: "security", cat: "Güvenlik", label: "Güvenlik Merkezi", Icon: Bug, tone: "rose",
    what: "11 modül birleşik pano: Antivirüs · Spam/Phish · Sandbox · SPF/DKIM/DMARC · BEC · Karantina · Outbound · URL · AI · SIEM · Exploit Scanner.",
    features: [
      "Overview: her modülün rozeti (active/ready/warn/off) + detay",
      "Exploit tab: shell/eval/base64/backdoor imza tarayıcı — WHM daemon veya manuel scan",
      "BEC tab: lookalike domain + display-name + urgency heuristic testi",
      "Sandbox tab: şüpheli ekler için VM detonation queue (WHM VM ile entegre)",
      "Reputation tab: Spamhaus/UCEPROTECT durum kontrolü",
      "Coğrafi tab: 113 ülke bloklama · zaman-tabanlı · brute-force otomatik",
    ],
    how: [
      "Exploit tab'da 'Tara' → 1500+ dosya taranır, kritik/high/medium bulgular listelenir.",
      "BEC tab'da 'CEO Ahmet' + info@sikertim.com + korunan domain='sirketim.com' dene → BEC HIGH döner.",
      "Coğrafi Brute-Force: 60dk pencere · 50 spam eşiği · 180dk TTL — 'Tara ve Blokla' butonu.",
    ],
    testid: "docs-module-security",
  },
  {
    key: "quarantine", cat: "Karantina", label: "Karantina", Icon: Inbox, tone: "amber",
    what: "İzole edilmiş şüpheli maillerin merkezi paneli. Her mail için: release, delete, whitelist, mark-spam, AI 'neden spam?' açıklaması.",
    features: [
      "Filtre: tüm/spam/high_spam/virüs/phishing",
      "AI açıklama (Claude): 'Neden spam?' butonu",
      "Bulk seç + release/delete",
      "cPanel quarantine sync (WHM daemon eşliği)",
    ],
    how: [
      "Her satır → detail drawer → tam body/header/attachment",
      "release → kullanıcıya teslim, whitelist → 30 gün domain izin, delete → kalıcı",
    ],
    testid: "docs-module-quarantine",
  },
  {
    key: "geoblocking", cat: "Güvenlik", label: "Coğrafi Bloklama", Icon: Globe2, tone: "emerald",
    what: "Ülke bazlı block/allow list + zaman kısıtları + brute-force otomatik ekleme.",
    features: [
      "113 ülke katalog · arama · toplu seçim",
      "Zaman-tabanlı: aktif saatler (0-23) + günler (Pzt-Paz)",
      "TTL: kural belirtilen dakika sonra otomatik silinir",
      "Brute-force otomatik: son N dakikada M spam eşiği aşan ülke bloklanır",
    ],
    how: [
      "Ülke Seç tab → seçim yap → aksiyon (block/allow) → TTL dakika (0=süresiz) → Kaydet",
      "Zaman-Tabanlı: 'yalnızca gece 00-06 arası CN,RU blokla' senaryosu",
      "Brute-Force: 60dk / 50 spam / 180dk TTL öntanımlı",
    ],
    testid: "docs-module-geoblocking",
  },
  {
    key: "queue", cat: "İşlem", label: "Kuyruk Yönetimi", Icon: Server, tone: "sky",
    what: "Exim kuyruğunda bekleyen mailleri listeler; toplu sil/ilet/dondur/döndür işlemleri.",
    features: [
      "Yalnızca donmuş filtresi",
      "6 aksiyon: remove · deliver · retry · freeze · thaw · bounce",
      "Audit log — her işlem MongoDB'ye kayıt",
    ],
    how: [
      "Dashboard'daki 'Kuyrukta Bekleyen' kartına tıkla",
      "Satırları seç → aksiyon butonu",
      "Gerçek exim yoksa preview'da mock döner (WHM'de gerçek exim çalışır)",
    ],
    testid: "docs-module-queue",
  },
  {
    key: "ai", cat: "AI", label: "AI Self-Training", Icon: Brain, tone: "fuchsia",
    what: "Sistem kendi kendine öğrenir. Saatlik cron: son 1 saatteki high_spam/clean mailleri otomatik Bayes'e besler. LLM (Claude) yeni SA regex kural önerisi üretir.",
    features: [
      "AI Sistem Analizi: mevcut konfig + metrik → Türkçe rapor + aksiyon",
      "Weekly Report (Pazartesi 07:00 UTC): son 7 gün özet",
      "AI Batch Prewarm: high_spam ingest → arka planda açıklama üretilir, cache'lenir",
      "Rule Suggestions: AI önerdiği kurallar 'onay' bekler — sen apply edersin",
    ],
    how: [
      "MailScanner sayfasında 'Sistemi Analiz Et' → 15-30sn'de rapor",
      "Self-Training log: her saat kaç örneğin eğitildiğini gösterir",
      "Öneriler kutusunda regex + skor gör → Onayla/Reddet",
    ],
    testid: "docs-module-ai",
  },
  {
    key: "alerts", cat: "Uyarı", label: "Uyarı Kuralları", Icon: BellRing, tone: "orange",
    what: "Webhook tabanlı uyarı motoru: spam trafiği eşik aştığında dış sisteme (Slack/Discord/SIEM) POST atar.",
    features: [
      "Kural editörü: metrik + operatör + eşik + zaman penceresi",
      "Webhook + Slack + Discord + Email hedefleri",
      "SIEM formatı: CEF · LEEF · JSON çıktı",
      "Timeline chart: son fire'lar",
    ],
    how: [
      "Kural: 'spam count > 100 in 5min' → webhook",
      "SIEM export: /api/mailscanner/siem/export?format=cef&hours=24",
    ],
    testid: "docs-module-alerts",
  },
  {
    key: "compliance", cat: "Rapor", label: "Uyumluluk / Rapor", Icon: BookOpen, tone: "indigo",
    what: "KVKK/GDPR uyumluluk snapshot + PDF export.",
    features: [
      "Health Score gösterge (0-100)",
      "Compliance PDF: son 30 günün spam/virus/karantina özeti",
      "Multi-server ribbon: hangi cPanel host aktif",
    ],
    how: [
      "Dashboard → Sağlık tab → 'PDF İndir'",
      "Rapor: verdict dağılımı + top senders + engine breakdown",
    ],
    testid: "docs-module-compliance",
  },

  // ═══════════════════════════════════════════════════════════════
  // v43.99.12 — GENİŞLETİLMİŞ MODÜL DOKÜMANTASYONU (35+ modül)
  // ═══════════════════════════════════════════════════════════════

  // --- MOTOR & KURAL ---
  {
    key: "engines", cat: "Motor", label: "Motorlar", Icon: Cpu, tone: "cyan",
    what: "Aktif spam motorlarını yönet: SpamAssassin · Bayes · ClamAV · DCC/Razor/Pyzor · RBL/DNSBL · SPF/DKIM/DMARC · LLM AI Classifier. Her motor için toggle + threshold + son çalışma zamanı.",
    features: [
      "Motor kartı: yeşil (aktif) / sarı (opsiyonel) / kırmızı (hata)",
      "SpamAssassin: threshold slider (0.0-15.0), varsayılan 5.0",
      "Bayes: 5000+ token eğitim eşiği, learn-as-spam / learn-as-ham butonları",
      "ClamAV: son güncelleme zamanı + freshclam manuel tetik",
      "AI Classifier (Claude): opsiyonel, Emergent LLM key gerekir",
      "Toplu 'Restart Engines' butonu → daemon yeniden başlar (WHM)",
    ],
    how: [
      "Panelde Motorlar sayfası → her motor için Toggle veya Threshold değeri gir → Kaydet",
      "Değişiklikler 30 sn içinde milter'a uygulanır — mail restart gerekmez",
      "Engine hatası → Sağlık sekmesinde alarm + Slack/Discord webhook fire",
    ],
    testid: "docs-module-engines",
  },
  {
    key: "rules", cat: "Motor", label: "Kural Editörü", Icon: Wrench, tone: "amber",
    what: "SpamAssassin uyumlu özel spam kuralları — regex + hedef alan (subject/from/body/header/all) + skor. AI destekli kural önerisi + audit trail.",
    features: [
      "Regex tester — kural kaydetmeden önce canlı örnek maille test",
      "AI Kural Önerisi (Claude): 'Türk fatura dolandırıcılığı' gibi tanım gir → 3 regex önerir",
      "Kural gruplama: kategori bazlı klasörler (fatura/kripto/dating/vs)",
      "Enable/Disable toggle: kuralı silmeden geçici kapat",
      "History: kim ne zaman ekledi/değiştirdi (audit)",
    ],
    how: [
      "Yeni Kural → Alan: 'body' · Pattern: `/tebrikler.*kazand[ıi]n/i` · Skor: 5.0 · Kaydet",
      "AI Önerileri Kutusu → onayla → apply → 30 sn'de canlı",
      "Regex hatası varsa kayıt yapılmaz, kırmızı uyarı gösterilir",
    ],
    testid: "docs-module-rules",
  },
  {
    key: "lists", cat: "Motor", label: "Kara/Beyaz Liste", Icon: PackageOpen, tone: "rose",
    what: "IP + Domain + E-posta bazlı whitelist/blacklist. TTL destekli (süresi dolunca otomatik silinir) + import/export CSV.",
    features: [
      "3 tür: IP (v4/v6/CIDR), Domain, Email",
      "3 durum: allow, block, spam-only (block yapmadan skoru artır)",
      "TTL: 1 saat / 1 gün / 30 gün / kalıcı",
      "CSV import: 10.000 kayda kadar toplu ekleme",
      "Yorum alanı: 'neden eklendi' notu",
    ],
    how: [
      "Yeni → Tür: IP, Değer: 1.2.3.4/24, Aksiyon: block, TTL: 30 gün, Not: 'MailFrom brute'",
      "Bulk import: sütun başlığı `value,action,ttl_hours,comment` olan CSV yükle",
    ],
    testid: "docs-module-lists",
  },

  // --- GÜVENLİK ---
  {
    key: "threat_intel", cat: "Güvenlik", label: "Tehdit Zekası", Icon: Radar, tone: "violet",
    what: "Dış tehdit istihbarat feed'leri — URLHaus (kötü URL'ler), OpenPhish (phishing), Spamhaus DROP. Her 6 saatte bir otomatik senkron.",
    features: [
      "3 feed sync durumu: son çalışma, eklenen kayıt sayısı, hata sayacı",
      "Manuel 'Şimdi Senkronize Et' butonu",
      "Feed kaynağı ekle/çıkar (RSS/JSON URL desteği)",
      "IOC tablosu: son 500 gösterge (URL/IP/hash) + first_seen, source",
      "Bir IOC'yi manuel 'kara listeye ekle' → Lists modülüne push",
    ],
    how: [
      "Feed sekmesi → 3 feed'den son çekim zamanı yeşil ise sağlıklı",
      "IOC arama: URL parçası yaz → o parçayı içeren tüm feed kayıtları görünür",
      "Her IOC satırında 'Bloklamaya Ekle' → Lists modülüne otomatik geçer",
    ],
    testid: "docs-module-threat-intel",
  },
  {
    key: "threat_defense", cat: "Güvenlik", label: "Threat Defense Center", Icon: ShieldCheck, tone: "fuchsia",
    what: "28 gelişmiş savunma modülü tek panoda: Phishing simülatör, BEC dedektörü, Marka Sahtekarlığı, DMARC izleme, Mail Continuity, AI Assistants, Dark Web izleme + daha fazlası.",
    features: [
      "28 endpoint'te bağımsız modül — her biri kendi form'u + result view'ı",
      "Dinamik JSON→UI: her modülün yanıt formatı otomatik uygun görselle render edilir",
      "Modül grupları: Phishing · BEC · Marka · DNS/Auth · Data Loss · Mail Flow · AI",
      "Kategori filtresi + arama",
      "Örnek payload gösterme (curl komut haline dönüştürme)",
    ],
    how: [
      "Modül seç → sağdaki form → 'Çalıştır' → sonuç kartında verdict + score + öneriler",
      "Örnek: Phishing URL Tester → URL yapıştır → phish score + benzer marka + red flag'ler",
      "Sonuç JSON'ı 'Kopyala' butonu ile paylaşılabilir",
    ],
    testid: "docs-module-threat-defense",
  },
  {
    key: "blacklist", cat: "Güvenlik", label: "IP Blacklist Çıkışı", Icon: UserX, tone: "rose",
    what: "Sunucunun IP'sini kontrol et: Spamhaus, Barracuda, SORBS, UCEProtect, PSBL. Blacklist'ten çıkarma isteği (delist) formu.",
    features: [
      "6 blacklist paralel sorgulanır — max 10 sn",
      "Listelendiği yer(ler) kırmızı + delist URL",
      "Delist formu: kendi IP'nizden gönderim istatistiği + delist gerekçesi otomatik doldurulur",
      "Historik: geçmişte listelendi mi + ne zaman çıkarıldı",
      "PTR ve rDNS eşleşme kontrolü",
    ],
    how: [
      "IP alanına sunucu IP'n yaz → 'Kontrol Et'",
      "Kırmızı listede varsa → 'Delist İsteği' → forma tıkla → o blacklist'in resmi formuna yönlendirilir",
    ],
    testid: "docs-module-blacklist",
  },
  {
    key: "bounce_digest", cat: "Güvenlik", label: "Bounce Digest", Icon: Mail, tone: "amber",
    what: "Bounce (geri dönen mail) analiz motoru. Hard/soft bounce oranı, en çok bounce alan alan/kullanıcı, kara listeye düşme riski.",
    features: [
      "Bounce trend grafiği (son 24 saat / 7 gün / 30 gün)",
      "Top offender: en fazla hard bounce üreten mail hesabı",
      "Otomatik uyarı: kullanıcının hard bounce oranı %5'i aşarsa gönderim geçici duraklat",
      "Slack/Discord bounce özeti (haftalık cron)",
      "SMTP relay logdan bounce satırlarını otomatik parse eder",
    ],
    how: [
      "Digest → Top Offender → kullanıcıya tıkla → geçmiş 100 bounce",
      "Otomatik uyarı Ayarlar → Bounce Threshold'dan yönetilir (varsayılan %5)",
    ],
    testid: "docs-module-bounce-digest",
  },

  // --- İŞLEM ---
  {
    key: "outbound", cat: "İşlem", label: "Giden Posta", Icon: ArrowUpRight, tone: "sky",
    what: "Sunucudan çıkan mailleri denetle: hız limiti, spam skoru, saatlik quota, IP hijyen skoru.",
    features: [
      "Kullanıcı başına saatlik/günlük limit (varsayılan 200/2000)",
      "Giden mail skoru: 3+ ise geçici karantina → admin onayına",
      "Blacklisted kelime tespiti: özel dictionary + varsayılan (viagra, kripto, dolandırıcı vb)",
      "Real-time throttle: hesap limitin %80'ine ulaştığında yavaşlat",
      "IP hijyen skoru: 0-100, 60 altı = uyarı",
    ],
    how: [
      "Ayarlar → Giden E-posta Kontrolü toggle'ı",
      "Kullanıcı başına saatlik limit alanı → 200 → Kaydet",
      "Limit aşımı → kullanıcıya otomatik email + admin bildirimi",
    ],
    testid: "docs-module-outbound",
  },

  // --- BİLDİRİM ---
  {
    key: "notifications", cat: "Bildirim", label: "Bildirim Kutusu", Icon: Bell, tone: "cyan",
    what: "Master + Bayı için birleşik inbox: sistem alarmları, PIN talepleri, ödeme onayları, güncelleme duyuruları, güvenlik alarmları.",
    features: [
      "Filtre: tümü / okunmamış / yıldızlı / kritik",
      "Bildirim türü: info (mavi), warning (sarı), critical (kırmızı)",
      "Toplu 'Okundu işaretle' + 'Sil'",
      "Bildirim üzerine tıkla → ilgili sayfaya deep link",
      "Sağ üst çan ikonu: okunmamış sayısı",
    ],
    how: [
      "Çan simgesine tıkla → son 5 bildirim dropdown'da",
      "Kutu sayfası → filtre + toplu işlem",
      "'Sesli uyarı' ayarı (Ayarlar → Bildirimler) — yeni kritik bildirimde ping çalar",
    ],
    testid: "docs-module-notifications",
  },
  {
    key: "reports", cat: "Rapor", label: "Raporlar", Icon: BookOpen, tone: "indigo",
    what: "Zamanlanabilir mail aktivite raporları — günlük/haftalık/aylık özet + PDF/CSV export + otomatik e-posta teslimi.",
    features: [
      "3 preset: günlük · haftalık · aylık",
      "Özel tarih aralığı seçici",
      "Sütunlar: total, spam, virus, quarantined, blocked, delivered, top senders",
      "Zamanlanmış raporlar: cron olarak master'a mail gönderilir",
      "PDF görsel branded (Reseller Branding kullanıyor)",
    ],
    how: [
      "Yeni Rapor → Aralık: Haftalık · Format: PDF · Hedef: benim@sirket.com · Cron: Pzt 09:00",
      "Kaydet — sonraki cron çalışmasında mail gider",
    ],
    testid: "docs-module-reports",
  },

  // --- MAİL SAĞLIK & TANI ---
  {
    key: "mail_health", cat: "Sağlık", label: "Mail Sağlık", Icon: Activity, tone: "emerald",
    what: "Tüm mail altyapısının canlı sağlık durumu: SMTP relay, Postfix/Exim daemon, MongoDB, DNS, SPF/DKIM/DMARC kayıtları.",
    features: [
      "6 kritik servis health check kartı",
      "SPF/DKIM/DMARC otomatik testleri — kırık kayıt kırmızı",
      "Son 24 saatte servis kesintisi zaman çizelgesi",
      "Otomatik onarım butonları: 'DKIM yeniden imzala', 'Milter restart'",
      "Bayı için kendi tenant'ının health durumu",
    ],
    how: [
      "Dashboard'da Sağlık tab'ında özet + Detay için Mail Sağlık sayfasına git",
      "Kırmızı kartın üstüne gel → nedeni + önerilen aksiyonu göster",
    ],
    testid: "docs-module-mail-health",
  },
  {
    key: "live_diagnostic", cat: "Sağlık", label: "Canlı Sunucu Tanı", Icon: Terminal, tone: "amber",
    what: "SSH'a girmeden sunucunuzda çalışan tanı komutları: exim mainlog tail, ps aux, netstat, memory, disk. Master'ın sunucusundan güvenli tunneled komut.",
    features: [
      "Preset komutlar: mail log, exim queue, disk, memory, netstat, systemctl status",
      "Live tail: son 100 satır + auto-scroll",
      "Filtre: 'error', 'reject', 'defer' gibi anahtar kelime",
      "Snapshot alma: o anki çıktıyı save et → geçmiş",
      "Sadece 'read-only' komutlar — write komutu yasak",
    ],
    how: [
      "Bir preset seç → 'Çalıştır' → sağ panelde çıktı",
      "Sonuç 'Snapshot Kaydet' ile geçmişe eklenir",
    ],
    testid: "docs-module-live-diagnostic",
  },
  {
    key: "plugin_health", cat: "Sağlık", label: "Plugin Sağlığı", Icon: ShieldCheck, tone: "cyan",
    what: "Master için tüm bayı sunucularının plugin durumunu tek ekranda görme: version, uptime, last-ping, mail queue derinliği.",
    features: [
      "Bayı bazlı sağlık matrisi: yeşil (sağlıklı) / sarı (yavaş) / kırmızı (offline)",
      "Otomatik ping her 10 saniyede bir",
      "'Herkese restart sinyali' toplu buton",
      "Version drift: eski sürümdeki bayı sayısı + 'Toplu Güncelle' önerisi",
    ],
    how: [
      "Master → Plugin Sağlığı → herhangi bir bayı satırına tıkla → detay drawer",
      "'Toplu Güncelle' butonu → seçilen bayilere OTA update push",
    ],
    testid: "docs-module-plugin-health",
  },

  // --- KULLANICI ---
  {
    key: "users", cat: "Kullanıcı", label: "Kullanıcılar", Icon: Users, tone: "indigo",
    what: "cPanel hesaplarını yönet: WHM daemon'dan otomatik sync + hesap bazlı istatistik (gönderim/karantina/spam catch oranı) + tekil ayarlar.",
    features: [
      "Otomatik sync (10 dk cron) veya manuel 'Şimdi Sync'",
      "Hesap kartı: bugün gönderim, spam yakalama, karantinada, hijyen skoru",
      "Hesap detayı: son 100 mail + geçerli policy + kişisel whitelist",
      "Toplu 'sadece bu hesaplara kural uygula' seçimi",
      "Ban/Unban: hesabın outbound mail'ini geçici durdur",
    ],
    how: [
      "Kullanıcılar → Sync → tüm cPanel hesapları listelenir",
      "Bir hesaba tıkla → policy düzenle veya banla",
    ],
    testid: "docs-module-users",
  },
  {
    key: "whitelist_history", cat: "Kullanıcı", label: "Whitelist Geçmişi", Icon: BookOpen, tone: "emerald",
    what: "Kim, ne zaman, hangi domain'i/IP'yi whitelist'e ekledi audit trail. Silinen kayıtları da gösterir (soft delete).",
    features: [
      "Filtre: kullanıcıya göre · aksiyon türüne göre · tarih aralığı",
      "Bir domain'in geçmişi: ilk eklenme, kaç kez kaldırıldı, gerekçeler",
      "Ters çevirme: 'Bu whitelist eylemini geri al' butonu",
      "CSV export: uyumluluk denetimi için",
    ],
    how: [
      "Sayfa açılır → son 100 whitelist aksiyonu listelenir",
      "Arama kutusu → 'sirket.com' → o domain'in tüm eylemleri",
    ],
    testid: "docs-module-whitelist-history",
  },
  {
    key: "marketplace", cat: "Kullanıcı", label: "İmza Marketplace", Icon: PackageOpen, tone: "violet",
    what: "Topluluk katkılı SpamAssassin kural paketleri: 'Türk kripto scam v2', 'Fatura oltalama', 'Fake ödeme'. Master onayı sonrası kurulur.",
    features: [
      "Kategori: kripto · fatura · dating · SMS-spoofing · brand-impersonation",
      "Her paket için: yayınlayan bayı, indirme sayısı, oy (⭐1-5), örnek regex sayısı",
      "'Yayınla' butonu: bayılar kendi kurallarını topluluğa açabilir",
      "Auto-update: bir pakete abone olursanız yeni versiyon otomatik gelir",
    ],
    how: [
      "Marketplace → paketi seç → 'Yükle' → 30 sn'de aktif",
      "Kendi paketini yayınla → başlık + kategori + regex listesi",
    ],
    testid: "docs-module-marketplace",
  },

  // --- MASTER YÖNETİM ---
  {
    key: "licenses", cat: "Master", label: "Lisans Yönetimi", Icon: Key, tone: "amber",
    what: "Tüm satılan lisansları yönet: oluştur/uzat/iptal/rotate. IP-based binding + plan level (starter/pro/enterprise).",
    features: [
      "Grid: license_key, müşteri, plan, IP(ler), status, expires_at",
      "Toplu 'Uzat 30 gün' seçimi",
      "Yeni lisans oluştur: müşteri adı + email + plan + IP + süre + kaydet → e-mail otomatik",
      "Rotate: lisans anahtarını yenile (eski revoke, yeni oluştur)",
      "Search + filter: sadece aktif / süresi bitmiş / iptal",
    ],
    how: [
      "Yeni → wizard: müşteri bilgi → plan → IP → süre → 'Oluştur ve E-mail Gönder'",
      "Lisans satırında ⋮ → Uzat / Rotate / İptal",
    ],
    testid: "docs-module-licenses",
  },
  {
    key: "master_live", cat: "Master", label: "Canlı Bayi Trafiği", Icon: Radar, tone: "fuchsia",
    what: "Tüm bayilerin gerçek zamanlı mail trafiğini tek ekranda gör: dk/mail hız, spam oranı, aktif bağlantı, saldırı altı.",
    features: [
      "Bayi bazlı: son 5 dk gönderim, karantina, verdict dağılımı",
      "Anomali tespiti: bir bayı olağandışı yükselirse kırmızıya döner",
      "WebSocket bağlantısı — canlı akış",
      "Filter: sadece kritik / sadece PRO plan / arama",
    ],
    how: [
      "Master açar → tüm bayılar yeşil olarak listelenir",
      "Kırmızı bayı → tıkla → detay drawer + acil eylem butonları",
    ],
    testid: "docs-module-master-live",
  },
  {
    key: "payments_admin", cat: "Master", label: "Ödeme Yönetim Panosu", Icon: Key, tone: "emerald",
    what: "Havale ve PayTR ödemelerini onayla/reddet. Onaylandığında lisans otomatik oluşturulur veya uzatılır.",
    features: [
      "Pending kuyruk: onay bekleyen sipariş listesi",
      "Havale: dekont yükleme + admin note",
      "PayTR: token doğrulama + refund",
      "Toplu 'hepsini onayla' (sadece Havale)",
      "Onaydan sonra otomatik: lisans oluştur, e-mail gönder, invoice PDF üret",
    ],
    how: [
      "Kuyruk → satır → dekont resmine bak → 'Onayla' + note",
      "Onay sonrası bayi otomatik e-mail alır",
    ],
    testid: "docs-module-payments-admin",
  },
  {
    key: "resellers_admin", cat: "Master", label: "Bayi Yönetimi", Icon: Users, tone: "cyan",
    what: "Bayı hesaplarını yönet: yeni bayı oluştur, sunucu bilgisi kaydet, plan değişikliği, uzak komut gönder.",
    features: [
      "Bayı listesi: isim, sunucu URL, plan, uptime, last-seen",
      "Yeni bayi kayıt: temel bilgi + otomatik lisans + hoşgeldin maili",
      "Sunucu bilgi güncelle: IP, panel URL, WHM erişim",
      "Toplu mesaj: seçili bayılara notification push",
      "Health matrix: her bayının plugin durumu",
    ],
    how: [
      "Yeni Bayi → form → 'Oluştur' → 5 sn'de sistem hazır",
      "Bayı → Uzak Yönetim → SSH-less komut çalıştır (whitelisted)",
    ],
    testid: "docs-module-resellers-admin",
  },
  {
    key: "plan_analytics", cat: "Master", label: "Plan Analitiği", Icon: Activity, tone: "sky",
    what: "Plan bazlı gelir + ARPU + churn + upsell fırsatları. Master için CFO dashboard'u.",
    features: [
      "MRR (aylık düzenli gelir) grafiği",
      "Plan başına: aktif bayı, aylık gelir, ort. lisans süresi",
      "Churn: son 30 günde iptal eden bayılar",
      "Upsell candidate: starter'da olup pro'ya yükselebilecek bayılar",
    ],
    how: [
      "Grafik zoom → tarih aralığı seç",
      "Upsell list → satır → 'Öneri Gönder' → o bayıya kişisel yükseltme teklifi mail'i",
    ],
    testid: "docs-module-plan-analytics",
  },
  {
    key: "plan_config", cat: "Master", label: "Plan Modülleri", Icon: Settings2, tone: "indigo",
    what: "Her plana (starter/pro/enterprise) hangi modüllerin açık olduğunu düzenle. Toggle → bayı panelinde modül görünür/gizlenir.",
    features: [
      "3 plan sütunu, 40+ modül satırı",
      "Kolayca toggle → 30 sn'de canlı yayınlanır",
      "'Yeni modül ekle' → JSON key tanımla → tüm planlara dahil et",
      "Kritik modül (master-only) korumalı — Bayı'ya açılamaz",
    ],
    how: [
      "Grid → satır × plan → checkbox toggle",
      "Kaydet → bayılar sayfayı yenilediğinde yeni modüller görünür",
    ],
    testid: "docs-module-plan-config",
  },
  {
    key: "audit_log", cat: "Master", label: "Master Audit Log", Icon: BookOpen, tone: "rose",
    what: "Sistem geneli tüm kritik işlemlerin denetim izi: kim ne zaman hangi lisansı sildi, PIN değiştirdi, master rotate yaptı.",
    features: [
      "Filtre: aksiyon türü · aktör IP · tarih",
      "Severity: info · warning · critical",
      "Full search: 'delete' geçen tüm loglar",
      "CSV export uyumluluk için",
      "Retention: 90 gün (config'de değiştirilebilir)",
    ],
    how: [
      "Filtre daralt → 'severity=critical' → son 20 kritik olayı gör",
      "Bir satıra tıkla → tam JSON payload + before/after",
    ],
    testid: "docs-module-audit-log",
  },
  {
    key: "remote_admin", cat: "Master", label: "Bayı Uzak Yönetim", Icon: Terminal, tone: "amber",
    what: "Master bayı sunucusuna SSH'sız komut gönderir: engine restart, cache temizle, log tail, whitelisted CLI komut.",
    features: [
      "Sadece whitelisted komut listesi (RCE yok)",
      "Komut geçmişi: kim ne zaman ne çalıştırdı",
      "Bayı onayı: 'yaklaşan komut' bildirim, bayı reject edebilir",
      "SSH tunnel değil — bayının pluginine HTTPS ile push",
    ],
    how: [
      "Bayı seç → komut seç ('milter-restart') → 'Gönder' → 30 sn'de sonuç",
    ],
    testid: "docs-module-remote-admin",
  },
  {
    key: "version_publish", cat: "Master", label: "Sürüm Yayınla", Icon: Sparkles, tone: "emerald",
    what: "Yeni versiyon çıktığında tüm bayılara OTA (over-the-air) push. Her bayı auto-update cron ile 6 saatte kontrol eder.",
    features: [
      "Yeni sürüm oluştur: version + changelog + severity (patch/minor/major)",
      "Rollout %: %10 → %50 → %100 canary deployment",
      "Rollback: sorun çıkarsa önceki sürüme geri döndür",
      "Bayı health: kaç bayı başarılı update aldı",
    ],
    how: [
      "Yeni Sürüm → version 43.99.13 · changelog markdown · rollout %10",
      "24 saat izle → sağlıklıysa %100'e çıkar",
    ],
    testid: "docs-module-version-publish",
  },
  {
    key: "wake_history", cat: "Master", label: "Ping Geçmişi", Icon: Radar, tone: "cyan",
    what: "Master → Bayı ping izleme: her bayının son 24 saat uptime %'si + bağlanamama nedenleri.",
    features: [
      "Bayı bazlı uptime: yeşil (%99+), sarı (%95-99), kırmızı (<%95)",
      "Kesinti nedenleri: timeout, 502, DNS, SSL",
      "Bildirim: bir bayı 5 dk offline olursa Slack fire",
    ],
    how: [
      "Grid → bayı → geçmiş 24 saat çizelge",
    ],
    testid: "docs-module-wake-history",
  },
  {
    key: "landing_cms", cat: "Master", label: "Landing CMS", Icon: BookOpen, tone: "fuchsia",
    what: "Ana web sitesinin (gokyuzuhosting.com) landing sayfa içeriğini panelden yönet: hero, features, pricing, testimonials.",
    features: [
      "WYSIWYG editör: markdown + preview",
      "Bölüm bazlı toggle: hero on/off",
      "Multi-language: TR/EN/AR versiyonları",
      "SEO meta: title, description, OG image",
      "Preview mode: yayınlamadan önce nasıl görüneceğini gör",
    ],
    how: [
      "Bölüm seç → içeriği düzenle → 'Preview' → 'Yayınla' → 30 sn'de canlı",
    ],
    testid: "docs-module-landing-cms",
  },
  {
    key: "email_templates", cat: "Master", label: "Mail Şablonları", Icon: Mail, tone: "amber",
    what: "Sistem maillerinin (welcome, invoice, alert, PIN reset) HTML şablonlarını düzenle. Değişkenli.",
    features: [
      "12+ şablon: welcome, invoice, license-expiry, quarantine-digest, alert-critical, PIN-reset...",
      "Değişkenler: {{customer_name}}, {{license_key}}, {{expires_at}}",
      "Live preview: örnek data ile mail'in gerçek hali",
      "Multi-language: her şablonun TR/EN/AR versiyonu",
      "Test-send: kendinize gönder",
    ],
    how: [
      "Şablon seç → düzenle → 'Test Send' → mail'i kontrol et → 'Kaydet'",
    ],
    testid: "docs-module-email-templates",
  },

  // --- BAYİ ---
  {
    key: "my_server", cat: "Bayi", label: "Sunucumu Bağla", Icon: Server, tone: "indigo",
    what: "Bayı için: kendi cPanel/WHM sunucu bilgilerini plugin'e tanıt.",
    features: [
      "WHM URL + port (varsayılan 2087)",
      "cPanel API token (whitelisted read-only)",
      "Sunucu health check: connection test butonu",
      "IP whitelist: hangi IP'lerden bağlantı kabul edilecek",
    ],
    how: [
      "URL: https://sunucum.com:2087 → API token yapıştır → 'Bağla'",
      "Yeşil ✓ → başarılı",
    ],
    testid: "docs-module-my-server",
  },
  {
    key: "smtp_settings", cat: "Bayi", label: "SMTP Ayarları", Icon: Mail, tone: "cyan",
    what: "Bildirim maillerinin gönderileceği SMTP hesabı: SendGrid, SES, Postfix, veya kendi cPanel SMTP.",
    features: [
      "Provider preset: SendGrid, AWS SES, Mailgun, Postfix, Custom",
      "TLS/SSL/STARTTLS/None seçenekleri",
      "Test-send: 'kendine test maili gönder' butonu",
      "Fallback: primary başarısızsa secondary'ye geç",
      "Rate limit: 100/dk gibi",
    ],
    how: [
      "Provider: SendGrid → API key yapıştır → 'Test Send' → yeşil ✓",
    ],
    testid: "docs-module-smtp-settings",
  },
  {
    key: "reseller_branding", cat: "Bayi", label: "Kendi Marka & Domain", Icon: Sparkles, tone: "fuchsia",
    what: "White-label — panelinde kendi marka logunu, renk temanı, domain adını gösterirsin. Beyaz etiket satış için.",
    features: [
      "Logo yükle (SVG/PNG)",
      "Renk teması: primary + accent",
      "Panel başlığı, favicon, footer",
      "Custom domain: panel.sirket.com → CNAME kurulumu rehberi",
      "SSL: Let's Encrypt otomatik veya wildcard yükle",
    ],
    how: [
      "Logo yükle + renkler seç → 'Preview' → 'Yayınla' → panel yenilenir",
      "Custom domain: DNS'e CNAME ekle → panelde 'Doğrula' → SSL otomatik",
    ],
    testid: "docs-module-reseller-branding",
  },
  {
    key: "custom_domain", cat: "Bayi", label: "Kendi Domain'im", Icon: Globe2, tone: "emerald",
    what: "Panel URL'ini kendi domainine çevir (panel.sirketim.com). Reseller Branding'in DNS/SSL sub-modülü.",
    features: [
      "CNAME kurulum wizard",
      "SSL: Let's Encrypt otomatik / wildcard sertifika yükle / self-signed",
      "DNS propagation kontrol",
      "Sub-path: panel.sirketim.com/mailguard",
    ],
    how: [
      "Wizard step 1: domain gir → step 2: DNS ekle → step 3: doğrula → step 4: SSL",
    ],
    testid: "docs-module-custom-domain",
  },
  {
    key: "subscription", cat: "Bayi", label: "Aboneliğim", Icon: Key, tone: "sky",
    what: "Bayı için kendi abonelik durumu: plan, süresi, kullanım (mail/gün, kural sayısı), ödeme geçmişi, upgrade butonları.",
    features: [
      "Aktif plan kartı: adı, bitiş, otomatik yenileme",
      "Kullanım metriği: quota progress bar'ları",
      "Upgrade tekliflerine hızlı erişim",
      "Ödeme geçmişi: fatura PDF indirme",
      "İptal: 30-day money-back",
    ],
    how: [
      "Upgrade → yeni plan seç → ödeme (Havale/PayTR/Stripe) → onayla",
      "Fatura → satır → PDF indir",
    ],
    testid: "docs-module-subscription",
  },

  // --- SİSTEM ---
  {
    key: "install_guide", cat: "Sistem", label: "Kurulum Rehberi", Icon: Terminal, tone: "emerald",
    what: "8 adımlı interaktif kurulum rehberi + PDF (TR/EN/AR) + adım başına video (30sn).",
    features: [
      "Progress bar: kaç adım tamamlandı",
      "Her adım: intro + video embed + kod bloklarıyla komutlar + 'kopyala' butonu",
      "PDF indir: 3 dilde (Türkçe/English/العربية)",
      "'Tamamlandı olarak işaretle' → progress kaydı",
      "Yardım: destek e-mail linki + FAQ",
    ],
    how: [
      "Adım 1'den başla → intro oku → video izle → komutu kopyala → çalıştır → tamamlandı",
      "PDF dil butonu → tıkla → indir",
    ],
    testid: "docs-module-install-guide",
  },
  {
    key: "maintenance", cat: "Sistem", label: "DB Bakım", Icon: Wrench, tone: "amber",
    what: "MongoDB koleksiyon boyutlarını izle + eski kayıtları temizle + haftalık backup + restore.",
    features: [
      "Koleksiyon grid: adı, doc sayısı, boyut, en eski/en yeni kayıt",
      "Retention politika: mail_events 30 gün, quarantine 90 gün, audit 1 yıl",
      "Manuel cleanup: 'sil şu tarihten eski'",
      "Haftalık backup: /api/backups/list — 8 snapshot retention",
      "Restore: dry-run + gerçek geri yükleme (2FA korumalı)",
    ],
    how: [
      "Backup → 'Şimdi Snapshot Al' → dosya oluşur → indir/sakla",
      "Restore → snapshot seç → dry-run → sonuç 'plan'ı kontrol et → gerçek restore",
    ],
    testid: "docs-module-maintenance",
  },
  {
    key: "logs", cat: "Sistem", label: "Sistem Logları", Icon: BookOpen, tone: "slate",
    what: "Backend uygulama logları: uvicorn, milter events, cron, integration errors. Filtre + arama.",
    features: [
      "Live tail: son 200 satır, auto-scroll",
      "Filtre: level (info/warning/error) · source · date range",
      "Search: substring match",
      "Snapshot: kritik loglar için 'kaydet ve destek'e gönder'",
    ],
    how: [
      "Filtre: level=error → son 24 saat errorlar",
      "'Destek Gönder' → snapshot dahil ticket açar",
    ],
    testid: "docs-module-logs",
  },
  {
    key: "settings", cat: "Sistem", label: "Global Ayarlar", Icon: Settings2, tone: "indigo",
    what: "Sistem çapında yapılandırmaların merkezi: motor threshold'ları, bildirim kanalları, kilit & PIN, güvenlik, entegrasyon.",
    features: [
      "6 sekme: Genel · Motorlar · Kilit & PIN · Bildirim · Entegrasyon · Advanced",
      "Kilit & PIN: Idle Auto-Lock, PIN Change Request akışı, Master 2FA, Kullanıcı PIN Yönetimi, PIN Değişiklik Geçmişi",
      "Entegrasyon: SMTP, Slack, Discord, Telegram, SIEM, Webhook",
      "Advanced: master rotation, master protection, trusted IPs, foreign IP strict mode",
      "Her setting için audit trail",
    ],
    how: [
      "Sekmeyi seç → değeri düzenle → 'Kaydet' → 30 sn'de canlı",
      "Kritik ayarlar (2FA aktifse) OTP kodunu ister",
    ],
    testid: "docs-module-settings",
  },
];


const CATEGORIES = [...new Set(MODULES.map(m => m.cat))];

// v43.99.13 — Modül anahtarı → panel içi route eşleştirmesi
// "Şimdi Aç" butonu için kullanılır.
const MODULE_ROUTES = {
  dashboard: "/panel",
  mailscanner: "/panel/mailscanner",
  security: "/panel/security",
  quarantine: "/panel/quarantine",
  geoblocking: "/panel/security",  // Security içinde Coğrafi tab
  queue: "/panel",  // Dashboard'da Kuyruk kartı
  ai: "/panel/mailscanner",
  alerts: "/panel/alerts",
  compliance: "/panel/reports",
  engines: "/panel/engines",
  rules: "/panel/rules",
  lists: "/panel/lists",
  threat_intel: "/panel/threat-intel",
  threat_defense: "/panel/threat-defense",
  blacklist: "/panel/blacklist",
  bounce_digest: "/panel/bounce-digest",
  outbound: "/panel/outbound",
  notifications: "/panel/notifications",
  reports: "/panel/reports",
  mail_health: "/panel/mail-health",
  live_diagnostic: "/panel/live-diagnostic",
  plugin_health: "/panel/plugin-health",
  users: "/panel/users",
  whitelist_history: "/panel/whitelist-history",
  marketplace: "/panel/marketplace",
  licenses: "/panel/licenses",
  master_live: "/panel/master-live",
  payments_admin: "/panel/payments-admin",
  resellers_admin: "/panel/resellers-admin",
  plan_analytics: "/panel/plan-analytics",
  plan_config: "/panel/plan-config",
  audit_log: "/panel/audit-log",
  remote_admin: "/panel/remote-admin",
  version_publish: "/panel/version-publish",
  wake_history: "/panel/wake-history",
  landing_cms: "/panel/landing-cms",
  email_templates: "/panel/email-templates",
  my_server: "/panel/my-server",
  smtp_settings: "/panel/smtp-settings",
  reseller_branding: "/panel/reseller-branding",
  custom_domain: "/panel/custom-domain",
  subscription: "/panel/subscription",
  install_guide: "/panel/install-guide",
  maintenance: "/panel/maintenance",
  logs: "/panel/logs",
  settings: "/panel/settings",
};

// v43.99.14 — Modül bazlı Sık Sorulan Sorular (FAQ) haritası
const GENERIC_FAQS = [
  {
    q: "Ayarlarımı kaydettim ama etkilemedi, neden?",
    a: "Değişiklikler backend daemon tarafından her 30 saniyede bir yenilenir. 1 dakika bekleyin veya WHM'de 'MailShield Restart' butonuna basın.",
  },
  {
    q: "Bu modülü Bayı'lara açık/kapalı yapabilir miyim?",
    a: "Master → Plan Modülleri (Plan Config) sayfasından her modülü plan bazında (starter/pro/enterprise) toggle edebilirsiniz.",
  },
  {
    q: "Değişikliklerin denetim izi nerede?",
    a: "Master → Master Audit Log sayfasında tüm kritik işlemler filtrelenebilir tabloda listelenir (aksiyon türü, aktör IP, tarih, JSON payload).",
  },
];

const MODULE_FAQS = {
  dashboard: [
    { q: "Kartlardaki sayılar canlı mı, ne sıklıkla güncelleniyor?", a: "Metrikler her 15 saniyede bir otomatik yenilenir. Sağ üstteki refresh ikonuna basarak manuel de tetikleyebilirsiniz." },
    { q: "'Kuyrukta Bekleyen' kartına tıklayınca ne oluyor?", a: "Exim kuyruk modalı açılır — donmuş/bekleyen tüm mailleri toplu sil/ilet/dondur/döndür işlemleriyle yönetebilirsiniz." },
  ],
  mailscanner: [
    { q: "Bayes trainer'ı ne zaman kullanmalıyım?", a: "En az 5000 token toplayana kadar 'training' modunda tutun. Spam örnekleri 'Learn as Spam', temiz mailler 'Learn as Ham' ile besleyin. Sistem 8-10 gün sonra %95+ isabetli olur." },
    { q: "AI Sistem Analizi ücretli mi?", a: "Claude modeli kullanıyor — Emergent LLM key üzerinden çalışır. Her analiz ~$0.03 tüketir; ayda 50-100 kez analiz yapabilirsiniz." },
    { q: "URL Rewrite hangi durumda mail'i bozar?", a: "Kısaltılmış URL'ler (bit.ly gibi) 2x kısaltma yapıldığında karışabilir. Genelde sorun olmaz; olursa Ayarlar → URL Koruma toggle kapatın." },
  ],
  security: [
    { q: "Exploit tarama sunucumu yavaşlatır mı?", a: "İlk tam tarama 5-8 dakika sürebilir (1500+ dosya). Sonraki taramalar sadece değişen dosyalara odaklanır ve 30 sn'de biter. IO priority 'low' ayarlanmış." },
    { q: "BEC dedektörü %100 doğru mu?", a: "Heuristic tabanlı — false positive oranı ~%2-4. Şüpheli mail geldiğinde karantinaya alınır, siz onaylarsınız. Zaman içinde whitelist ile geliştirilir." },
  ],
  quarantine: [
    { q: "Karantinada mail kaç gün saklanır?", a: "Varsayılan 90 gün (Ayarlar → Retention'dan değiştirilebilir). Sonra otomatik silinir; delete audit log'a düşer." },
    { q: "Release ettiğim mail spam sayılmaz mı?", a: "Release kullanıcının inbox'ına gönderir + gönderen domain'i 30 gün whitelist'e alır. Aynı domain'den bir daha mail gelirse otomatik geçer." },
  ],
  threat_defense: [
    { q: "28 modül tek tek mi çalıştırılıyor?", a: "Her modül bağımsız. Bir modülün formunu doldurup 'Çalıştır'a basınca sadece o endpoint tetiklenir. Toplu 'Hepsini Test Et' butonu yok — hedefli teşhis için." },
    { q: "Sonuçlar cache'leniyor mu?", a: "Aynı input için 5 dakika cache. Farklı input her seferinde yeni sorgu." },
  ],
  licenses: [
    { q: "Lisans anahtarını kaybedersem?", a: "Master paneli → Lisanslar → 'Rotate' butonu → eski revoke olur, yeni oluşur + otomatik e-posta gider." },
    { q: "Bir IP'yi birden fazla lisansa bağlayabilir miyim?", a: "Hayır. Her IP tek bir lisansa bağlanır (multi-tenant izolasyon). Aynı sunucuda çoklu domain için IP alias veya reseller sub-license kullanın." },
  ],
  maintenance: [
    { q: "Weekly backup'lar nereye kaydediliyor?", a: "/app/backups/ klasörüne .json.gz olarak. Retention 8 snapshot (yaklaşık 2 ay). Master paneli → DB Bakım → Backup sekmesinden indirebilirsiniz." },
    { q: "Restore ile kritik veriyi kaybederim mi?", a: "Her zaman dry_run=true ile başlayın! Gerçek restore mevcut collection'ları TAMAMEN siler ve snapshot'tan doldurur. 2FA aktifse doğrulanmış cookie zorunludur." },
  ],
  settings: [
    { q: "2FA'yı aktifleştirdim ama giremiyorum?", a: "Backup code'larınızdan biri ile giriş yapın (2FA setup sırasında verilen 10 kod). Yoksa /app/backend/.env → MASTER_2FA_ENABLED=false ile bypass'lı bakım moduna geçin." },
    { q: "Kilit ekranı PIN'imi unuttum, nasıl sıfırlarım?", a: "Master için: Ayarlar → Kilit & PIN → 'Force Reset PIN' (v43.99.9+). Bayı için: Master → Kullanıcı PIN Yönetimi → o kullanıcının satırında 'SIFIRLA'." },
  ],
  install_guide: [
    { q: "Video eğitim gözükmüyor?", a: "Master paneli → Kurulum Rehberi → 'Video URL'lerini Yönet' butonundan 8 adım için YouTube veya MP4 URL'i girin. DB'ye kaydedilir, herkes anında görür." },
    { q: "PDF hangi dillerde?", a: "Türkçe (varsayılan), English (?lang=en), العربية (?lang=ar). Sağ üstteki bayraklı butonlarla indirebilirsiniz." },
  ],
};

const TONE_MAP = {
  sky: "text-sky-300 bg-sky-500/10 border-sky-500/40",
  indigo: "text-indigo-300 bg-indigo-500/10 border-indigo-500/40",
  rose: "text-rose-300 bg-rose-500/10 border-rose-500/40",
  amber: "text-amber-300 bg-amber-500/10 border-amber-500/40",
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
  fuchsia: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/40",
  orange: "text-orange-300 bg-orange-500/10 border-orange-500/40",
};

export default function Docs() {
  const [active, setActive] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // v43.99.14
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  // Modül değiştiğinde tab'ı sıfırla
  useEffect(() => { setActiveTab("overview"); }, [active?.key]);

  // v43.99.13 — Fuse.js fuzzy search (label + what + features + how'da arama)
  const fuse = useMemo(() => new Fuse(MODULES, {
    keys: [
      { name: "label",    weight: 0.5 },
      { name: "what",     weight: 0.3 },
      { name: "features", weight: 0.15 },
      { name: "how",      weight: 0.05 },
      { name: "cat",      weight: 0.1 },
    ],
    threshold: 0.35,    // 0.0 = strict, 1.0 = anything
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), []);

  const filtered = useMemo(() => {
    let list = MODULES;
    if (search.trim().length >= 2) {
      list = fuse.search(search.trim()).map(r => r.item);
    }
    if (category !== "all") {
      list = list.filter(m => m.cat === category);
    }
    return list;
  }, [search, category, fuse]);

  // Kategoriye göre modül sayısı (chip'lerde göstermek için)
  const catCounts = useMemo(() => {
    const c = { all: MODULES.length };
    MODULES.forEach(m => { c[m.cat] = (c[m.cat] || 0) + 1; });
    return c;
  }, []);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400"/> Modül Dokümantasyonu
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {MODULES.length} modül · {filtered.length !== MODULES.length && `${filtered.length} sonuç · `}
            fuzzy arama · kart tıkla → detay
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500"/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Ara: 'karantina', 'webhook', 'ssl'..."
            data-testid="docs-search"
            className="pl-9 pr-9 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 w-80 focus:border-indigo-500/50 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              data-testid="docs-search-clear"
              className="absolute right-2 top-2.5 text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4"/>
            </button>
          )}
        </div>
      </div>

      {/* v43.99.13 — Kategori chip filtresi */}
      <div className="flex flex-wrap gap-1.5" data-testid="docs-category-chips">
        {[["all", "Tümü"], ...CATEGORIES.map(c => [c, c])].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            data-testid={`docs-chip-${key}`}
            className={`text-[11px] px-3 py-1 rounded-full border transition-all font-semibold ${
              category === key
                ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
            }`}
          >
            {label}
            <span className="ml-1.5 text-[10px] opacity-70">{catCounts[key] || 0}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="docs-grid">
        {filtered.map(m => (
          <div
            key={m.key}
            data-testid={m.testid}
            className={`border rounded-lg p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg group ${TONE_MAP[m.tone]}`}
          >
            <button
              onClick={() => setActive(m)}
              className="text-left w-full"
            >
              <div className="flex items-start justify-between">
                <m.Icon className="w-6 h-6 opacity-80"/>
                <span className="text-[10px] mono uppercase tracking-widest opacity-70">{m.cat}</span>
              </div>
              <div className="mt-3 text-base font-semibold">{m.label}</div>
              <div className="text-[11px] opacity-80 mt-1 line-clamp-2">{m.what}</div>
              <div className="text-[10px] opacity-60 mt-2">{m.features.length} özellik · nasıl kullanılır +</div>
            </button>
            {MODULE_ROUTES[m.key] && (
              <a
                href={MODULE_ROUTES[m.key]}
                data-testid={`docs-open-${m.key}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md border border-current opacity-70 hover:opacity-100 transition-opacity"
              >
                <ExternalLink className="w-3 h-3" />
                Şimdi Aç →
              </a>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-3 text-center py-12 text-slate-500 text-sm">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
            "{search}" için sonuç yok — farklı bir terim deneyin
          </div>
        )}
      </div>

      {active && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-6" onClick={() => setActive(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-t-xl sm:rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl"
               data-testid="docs-detail" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg border ${TONE_MAP[active.tone]}`}>
                  <active.Icon className="w-6 h-6"/>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{active.cat}</div>
                  <h2 className="text-slate-100 text-xl font-semibold">{active.label}</h2>
                </div>
              </div>
              <button onClick={() => setActive(null)} data-testid="docs-close"
                      className="p-2 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
            </div>

            {/* v43.99.14 — Sekme (tab) navigasyonu */}
            <div className="flex gap-1 px-5 pt-3 border-b border-slate-800 sticky top-[68px] bg-slate-900 z-10" data-testid="docs-tabs">
              {[
                { id: "overview", label: "Genel Bakış", Icon: BookOpen },
                { id: "video",    label: "Video Eğitimi", Icon: Play },
                { id: "faq",      label: "Sık Sorulan", Icon: HelpCircle },
                { id: "ai",       label: "AI Sohbet", Icon: Brain },
              ].map(t => (
                <button
                  key={t.id}
                  data-testid={`docs-tab-${t.id}`}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                    activeTab === t.id
                      ? "text-indigo-300 border-indigo-500"
                      : "text-slate-400 border-transparent hover:text-slate-200"
                  }`}
                >
                  <t.Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-5">
              {activeTab === "overview" && (<>
                {/* Video-style Animated Walkthrough */}
                <AnimatedWalkthrough module_key={active.key} tone={active.tone}/>
                {/* User uploaded media gallery + AI illustration */}
                <MediaGallery moduleKey={active.key} tone={active.tone} moduleLabel={active.label}/>
                {/* AI Sesli Kılavuz */}
                <AiNarration module={active}/>

                <section>
                  <h3 className="text-slate-100 font-semibold text-sm mb-2">Ne yapar?</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{active.what}</p>
                </section>
                <section>
                  <h3 className="text-slate-100 font-semibold text-sm mb-2">Öne çıkan özellikler</h3>
                  <ul className="text-slate-300 text-sm space-y-1.5">
                    {active.features.map((f, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className="text-indigo-400 mt-1">▸</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="text-slate-100 font-semibold text-sm mb-2">Nasıl kullanılır?</h3>
                  <ol className="text-slate-300 text-sm space-y-1.5 list-decimal list-inside">
                    {active.how.map((h, i) => <li key={i}>{h}</li>)}
                  </ol>
                </section>
                {MODULE_ROUTES[active.key] && (
                  <a
                    href={MODULE_ROUTES[active.key]}
                    data-testid={`docs-drawer-open-${active.key}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-indigo-500 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 text-sm font-bold"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {active.label} sayfasını aç →
                  </a>
                )}
              </>)}

              {activeTab === "video" && <DocsVideoTab module={active} />}

              {activeTab === "faq" && <DocsFaqTab module={active} />}

              {activeTab === "ai" && <AiModuleChat module={active}/>}

              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
                <span>Modül anahtarı: <span className="mono text-slate-400">{active.key}</span></span>
                <span>Kategori: <Badge>{active.cat}</Badge></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Basit SVG mockup — modul için tema-uyumlu görsel placeholder
function MockPreview({ module_key }) {
  // Her modul için farklı görsel
  if (module_key === "dashboard") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {[0,1,2,3,4,5].map(i => (
          <rect key={i} x={i*64+10} y={20} width={54} height={60} rx={6}
                fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.6}/>
        ))}
        <text x="10" y="15" fontSize="8" fill="currentColor" opacity={0.7}>Control Bar · 6 kart</text>
      </svg>
    );
  }
  if (module_key === "queue") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {[0,1,2,3,4].map(i => (
          <g key={i}>
            <rect x={10} y={i*17+5} width={12} height={12} rx={2} fill="currentColor" opacity={0.3}/>
            <line x1={30} y1={i*17+11} x2={380} y2={i*17+11} stroke="currentColor" strokeWidth="0.5" opacity={0.4}/>
          </g>
        ))}
      </svg>
    );
  }
  if (module_key === "geoblocking") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {["TR","US","CN","RU","DE","GB"].map((cc, i) => (
          <g key={cc} transform={`translate(${i*60+20},50)`}>
            <circle r="14" fill="currentColor" opacity="0.15"/>
            <text textAnchor="middle" y="4" fontSize="10" fill="currentColor" fontFamily="JetBrains Mono">{cc}</text>
          </g>
        ))}
      </svg>
    );
  }
  if (module_key === "ai") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        <circle cx="80" cy="50" r="30" fill="currentColor" opacity="0.15"/>
        <text x="80" y="55" textAnchor="middle" fontSize="18" fill="currentColor">AI</text>
        <path d="M120,50 L200,50" stroke="currentColor" strokeWidth="1" markerEnd="url(#arr)" opacity="0.6"/>
        <rect x="210" y="30" width="170" height="40" rx="4" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
        <text x="220" y="45" fontSize="8" fill="currentColor" opacity="0.7">Bayes · Rules · Analysis</text>
        <text x="220" y="60" fontSize="8" fill="currentColor" opacity="0.7">Turkish LLM · Claude</text>
      </svg>
    );
  }
  // default
  return (
    <svg viewBox="0 0 400 100" className="w-full h-24">
      <rect x="10" y="10" width="380" height="80" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <text x="200" y="55" textAnchor="middle" fontSize="14" fill="currentColor" opacity="0.7">modül önizleme</text>
    </svg>
  );
}

// Video-style animated walkthrough — CSS keyframe scenes cycling every 4s
function AnimatedWalkthrough({ module_key, tone }) {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const scenes = SCENES[module_key] || SCENES.default;
  const total = scenes.length;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setScene(s => (s + 1) % total), 4000);
    return () => clearInterval(t);
  }, [playing, total]);
  const cls = TONE_MAP[tone];
  return (
    <div className={`rounded-lg border ${cls} bg-slate-950 overflow-hidden`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <div className="flex items-center gap-2 text-[11px] mono">
          <Play className={`w-3 h-3 ${playing ? "text-emerald-400" : "text-slate-500"}`}/>
          <span className="text-slate-400">30sn animasyonlu kılavuz</span>
          <span className="text-slate-500">· Sahne {scene + 1} / {total}</span>
        </div>
        <div className="flex items-center gap-1">
          {scenes.map((_, i) => (
            <button key={i} onClick={() => setScene(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === scene ? "bg-slate-100 w-4" : "bg-slate-600"}`}/>
          ))}
          <button onClick={() => setPlaying(!playing)} className="ml-2 text-slate-400 hover:text-slate-100 text-[10px]">
            {playing ? "⏸" : "▶"}
          </button>
        </div>
      </div>
      <div className="p-6 h-48 relative overflow-hidden">
        {scenes.map((s, i) => (
          <div key={i}
               className={`absolute inset-0 p-6 transition-all duration-700 ease-out
                 ${i === scene ? "opacity-100 translate-y-0" : (i < scene ? "opacity-0 -translate-y-4 pointer-events-none" : "opacity-0 translate-y-4 pointer-events-none")}`}>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Adım {i + 1}</div>
            <div className="text-sm text-slate-100 mb-3 font-medium">{s.title}</div>
            <div className="text-xs text-slate-400">{s.body}</div>
            <div className="mt-3">{s.visual}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function useEffectAdvance() { /* deprecated - replaced by direct useEffect */ }

function AiNarration({ module }) {
  const [text, setText] = useState("");
  const [display, setDisplay] = useState("");
  const gen = useMutation({
    mutationFn: () => api.msDocsNarrate({
      module_key: module.key, module_label: module.label,
      features: module.features, style: "friendly",
    }),
    onSuccess: (d) => {
      setText(d.script || "");
      // typewriter effect
      let i = 0;
      setDisplay("");
      const t = setInterval(() => {
        i++;
        setDisplay((d.script || "").slice(0, i));
        if (i >= (d.script || "").length) clearInterval(t);
      }, 25);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const speak = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      toast.error("Tarayıcı sesli okuma desteklemiyor");
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  };
  return (
    <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-fuchsia-300 font-semibold text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4"/> AI Sesli Kılavuz (Claude · Türkçe)
        </div>
        <div className="flex gap-2">
          <button
            data-testid="docs-narrate-btn"
            onClick={() => gen.mutate()} disabled={gen.isPending}
            className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-40">
            {gen.isPending ? "Yazılıyor..." : "AI Kılavuz Üret"}
          </button>
          {text && (
            <button onClick={speak} data-testid="docs-narrate-speak"
                    className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30">
              <Volume2 className="w-3 h-3 inline mr-1"/>Sesli Oku
            </button>
          )}
        </div>
      </div>
      {display && (
        <div className="text-sm text-slate-200 leading-relaxed bg-slate-950 rounded p-3 mt-2">
          {display}
          {display.length < text.length && <span className="inline-block w-1.5 h-3.5 bg-fuchsia-400 animate-pulse ml-0.5"/>}
        </div>
      )}
      {!display && !gen.isPending && (
        <div className="text-xs text-slate-500 italic">Butona bas → 20-30sn'lik konuşma tarzı kılavuz üretilecek + tarayıcı sesli okuyabilir</div>
      )}
    </div>
  );
}

// Scene definitions per module — CSS/SVG animated frames
const SCENES = {
  dashboard: [
    { title: "1) Advanced Control Bar", body: "Üstteki 6 renkli kart canlı metriklerinizi gösterir.", visual: <BarScene/> },
    { title: "2) Tab bar", body: "7 tab arasında geçiş: Genel/Coğrafi/Trafik/Karantina/Sağlık/Canlı/Tümü.", visual: <TabScene/> },
    { title: "3) Kuyruk Modal", body: "Kuyruk kartına tıkla → toplu sil/ilet/dondur işlemleri.", visual: <QueueScene/> },
  ],
  mailscanner: [
    { title: "1) Yapılandırma", body: "Threshold ve motorları (SA/Bayes/ClamAV/Rspamd) tek tıkla aç/kapat.", visual: <ToggleScene/> },
    { title: "2) AI Analiz", body: "Claude sistemi okur, Türkçe rapor + aksiyon önerisi verir.", visual: <AiScene/> },
    { title: "3) Öğrenme", body: "Saatlik cron: high_spam → Bayes'e otomatik beslenir + LLM regex önerir.", visual: <LearnScene/> },
  ],
  security: [
    { title: "1) 11 Modül Overview", body: "Her modülün rozetli durum kartı bir bakışta.", visual: <GridScene/> },
    { title: "2) Exploit Tarayıcı", body: "Tek tık → 1500+ dosya taranır, kritik bulgular listelenir.", visual: <BugScene/> },
    { title: "3) BEC Tester", body: "Lookalike domain + display-name + urgency heuristic ile CEO fraud tespit.", visual: <BecScene/> },
  ],
  geoblocking: [
    { title: "1) Ülke Seç", body: "113 ülke katalog · toplu seçim · TTL ile otomatik silme.", visual: <FlagScene/> },
    { title: "2) Zaman-Tabanlı", body: "Sadece gece 00-06 arası CN/RU blokla senaryosu.", visual: <ClockScene/> },
    { title: "3) Brute-Force Otomatik", body: "Eşik aşan ülkeler TTL süresince otomatik bloklanır.", visual: <ZapScene/> },
  ],
  queue: [
    { title: "1) Aç", body: "Dashboard'da 'Kuyrukta Bekleyen' kartına tıkla.", visual: <QueueScene/> },
    { title: "2) Seç", body: "Satırları tıkla veya 'Tümünü seç' — toplu işlem hazır.", visual: <SelectScene/> },
    { title: "3) Uygula", body: "6 aksiyon: sil, ilet, dondur, çöz, döndür, tekrar dene.", visual: <ActionScene/> },
  ],
  ai: [
    { title: "1) AI Analiz", body: "Sistemi tara → LLM Türkçe rapor + aksiyon önerisi.", visual: <AiScene/> },
    { title: "2) Öğrenme", body: "Saatlik cron Bayes'i besler + LLM SA regex önerir.", visual: <LearnScene/> },
    { title: "3) Prewarm", body: "High_spam ingest → arka planda açıklama üretilir, cache'lenir.", visual: <CacheScene/> },
  ],
  default: [
    { title: "1) Genel Bakış", body: "Modül açıklaması ve giriş.", visual: <BarScene/> },
    { title: "2) Kullanım", body: "Ana ekran ve aksiyonlar.", visual: <TabScene/> },
    { title: "3) İpucu", body: "Best practice ve öneriler.", visual: <AiScene/> },
  ],
};

// Small SVG scene components with CSS animations
function BarScene() {
  return (
    <div className="flex gap-2">
      {[0,1,2,3,4,5].map(i => (
        <div key={i} className="flex-1 h-10 rounded animate-pulse"
             style={{ background: `linear-gradient(to top, currentColor ${20+i*10}%, transparent)`, opacity: 0.4, animationDelay: `${i*0.1}s` }}/>
      ))}
    </div>
  );
}
function TabScene() {
  return (
    <div className="flex gap-1">
      {["Genel","Coğrafi","Trafik","Canlı","+3"].map((t, i) => (
        <div key={t} className={`px-2 py-1 rounded text-[10px] mono border ${i === 0 ? "bg-current/20 border-current text-slate-100" : "border-slate-700 text-slate-500"}`}>{t}</div>
      ))}
    </div>
  );
}
function QueueScene() {
  return (
    <div className="space-y-1">
      {[0,1,2].map(i => (
        <div key={i} className="flex items-center gap-2 text-[10px] mono">
          <div className="w-3 h-3 border border-current rounded"/>
          <div className="flex-1 h-2 bg-current/30 rounded animate-pulse" style={{ animationDelay: `${i*0.2}s` }}/>
        </div>
      ))}
    </div>
  );
}
function ToggleScene() {
  return (
    <div className="flex gap-1 flex-wrap">
      {["SA","Bayes","ClamAV","Rspamd"].map((e, i) => (
        <div key={e} className={`px-2 py-1 rounded text-[10px] mono border ${i < 3 ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-500"}`}>● {e}</div>
      ))}
    </div>
  );
}
function AiScene() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-current/20 animate-pulse flex items-center justify-center text-[10px]">AI</div>
      <div className="flex-1 space-y-1">
        <div className="h-1.5 bg-current/40 rounded animate-pulse"/>
        <div className="h-1.5 bg-current/30 rounded animate-pulse w-3/4" style={{ animationDelay: "0.2s" }}/>
      </div>
    </div>
  );
}
function LearnScene() {
  return (
    <svg viewBox="0 0 200 40" className="w-full h-10">
      <path d="M0,30 Q50,10 100,20 T200,15" stroke="currentColor" strokeWidth="1.5" fill="none">
        <animate attributeName="stroke-dasharray" from="0 300" to="300 0" dur="2s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}
function GridScene() {
  return (
    <div className="grid grid-cols-4 gap-1">
      {Array.from({length: 8}).map((_, i) => (
        <div key={i} className="h-4 border border-current/40 rounded animate-pulse" style={{ animationDelay: `${i*0.1}s` }}/>
      ))}
    </div>
  );
}
function BugScene() {
  return (
    <div className="flex items-center gap-2 text-[10px] mono">
      <div className="w-3 h-3 rounded-full bg-rose-400 animate-ping"/>
      <span>/var/www/wp/x.php:12 · eval_base64</span>
    </div>
  );
}
function BecScene() {
  return (
    <div className="text-[10px] mono">
      <div className="text-slate-400">from: <span className="text-rose-400 line-through">info@sirket.com</span></div>
      <div className="text-slate-400">gerçek: <span className="text-emerald-400">info@sikertim.com</span></div>
    </div>
  );
}
function FlagScene() {
  return (
    <div className="flex gap-1 flex-wrap">
      {["TR","US","CN","RU","DE","IN"].map((c, i) => (
        <div key={c} className={`px-2 py-1 rounded text-[10px] mono border border-current/30 ${i%2 ? "bg-current/20" : ""}`}>{c}</div>
      ))}
    </div>
  );
}
function ClockScene() {
  return (
    <svg viewBox="0 0 40 40" className="w-10 h-10">
      <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
      <line x1="20" y1="20" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5">
        <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="3s" repeatCount="indefinite"/>
      </line>
    </svg>
  );
}
function ZapScene() {
  return (
    <div className="text-[10px] mono text-rose-400 animate-pulse">
      🚨 CN: 74 spam · auto-blocked (180min TTL)
    </div>
  );
}
function SelectScene() {
  return (
    <div className="space-y-1">
      {[0,1,2].map(i => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          <div className={`w-3 h-3 rounded ${i < 2 ? "bg-current/60" : "border border-current/40"}`}/>
          <div className="flex-1 h-1.5 bg-current/20 rounded"/>
        </div>
      ))}
    </div>
  );
}
function ActionScene() {
  return (
    <div className="flex gap-1 flex-wrap text-[9px] mono">
      {["remove","deliver","freeze","thaw","retry","bounce"].map(a => (
        <span key={a} className="px-1.5 py-0.5 rounded border border-current/30 bg-current/10">{a}</span>
      ))}
    </div>
  );
}
function CacheScene() {
  return (
    <div className="flex items-center gap-2 text-[10px] mono">
      <div className="w-4 h-4 border-2 border-current/40 rounded-full border-t-current animate-spin"/>
      <span>prewarming AI explanation → cache</span>
    </div>
  );
}

function MediaGallery({ moduleKey, tone, moduleLabel }) {
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();
  const media = useQuery({
    queryKey: ["docs-media", moduleKey],
    queryFn: () => api.docsMediaList(moduleKey),
  });
  const del = useMutation({
    mutationFn: (id) => api.docsMediaDelete(id),
    onSuccess: () => { toast.success("Silindi"); qc.invalidateQueries({ queryKey: ["docs-media", moduleKey] }); },
  });
  const illustrate = useMutation({
    mutationFn: () => api.moduleIllustrate({ module_key: moduleKey, module_label: moduleLabel || moduleKey }),
    onSuccess: () => { toast.success("🤖 AI görseli üretildi"); qc.invalidateQueries({ queryKey: ["docs-media", moduleKey] }); },
    onError: (e) => toast.error("Üretilemedi: " + (e?.response?.data?.detail || e.message)),
  });
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast.error("Dosya 20MB'dan büyük"); return; }
    setUploading(true);
    try {
      await api.docsMediaUpload(moduleKey, f, caption);
      toast.success("Yüklendi ✓");
      setCaption("");
      qc.invalidateQueries({ queryKey: ["docs-media", moduleKey] });
    } catch (err) {
      toast.error(err?.response?.data?.detail || err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };
  const items = media.data?.items || [];
  return (
    <div className={`rounded-lg border ${TONE_MAP[tone]} bg-slate-950 p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="w-4 h-4"/> Modül Görselleri / Videoları
          <span className="text-[10px] text-slate-500 mono">{items.length} adet</span>
        </div>
        <label className="text-xs px-3 py-1.5 rounded-md border border-current/40 bg-current/10 hover:bg-current/20 cursor-pointer transition-colors"
               data-testid={`docs-media-upload-${moduleKey}`}>
          {uploading ? "Yükleniyor..." : "+ GIF / Video / Görsel Yükle"}
          <input type="file" accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm" className="hidden" onChange={onFile} disabled={uploading}/>
        </label>
        <button onClick={() => illustrate.mutate()} disabled={illustrate.isPending}
                data-testid={`docs-media-ai-${moduleKey}`}
                className="text-xs px-3 py-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-40">
          <Sparkles className="w-3 h-3 inline mr-1"/>{illustrate.isPending ? "AI üretiyor..." : "AI ile Görsel Üret"}
        </button>
      </div>
      <input value={caption} onChange={(e) => setCaption(e.target.value)}
             placeholder="Açıklama (opsiyonel, dosya yüklemeden önce yaz)"
             className="w-full mb-3 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"/>
      {items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map(m => (
            <div key={m.id} className="border border-slate-800 rounded overflow-hidden bg-slate-950 group relative">
              {m.content_type.startsWith("video/") ? (
                <video src={m.url} controls className="w-full h-40 object-cover bg-black"/>
              ) : (
                <img src={m.url} alt={m.caption || m.filename} className="w-full h-40 object-cover"/>
              )}
              <button onClick={() => del.mutate(m.id)} title="Sil"
                      className="absolute top-2 right-2 bg-rose-500/80 hover:bg-rose-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3"/>
              </button>
              <div className="p-2 text-[11px] text-slate-400 truncate">{m.caption || m.filename}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500 italic text-center py-4">Henüz görsel yok. GIF/screencap yükle → drawer'da otomatik görüntülenir.</div>
      )}
    </div>
  );
}

function AiModuleChat({ module }) {
  const [question, setQuestion] = useState("Bu modül ne işe yarar?");
  const [messages, setMessages] = useState([]);
  // Load persistent Q&A history when module changes
  const history = useQuery({
    queryKey: ["module-qa", module.key],
    queryFn: () => api.moduleQaLog(module.key),
  });
  useEffect(() => {
    const items = history.data?.items || [];
    // Reverse (oldest first) + convert to chat format
    const msgs = [...items].reverse().flatMap(q => [
      { role: "user", text: q.question, ts: q.created_at },
      { role: "ai", text: q.answer, ts: q.created_at },
    ]);
    setMessages(msgs);
  }, [history.data]);
  const ask = useMutation({
    mutationFn: (q) => api.moduleAsk({ module_key: module.key, module_label: module.label, question: q }),
    onSuccess: (d) => setMessages(m => [...m, { role: "user", text: question }, { role: "ai", text: d.answer }]),
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const submit = () => { if (question.trim()) { ask.mutate(question); setQuestion(""); } };
  const suggestions = ["Bu modül ne işe yarar?", "Nasıl kullanmalıyım?", "En iyi ayarlar neler?", "Hangi senaryolarda kullanılır?"];
  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="text-indigo-300 font-semibold text-sm flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4"/> AI Modül Asistanı · Sor, öğren
        {messages.length > 0 && <span className="text-[10px] text-slate-500 mono ml-1">· {Math.floor(messages.length / 2)} kayıtlı</span>}
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {suggestions.map(s => (
          <button key={s} onClick={() => { setQuestion(s); }} data-testid={`mod-ask-suggest-${s.slice(0,10)}`}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()}
               data-testid="mod-ask-input"
               placeholder="Bu modül hakkında sor..."
               className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"/>
        <button data-testid="mod-ask-btn" onClick={submit} disabled={ask.isPending || !question.trim()}
                className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
          {ask.isPending ? "Yanıtlanıyor..." : "Sor"}
        </button>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[85%] rounded p-2 text-xs ${m.role === "user" ? "bg-slate-800 text-slate-300" : "bg-indigo-500/10 text-slate-100 border border-indigo-500/30"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-xs text-slate-500 italic text-center py-2">Soruyu yaz ya da öneriden birine tıkla → AI yanıtlayacak · geçmiş kaydedilir</div>
        )}
      </div>
    </div>
  );
}


// v43.99.14 — "Video Eğitimi" sekmesi
function DocsVideoTab({ module }) {
  const configured = MODULE_VIDEOS[module.key];
  const isInstallGuide = module.key === "install_guide";
  const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    "GökyüzüWebSpam " + module.label + " nasıl kullanılır"
  )}`;

  return (
    <div className="space-y-4" data-testid="docs-video-tab">
      {/* Configured video */}
      {configured ? (
        <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
          <div className="aspect-video bg-black">
            <iframe
              src={configured}
              title={`${module.label} eğitim videosu`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
          <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800">
            📺 Resmi eğitim videosu
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center">
          <Play className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <div className="text-sm text-slate-300 font-semibold mb-1">
            "{module.label}" için resmi video henüz eklenmedi
          </div>
          <div className="text-[12px] text-slate-500 mb-4">
            Master, YouTube veya MP4 URL'i eklediğinde burada gösterilir.
          </div>
          <a
            href={ytSearchUrl}
            target="_blank" rel="noreferrer"
            data-testid="docs-video-yt-search"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            YouTube'da "{module.label}" ara
          </a>
        </div>
      )}

      {/* Install Guide için özel: 8 adımın videolarını göster */}
      {isInstallGuide && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="text-sm font-bold text-emerald-300 flex items-center gap-2 mb-2">
            <Rocket className="w-4 h-4" />
            8 Adım Kurulum Videoları
          </div>
          <p className="text-[12px] text-slate-300 mb-3">
            Kurulum Rehberi sayfasında her adımın altında 30 saniyelik ekran kaydı vardır.
            Master, "Video URL'lerini Yönet" butonu ile bu videoları yönetir.
          </p>
          <a
            href="/panel/install-guide"
            data-testid="docs-video-install-open"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 text-xs font-bold"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Kurulum Rehberini Aç
          </a>
        </div>
      )}

      {/* Yardım kartı */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex items-start gap-3">
        <HelpCircle className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
        <div className="text-[12px] text-slate-400 leading-relaxed">
          Video eğitimi bulamadınız mı? <b>AI Sohbet</b> sekmesinden Claude'a modülle ilgili sorularınızı sorabilirsiniz — anında Türkçe kılavuz üretir.
        </div>
      </div>
    </div>
  );
}

// v43.99.14 — "Sık Sorulan Sorular (FAQ)" sekmesi
function DocsFaqTab({ module }) {
  const specific = MODULE_FAQS[module.key] || [];
  const all = [...specific, ...GENERIC_FAQS];
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <div className="space-y-2" data-testid="docs-faq-tab">
      <div className="text-[11px] text-slate-500 mb-3">
        {specific.length > 0
          ? `${specific.length} modül-özel + ${GENERIC_FAQS.length} genel soru`
          : `${GENERIC_FAQS.length} genel soru`
        }
      </div>
      {all.map((f, i) => {
        const open = openIdx === i;
        const isSpecific = i < specific.length;
        return (
          <div
            key={i}
            data-testid={`docs-faq-${i}`}
            className={`border rounded-lg overflow-hidden transition-all ${
              open
                ? "border-indigo-500/40 bg-indigo-500/5"
                : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
            }`}
          >
            <button
              onClick={() => setOpenIdx(open ? -1 : i)}
              className="w-full text-left px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <HelpCircle className={`w-4 h-4 mt-0.5 shrink-0 ${
                  isSpecific ? "text-indigo-400" : "text-slate-500"
                }`} />
                <div>
                  <div className="text-sm font-semibold text-slate-100">{f.q}</div>
                  {isSpecific && (
                    <div className="text-[10px] text-indigo-400 mt-0.5 font-bold uppercase tracking-wider">
                      Bu modüle özel
                    </div>
                  )}
                </div>
              </div>
              <span className={`text-slate-400 text-lg transform transition-transform shrink-0 ${
                open ? "rotate-45" : ""
              }`}>+</span>
            </button>
            {open && (
              <div className="px-4 pb-3 pt-1 text-[13px] text-slate-300 leading-relaxed border-t border-slate-800/60">
                {f.a}
              </div>
            )}
          </div>
        );
      })}

      {/* Yeni soru ekleme bilgi kartı */}
      <div className="mt-4 rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-3 text-center">
        <div className="text-[11px] text-slate-500 mb-1">
          Cevabını bulamadığınız bir soru mu var?
        </div>
        <div className="text-[12px] text-slate-300">
          <b>AI Sohbet</b> sekmesine geçin — Claude size 5 saniyede özel cevap üretir.
        </div>
      </div>
    </div>
  );
}

