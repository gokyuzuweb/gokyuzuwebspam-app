# MailShield Pro — WHM/cPanel Mail Security Plugin

## Problem Statement
whm/cpanel mailler için spam uygulaması yapabilirmiyiz. Örnek ConfigServer MailScanner
gibi daha kapsamlı ve kolay. Hedef cPanel sürümü: **136.0.32**. Aktif cPanel sistemine
zarar vermeden çalışacak.

## User Choices
- **Uygulama tipi:** WHM/cPanel Plugin (production için Perl/PHP kaynak paketi) + React
  tabanlı önizleme dashboard'u (bu ortamda görüntülenir)
- **Spam motoru:** Apache SpamAssassin + ClamAV + DCC + Vipul's Razor; Rspamd
  alternatifi mevcut; hangisi etkinleştirilirse o kullanılır. AI (Emergent LLM)
  katmanı da toggle edilebilir.
- **Özellikler:** Karantina (release/delete/rapor), Whitelist/Blacklist (global +
  kullanıcı), gerçek zamanlı dashboard, kurallar editörü + tester, kullanıcı
  yönetimi, loglar, giden posta kontrolü, kurulum kılavuzu
- **Güvenlik:** Kurulum non-destructive olmalı, aktif cPanel'e dokunmamalı,
  milter opt-in

## Architecture
### Preview Dashboard (bu ortamda çalışan)
- **Backend:** FastAPI (Python) `/app/backend/server.py`, MongoDB, Motor async
  driver. `/api/*` prefix ile tüm endpoint'ler: stats, quarantine, lists, rules,
  engines, settings, users, logs, outbound, scan test.
- **Frontend:** React 19 + React Router + TanStack Query + Recharts + Radix UI +
  Sonner toast + Tailwind. Manrope (sans) + JetBrains Mono (mono) font kombinasyonu.
  Dark SOC teması (slate-950 base).
- **Data:** Auto-seeded on startup — 48 quarantine items, 8 list entries, 4 rules,
  6 engines, 5 cPanel users, 30 log entries.

### WHM Plugin Package (`/app/whm-plugin/`)
- **AppConfig:** `appconfig/mailshield.conf` → `register_appconfig`
- **WHM CGI:** `whm/mailshield.cgi` (Perl, Whostmgr::ACLS root kontrolü)
- **cPanel plugin:** `cpanel/mailshield.live.php` + `.cpanelplugin`
- **Milter (opt-in):** `lib/SpamGuard/Milter.pm` + `Engines.pm` + `Config.pm`
  — Sendmail::PMilter tabanlı, 127.0.0.1:33333 dinler, spamc/clamdscan/dccif/
  razor-check komutlarını shell out eder
- **CLI:** `mailshieldctl` (status, restart, engine enable/disable, policy,
  quarantine, bayes)
- **systemd:** api / milter (opt-in başlatılır) / quarantine.timer
- **Install:** `install.sh` cp -n (no-clobber), --dry-run destekli, milter DEFAULT
  KAPALI. `uninstall.sh` /etc/mailshield ve /var/log/mailshield'i korur, cPanel
  yapılandırmasına dokunmaz.

## Non-destructive Guarantees
- Sadece yeni dosyalar EKLENİR (`cp -n`); mevcut cPanel dosyaları KORUNUR
- Exim `milters=` satırı otomatik EKLENMEZ; kullanıcı Advanced Editor'de manuel
  ekler → cayma tek satır silmek
- SpamAssassin/ClamAV/DCC/Razor sistem servisleri OLDUKLARI GİBİ bırakılır
- MongoDB otomatik kurulmaz, yalnızca uyarı verilir
- Kaldırmada /etc/mailshield ve /var/log/mailshield DOKUNULMADAN kalır

## Implemented Screens (Turkish UI)
1. **Kontrol Paneli** — 4 stat card, 24h saatlik trafik grafiği (ham/spam/tehdit),
   son karantina feed, top-sender IP bar chart, tehdit dağılımı
2. **Karantina** — arama/filter, bulk release/delete/report-Bayes, önizleme modal
   (başlıklar, kurallar, gövde)
3. **Beyaz / Kara Liste** — tab'lı; IP/domain/email; global veya kullanıcı bazlı
4. **Kurallar** — custom SpamAssassin regex rules + tester (canlı skorlama)
5. **Motorlar** — 6 motor kartı (SA/ClamAV/DCC/Razor/Rspamd/AI), toggle, metrikler
6. **Giden Posta** — kullanıcı bazlı limit/blok durumu
7. **Kullanıcılar** — cPanel hesap trafiği ve spam metrikleri
8. **Kayıtlar** — canlı log akışı, level filtresi
9. **Ayarlar** — eşik slider'ları, motor seçici, Bayes/AI/TLS toggle'ları,
   karantina retention, rapor sıklığı, outbound
10. **Kurulum Kılavuzu** — 8 adım, kopyalanabilir kod blokları, mimari diyagramı

## Files
- `/app/backend/server.py`
- `/app/frontend/src/App.js`, `index.css`, `App.css`, `pages/*.js`, `components/*.js`, `lib/api.js`
- `/app/whm-plugin/` — 21 dosya, tam kurulabilir WHM plugin paketi
- `/app/whm-plugin/docs/INSTALL.md` — detaylı kurulum kılavuzu

## Backlog
- P1: Gerçek WHM sunucusunda `install.sh` end-to-end test
- P1: `install_plugin` çıktısını yakalayıp panelde göster
- P2: Emergent LLM entegrasyonu tam devreye alınırsa AI motoru için gerçek scoring
- P2: Kullanıcı bazlı per-user threshold GUI
- P2: PDF haftalık rapor
- P2: Slack/Telegram alert entegrasyonu
- P3: Reseller yetki matrisi

## Verified (curl)
- `/api/stats/overview` → 56952 scanned, 48 quarantine, 4/6 engines
- `/api/engines` → 6 motor, SA/ClamAV/DCC/Razor aktif
- `/api/scan/test` → skor 7.2, verdict `spam`, 3 kural eşleşti
- `/api/engines/rspamd/toggle` → geçiş çalışıyor

## Test Credentials
Uygulama şu an auth-free önizleme modunda çalışıyor. Gerçek WHM'ye kurulunca
WHM oturum kimlik doğrulaması CGI proxy tarafından yapılır (root ACL kontrolü).
