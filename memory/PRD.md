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
- **v28 (Feb 2026)**: **DEMO MODU SALT-OKUNUR KİLİDİ** — Backend middleware (`demo_write_guard`) müşteri modunda lisanssız iken tüm `POST/PUT/PATCH/DELETE` isteklerini 423 (Locked) `DEMO_READ_ONLY` ile reddediyor (istisnalar: /plugin/, /admin/master-unlock, /license/, /version/, /master/, /reseller/, /payments/, /smart-pos/, /auth/, /invoices/, /shop); Frontend axios interceptor tüm 423 cevaplarında "Demo modunda işlem yapılamaz — Lisans Gir" toast'ı gösteriyor; Belirgin **● SALT OKUNUR** pill + amber gradient bandı + **Lisansla Kilidi Aç** butonu (`PluginStatusStripe`); `gws:open-license-modal` global event ile `LicenseGate` ve Landing modal manuel açılabiliyor; `auto-update.sh` scripti otomatik `git stash` ile yerel değişiklik conflict'lerini çözüyor
- **v29 (Feb 2026)**: **CANLI TRAFİK TAM DÜZELTME** — (1) `mailshield-logtail.pl` **timezone offset autodetect** — Exim log lokal saatini alıp doğru offset ile postluyor (`+00:00` hardcoded değil), (2) RFC 2047 **MIME encoded-word decoder** (`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`) Türkçe karakterler (`iöçüşğ İÇÖÜĞŞ`) düzgün gösteriliyor + backend safety-net decode (`email.header.make_header`), (3) **Logtail Heartbeat sistemi** — script her 60sn `POST /api/events/logtail-heartbeat` atıyor, `GET /api/events/logtail-status` panel'de "● script canlı / yavaş / kapalı" rozeti (LogtailBadge komponenti), (4) **TZ Migration endpoint** `POST /api/events/admin/migrate-ts-tz` (master anahtarı korunmalı) — eski `+00:00` yanlış ts'leri `+03:00` lokal olarak yeniden yorumlayıp UTC'ye çeviriyor (dry_run + only_exim seçenekleri), (5) **Frontend saat sabitlemesi** — `fmtTime` her zaman `timeZone: "Europe/Istanbul"` ile gösteriyor (browser konumundan bağımsız), (6) **Sıralama fix** — backend `sort([("ts",-1),("ingested_at",-1)])` + client-side ts DESC sort (en yeni mail her zaman üstte), (7) **Filter UI kaybolma fix** — verdict tab seçilince filtered items 0 olsa bile filter bar/donut görünmeye devam ediyor (total > 0 koşulu), verdict dropdown'da kategori sayıları görünüyor
- **v30 (Feb 2026)**: **LİSANS CRUD + MAILSCANNER PARİTE + ENV OVERRIDE** — (1) `mailshield-logtail.pl` **env var öncelik**: `MAILSHIELD_SERVER_URL` ve `MAILSHIELD_LICENSE_KEY` systemd override.conf'tan okunuyor (config yanlış URL'de kalsa bile doğru backend'e postlar), (2) **MailScanner tam header parsing** — `X-MailScanner: Found to be infected`, `X-MailScanner-Information`, `X-MailScanner-SpamScore` (yıldız formu), `X-ClamAV-Virus`, `X-Virus-Status` header'ları parse ediliyor → mail virüs/spam ise script de aynı verdict'i veriyor (MSFE ile parite), (3) **Perl script hız optimizasyonu** — SpamAssassin header retry 3x800ms yerine 2x300ms (worst 2.4sn → 0.6sn per mail) + `$MID_MAP` scope fix, (4) **auto-update.sh Perl kopyalama** — Docker rebuild dışında `/usr/local/mailshield/bin/mailshield-logtail.pl`'i de otomatik güncelleyip `systemctl restart mailshield-logtail`, (5) **Lisans CRUD tam düzeltme** — backend `demo_write_guard` artık MASTER_IP eşleşmesini de kabul ediyor (X-Forwarded-For + request.client.host), `/api/admin/whoami` `is_master:true` iken `master_key` de dönüyor, `useIsMaster` hook cevap gelince otomatik `localStorage['gws.master_license']` set ediyor, `_attachMasterKey` interceptor gws.master_license'ı öncelikli okuyor → **PUT/DELETE/BulkAction hepsi çalışıyor** (13/13 backend test %100 pass), (6) **ts_auto_corrected safety net** — backend ingest'te ts 30dk-12sa arası ileride ise otomatik offset uygulanıp UTC'ye çekilir (eski script deploy edilmemiş sunucular için failsafe)
- **v31 (Feb 2026)**: **BACKLOG SPRINT** — (1) **Cookie-based master session auto-unlock** — `useIsMaster` hook is_master=true dönünce otomatik `/api/admin/master-unlock` çağırıp 30-günlük `gws_master_session` cookie'sini alıyor (axios `withCredentials:true`); `demo_write_guard` middleware cookie'yi önce kontrol ediyor → PUT/DELETE localStorage/header karışıklığından bağımsız çalışıyor (BULLETPROOF lisans CRUD), (2) **Log Source Selector** — `GET/POST /api/plugin/log-source` (modes: `exim`/`mailscanner`/`auto`) settings collection'a persist ediyor; Settings sayfasına 3 seçenekli görsel kartlar (Otomatik/Sadece Exim/Sadece MailScanner) + Türkçe açıklamalar + master anahtarı koruması; Perl script startup'ta backend'den mode'u okuyor (env override: `MAILSHIELD_LOG_SOURCE`), (3) **Türkçe double-encode fix** — Perl script `Encode::decode` sonrası **re-encode YAPMIYOR** (JSON::PP zaten UTF-8 mode'da), `_mime_decode_wordstr` de Perl-string döndürüyor; backend ingest'te safety-net: mojibake pattern (Ã, Å, Ä±) tespit edilirse `.encode('latin-1').decode('utf-8')` ile geri döndürülüyor + `subject_double_decoded:True` flag, (4) **Landing sosyal kanıt geliştirme** — bölgesel isim/şehir/firma eşleşmesi (region_pool sözlüğü 35 ülke), TR ağırlıklı mix (~%50), ~%35 firma satın alması (🏢 ikonu) ~%65 birey (👤), her satırda bayrak + şehir + ülke kodu (`🇹🇷 Samsun, TR`, `🇬🇧 Manchester, GB`)
- **v36 (Feb 2026)**: **ABONELİK YENİLEME HATIRLATICI** — (1) **`_license_expiry_alerts_task` düzeltildi**: yanlış `expires_at` alanı yerine `valid_until` sorguluyor (önceden 19 gerçek lisansta çalışmıyor, sadece 4 dummy'de tetikleniyordu); 30/14/3 gün eşiklerinde admin_email'e Türkçe hatırlatma gönderiyor. (2) **`GET /api/plugin/renewal-info`** yeni endpoint: `days_left`, `should_show_banner`, `severity` (info@30d / warning@14d / critical@3d), `renewal_url` döner. Frontend `RenewalBanner` bunu 5dk polling'te çeker ve panel üstünde severity'ye göre amber/orange/rose tonda banner gösterir (kritik pulse animasyonlu). Ayrıca dismiss butonu 24 saatliğine gizler (kritikte gizlenemez), dismiss key artık lisans başına scope'lu (bir başka lisansta eski state taşınmaz). Banner /panel/subscription route'unda gizlenir. (3) **`POST /api/subscription/renew`** tek-tık lisans uzatma: mevcut plan/e-postayı otomatik çeker, `renewal_intent:{email}:{plan}` marker yazar, Stripe checkout başlatır. (4) **`_finalize_purchase` kritik fix**: `renewal_intent` marker'ı okur, VARSA mevcut lisansın `valid_until`'ini uzatır (`license_version++`, `renewed_at` set) yerine yeni lisans satırı açmaz; marker'ı temizler; müşteriye yenileme onay maili gönderir. (5) Subscription.js `?renew=1` deep-link ile mevcut plan kartına scroll + hero'da "Tek Tık 1 Yıl Uzat" gradient buton. Test: **testing_agent** 12/12 backend + %100 frontend PASS.
- **v35 (Feb 2026)**: **MOTOR DEMO KİLİDİ FIX + LİSANS ZORLA İLETME + ABONELİK PANELİ** — (1) **P0 Bug**: `demo_write_guard` seller-mode branch, `status.licensed` True dönerse yazma serbest → motor toggle/silme, blacklist, list, engines gibi kritik yazmalar Pro lisanslı bayilerde artık 423 dönmüyor. (2) **`POST /api/licenses/{id}/broadcast-refresh`** (master-only): lisansın `license_version` sayacını 1 arttırıp `license_events` koleksiyonuna `refresh_requested` düşer. `plugin/status` payload'ına yeni `license_version` alanı eklendi. Frontend `PluginStatusStripe` useEffect ile bunu izler, değiştiğinde sonner toast "Lisans güncellendi" + tüm React Query cache'lerini invalidate eder → yeni plan/limitler anında aktif. Licenses.js her satıra sky renkli refresh butonu (`lic-broadcast-{id}`) eklendi. (3) **`/panel/subscription` — Aboneliğim/Yükseltme paneli** (`Subscription.js`): hero'da mevcut plan + kalan gün + kullanım metrikleri, 3 planlık karşılaştırma kartları (Starter/Pro/Enterprise), monthly/yearly toggle + yıllık tasarruf gösterimi, tek tık Stripe checkout, ödeme geçmişi. Deep-link `?upgrade=pro&cycle=yearly` hedef kartı ring-2 indigo glow + otomatik scroll ile öne çıkarır. PlanUpgradeModal ve PlanGate CTA'ları artık `/panel/subscription`'a yönleniyor. Nav'a "Aboneliğim" Sparkles ikonu eklendi. `api.myPayments()` 404'te sessizce boş liste dönüyor. Test: **testing_agent** 16/16 backend + %100 frontend PASS.
- **v34 (Feb 2026)**: **PLAN FUNNEL ANALİTİĞİ + BAYİ TEHDİT PUSH BİLDİRİMİ** — (1) **Plan Upgrade Funnel** — `POST /api/analytics/plan-event` (visitor de yazabilir, allow-list'te) 6 aşama: gate_view/gate_click/modal_open/cycle_change/checkout_click/purchase; PlanGate.js useEffect+onClick, PlanUpgradeModal.js modal_open/cycle_change/checkout_click, Shop.js CheckoutSuccess `paid` durumunda purchase event (session-scoped dedupe). Master `GET /api/admin/plan-funnel?days=N` 5-aşamalı huni + by_feature + by_target_plan + recent 20. Yeni `/panel/plan-analytics` sayfası (`PlanAnalytics.js`): 4 stat kart (Görüntülenme/Kilit Tıkı/Satın Alma/Toplam Dönüşüm), 5 huni barı gradient tone'lu, feature breakdown tablosu conversion oranıyla renklendirilmiş. Conversion %100'de cap'lendi. (2) **Threat Push Bildirim** — `_threat_ratio_monitor_task` 5 dakikada bir tarama; bayi son 60dk'da ≥20 mail alıp spam+virüs+phish oranı >%30 ise `master_alerts` collection'a UNSEEN alert + admin e-postası + activity log; 60dk dedupe. Master `GET /admin/threat-alerts?unseen_only=`, `POST /admin/threat-alerts/{id}/ack`, `POST /admin/threat-alerts/ack-all`, `POST /admin/threat-alerts/scan` (manuel tetik). Yeni `ThreatAlertBell` komponenti Header'a bağlandı: master-only, 20sn polling, badge unseen sayısı, yeni unseen'de sonner toast, panel'de alert listesi (ratio %60+ critical kırmızı), tek/ack-all butonları, drill-down link. (3) `_is_master` cookie/header fallback'i mevcut. Test: **testing_agent** 18/18 backend + %100 frontend PASS.
- **v33 (Feb 2026)**: **MASTER LIVE + AUTO-CLEANUP CRON + PLAN UPGRADE WIZARD** — (1) `GET /api/admin/resellers-live?hours=N` yeni master endpoint: her bayi için son N saatlik mail sayacı (mails/spam/virus/phish/blocks/clean), spam_ratio_pct, online (10 dk heartbeat), violations_period; yanıt online önce + trafik desc sıralı, (2) `/panel/master-live` yeni sayfa (`MasterLive.js`): 6 stat kart (bayi, çevrim içi, toplam mail, spam, virüs, ihlal), periyod switcher (1sa/6sa/24sa/3 gün/7 gün), arama+online-only filtre, yan yana bayi kartları (canlı pulse + plan rozeti + counter pill'ler + tehdit oranı bar + son görülme + drill-down link `/panel/resellers-admin?rid=`), 15sn otomatik yenileme, (3) `_daily_violations_cleanup_task` cron: startup + her 24 saatte bir `license_violations` ve `violations` collection'larından 7 günden eski kayıtları siler, `maintenance_log` + activity logs'a yazar; manuel tetik master için `POST /api/maintenance/violations/auto-cleanup?days=7`, (4) **PlanUpgradeModal** (`/app/frontend/src/components/PlanUpgradeModal.js`): PlanGate kilit CTA'sına bağlı modal; mevcut plan vs önerilen plan yan yana kartlar, aylık/yıllık cycle toggle, fark hesabı, tek tık `/panel/pricing?upgrade=X&cycle=Y` yönlendirmesi, ESC/backdrop/X ile kapatılır, (5) **`_is_master` genişletildi**: header (`X-Master-Key`) + cookie (`gws_master_session`) fallback'leri eklendi → master GET endpoint'leri artık üç yöntemin herhangi biriyle erişilebilir (parity with demo_write_guard). Test: **testing_agent_v3** 13/13 backend PASS, frontend %100 (2 minor issue → düzeltildi).
- **v32 (Feb 2026)**: **BLACKLIST DEMO KİLİDİ FIX + PLAN GATING UI + LİSANS UPDATE 500 FIX** — (1) `demo_write_guard` allow-list'ine `/api/blacklist/` ve `/api/plan/features` eklendi — Pro lisanslı panellerde RBL kontrol/delist artık 423 dönmüyor, (2) POST alternatifi `POST /api/blacklist/requests/{id}/update` (Apache PUT bloğu için) — frontend `blacklistUpdateRequest` artık POST kullanıyor, (3) **PlanGate + PlanBadge komponentleri** (`/app/frontend/src/components/PlanGate.js`) — plan matrisi feature'ı kapsamıyorsa "Üst versiyonda geçerli" amber uyarı kartı + Planları görüntüle butonu; sayfa başlıklarında canlı plan rozeti (Starter/Pro/Enterprise renk kodlu), (4) Security → Exploit tab `<PlanGate feature="exploit_editor" minPlan="pro">` ile sarıldı, Blacklist ve Security header'larına `<PlanBadge/>` eklendi, (5) **P0 pre-existing bug fix** — `PUT /api/licenses/{lid}` her lisans güncellemesinde 500 (AttributeError: LicenseIn'de license_key/panel_domains yok); artık mevcut DB kaydından okunuyor → tüm lisans düzenleme akışı 200 dönüyor, (6) `blacklist_delist` içindeki unreachable duplicate log kodu (3454-3458) temizlendi. Test: 12/12 backend testi (`test_v20_blacklist_planfeatures.py`) PASS, license update regression PASS.

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


## 2026-02-08 (5) · WHM/cPanel Sunucu Deployment Sürecinde

### Kurulum Adımları — Kullanıcının Sunucusu (`ns1`, CloudLinux 8.10)
Kullanıcı VPS'e SSH ile bağlandı ve şu adımları başarıyla tamamladı:

1. ✅ **Docker + Compose kuruldu** (CentOS/CloudLinux uyumlu repo ile)
2. ✅ **Kod GitHub'dan çekildi**: `git clone https://github.com/gokyuzuweb/gokyuzuwebspam-app.git`
3. ✅ **.env dosyaları oluşturuldu**: `backend.env` + `frontend.env` (deployment/ altında)
4. ✅ **Docker override eklendi**: `docker-compose.override.yml` ile nginx servisi devre dışı (Apache ile çakışmasın)
5. ✅ **litellm çakışması çözüldü**: requirements.txt'den doğrudan URL satırı silindi (`sed '/^litellm[[:space:]]/d'`)
6. ✅ **yarn.lock preview'dan indirildi**: `curl -L -o frontend/yarn.lock https://mailscanner-pro.preview.emergentagent.com/yarn.lock`
7. ✅ **MongoDB 7 → 4.4 downgrade**: CPU AVX desteği yok, MongoDB 7 restart döngüsünde. `sed 's|mongo:7|mongo:4.4|'` ile düzeltildi
8. ✅ **3 container çalışıyor**: `gws-mongo (healthy)`, `gws-backend (Up)`, `gws-frontend (Up)`. `curl :8001/api/version/current` → JSON döndü ✓
9. ✅ **mod_proxy + mod_proxy_http Apache modülleri aktif**
10. ⏳ **Kalan**: WHM'de subdomain (`panel.gokyuzuhosting.com`) oluşturma + `.htaccess` yerleştirme + SSL

### Preview'da yapılan düzeltmeler (auto-update uyumluluğu için)
- `/app/backend/requirements.txt` → litellm doğrudan URL satırı silindi
- `/app/deployment/docker-compose.yml` → MongoDB 7 → 4.4, healthcheck `mongosh` → `mongo`
- `/app/frontend/public/yarn.lock` → preview URL üzerinden indirilebilir
- `/app/frontend/public/gokyuzuwebspam-source.tar.gz` → tam kaynak tarball

### Deployment Dokümantasyonu
- `/app/DEPLOY-KILAVUZU.md` — Tam teknik rehber (Docker + Nginx + Certbot)
- `/app/SUNUCU-KURULUM-ADIM-ADIM.md` — Copy-paste Türkçe kurulum
- `/app/deployment/install.sh` — Otomatik sıfır sunucu kurulum
- `/app/deployment/auto-update.sh` — GitHub sync + Docker rebuild
- `/app/deployment/whm-cpanel-htaccess.txt` — Apache reverse proxy config

### Son Adım — WHM Subdomain + .htaccess
Kullanıcıya "boş sayfa" sorunu için tek blok teşhis + otomatik fix scripti verildi (subdomain doc root'u bulur, .htaccess yazar, AllowOverride açar, Apache restart, SSL çeker).

