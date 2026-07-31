# cyber-security-18 Agent'ına Verilecek Talimat
# ==============================================
# Aşağıdaki metnin tamamını cyber-security-18 projesindeki Emergent agent'a
# tek mesaj olarak yapıştırın. Değişkenler `<KULLANICI-ADIN>` ve `<REPO-ADI>`
# kısımlarını kendi GitHub kullanıcı adı ve repo adınızla değiştirmelisiniz.

---

GökyüzüWebSpam satış + lisans + admin panel modülünü bu projeye ekliyoruz.
Kaynak: `https://github.com/<KULLANICI-ADIN>/<REPO-ADI>` klasör: `export/gws-module/`

Hedef: `gokyuzubilgisayar.com/gws/*` altında tam çalışan bir SaaS modülü.

## Zorunlu Kısıtlar
- Mevcut cyber-security-18 route'larını KESİNLİKLE bozma
- Mevcut auth mekanizmasına dokunma (reseller kendi JWT'sini kullanır)
- Mevcut MongoDB koleksiyonlarını override etme (yeni koleksiyonlar ekle)
- Frontend'de tüm yeni route'lar `/gws` prefix'i altında olacak

## Adımlar

### 1. Backend Dosyalarını Kopyala
```bash
cp -r export/gws-module/backend/routes/*.py /app/backend/routes/
cp export/gws-module/backend/deps.py /app/backend/deps.py
```
Yeni endpoint'ler mevcut `/api/*` prefix'i altında zaten kayıtlı.

### 2. server.py'ye include_router ekle
`/app/backend/server.py` dosyasının sonuna (mevcut `app.include_router(api)` çağrısından sonra):
```python
from routes.analytics import router as _gws_analytics
from routes.plugin import router as _gws_plugin
from routes.reseller import router as _gws_reseller
from routes.invoices import router as _gws_invoices
from routes.license_client import router as _gws_license
app.include_router(_gws_analytics, prefix="/api")
app.include_router(_gws_plugin, prefix="/api")
app.include_router(_gws_reseller, prefix="/api")
app.include_router(_gws_invoices, prefix="/api")
app.include_router(_gws_license, prefix="/api")
```

### 3. Ek Backend Endpoint'leri
server.py'de eksik olan endpoint'leri ekle (kaynak GitHub'daki `backend/server.py`):
- `/api/pricing` (GET/PUT)
- `/api/licenses` (GET/POST/PUT/DELETE)
- `/api/checkout/create-session` (POST)
- `/api/checkout/status/{sid}` (GET)
- `/api/checkout/webhook` (POST)
- `/api/checkout/transactions` (GET)
- `/api/plugin/verify-license` (POST)
- `/api/system/mode` (GET) — döner {"mode": "seller"}
- `/api/i18n/languages` (GET) — döner desteklenen 6 dil listesi

Bu endpoint'leri routes/checkout.py ve routes/licensing.py adında YENİ modüllere yazabilirsin.

### 4. Frontend Dosyalarını Kopyala
```bash
cp -r export/gws-module/frontend/pages/*.js /app/frontend/src/pages/
cp -r export/gws-module/frontend/components/*.js* /app/frontend/src/components/
cp -r export/gws-module/frontend/i18n/*.js /app/frontend/src/i18n/
```

`/app/frontend/src/lib/api.js` içeriğini mevcut api.js'e MERGE et (üzerine yazma).
Sadece şu method'lar eklenmelidir:
- `pricing, pricingPublic, pricingPut`
- `licenses, licenseCreate, licenseUpdate, licenseDelete, licenseVerify`
- `checkoutCreate, checkoutStatus, checkoutTransactions`
- `analyticsMrr`
- `licenseServerHealth, licenseServerVerify, licenseServerRevoke, licenseServerConfig`
- `resellerRegister, resellerLogin, resellerMe, resellerAddSub, resellerDelSub, resellerQuarantine, resellerLists, resellerAddList, resellerDelList, resellerInvoices, resellerInvoicePdfBlob`
- `pluginInstallInfo, pluginDownloadUrl`
- `i18nLanguages, systemMode`

### 5. App.js'e Route Ekle
Mevcut Routes bloğuna EKLE (mevcut route'ları silme):
```jsx
import Shop, { CheckoutSuccess } from "@/pages/Shop";
import Reseller from "@/pages/Reseller";
import Landing from "@/pages/Landing";
import Licenses from "@/pages/Licenses";
import Pricing from "@/pages/Pricing";
import { I18nProvider } from "@/i18n";

// Tüm mevcut Routes'ları I18nProvider ile sar
<I18nProvider>
  <BrowserRouter>
    <Routes>
      {/* MEVCUT ROUTE'LAR */}
      {/* ... */}
      
      {/* YENİ GWS ROUTE'LAR */}
      <Route path="/gws" element={<Landing />} />
      <Route path="/gws/shop" element={<Shop />} />
      <Route path="/gws/checkout/success" element={<CheckoutSuccess />} />
      <Route path="/gws/reseller" element={<Reseller />} />
      <Route path="/gws/admin/licenses" element={<Licenses />} />
      <Route path="/gws/admin/pricing" element={<Pricing />} />
    </Routes>
  </BrowserRouter>
</I18nProvider>
```

### 6. Admin Panel Menüsüne Ekle
cyber-security-18'in admin panelinde (varsa Sidebar/Menu component), yeni bir bölüm ekle:
```jsx
{
  section: "GökyüzüWebSpam",
  items: [
    { icon: DollarSign, label: "Lisanslar & MRR", to: "/gws/admin/licenses" },
    { icon: Tag, label: "Fiyatlandırma", to: "/gws/admin/pricing" },
    { icon: ExternalLink, label: "Landing Sayfası", to: "/gws" },
    { icon: Users2, label: "Bayi Portalı", to: "/gws/reseller", target: "_blank" },
  ]
}
```

### 7. Env Değişkenlerini Ekle
`/app/backend/.env` dosyasına EKLE (mevcut değerlere DOKUNMA):
```env
# GökyüzüWebSpam modülü
STRIPE_API_KEY=sk_test_emergent
STRIPE_WEBHOOK_SECRET=whsec_placeholder
MAILSHIELD_MODE=seller
PUBLIC_LICENSE_SERVER_URL=http://localhost:8002
LICENSE_SERVER_REGIONS=Primary
LICENSE_SERVER_ADMIN_KEY=<openssl rand -hex 32>
RESELLER_JWT_SECRET=<openssl rand -hex 32>
```

### 8. Python Bağımlılıkları
```bash
pip install httpx redis reportlab bcrypt PyJWT emergentintegrations
pip freeze > /app/backend/requirements.txt
```

### 9. License Server'ı Ayaklandır (Opsiyonel)
Eğer Redis-backed license cluster istersen:
```bash
cp -r export/gws-module/license-server /app/
apt-get install -y redis-server
```
`/etc/supervisor/conf.d/gws-license.conf` oluştur:
```ini
[program:gws-license]
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8002
directory=/app/license-server
autostart=true
environment=MONGO_URL="mongodb://localhost:27017",DB_NAME="test_database"
```

Kurmayacaksan `PUBLIC_LICENSE_SERVER_URL=disabled` yaparak devre dışı bırak.

### 10. Seed Data (Sadece Test İçin)
Production'da BU BÖLÜMÜ SKIP ET. Preview'de test için:
```python
# 1 test reseller + 1 örnek lisans
await db.licenses.insert_one({
    "id": "seed-1",
    "license_key": "MS-DEMO-1234567890ABCDEF",
    "customer_name": "Demo Firma",
    "customer_email": "demo@test.com",
    "plan": "pro",
    "ip_addresses": ["1.2.3.4"],
    "max_domains": 100,
    "valid_until": "2027-12-31T00:00:00+00:00",
    "active": True,
    "notes": "seed",
    "created_at": "2026-02-01T00:00:00+00:00",
})
```

### 11. Servisleri Restart et
```bash
sudo supervisorctl restart backend frontend
```

### 12. Test
```bash
# Backend
curl http://localhost:8001/api/analytics/mrr
curl http://localhost:8001/api/pricing
curl http://localhost:8001/api/plugin/install-info

# Frontend
# https://<preview-url>/gws → Landing görünmeli
# https://<preview-url>/gws/shop → Stripe checkout formu
# https://<preview-url>/gws/reseller → Bayi login
# https://<preview-url>/gws/admin/licenses → MRR + Cluster widget
```

### 13. testing_agent_v3_fork ile Regresyon
Tüm mevcut cyber-security-18 flow'larının + yeni /gws/* flow'larının çalıştığını doğrula.
data-testid'ler: landing-page, landing-buy-cta, landing-reseller-cta, mrr-panel, mrr-stat-mrr,
license-server-status, reseller-auth, invoices-card, inv-pdf-*, region-primary.

---

## Sonraki Adımlar (Sen Yaptıktan Sonra Kullanıcı Yapacak)
1. Deployment → Deploy (50 kredi/ay)
2. Domains → Link Domain → gokyuzubilgisayar.com
3. DNS: A + TXT kayıtları
4. Stripe live key'i deployment env'ine ekle
5. Test satın alma yap

Herhangi bir sorunda console log + backend log + git diff ile geri dön.
