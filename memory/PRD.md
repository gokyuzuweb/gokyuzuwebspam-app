# GökyüzüWebSpam — WHM/cPanel Mail Security Plugin (v1.1)

## Marka
"GökyüzüWebSpam" — WHM/cPanel için satılabilir, kapsamlı mail güvenliği eklentisi.
Hedef cPanel sürümü: **136.0.32**.

## Session 3 Eklemeleri
1. **Marka yeniden adlandırma**: MailShield → GökyüzüWebSpam (görünür UI, dokümanlar, plugin dosyaları)
2. **Lisans + Sürüm Yönetimi** (`/api/licenses`, `/api/version/*`):
   - Her müşteri için UUID lisans anahtarı (MS-XXXXX…)
   - Birden fazla IP tanımlama, plan (starter/pro/enterprise), max_domains, valid_until
   - Plugin heartbeat endpoint (`/api/license/heartbeat`) — 403 döner, ihlal loglanır, satıcıya e-posta
   - `/api/version/manifest` (PUT) ile yeni sürüm yayınlama; plugin `check-update` ile algılar
   - Lisans Yönetimi sayfası: liste, ekleme, silme, aktif/pasif toggle, ihlal geçmişi, simülasyon
3. **Blacklist / RBL Çıkışı** (`/api/blacklist/*`):
   - 15 sağlayıcı DNS RBL kontrolü (Spamhaus ZEN/DBL, Barracuda, SORBS, SpamCop, SURBL, URIBL, invaluement, PSBL, CBL, HostKarma, Spam Rats, Backscatterer, Mailspike)
   - IP veya domain kontrolü (paralel async DNS query)
   - Delisting talebi oluşturma — e-postalı sağlayıcılar için `sendmail` ile otomatik gönderim, portal olanlar için "Bekliyor" durumu
   - Talep takip listesi (durum güncelleme: bekliyor / gönderildi / çözüldü / başarısız)
4. **AI Kural Üretici** (`/api/rules/generate`):
   - Doğal dil promptu → 1-3 SpamAssassin regex kuralı önerisi
   - Model seçilebilir (Claude Sonnet 4.5 / GPT-5.2 / Gemini 3 Flash)
   - **Dil desteği**: TR/EN/DE/FR/ES/AR — arayüz diline göre kural adları o dilde üretilir
   - Örnek: TR prompt → "Kripto yatırım garantili kazanç vaadiyle spam", EN prompt → "CRYPTO_INVESTMENT_SCAM_GUARANTEED_RETURNS"
5. **E-posta öncelikli Bildirim**: Slack + Telegram yerine artık **yönetici e-postası** ana kanal
   - `admin_email` + `email_from` alanları, local `/usr/sbin/sendmail` ile gönderim
   - Yüksek skor tehdit + lisans ihlali + rapor hepsi tek adrese
   - Slack yedek kanal olarak kalıyor (opsiyonel)
6. **i18n — Çok Dilli Panel** (`/api/i18n/*`):
   - 7 dil: Otomatik / Türkçe / English / Deutsch / Français / Español / العربية
   - `Otomatik` modda WHM CGI proxy'nin `X-Cpanel-Language` header'ından cPanel dili algılanır
   - `<I18nProvider>` context + `useT()` hook + `strings.js` dictionary
   - Sidebar navigasyon + header title tamamen i18n
   - RTL desteği (Arapça)
   - Ayarlar → dil seçici kartı (7 dil kart butonu)

## Doğrulanan Testler (curl)
- ✅ Lisans heartbeat: doğru anahtar + izinli IP `203.0.113.10` → 200 OK, güncelleme bilgisi döner
- ✅ Lisans heartbeat: doğru anahtar + izinsiz IP `99.99.99.99` → 403 + reason: `ip_not_allowed`
- ✅ Simüle ihlal: `/api/license/simulate-violation` → alert e-postası tetiklendi
- ✅ AI Rule TR: "sahte kripto para yatırım daveti" → 3 Türkçe kural
- ✅ AI Rule EN: "fake crypto investment scam" → 3 English kural
- ✅ Blacklist: 15 sağlayıcı listelendi
- ✅ i18n: 7 dil endpoint'ten döner
- ✅ Cloudflare 1.1.1.1 RBL check: 2/12 sağlayıcıda listeli (gerçek DNS sorgusu çalışıyor)

## Sayfalar (14 adet)
Kontrol Paneli · Karantina · Beyaz/Kara Liste · **Blacklist Çıkışı (yeni)** · Kurallar (AI generator + dil seçici) · Motorlar · Giden Posta · Bildirimler (e-posta öncelikli) · Raporlar · **Lisans Yönetimi (yeni)** · Kullanıcılar · Kayıtlar · Ayarlar (dil seçici + AI model) · Kurulum Kılavuzu

## Endpoint Sayımı
Toplam **51 endpoint** — dashboard, karantina, listeler, kurallar, motorlar, ayarlar, kullanıcılar, loglar, giden posta, bildirimler, AI, PDF rapor, milter, lisans, sürüm, blacklist, i18n

## WHM Plugin Paketi (`/app/whm-plugin/`)
- **24 dosya**
- WHM CGI proxy artık `X-Cpanel-Language` header'ını FastAPI'ye forward ediyor
- systemd: api · milter · quarantine.timer · report.timer (heartbeat için gelecek iterasyonda ayrı timer)

## Kritik Non-destructive Garantiler (değişmedi)
- Sadece yeni dosyalar EKLENİR (`cp -n`)
- Exim `milters=` satırı otomatik EKLENMEZ (opt-in)
- SpamAssassin/ClamAV/DCC/Razor sistem servisleri değişmez
- Kaldırmada /etc/mailshield ve /var/log/mailshield korunur

## Backlog
- P1: Sidebar dışındaki sayfaların (Karantina/Lists/Rules body/Reports/etc.) i18n çeviri tamamlanması
- P2: Plugin tarafından heartbeat gönderen Perl daemon (`/usr/local/mailshield/bin/heartbeat.pl` + systemd timer)
- P2: Otomatik güncelleme (`mailshieldctl update` — tar indir + install.sh --upgrade)
- P2: Blacklist RBL check için cron schedule (kendi IP'ni haftalık kontrol)
- P3: Reseller yetki matrisi
- P3: Multi-language PDF rapor (şu an sadece Türkçe)

## Files
- `/app/backend/server.py` (1660+ satır, 51 endpoint)
- `/app/frontend/src/i18n/*` — i18n altyapısı + 7 dil
- `/app/frontend/src/pages/*.js` — 14 sayfa
- `/app/whm-plugin/` — 24 dosya
- `/app/frontend/public/kurulum-kilavuzu.html`

## Test Credentials
Auth-free önizleme modu. WHM'ye kurulunca CGI proxy Whostmgr::ACLS root kontrolü yapar.
Örnek lisans anahtarı (seed): "Örnek Müşteri A.Ş." → görünen paneldeki "Lisans Yönetimi" ekranından kopyalanır.
