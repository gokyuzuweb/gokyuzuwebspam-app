# GökyüzüWebSpam v1.6 — WHM/cPanel Mail Security SaaS

## v1.6.5 (Feb 2026) — Executor + Glow + Donut + Scope
- **Quarantine Executor**: Logtail her 10sn `/events/pending-actions` polling → `exim -Mrm` (delete),
  `exim -M` (release), sa-learn stub (report_spam) → `/events/complete-action` back-report.
  event_id ↔ exim_mid mapping `/var/lib/mailshield/event-mid.map` diskte, 3M limit.
- **Widget Auto-Scroll (glow)**: React `useRef` seen-ids diff → yeni event id'ler `newIds` Set'e
  eklenir, `.gws-row-glow` CSS keyframe (2.5s ease-out, indigo highlight) tetiklenir.
- **Verdict Distribution Donut**: SVG donut, segment onClick → verdictFilter set. Legend tıklanabilir.
  Total ortasında büyük mono sayı. 5 renk: emerald/amber/rose/red/violet.
- **Per-User Scope**: URL query `?scope=user&user=<email-or-domain>` → backend `scope_user` param
  → `re.escape` + case-insensitive substring match to_addr/from_addr üzerinde.
  cPanel end-user plugin `mailshield.live.php` bunu `getenv(REMOTE_USER)` ile otomatik geçiriyor.

Backend v1.6.5 doğrulama (canlı sunucudan 329 gerçek event geldi):
- Verdict breakdown: clean 323, spam 1, high_spam 4, virus 1 (skor 12.00 doğru okundu)
- Scope 'karayel' filter → 3 event correctly matched

## v1.6.4 (Feb 2026) — Verdict Enrichment + Filters + Quarantine Sync + End-User Fix
Kullanicinin 4 istegini tek tarball'a paketleyip WHM `↻ Guncelle` ile deploy edilebilir yaptik.

### 1) Verdict Enrichment
- Logtail 800ms×3 retry ile `/var/spool/exim/input/*-H` header'larindaki
  `X-Spam-Score`, `X-Spam-Status`, `X-Spam-Report`, `X-MailScanner-SpamCheck` okur
- Skora göre `clean` / `spam` (5+) / `high_spam` (10+) verdict atar
- `scores.spamassassin` + `scores.sa_report` payload'a eklenir

### 2) Traffic Filters
- LiveMailEvents widget: search input (from/to/subject) + verdict dropdown
- Client-side filter, live count `Gosterilen: X / Y`, `Temizle` butonu

### 3) Quarantine Sync Backend
- `POST /api/events/quarantine-action` — panel -> kuyruk (delete/release/report_spam)
- `GET /api/events/pending-actions?license_key=` — sunucu daemon short-poll
- `POST /api/events/complete-action` — daemon aksiyon sonucu geri raporlar
- `pending_quarantine_actions` MongoDB collection

### 4) cPanel End-User Fix
- `mailshield_user.conf` URL: `/3rdparty/mailshield/index.live.php`
- install.sh: `/usr/local/cpanel/base/3rdparty/mailshield/` dizini olusturulur + PHP kopyalanir

## v1.6.3 (Feb 2026) — One-Click Self-Update ✅
WHM plugin başlığında "↻ Guncelle" butonu — kullanıcı her code değişikliğinde SSH'a gitmeden
tek tıkla sunucudaki plugin script'lerini yeniler.

### Nasıl çalışır
- Buton `fetch('?action=self-update')` yapar
- CGI: son tarball'ı wget'ler, 4 kritik dosyayı overwrite eder (logtail.pl, heartbeat.pl, index.cgi, mailshield.tmpl)
- `systemctl restart mailshield-logtail.service` ile yeni Perl kodunu aktif eder
- JSON `{ok, actions[], errors[]}` döner
- JS iframe'i reload eder, kullanıcı yeni sürümü anında görür

### Güvenlik
- `Whostmgr::ACLS::hasroot()` guard — sadece root WHM erişebilir
- Query string tabanlı (PATH_INFO WHM cpsrvd'da bazen boş)
- Sadece 4 belirli dosya güncellenir (config/systemd unit dosyalarına dokunmaz)

## v1.6.2 (Feb 2026) — Canlı Mail Trafiği (SaaS SMTP mirror)
Kullanıcının canlı cPanel sunucusundaki (89.19.15.58) gerçek mail trafiği artık panelde
görünüyor. Milter Exim'e bind edilmesine gerek yok — sunucudaki Exim mainlog tail edilir.

### Nasıl çalışır
1. `mailshield-logtail.service` (Perl daemon, systemd) `/var/log/exim_mainlog`'u tail eder
2. Her `<= sender ... T="subject" for rcpt` satırı için event yaratır
3. Opsiyonel olarak `/var/spool/exim/input/*-H` içindeki `X-Spam-Score` header'ı okur
4. HTTPS POST → `{preview_url}/api/events/ingest` (license_key + hostname eklenir)
5. Backend `mail_events` collection'ına yazar
6. Frontend Dashboard'ın üstündeki "Canlı Mail Trafiği" widget'ı her 8 sn'de bir listeler

### Yeni bileşenler
- `/app/backend/routes/events.py` — ingest, ingest-batch, list, summary, test-ingest
- `/app/frontend/src/components/LiveMailEvents.js` — tablo formatlı, license editable
- `/app/whm-plugin/scripts/mailshield-logtail.pl` — Exim mainlog parser (Perl daemon)
- `/app/whm-plugin/systemd/mailshield-logtail.service` — installer tarafından auto-start
- `mail_events` MongoDB collection (license_key indexed)

## v1.6.1 (Feb 2026) — WHM Plugin CANLI SUNUCUDA ÇALIŞTI ✅
Kullanıcının canlı cPanel (89.19.15.58) kurulumunda başarıyla çalışıyor.

### KRITIK BULGU: cPanel AppConfig `acls=` (çoğul S ile) bekliyor
Handoff'ta `acl=basic-whm-functions`, `acl=all`, `acl=any` denendi — hepsi başarısız.
Sunucudaki çalışan diğer plugin'lerin (CSF, MailScanner) config'ini inceleyince gerçek
alan adının `acls=` (**çoğul**) olduğu ortaya çıktı. Log mesajı `"acls missing"`
tam da bu ipucunu veriyordu.

### Nihai `/var/cpanel/apps/mailshield.conf` Formatı
```
name=mailshield
service=whostmgr
url=/cgi/mailshield/index.cgi
user=root
acls=all                              <-- çoğul S KRİTİK
displayname=GokyuzuWebSpam
entryurl=mailshield/index.cgi         <-- başında cgi/ YOK
icon=mailshield/icon.png
target=_self
```

### Tüm Değişiklikler
- `GökyüzüWebSpam` → `GokyuzuWebSpam` (tüm `/app/whm-plugin/` dosyalarında)
- WHM/cPanel CGI dizinleri **`root:root`** sahiplik (`mailshield:mailshield` cPanel 403 sebebi)
- `mailshield.cgi` yeniden yazıldı: `Whostmgr::HTMLInterface::defheader/deffooter` resmi API +
  manuel `Content-Type: text/html; charset=utf-8` header
- Template TT plugin yerine plain HTML (WHM chrome Perl tarafında render ediliyor)
- iframe frontend preview URL'sine yönlendi
- `install.sh` sertleştirildi: FORCE overwrite, unregister+register idempotent
- `whm/icon.png` + `cpanel/icon.png` eklendi (48x48 PNG)
- Backend `/api/plugin/download` her istekte anlık tarball üretir

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
