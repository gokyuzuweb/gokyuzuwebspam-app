# GökyüzüWebSpam v1.6 — WHM/cPanel Mail Security SaaS

## v1.6 (Feb 2026) — Enterprise Polish Release
Backend 17/17 + Frontend %100 · `iteration_6.json` (retest_needed: false, sıfır hata)

### 1) Cluster Region İsimlendirme
- `LICENSE_SERVER_REGIONS` env: comma-separated dostane etiketler
- Backend proxy artık URL yerine `region` label döndürür (`served_by`, `regions[].region`)
- Widget: "Primary EU-West" / "Secondary EU-Central" kartları — customer altyapı topolojisini görmez
- Yeni public shape: `{reachable, region, healthy_count, total_regions, cluster_size, regions[...]}`
- **Bilgi sızıntısı yok**: URL, replica_id ve internal port asla frontend'e gitmez

### 2) Docker Compose Deploy Şablonu (`/app/deploy/`)
- `docker-compose.yml`: Mongo + Redis Master/Replica + 3× Sentinel + N× license-server + HAProxy
- `haproxy.cfg`: `server-template license 5` ile Docker DNS auto-discovery, healthchecked round-robin, stats @ :8404
- `README.md`: Mimari şeması + hızlı başlangıç + prod sertleştirme kılavuzu + failover testi
- Ölçekleme: `docker compose up -d --scale license=5` ile 5 replica

### 3) Invoice Çoklu-Dil PDF
- `GET /api/reseller/invoices/{id}/pdf?lang=tr|en|de|fr|es` — 5 dilde profesyonel A4 fatura
- Reseller portal'a **invoice-lang** select eklendi (localStorage'da persist)
- Filename: `INV-YYYYMM-XXXXX-{lang}.pdf`
- INVOICE_I18N dictionary: INVOICE/FATURA/RECHNUNG/FACTURE/FACTURA + full label çevirileri
- Fallback: bilinmeyen dil → EN

### 4) Modüler Split — P2'ye Ertelendi
Kapsamlı analiz: kalan endpoint'ler (rules, ai, checkout, licensing) 30+ shared helper'a bağımlı
(`_send_email`, `_pricing_settings`, `_stripe_client`, `_notify_settings`, `_finalize_purchase`,
model'ler `PaymentTransaction/License/PolicySettings`, `AI_PROVIDER` map, vb.). Uygun split için
önce bir `shared/` modülüne bu helper'ların çıkarılması gerekir. Regression riski yüksek olduğundan
v1.7 iterasyonunda dedicated modularization pass yapılacak. server.py hâlâ 2286 satır.

## Sistem Envanteri (v1.6)
| Service | Port | Status |
|---------|------|--------|
| Ana backend | 8001 | ✅ v1.6 |
| license-server-1 (Primary EU-West) | 8002 | ✅ v2.0.0 + Redis cache |
| license-server-2 (Secondary EU-Central) | 8003 | ✅ v2.0.0 + Redis cache |
| Redis | 6379 | ✅ 7.x |
| Frontend | 3000 | ✅ v1.6 |
| MongoDB | 27017 | ✅ |

## Env Değişkenleri (v1.6 yenileri)
```env
PUBLIC_LICENSE_SERVER_URL=http://localhost:8002,http://localhost:8003
LICENSE_SERVER_REGIONS=Primary EU-West,Secondary EU-Central
LICENSE_SERVER_ADMIN_KEY=gws-license-admin-key
```

## Yeni Route Modülleri
- `/app/backend/routes/analytics.py` (MRR — v1.4)
- `/app/backend/routes/plugin.py` (download + install-info — v1.4)
- `/app/backend/routes/reseller.py` (JWT + subaccounts + scoped — v1.4)
- `/app/backend/routes/license_client.py` (region-aware proxy — v1.4/v1.6)
- `/app/backend/routes/invoices.py` (PDF + i18n — v1.5/v1.6)

## Backlog / P2-P3
- **P2**: Tam modüler split — routes/checkout.py, routes/rules.py, routes/ai.py, routes/licensing.py + shared/ helper module (v1.7 hedefi)
- **P2**: Redis Sentinel'i preview'de de kurup gerçek HA testi yap
- **P3**: HAProxy config'ini gerçek TLS ile front'la (Cloudflare Origin CA + certbot örneği)
- **P3**: Invoice PDF: Arapça RTL desteği + Bayar (Latin extended) font
- **P3**: Reseller portal — quota yükseltme akışı (in-place upgrade + prorate)
- **P3**: MRR trend `relativedelta` ile calendar-month accurate

## Credentials
- Ana panel: auth-free (MAILSHIELD_MODE=seller)
- Reseller: `reseller@test.com` / `strong123` — lisans `MS-435EA62E57A442BBB10985E9`, 3 fatura
- License Server admin: `X-Admin-Key: gws-license-admin-key`
- Stripe test: `sk_test_emergent` + kart `4242 4242 4242 4242`

## URL Yapısı
- `/` → Landing (public, 6 dil, RTL destekli)
- `/shop`, `/checkout/success` → Public payment flow
- `/reseller` → JWT auth reseller portal (invoices + PDF 5-dil + subaccounts)
- `/panel/*` → Ana panel (MRR + region-named cluster widget + hepsi)
- Legacy `/quarantine`, `/licenses`... → 301 redirect
