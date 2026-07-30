# GökyüzüWebSpam v1.4 — WHM/cPanel Mail Security SaaS

## v1.4 (Feb 2026) — Major Structural Release
Bu turda 4 büyük görev tamamlandı; test kapsamı **backend %100 (28/28) + frontend %100**:

### 1) Landing Page (`/`)
- Cyberpunk/security dark tema — indigo/rose gradient hero + grid backdrop
- Bölümler: Hero + Panel önizleme mock + Features (6 kart) + Stats + How it Works + Terminal demo + Pricing (canlı `/api/pricing`) + FAQ + CTA + Footer
- Multi-language: TR/EN string map (diğer 4 dil common i18n'e devrediyor)
- `data-testid`: landing-page, landing-hero, landing-buy-cta, landing-demo-cta, landing-reseller-cta, landing-features, landing-pricing, landing-how, landing-faq

### 2) Backend Modülerizasyonu (`/app/backend/routes/`)
- Shared `deps.py` — DB, ENV, PLUGIN_MODE, seller_only dependency
- `routes/analytics.py` — MRR endpoint çıkarıldı
- `routes/plugin.py` — download + install-info çıkarıldı
- `routes/reseller.py` — Yeni reseller portal endpoint'leri
- `routes/license_client.py` — Upstream license server proxy'si
- server.py: 2461 → 2278 satır; `app.include_router` ile modüller bağlı
- Not: Tam split (rules, ai, checkout, licensing çekirdek) P2 backlog'a alındı — regression riski kritik değildi

### 3) Reseller Alt-Yetki + JWT Auth (`/reseller`)
- **Yeni koleksiyonlar**: `resellers`, `subaccounts`; `lists`'e `owner_reseller_id`
- **Auth**: bcrypt password + PyJWT HS256, 24h TTL, `RESELLER_JWT_SECRET` env
- **Endpoint'ler**: `/api/reseller/auth/{register,login}`, `/me`, `/subaccounts` CRUD, `/quarantine`, `/lists` CRUD — hepsi Bearer token gerektirir
- **Plan bazlı kota**: starter=5, pro=50, enterprise=999 subaccount
- **Scoped filtreleme**: reseller alt hesaplarının recipient/username'lerine göre karantina + lists filtrelenir
- **Frontend**: `/reseller` → AuthScreen (login/register toggle) → Dashboard (StatCard × 4 + sub-account CRUD tablosu + scoped quarantine tablosu)

### 4) Canlı License Server (port 8002, ayrı FastAPI process)
- Yeri: `/app/license-server/server.py`, supervisor: `license-server.conf`
- Env: `LICENSE_SERVER_ADMIN_KEY=gws-license-admin-key`
- **Endpoint'ler**: `POST /v1/heartbeat`, `GET /v1/verify`, `POST /v1/revoke` (X-Admin-Key), `GET /v1/health`
- IP mismatch ise `license_violations` koleksiyonuna yazar + `ok:false status:violation` döner
- Expired lisans için `status:expired`, bilinmeyen key için `status:unknown`
- Bootstrap: hiç IP kayıtlı değilse ilk heartbeat auto-register (P3: harden this)
- **Ana backend proxy**: `/api/license-server/health|verify|revoke|config` — `PUBLIC_LICENSE_SERVER_URL` env üzerinden
- **WHM plugin** heartbeat.pl güncellendi: `/v1/heartbeat` endpoint'ine POST atıyor, config'ten `license.server_url` okuyabiliyor

## Routing Değişikliği (v1.3 → v1.4)
- `/` → Landing (public marketing)
- `/shop`, `/checkout/success` → Public (aynı)
- `/reseller` → Reseller portal (kendi auth)
- `/panel/*` → Ana panel (tüm eski route'lar buraya taşındı)
- Legacy `/quarantine`, `/licenses`, ... → 301 redirect `/panel/*`

## Servis Envanteri
| Service | Port | Status |
|---------|------|--------|
| Ana backend (FastAPI + routes/) | 8001 | ✅ Running |
| License server (FastAPI) | 8002 | ✅ Running |
| Frontend (React + Landing/Panel/Reseller) | 3000 | ✅ Running |
| MongoDB | 27017 | ✅ Running |

## Test Doğrulaması (iteration 4)
- Backend pytest: **28/28 %100** — 7 license-server + 2 proxy + 10 reseller + 4 regression + 5 landing/routing
- Frontend: **%100** — Landing hero+features+pricing+CTA'lar; Panel `/panel/licenses` MRR + LicenseServerStatus (Erişilebilir ✓); Reseller login/register/sub-account add/logout flow

## Backlog (P2/P3 — Sonraki iterasyonlar için)
- **P2**: Kalan endpoint'leri routes/'a taşı (rules, ai, checkout, licensing çekirdek) — server.py'yi <500 satıra indir
- **P2**: MRR trend `relativedelta` ile calendar-month accurate
- **P2**: License server bootstrap IP — first-run token gerektirsin
- **P3**: `/api/plugin/download` tarball cache (per version)
- **P3**: Checkout webhook 400 döndürsün invalid signature'da (Stripe retry için)
- **P3**: Reseller portal — 2FA, invoice geçmişi, quota yükseltme akışı
- **P3**: License server — cluster mode (Redis + multiple replicas)
- **P3**: Landing → i18n'in diğer 4 dile (DE/FR/ES/AR) yayılması

## Credentials (test için)
- Auth-free ana panel (MAILSHIELD_MODE=seller)
- Reseller test hesabı: `reseller@test.com` / `strong123` (lisans MS-435EA62E57A442BBB10985E9)
- License server admin: `X-Admin-Key: gws-license-admin-key`
- Seed data: 5 paid transaction (MRR $315, ARR $3780)
