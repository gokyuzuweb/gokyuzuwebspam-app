# GökyüzüWebSpam v1.2 — WHM/cPanel Mail Security Plugin

## Bu Session Eklemeleri (v1.2)
- **Stripe Ödeme Otomasyonu**: Public /shop sayfası + 3 plan kartı × "Şimdi Satın Al" butonu
  → gerçek Stripe Checkout URL üretir → ödeme sonrası otomatik UUID lisans anahtarı,
  müşteriye ve satıcıya e-posta ile bildirim
- **Version Upgrade Banner**: Yeni sürüm yayınlanınca üst şeritte "Tek Tıkla Güncelle"
  butonu; WHM'de `mailshieldctl update` çalıştırır, önizleme ortamında simüle eder
- **i18n Genişletmesi**: TR/EN/DE/FR/ES/AR × nav+common+header+dashboard tam çevirili
  · Dashboard sayfası useT() ile refactor · language switching kusursuz (test edildi)

## Endpoint (yeni)
- POST `/api/checkout/create-session` — Stripe session (public, e-posta zorunlu)
- GET `/api/checkout/status/{sid}` — ödeme durumu poll
- POST `/api/checkout/webhook` — Stripe callback (auto-license on paid)
- GET `/api/checkout/transactions` — satıcı görünümü
- POST `/api/plugin/upgrade` — tek tıkla plugin update

## Test Doğrulaması (iteration 2)
- Backend: **17/17 pass %100**, critical bugs: 0
- Frontend: shop→stripe redirect, upgrade banner+toast, i18n EN/DE/AR hepsi doğrulandı
- Regresyon: tüm önceki bug fix'ler ve özellikler çalışıyor

## Sistem Genel Durumu
- 15 sayfa: Dashboard, Karantina, Beyaz/Kara Liste, Blacklist Çıkışı, Kurallar,
  Motorlar, Giden Posta, Bildirimler, Raporlar, Lisans Yönetimi (seller-only),
  **Fiyatlandırma (seller-only)**, Kullanıcılar, Kayıtlar, Ayarlar, Kurulum
- Public routes: `/shop`, `/checkout/success` — auth'suz, sidebar'sız
- 60+ backend endpoint
- 6 dil desteği + Otomatik (cPanel-follow)
- 7 günlük demo + IP bazlı lisans doğrulama + LicenseGate
- SpamAssassin/ClamAV/DCC/Razor + Rspamd + AI (Claude/GPT/Gemini)
- Karantina, whitelist/blacklist, kurallar (AI generator), PDF rapor, RBL çıkışı
- WHM plugin paketi: 28 dosya (Perl milter, heartbeat daemon, systemd, install.sh)
- MAILSHIELD_MODE: seller (varsayılan) / customer (bayi kurulumu)

## Backlog
- P2: Full sayfa çevirileri (Quarantine, Lists, Rules body, Reports, Notifications, Settings)
  — nav + header + dashboard tam ancak diğer 11 sayfa body TR fallback ile çalışıyor
- P2: Reseller alt-yetki matrisi
- P3: PricingSettings schema versioning
- P3: Checkout create-session rate limit / captcha
- P3: server.py'yi domain'lere böl (2235 satır)

## Test Credentials
Auth-free preview. STRIPE_API_KEY=sk_test_emergent (backend/.env).
Seed lisans: "Örnek Müşteri A.Ş." → IP 203.0.113.10.
