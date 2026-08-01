# GökyüzüWebSpam · PRD

## Product
Multi-module WHM/cPanel mail-security SaaS with a React/FastAPI panel, WHM plugin, cPanel CGI proxy and a standalone License Server. IP-based licensing, reseller scoping, checkout, full i18n.

## Personas
1. **Master admin** — publishes versions, manages MRR/licenses (gokyuzuhosting.com, IP 89.19.15.58).
2. **Reseller** — resells scoped licenses; sees their sub-accounts only.
3. **Customer** — hosting/agency operator running the WHM plugin.

## Core Requirements (Delivered)
- WHM plugin + systemd heartbeat + cPanel CGI proxy
- Live mail traffic streaming (milter → SaaS)
- Alert Rules Engine (webhooks)
- Exploit / Webshell scanner (Perl daemon + backend)
- Independent MailScanner module + AI Auto-Actions
- Global Threat Intelligence (URLhaus / Spamhaus real feeds, IOC store, DMARC agg, Compliance auto-detect)
- AI Predict Score (50ms real-time)
- AI Weekly Report cron + SMTP delivery
- Docs Drawer: persistent AI Chat + walkthrough videos + media uploads
- Country blocking + time-based rules + brute-force auto-block
- Offline TopoJSON attack map
- **v19 (Feb 2026)**: 14 RBLs + delisting, Mail Health (MX/SPF/DKIM/DMARC/PTR), Update Server, PayTR + Havale/EFT, Landing ModulesShowcase, DB usage + selective cleanup, IP block from mail detail, Turkish char fixes, PHP bridge for gokyuzubilgisayar.com
- **v20 (Feb 2026)**: Payments Admin panel (approve/reject havale + inbox), Monthly auto-cleanup cron with email report (archive/delete), Geo Blocked-IP heatmap on Landing + Trust Dashboard, "Havale Yaptım" user notify flow, Trust Center Dashboard tab in Security
- **v21 (Feb 2026)**: Sidebar live badge (pending havale count · animate-pulse), 30-day Trust Score trend line chart with delta/avg/min/max, Country detail modal on Landing map (click bubble/row → IP list + timestamps), Enhanced auto-cleanup email with 30-day trend + top 10 spam source countries
- **v22 (Feb 2026)**: Live block counter (Landing hero 5s refresh), 30-day blocked-mail bar chart trend widget, per-IP Whitelist button (false-positive recovery), Trust Score <60 alert email + inbox, **SELF-HOST DEPLOYMENT PACKAGE** (Docker + Nginx + install.sh + backup/restore scripts) + **Master Mode Router** (/master/check /status /relay/update-check /relay/threat-feed /relay/heartbeat for resellers/plugins)
- **v23 (Feb 2026)**: Bayi Panosu (/panel/resellers-admin) with live heartbeat + online badge, 'Yeni Versiyon Yayınla' modal (release_history), Landing bar chart region filter (TR/Dış/Tümü), Whitelist History page (/panel/whitelist-history) with search + remove
- **v24 (Feb 2026)**: **Akıllı POS Router** (/api/smart-pos/*) — 5 sağlayıcı (paytr, iyzico, param, ipara, havale) health-based auto-routing + fallback chain; Bayi heartbeat tablosuna lisans **bitiş tarihi** kolonu + Bitişe Yakın stat kartı; SMTP **Otomatik Mod** toggle (WHM/cPanel sendmail + license domain'inden otomatik FROM adresi)
- **v25 (Feb 2026)**: Havale ekstre yükle + otomatik referans eşleştirme (`POST /payments/havale/statement-match`), lisans bitiş uyarı cron'u (14g + 3g mail — bayi domain'inden), POS health monitor cron (%40 altı → inbox alert + Telegram), Akıllı POS listesi 20 sağlayıcıya genişletildi (7 gateway + 12 banka VPOS + 1 manuel)
- **v26 (Feb 2026)**: **Sanal POS API Config UI** (`/api/smart-pos/provider/{key}/config` GET/POST + `/test`) — panel üzerinden her sağlayıcı için MERCHANT ID / KEY / SALT gir; **Bloklanan IP Coğrafi Haritası** react-simple-maps + TopoJSON ile gerçek dünya haritası + saldırı çizgileri (animasyonlu dashed line) + hedef sunucu pulse marker + tıklanabilir ülke poligonları; **Modül Durumları tile'ları tıklanabilir** — ilgili tab veya sayfaya query param ile navigasyon
- **v27 (Feb 2026)**: **Bayilere Broadcast** (`POST /master/notify-resellers`) — Bayi Panosu'na "Bayilere Duyuru Gönder" modalı, acil/normal seçeneği · **Publish Version** artık bayilere otomatik mail atıyor (kendi domain'lerinden); **Exploit Panel Modernize** — 10 imza için Türkçe açıklama sözlüğü (SIGNATURE_DICT), her bulguda "Bu ne demek? / Tehlike nedir? / Nasıl çözerim?" panelleri + OWASP/Web ara linkleri + severity filtre + arama; **Landing Hero Kapsamlı Metrikler** — 8 canlı sayaç kartı (Bugün Engellenen / Toplam / Virüs / Phishing / Exploit / IP Blok / Karantina / IOC); **SMTP Diagnostic** — Exim log'u kontrol edip preview ortamı kısıtlaması tespit edilir, kullanıcıya net uyarı gösterilir

## Sanal POS Sağlayıcı Listesi (20)
### Ödeme Ağ Geçitleri (7)
PayTR · iyzico · Param · ipara · Shopier · Moka United · SiPay

### Banka Sanal POS'ları (12)
Garanti BBVA · Yapı Kredi Posnet · Akbank · İş Bankası İşCep · Ziraat · Halkbank · Vakıfbank · DenizBank · TEB · QNB Finansbank · Kuveyt Türk · Albaraka Türk

### Manuel (1)
Havale / EFT / FAST

## Self-Host Architecture
- Location: `/app/deployment/` — Docker Compose (backend + frontend + Mongo + Nginx)
- Master node: `panel.gokyuzuhosting.com` (89.19.15.58)
- Resellers/plugins connect to master domain, not Emergent
- Update sync from Emergent via cron (`update-from-emergent.sh`)
- 24-hour cache on master relay endpoints
- Reseller heartbeat tracking (10min online window)

## Payment Integration
- **PayTR iFrame API** — kartla ödeme (mock mode when merchant keys unset)
- **Havale/EFT** — IBAN + reference, admin manual approval
- Old Stripe integration still functional as fallback

## PHP Bridge
Located at `/app/php-bridge/`: `gws-bridge.php` cURL client + 3 example pages (mail-health, RBL check, checkout). Alternative iframe embed documented.

## DB Maintenance
- Two-tier collection categorization: DATA_COLS (deletable) vs SETTINGS_COLS (preserved)
- `POST /api/maintenance/cleanup` requires `confirm='DELETE_DATA'`
- UI (`/panel/maintenance`) requires typing `SIL` before enabling delete button
- Filtering: `older_than_days` optional
- Audit trail in `maintenance_log`

## Nav Structure
Home / Dashboard / MailScanner / Mail Sağlık / Tehdit Zekası / Güvenlik / Quarantine / Whitelist·Blacklist / RBL Delisting / Rules / Engines / Outbound Mail / Notifications / Alert Rules / Reports / Users / Logs / Settings / **DB Bakım** / Installation Guide / Docs

## Backlog (P1/P2)
- P1: PayTR live merchant provisioning UI + admin havale approval dashboard
- P1: Automatic monthly cleanup cron
- P2: Legacy mojibake purge (user-triggered from DB Bakım)
- P2: More sophisticated country geoIP (currently /8 prefix map)
- P2: Multi-tenant PHP bridge with per-license headers

## 2026-02-08 · Ödeme Panosu Modernizasyonu + Version Publish Fix
### Smart POS Panel — Tab yapısı + Taksit sistemi
- SmartPosPanel tamamen yeniden tasarlandı: gradient stat kartları + 4 alt-tab
- Alt-tab'lar: 💳 Sanal POS / 🏛️ Banka POS'ları / 🏦 Havale / 📊 Taksit Oranları
- Her sağlayıcı kartı modern hover animasyonu + kart aile chip'leri + Aktif/Hazır/Test rozeti
- 2 modal: `PosConfigModal` (API anahtarları) + `InstallmentConfigModal` (taksit + komisyon)

### Taksit Sistemi (backend + UI)
- Backend: `GET/POST /api/smart-pos/installments/{key}` — sağlayıcı bazlı oran matrisi
- Backend: `POST /api/smart-pos/installments/calculate` — canlı taksit hesaplama
- Frontend: 1-12 taksit matrisi + canlı ödeme simülatörü + kart aile limitleri
- Komisyon yansıtma modları: `reflect_to_customer` (müşteriye yansıt) veya `absorb` (satıcı üstlensin)
- Ek komisyon (%) — 2+ taksitlere ek yansıtma

### Bug Fix — Sürüm yayınlama otomatik-bump
- **Sorun**: Boş `latest_version` ile publish edildiğinde backend patch'i +1 yapıyordu (1.3.5 → 1.3.6 → 1.3.7)
- **Kök neden**: `server.py:version_publish` fallback yolunda `parts[2] += 1`
- **Çözüm**: 
  - Backend fallback artık `settings.version.version` (kurulu sürüm) kullanıyor, bump yok
  - Frontend "Kurulu Sürümü Yayınla" butonu artık explicit olarak `cur.data.version` gönderiyor
- Test: 3 kez üst üste boş publish → hepsi `1.3.3` yayınlandı ✓

### Bug Fix — Licenses.js runtime crash
- **Sorun**: `r.ip_addresses.map is undefined` — bazı lisans kayıtlarında ip_addresses eksik
- **Çözüm**: `(r.ip_addresses || []).map(...)` null-safe guard

### Yeni Endpoint'ler
- `POST /api/payments/havale/statement-upload` — PDF/TXT/CSV yükleme, pypdf ile text çıkarma
- `POST /api/smart-pos/installments/calculate` — checkout için taksit tablosu
- `GET/POST /api/smart-pos/installments/{key}` — oran matrisi CRUD

### Yeni Frontend Component'ler (PaymentsAdmin.js)
- `StatementMatchForm` — ekstre yapıştırma + PDF/TXT/CSV upload + auto-approve
- `PosConfigModal` — sağlayıcı API anahtarları + show/hide secrets
- `OrdersKanban` — 4 sütun drag-drop (Bekleyen/Bildirim/Onaylandı/Reddedildi)
- `ProviderCard`, `InstallmentOverview`, `InstallmentConfigModal`, `SmartPosMiniStat`


## 2026-02-08 (2) · UX + Alarm Sistemi + Renkli Tab'lar

### Landing → Panel dönüş
- Header'daki "Live Demo" butonu → belirgin yeşil "Panele Dön" oldu
- Sabit sağ-alt köşe floating buton: `FloatingPanelButton` (gradient emerald, animasyonlu)

### Saldırı & Toplu Mail Alarm sistemi
- `NotificationSettings` şemasına 4 yeni alan: `alert_on_attack`, `alert_on_bulk_mail`, `attack_threshold_5min`, `bulk_mail_threshold_1h`
- Backend: `_check_attack_bulk_alerts()` her ingest event sonrası çalışıyor
- Saldırı algılama: 5dk'da aynı sender_ip'den >= threshold olay
- Toplu mail algılama: 1sa'da aynı from_addr'den >= threshold outbound
- Cool-down: aynı kaynak + kind için 30dk cool-down (spam alarm koruma)
- Alarm kanalları: `notifications_inbox` + admin e-postası + Slack webhook
- Frontend: `Notifications.js` panelinde toggle + eşik input'ları

### Lisans Yönetimi 4 Renkli Tab'a Bölündü
- Karmaşık tek sayfa → `LicenseTabs` component'i ile 4 sekmeye ayrıldı
- 🔵 **Lisanslar** (indigo) — filtreli tablo
- 🟢 **Yeni Lisans** (emerald) — ekleme formu
- 🔴 **İhlaller** (rose) — canlı sayaç badge'i ile
- 🟡 **Yönetim** (amber) — VersionPublish + ResellerAdmin + AdminOperations + yardım
- Aktif tab: gradient shadow, pulse dot, renkli border, hover elevation

### Global Tab Enhancement CSS
- `index.css` içine tüm site tab'larını renklendiren global CSS eklendi
- `border-b-2 border-indigo-500` pattern'ini gradient/pulse/glow ile canlandırıyor
- `data-testid^="tab-|pa-tab-|sptab-|lictab-"` seçicileri global efekt uyguluyor
- Renkli alt-tab bar container: indigo→emerald→rose gradient border-bottom
- Pill-style sub-tab'larda shimmer efekti

### Bug Fix: NotificationSettings backward-compat
- Eski docs'ta yeni alanlar yoktu → `_notify_settings()` artık pydantic default'la merge ediyor
- Test: GET /api/notifications yeni alanlar için doğru default değer döndürüyor


## 2026-02-08 (3) · Ultra-Belirgin Tab'lar + PHP Multi-page + Alarm Sim + Deploy Kılavuzu

### 🌈 Tab'lar artık ULTRA-belirgin (kullanıcı isteği)
- `index.css` global tab enhancement v2:
  - Tab bar container: `[data-testid="dashboard-tabs" | "smart-pos-subtabs" | "lic-tabbar"]` → renkli gradient border-image + 2px border + shadow
  - Aktif tab (pill-style, `bg-indigo-500/20` içeren): gradient 30% opacity + ring-2 inset + shadow + text-shadow + %2 scale
  - Aktif tab (border-b-2 style): rgb(99,102,241) 3px alt çizgi + gradient bg + shadow
  - Üst kenarda parlayan shimmer bar (`::before`, 2.4s animation)
  - Sağ üst köşede nabız gibi atan pulse dot (`::after`, 1.6s animation)
  - Renk varyasyonları: emerald, rose, amber için ayrı stiller
  - Hover shimmer efekti pill-style sub-tab'lara

### 🔔 Alarm Test Butonları
- Backend: `POST /api/events/simulate-alert { kind: 'attack'|'bulk_mail' }`
  - Cool-down bypass + 100+ sahte event ekleme + gerçek alarm zinciri tetikleme
  - Test edildi: 3 alarm inbox'a düştü ✓
- Frontend: `Notifications.js` → yeni "Saldırı & Toplu Mail Alarm Testi" kartı, 2 buton

### 📄 PHP Bridge Multi-page Site (cyber-security-18'e yüklenecek)
- `inc/layout.php` — Ortak header/nav/footer (Manrope + JetBrains Mono)
- `index.php` — Ana satış (mevcut + yeni nav)
- `ozellikler.php` — 14 modül showcase (3-col grid, feature listeleri)
- `fiyatlar.php` — 3 paket + PayTR + Havale checkout
- `arac-rbl.php` — Ücretsiz RBL kontrol aracı (backend'e cURL)
- `arac-mailhealth.php` — SPF/DKIM/DMARC/MX health test + 0-100 skor
- `musteri.php` — Lisans sorgulama portalı (verify-license backend)
- `iletisim.php` — İletişim formu + dosya loglama
- Tüm sayfaları PHP `-l` syntax check ile doğrulandı
- Test: PHP built-in server ile 7/7 sayfa render ediliyor

### 📘 Deploy Kılavuzu
- `/app/DEPLOY-KILAVUZU.md` (10 adım)
- Dual-source mimari açıklaması (preview=dev, gokyuzuhosting=prod)
- DNS/SSL/Nginx/Docker Compose/Certbot adımları
- PHP Bridge kurulumu (cyber-security-18 projesine)
- Sorun giderme + kontrol listesi

### Backend Fix: NotificationSettings backward-compat
- `_notify_settings()` artık eski docs'a pydantic default'ları merge ediyor
- Test: yeni alanlar (alert_on_attack, thresholds) default değerlerle döner


## 2026-02-08 (4) · Alt-tab CSS Genişletme

### Sorun
Kullanıcı Yönetim tab'ının içindeki ResellerAdminPanel alt-tab'larının (Girişler/Bayiler/Alt Hesaplar) hala sönük kaldığını raporladı. Bunlar `border-indigo-400 text-indigo-300` kullanıyordu, önceki CSS ise sadece `border-indigo-500` yakalıyordu.

### Fix
`index.css` v3 selector'leri genişletildi:
- Aktif underline tab için: `border-indigo-500`, `border-indigo-400`, `admin-tab-*[text-indigo-300]`, `ms-tab-*`, `sec-tab-*` hepsi yakalanıyor
- Tab bar container: `.flex.gap-1.border-b.border-slate-800` da eklendi (ResellerAdmin container)
- Shimmer bar + pulse dot artık admin-tab pattern'lerinde de görünüyor
- Screenshot ile MailScanner "Yapılandırma" tab'ı üzerinde doğrulandı ✓

Etkilenen sayfalar (otomatik):
- ResellerAdminPanel (Licenses > Yönetim içinde)
- MailScanner (ms-tab-*)
- Security (sec-tab-*)
- MailEventDetail modal
- Quarantine (qtab-*)
- PaymentsAdmin (pa-tab-*)
- Licenses (lictab-*)
- Dashboard (dashtab-*)
- Smart POS sub-tabs (sptab-*)

### Alarm Simülasyonu Doğrulaması
- `POST /api/events/simulate-alert { kind: attack }` → inbox'a `attack_alert` düştü ✓
- `POST /api/events/simulate-alert { kind: bulk_mail }` → inbox'a `bulk_mail_alert` düştü ✓
- Test sonucu inbox'ta 7 okunmamış bildirim biriktiği doğrulandı

