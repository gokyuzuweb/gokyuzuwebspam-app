# GökyüzüWebSpam v1.3 — WHM/cPanel Mail Security SaaS

## Bu Session Eklemeleri (v1.3 · Feb 2026)
- **Aylık MRR Panosu**: Licenses sayfasına canlı finansal analitik eklendi. MRR/ARR/ARPU/LTV
  stat kartları, 6-aylık MRR trend bar chart, plana göre dağılım tablosu ve son işlemler listesi.
  Kaynak: `/api/analytics/mrr` — payment_transactions + licenses koleksiyonlarından hesaplanır,
  yıllık ödemeler /12 ile normalize edilir. Preview'de 5 seed işlem: MRR=$315, ARR=$3780.
- **Ödeme Sonrası Onboarding**: Stripe checkout başarılı olunca müşteriye zenginleştirilmiş
  e-posta gönderilir — lisans anahtarı, tek-komut wget kurulum, 7 adımlı manuel kurulum ve
  destek bilgisi. CheckoutSuccess sayfası da aynı komutu ve indirme butonunu gösterir.
- **Wget Kurulum Sistemi**: `GET /api/plugin/download` on-the-fly tarball servis eder
  (X-GWS-Version header + Content-Disposition). `GET /api/plugin/install-info` wget/curl
  varyantlarını + lisans-embedded komutu döner. X-Forwarded-Proto/Host okuyarak public URL
  üretir. Install sayfasına "One-line Install" bölümü ve toggle eklendi.
- **Full Sayfa Çevirileri**: strings.js 6 dil × 8 sayfa = ~250 yeni key ile genişletildi.
  Quarantine, Notifications, Settings, Reports, Rules (body), MRR ve Install UI hepsi useT()
  kullanır. TR/EN/DE/FR/ES/AR — anlık dil değişimi (test edildi: TR→EN placeholder swap).

## Yeni Endpoint (v1.3)
- GET `/api/analytics/mrr` — MRR/ARR/ARPU/LTV/churn/trend/plan_breakdown/recent (seller-only)
- GET `/api/plugin/download` — WHM plugin tarball (public)
- GET `/api/plugin/install-info?license_key=X` — wget/curl one-liner + adımlar

## Test Doğrulaması (iteration 3)
- Backend pytest: **24/25 pass %96** — tek başarısız test iteration 2'den kalma stateful
  version-upgrade sıralı testi (kod hatası değil, DB state); iteration 3'ün 4 yeni feature
  testi %100 geçti (analytics_mrr, plugin_download, install_info +license, checkout webhook).
- Frontend: **%100 pass** — MRR panel (mrr-stat-mrr/arr/subs/ltv, trend, plan-table, recent),
  Install one-liner + toggle + tarball download, CheckoutSuccess (6 testid), Quarantine i18n
  TR↔EN swap hepsi doğrulandı.

## Sistem Genel Durumu
- 15 sayfa: Dashboard, Karantina, Beyaz/Kara Liste, Blacklist Çıkışı, Kurallar,
  Motorlar, Giden Posta, Bildirimler, Raporlar, **Lisans Yönetimi + MRR Panosu** (seller),
  **Fiyatlandırma** (seller), Kullanıcılar, Kayıtlar, Ayarlar, Kurulum
- Public routes: `/shop`, `/checkout/success` (wget + tarball + copy)
- 65+ backend endpoint
- 6 dil desteği tam (nav+header+common+dashboard+quarantine+rules+notifications+settings+reports+mrr+install_ui)
- 7 günlük demo + IP bazlı lisans + LicenseGate + heartbeat daemon
- SpamAssassin/ClamAV/DCC/Razor + Rspamd + AI (Claude/GPT/Gemini)
- Karantina, whitelist/blacklist, AI kural üretici, PDF rapor, RBL çıkışı
- WHM plugin paketi: 28 dosya + on-the-fly tarball
- MAILSHIELD_MODE: seller (varsayılan) / customer

## Backlog
- P2: server.py'yi domain'lere böl (2453 satır — checkout/, analytics/, plugin/, licensing/, i18n/)
- P2: `/api/plugin/download` tarball cache (per version, in-memory veya disk)
- P3: MRR trend hesabı `relativedelta` ile calendar-month accurate yap
- P3: Checkout webhook 400 döndürsün (Stripe retry için) invalid signature'da
- P3: Reseller alt-yetki matrisi
- P3: PricingSettings schema versioning

## Endpoint Envanteri (Yeni)
- POST `/api/checkout/create-session`, GET `/api/checkout/status/{sid}`, POST `/api/checkout/webhook`
- GET `/api/checkout/transactions` (seller)
- GET `/api/analytics/mrr` (seller)
- GET `/api/plugin/download`
- GET `/api/plugin/install-info`
- POST `/api/plugin/upgrade`
- GET `/api/version/current`, `/version/manifest`, `/version/check-update`

## Test Credentials
Auth-free preview. STRIPE_API_KEY=sk_test_emergent (backend/.env).
Seed: 5 paid transactions (session_id `cs_test_seed_*`) + 5 licenses (notes=seed).
Reseller test: "Örnek Müşteri A.Ş." → IP 203.0.113.10.
