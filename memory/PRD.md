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

