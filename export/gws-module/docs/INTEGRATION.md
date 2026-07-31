# GökyüzüWebSpam — Satış & Lisans Modülü Entegrasyon Kılavuzu

Bu kılavuz, `cyber-security-18` projesindeki Emergent agent'a verilmek üzere
hazırlanmıştır. Sadece **satış, lisanslama ve admin paneli** modüllerini içerir —
mail scanning (SpamAssassin/ClamAV) kısmı hariç.

## Ne Ekleniyor?

### 🛒 Satış (Public)
- `/shop` — Stripe checkout ile plan seçimi (Starter/Pro/Enterprise)
- `/checkout/success` — Ödeme sonrası lisans + wget kurulum komutu

### 👤 Bayi (Reseller Portal)
- `/reseller` — JWT auth ile bayi girişi/kayıt
- Alt hesap yönetimi (plan bazlı kota: 5/50/999)
- Fatura geçmişi + 5-dilde PDF indirme (TR/EN/DE/FR/ES)

### 🎛️ Admin (Seller-only Panel)
- `/panel/licenses` — Lisans CRUD + MRR dashboard + cluster status
- `/panel/pricing` — Plan fiyat yönetimi
- MRR/ARR/ARPU/LTV/Churn canlı gösterge
- Fatura raporları

### 🔐 License Server (Ayrı Servis)
- `/api/license-server/*` — WHM plugin heartbeat'lerini karşılar
- Redis-backed cluster (opsiyonel)

## Dosya Listesi

### Backend (`/app/backend/`)
```
routes/analytics.py         # MRR endpoint
routes/reseller.py          # Reseller JWT + subaccounts
routes/invoices.py          # PDF invoice (5-lang)
routes/license_client.py    # License server proxy
routes/plugin.py            # Plugin download + install-info
deps.py                     # Shared db + env helpers
```

### Backend server.py'ye eklenecek endpoint'ler
```python
# Bu endpoint'ler mevcut server.py'ye include_router ile eklenmeli:
- /api/pricing (GET/PUT)
- /api/licenses (GET/POST/PUT/DELETE)
- /api/checkout/create-session (POST)
- /api/checkout/status/{sid} (GET)
- /api/checkout/webhook (POST)
- /api/checkout/transactions (GET)
```

### Frontend (`/app/frontend/src/`)
```
pages/Shop.js               # Public shop + CheckoutSuccess
pages/Reseller.js           # Reseller portal (auth + dashboard)
pages/Licenses.js           # Admin: license CRUD + MRR
pages/Pricing.js            # Admin: plan pricing
pages/Landing.js            # (Opsiyonel) 6-dil marketing page
components/MrrPanel.js
components/LicenseServerStatus.js
components/LicenseGate.js
i18n/index.js               # 6-dil context
i18n/strings.js             # 6-dil strings
lib/api.js                  # API client (relevant methods only)
```

### Standalone License Server
```
license-server/server.py    # FastAPI, port 8002 (ayrı process)
```

### Deploy
```
deploy/docker-compose.yml   # Redis + license replicas + HAProxy
deploy/haproxy.cfg
deploy/README.md
```

## MongoDB Koleksiyonları
```
licenses               # {license_key, customer_email, ip_addresses[], plan, valid_until, active}
payment_transactions   # {session_id, plan_code, amount, license_key, status, completed_at}
resellers              # {id, email, password_hash, license_key, company, plan}
subaccounts            # {id, reseller_id, username, email, domain, quota_daily}
lists                  # {type, value, owner_reseller_id}
license_heartbeats     # {license_key, server_ip, last_seen_at}
license_violations     # {license_key, server_ip, reason, at}
```

## Env Değişkenleri
Aşağıdakileri `cyber-security-18/backend/.env` içine ekleyin:

```env
# LLM (kural üretimi için) — mevcutsa dokunmayın
EMERGENT_LLM_KEY=<mevcut değeri koru>

# Stripe (production için Live key kullanın)
STRIPE_API_KEY=sk_test_emergent
STRIPE_WEBHOOK_SECRET=whsec_XXX_from_stripe_dashboard

# License server (opsiyonel — cluster kurmayacaksanız /license-server/ path'i devre dışı bırakabilirsiniz)
PUBLIC_LICENSE_SERVER_URL=http://localhost:8002
LICENSE_SERVER_REGIONS=Primary
LICENSE_SERVER_ADMIN_KEY=<openssl rand -hex 32 çıktısı>

# Reseller JWT
RESELLER_JWT_SECRET=<openssl rand -hex 32 çıktısı>

# Mail (bildirim + onboarding e-postaları)
MAILSHIELD_MODE=seller
```

## Routing Değişikliği (Kritik!)

`cyber-security-18` zaten mevcut bir uygulama. GökyüzüWebSpam route'larının **ana route'ları ezmemesi** için `/gws/*` prefix'i altına yerleştirin:

```javascript
// App.js içinde
<Route path="/gws" element={<Landing />} />           // (opsiyonel marketing)
<Route path="/gws/shop" element={<Shop />} />        // satış
<Route path="/gws/checkout/success" element={<CheckoutSuccess />} />
<Route path="/gws/reseller" element={<Reseller />} />
<Route path="/gws/admin/*" element={<GwsAdminShell />} /> // panel
```

Backend route'ları için değişiklik gerekmez — hepsi `/api/*` prefix'i altında zaten.

## Entegrasyon Adımları

### 1) Bu projeyi GitHub'a kaydedin
"Save to GitHub" butonu ile `gokyuzuwebspam-source` reposu oluşturun.

### 2) cyber-security-18 agent'ına şu talimatı verin:

```
Şu GitHub repo'sundan sadece satış + lisans + admin panel modüllerini
projeme entegre et:

https://github.com/<kullanıcı>/gokyuzuwebspam-source

Kopyalanacak dosyalar:
- backend/routes/{analytics,reseller,invoices,license_client,plugin}.py → /app/backend/routes/
- backend/deps.py → /app/backend/deps.py
- frontend/src/pages/{Shop,Reseller,Licenses,Pricing}.js → /app/frontend/src/pages/
- frontend/src/components/{MrrPanel,LicenseServerStatus,LicenseGate}.js → /app/frontend/src/components/
- frontend/src/i18n/ → /app/frontend/src/i18n/
- license-server/ → /app/license-server/
- deploy/ → /app/deploy/

Route değişikliği: TÜM frontend route'larını /gws prefix'i altına al
(shop → /gws/shop, reseller → /gws/reseller, panel → /gws/admin).

server.py'ye include_router çağrılarını ekle (checkout, licenses, pricing
endpoint'lerini server.py'den taşımak yerine mevcut yapıya bırakırsan
en az riskli olur — bu endpoint'ler için ayrıca routes/checkout.py
routes/pricing.py routes/licensing.py yaz).

MongoDB koleksiyonları: mevcut DB'de aynı isimleri kullan
(licenses, payment_transactions, resellers, subaccounts).

Env değişkenlerini INTEGRATION.md'deki listeye göre ekle.

Supervisor'a license-server-1 ve license-server-2 ekle (redis kuruluysa),
kurmayacaksan license_client.py'yi PUBLIC_LICENSE_SERVER_URL=disabled
yaparak devre dışı bırak.

Test seed: 5 paid transaction + 1 test reseller
(reseller@test.com / strong123).

data-testid'leri koruyarak Playwright regression yap.
```

### 3) Sonrası
- Domain'i `gokyuzubilgisayar.com` cyber-security-18 deployment'ına bağla
- Landing → `gokyuzubilgisayar.com/gws` yönlendirmesi
- Ana site'inizden `/gws/shop` ve `/gws/reseller` link'lerini ekleyin
- Stripe live key ile production satışa açın

## Önemli Notlar

1. **Backend endpoint'lerinin çoğu server.py'de** — bu proje 2286 satır. cyber-security-18'in server.py'sini bozmamak için endpoint'leri **APIRouter ile ayrı dosyalara** ayırıp include edin.

2. **Reseller JWT ayrı bir auth mekanizması** — cyber-security-18'in mevcut auth'una müdahale etmez, sadece `/api/reseller/*` route'larını korur.

3. **License Server opsiyonel** — Redis/2-replica cluster kurmak istemezseniz `license_client.py`'yi devre dışı bırakabilir, ana backend içindeki basit `/api/plugin/verify-license` endpoint'ini kullanabilirsiniz.

4. **PDF invoice ReportLab'a bağımlı** — `pip install reportlab` gerekli.

5. **Seed data** production'da temizlenmeli — test verilerini include etmeyin.
