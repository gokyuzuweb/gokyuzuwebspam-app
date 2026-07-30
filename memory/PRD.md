# GökyüzüWebSpam v1.5 — WHM/cPanel Mail Security SaaS

## v1.5 (Feb 2026) — Invoice, Cluster & Full-Locale Release
Backend 18/19 + Frontend %100 · `iteration_5.json` (retest_needed: False)

### 1) Reseller Invoice History + PDF
- `/api/reseller/invoices` — bu bayinin lisans anahtarına bağlı tüm paid transactions'ları listeler
- `/api/reseller/invoices/{id}/pdf` — ReportLab ile A4 profesyonel fatura üretir (Türkiye muhasebe uyumlu)
- Deterministic invoice numbering: `INV-YYYYMM-{5hexchars}` (MD5-based)
- Reseller portal'da yeni **Fatura Geçmişi** kartı — INV numarası, tarih, plan, tutar, tek-tık PDF indirme
- Backfill: 3 seed transaction reseller license'ına bağlandı (test için)

### 2) License Server Cluster (v2.0)
- **Redis 6379** cluster koordinasyonu, verify cache (60s TTL) ve dağıtık rate limiting (120/min per license)
- **2 replica**: `license-primary-8002` + `license-secondary-8003` (supervisor'da ayrı process)
- Her replica X-Replica-Id header'ı stampler, `/v2/cluster/health` peer'ları listeler
- Backend proxy (`license_client.py`) round-robin ile replica arasında yük dağıtır + primary düşerse otomatik failover
- Cluster widget'ı Licenses sayfasında: her replica UP/DOWN, Redis ✓/×, cluster view
- Graceful degradation: Redis erişilemezse Mongo-only mod devam eder

### 3) Landing Full 6-Dil
- Landing.js LANG_STRINGS: **TR/EN/DE/FR/ES/AR** tam çeviri
- Arapça için `<div dir="rtl">` otomatik RTL yönü
- Hero + Features (6 kart) + How it Works + Pricing + FAQ + Footer hepsi çevrildi
- Landing header'daki `landing-lang` select ile canlı geçiş

## Servis Envanteri
| Service | Port | Version | Status |
|---------|------|---------|--------|
| Ana backend (FastAPI + routes/) | 8001 | v1.5 | ✅ |
| License server (primary) | 8002 | v2.0.0 | ✅ |
| License server (secondary) | 8003 | v2.0.0 | ✅ |
| Redis | 6379 | 7.x | ✅ |
| Frontend (Landing/Panel/Reseller) | 3000 | v1.5 | ✅ |
| MongoDB | 27017 | 7.x | ✅ |

## Yeni Endpoint'ler (v1.5)
- GET `/api/reseller/invoices` — fatura listesi (Bearer JWT)
- GET `/api/reseller/invoices/{id}` — tek fatura JSON
- GET `/api/reseller/invoices/{id}/pdf` — PDF stream
- License-server v2: `/v1/health` (Redis status), `/v2/cluster/health`, X-Replica-Id header, rate limit 429

## Backlog / P2-P3
- **P2**: Kalan endpoint'leri routes/'a taşı (rules, ai, checkout, licensing) — server.py 500 satıra
- **P2**: Cluster widget'ta internal URL yerine dostane isim ("Primary EU-1") — leak minimize
- **P2**: Invoice header currency formatı normalize
- **P3**: Cluster'ı gerçek multi-host'a taşı (Docker Compose + Redis Cluster / Sentinel)
- **P3**: Invoice: KDV/vergi hesabı toggle, çoklu dil PDF (invoice_pdf?lang=en)
- **P3**: Reseller dashboard: quota yükseltme akışı (in-place upgrade)
- **P3**: Rate limiting redis TTL sliding window (şu an fixed window)

## Test Credentials
- Ana panel: auth-free (MAILSHIELD_MODE=seller)
- Reseller portal: `reseller@test.com` / `strong123` · lisans `MS-435EA62E57A442BBB10985E9` · 3 fatura backfilled
- License server admin: header `X-Admin-Key: gws-license-admin-key`
- Stripe test: `sk_test_emergent` + kart `4242 4242 4242 4242`

## URL Yapısı
- `/` → Landing (public, 6 dil, RTL destekli)
- `/shop`, `/checkout/success` → Public payment flow
- `/reseller` → JWT auth reseller portal (subaccounts + invoices + scoped quarantine)
- `/panel/*` → Ana panel (MRR + Cluster widget + hepsi)
- Legacy `/quarantine`, `/licenses`... → 301 redirect `/panel/*`
