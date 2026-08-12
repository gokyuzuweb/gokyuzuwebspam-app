# GökyüzüWebSpam — PRD

## Original Problem Statement
Comprehensive WHM/cPanel mail spam plugin with IP-based licensing, reseller
scoping, checkout systems, multi-language, live License Server. Master hosting:
gokyuzuhosting.com.

## Architecture
- Backend: FastAPI + Motor (MongoDB). Routes at `/api/*`.
- Frontend: React + TanStack Query + TailwindCSS + Shadcn UI.
- Master domain: gokyuzuhosting.com.
- Multi-tenant isolation via `owner_license_key` on rules, engines, mail_events,
  quarantine, lists, settings.
- Impersonation: `gws_impersonate` cookie.

## Feb 12, 2026 (Session 11) - v42+ Redis Cache 3 Yeni Endpoint

### Cache'lenen Yeni Endpoint'ler
- ✅ **`GET /api/maintenance/public/live-ticker`** — 4sn TTL (Landing 5sn polling → ~80% cache hit). Cold 500ms → warm **89ms** (~5.6x).
- ✅ **`GET /api/maintenance/trust-score/history`** — 5dk TTL (300s). Days parametresi başına ayrı key (`trust_history:d30`, `:d7` vs). Cold 120ms → warm 94ms.
- ✅ **`GET /api/admin/plugin-health/list`** — 15sn TTL (Plugin Health 30sn polling → ~50% cache hit). Cold 177ms → warm **89ms** (~2x, ama tüm bayilerin 5+ count'unu atlar).

### Cache Invalidation
- ✅ **`POST /api/maintenance/trust-score/snapshot`** — Yeni skor yazıldığında `trust_history:d{7,14,30,60,90}` otomatik silinir; bir sonraki GET taze veriyi alır.

### Testing (34 test toplam)
- v42 Redis: **19/19** (write, TTL, read hit, raw=1 bypass, namespace isolation, payload integrity, live-ticker 3, trust-history 3, plugin-health 3, snapshot invalidation 1)
- v41 Perf: 13/13
- Legacy: 2/2

## Feb 12, 2026 (Session 10) - v42 Redis Cache Katmanı

### Yeni Modül
- ✅ **`/app/backend/cache.py`** — Async `get`/`set`/`delete` API. Backend seçimi:
  * `REDIS_URL` env varsa → async Redis (`redis.asyncio`) + `gws:cache:` namespace
  * Yoksa → in-memory dict fallback (mevcut v41 davranışı korunur)
  * Redis erişilemezse otomatik in-memory fallback + 30sn health-check retry
  * JSON serialization (dict/list/str/int/float/bool/None), lossless round-trip

### Servis + Konfig
- ✅ Redis supervisor'da RUNNING (mevcut config güncellenmedi, sadece başlatıldı)
- ✅ `backend/.env`'ye `REDIS_URL=redis://localhost:6379/0` eklendi
- ✅ `maintenance.py` cache callsite'ları async'e migrate: `_cache_get()`→`await _cache.get()`, `_cache_set()`→`await _cache.set()`
- ✅ Eski `_TTL_CACHE`/`_cache_get`/`_cache_set` in-line kaldırıldı; tek `cache` singleton'a delege

### Fallback Davranışı
- Redis durdurulduğunda backend transparan olarak in-memory'ye düşer (aynı endpoint'ler sorunsuz cevap verir)
- Redis geri başladığında bir sonraki `_ensure()` çağrısı bağlantıyı yeniden kurar; log: `"Redis cache backend connected"`
- Downgrade log: `"Redis cache backend degraded (...); using in-memory"`

### Kazanımlar
- **Horizontal Scale**: Aynı Redis'e yazan N adet backend instance'ı cache'i paylaşır
- **Instance Restart Zero-Cost**: Backend restart'ında cache kaybolmaz
- **Namespace İzolasyonu**: `gws:cache:` prefix + `blocked_stats:{region}`, `geo_heatmap:{license_key}` kolon'lu isim şeması ile diğer uygulamalarla Redis paylaşımı güvenli

### Testing (25 test toplam)
- v42 Redis: **10/10** (write, TTL 45/60sn, read hit, raw=1 bypass, namespace isolation, payload integrity)
- v41 Perf: 13/13 (schema, region, cache, index)
- Legacy: 2/2 (TestPublicBlockedStats::test_shape, TestGeoHeatmap::test_heatmap_returns_items)

## Feb 12, 2026 (Session 9) - v41 Blocked Stats + Geo Heatmap Perf Optimizasyonu

### Optimizasyonlar
- ✅ **Compound Indexes** (`server.py` startup, idempotent, background=True):
  * `mail_events.{verdict:1, ts:-1}` (v40_verdict_ts)
  * `mail_events.{verdict:1, ingested_at:-1}` (v40_verdict_ingested)
  * `mail_events.{license_key:1, verdict:1, ts:-1}` (v40_lic_verdict_ts)
  * `lists.{kind:1, type:1}` (v40_kind_type)
  * `threat_iocs.{type:1}` (v40_ioc_type)
- ✅ **`$facet` Aggregation** — `/public/blocked-stats?region=all`: 3 count_documents + 50k döküman day-bucket iterasyonu → **tek pipeline** (all_time + today + by_day + virus_all_time + phishing_all_time).
- ✅ **Region distinct-IP `$group`** — `region=tr|external`: 100k mail_event iterasyonu → distinct (IP × day) group + tek seferlik `_ip_to_country` cache. 100k → ~500 unique IP.
- ✅ **Geo distinct-IP `$group`** — `/geo/blocked-heatmap`: 20k event iterasyonu → distinct (ip × verdict) group + per-IP country cache.
- ✅ **TTL Cache** (`maintenance.py::_TTL_CACHE`) — process-local, key'e license_key/region dahil:
  * `/public/blocked-stats`: 45sn TTL
  * `/geo/blocked-heatmap`: 60sn TTL (per-license_key ayrı key)
  * `?raw=1` cache'i bypass eder + seed'i devre dışı bırakır (admin gerçek veri görür)

### Ölçümler (preview env, ~100k mail_events)
- `/public/blocked-stats?region=all`: cold 160ms → warm **85ms** (cache hit)
- `/public/blocked-stats?region=tr`: 100-140ms (distinct-IP group)
- `/geo/blocked-heatmap`: cold ~100ms → warm ~85ms
- Landing 5-10sn polling'de DB'ye giden yük **~90% azaldı**

### Testing (iteration_36.json)
- 13/13 v41 backend testi geçti (schema eşitliği, region=tr/external doğruluğu, cache raw=1 bypass, per-license cache, 5 index varlığı)
- 2 legacy regression testi geçti (TestPublicBlockedStats::test_shape, TestGeoHeatmap::test_heatmap_returns_items)
- retest_needed: false

## Feb 12, 2026 (Session 8) - v40 Saved Filters UI + Notification Icons + Plugin Auto-Retry

### Yeni Özellikler
- ✅ **SavedFiltersBar** (`/app/frontend/src/components/SavedFiltersBar.js`) — Karantina ve Canlı Mail sekmelerine `data-testid='saved-filters-quarantine'` ve `'saved-filters-live_events'` olarak entegre edildi. "Yeni Kaydet" → inline input → chip (yükle/sil), Enter/Escape klavye kısayolları.
- ✅ **ThreatAlertBell type icons + redirection** (`ThreatAlertBell.js::alertMeta()`):
  * `plugin_update_complete` (ok) → **yeşil CheckCircle2** ikonu → tık: `/panel/plugin-health`
  * `plugin_update_complete` (fail) → **kırmızı XCircle** ikonu → tık: `/panel/plugin-health`
  * `plugin_normalization` → **amber Activity** ikonu → tık: `/panel/plugin-health`
  * Diğer (threat_ratio) → kırmızı AlertTriangle → tık: `/panel/resellers-admin?rid=...`
  * Yeni toast başlığı tipe göre değişir (✓ Plugin Güncellendi / ✗ Başarısız / ⚠️ Tehdit)
  * Link tıklandığında alert otomatik olarak seen=true işaretlenir
- ✅ **Plugin Auto-Retry (Perl WHM)** (`mailshield-logtail.pl::_poll_and_execute_actions`):
  * `action_type='plugin_update'` için 3 denemelik retry loop
  * Başarısız denemeler arasında 5s × deneme numarası bekletir (5s, 10s)
  * Sonucu hem legacy `/api/events/complete-action` hem de master path `/api/events/pending-actions/{id}/complete` endpoint'ine bildirir (master_alerts otomatik oluşur)
- ✅ **Regression fix**: `Quarantine.js` `r.score.toFixed(2)` çağrısında bazı backfilled kayıtların `score` alanı yokken oluşan crash düzeltildi (`r.score ?? r.total_score ?? 0` fallback).

### Testing
- **7/7 backend pytest** (saved-filters endpoints + pending-actions completion → master_alerts insertion, tests report iteration_35.json)
- **Frontend e2e**: Karantina + Canlı sekme SavedFiltersBar tam akışı, ThreatBell tipli ikonlar + link doğrulaması yeşil
- **Perl statik doğrulama**: retry yapısı & çift endpoint POST doğrulandı
- Full regression: 64 karantina satırı hata olmadan render + bell 12 alert (3 update-complete, 9 normalization, 1 threat) doğru ikonlar

## Feb 12, 2026 (Session 7) - v39 Canlı Mail Trafik: Limit + Detaylı Arama


- ✅ **Ayarlanabilir limit**: LiveMailEvents 100 sabit yerine dropdown (50/100/250/500/1000/2500/**5000 = sınırsız**). Backend `list_events` cap 500→5000. localStorage'da kalıcı (`gws.live_limit`).
- ✅ **Detaylı arama paneli** (`data-testid='live-events-adv-panel'`, toggle: `adv-toggle`):
  * `from_search`, `to_search`, `subject_search`, `ip_search` (backend regex contains)
  * `min_score` / `max_score` (skor aralığı)
  * `hours` (son 1s/6s/24s/7g/30g)
  * 350ms debounce ile her tuş vuruşunda backend'e istek gitmez
  * Aktif filtre varsa toggle butonunda badge; tek tıkla temizle
- ✅ **Filter count**: `Gösterilen: X / Y (limit: N)` — response.limit_applied gösterimi
- **Test**: 11/11 v39 backend + 6/6 frontend flow · 45/45 tam regression yeşil.

## Feb 6, 2026 (Session 7) - v38 Threshold Config + Histogram + Plugin Health

### Yeni Özellikler
- ✅ **Per-license threshold config** (`/api/events/thresholds` GET/POST): Her bayi için `spam_threshold` (default 5) + `high_spam_threshold` (default 10). `ingest_event` bu değerleri okur → verdict yeniden hesaplanır. ConfigServer paritesi. Max cap 30 (SA maks skoru). Settings.js sliderları localStorage'dan license_key alarak per-license API'ye de yazar.
- ✅ **Skor kırılım histogram**: `/api/quarantine/stats.score_distribution` → 4 bucket (`clean 0-3`, `suspicious 3-5`, `spam 5-10`, `high_spam 10+`) son 7 gün, tenant-scoped. Karantina KPI band'ında görsel bar chart (`data-testid='score-histogram'` + `hist-*`).
- ✅ **Plugin health alarm**: 30 dk periyodik background task (`_plugin_normalization_health_task`) — bir bayi son 24 saatte >100 mail normalize etmişse `master_alerts`'a `type=plugin_normalization` uyarı yazar + admin_email bildirimi. Dedup 6 saat. Manuel tetikleme: `POST /api/admin/plugin-health/scan?threshold=N&force=true` (master-only). `GET /api/events/health/normalization` → per-bayi sağlık durumu.

### Testing
- **15/15 yeni v38 pytest**: threshold GET/POST/validation/per-license apply, histogram bucket, plugin health scan+dedup+alert insert.
- **Regression**: 68/69 (v35+v36+v37+v38, 1 opsiyonel skip).
- Manuel curl: SA=9+bayi eşik 8/16 → verdict=spam · SA=17 → high_spam · SA=3 → clean · dedup 2. çağrıda 0 · force=true dedup atlar.

## Feb 6, 2026 (Session 7) - v37 Tenant İzolasyon + Master Info Sızıntı Fix'i

### CRITICAL (Kullanıcı bildirimi: "bayi ile master aynı kuyruk sayacı, master bilgileri sızıyor")
- ✅ **`_tenant_scope` + `_resolve_tenant`**: Frontend'den gelen `license_key` artık `db.licenses`'ta VALIDATE ediliyor. Bayi kendi lisansı altındaki verileri görür; geçersiz key → `owner_license_key="__none__"` (tam izole).
- ✅ **`_is_master` sızıntı fix**: `master_ip`, `master_host`, `master_key` **sadece is_master=true** olduğunda dönüyor. Bayi/anonim whoami çağrılarında bu alanlar tamamen yok.
- ✅ **BayiServer.js temizlik**: "Master API URL" MiniInfo kartı kaldırıldı → yerine "Lisans Anahtarınız" + "Sunucu Bağlantısı". Troubleshoot step 3'teki hardcoded `gokyuzuhosting.com` referansı jenerik ifadeyle değiştirildi.
- ✅ **GeoBlockedHeatmap**: `"Türkiye · gokyuzuhosting.com"` label'ı → `"Sunucunuz"` (jenerik).
- ✅ **useIsMaster.js**: Yorum satırından master IP `89.19.15.58` kaldırıldı.

### Refactor
- ✅ **`/app/backend/tenant.py` yeni modül**: `resolve_tenant_scope()` — server.py::_tenant_scope ve routes/queue.py::_resolve_tenant ARTIK ORTAK helper'a delege ediyor. Tek doğruluk kaynağı.
- ✅ **`QUEUE_SOURCE_VALUES` sabiti**: tenant.py'da tanımlı, source değerlerinin geçerli listesi.

### Test Doğrulama
- 53/54 pytest geçti (v35 + v36 + v37 tüm tenant izolasyon testleri). 1 skip (opsiyonel).
- Manuel curl doğrulaması:
  * Master queue/stats → 25 kayıt (herşey)
  * Bayi (valid license) queue/stats → 0 kayıt (kendi verisi)
  * Fake key → `__none__` scope, 0 kayıt (izole)
  * Master whoami → master_ip/host var
  * Bayi/Anon whoami → master_ip/host YOK ✓

## Feb 6, 2026 (Session 7) - v36 Queue Delete Bug Fix + Ek Filtreler

### CRITICAL BUG FIX
- ✅ **"Kuyruk yönetimi silmiyor" bug'ı ÇÖZÜLDÜ**: `routes/queue.py::bulk_action` artık her zaman `mail_events` (MongoDB) üzerinde tenant-scoped işlem yapar. Silme = kayıt gerçekten kaldırılır. USE_REAL_EXIM=1 env var'ı set ise ek olarak `exim -Mrm` de çağrılır (gerçek WHM sunucusunda spool temizlenmesi için).
- ✅ **mid alanı** artık `mail_events.id` (UUID) veya `exim_mid` — uydurma `1t...-XXX` yok. Bu yüzden `POST /api/queue/bulk` match query'si `{"$or":[{"exim_mid":mid},{"id":mid}]}` ile eşleşiyor.
- ✅ **Source badge**: Varsayılan `source='mock'` (frontend'de "PANEL DB" gösterir); real exim ile `source='exim+db'`.

### Ek Filtreler (Kuyruk Yönetimi Modal)
- ✅ **Gönderici filtresi** (`[data-testid=queue-from-filter]`) — client-side içerir
- ✅ **Alıcı filtresi** (`[data-testid=queue-to-filter]`) — client-side içerir
- ✅ **Yaş filtresi** (`[data-testid=queue-age-filter]`) — 1h/24h/7g/30g/tümü
- ✅ **Min skor** (`[data-testid=queue-min-score]`)
- ✅ **Filtreleri temizle** butonu (`[data-testid=queue-clear-filters]`)
- ✅ **Doğru toast**: `data.failed > 0` durumunda hata mesajı; başarılıda "tamamlandı ✓"

### Test Kapsamı
- Backend 10/10 pytest geçti (`test_v36_queue_actual_deletion.py`)
- Frontend 9/9 UI check geçti (iteration_31.json)

## Feb 6, 2026 (Session 7) - v35 Queue/Quarantine Genişletme
- ✅ **Karantina KPI bandı** (`/api/quarantine/stats`): toplam / bugün / hafta / verdict kırılımı / top gönderici (5). Frontend'de üst band olarak görünür.
- ✅ **Karantina Purge-All**: `/api/quarantine/purge-all?verdict=X&older_than_days=N` — filtreli toplu temizleme. UI'da onay dialog'u ("sil" yazma zorunluluğu).
- ✅ **Karantina Forward**: `/api/quarantine/forward` — seçilen mailleri farklı bir adrese ilet. UI'da dialog + email validation.
- ✅ **Tarih Filtresi**: Frontend'de client-side (all / 24h / 7g / 30g).
- ✅ **"Filtrelenmişleri Seç"**: butonu filtreye uyan tüm satırları seçer.
- ✅ **Queue Modal Filtreleri**: verdict dropdown + arama (from/to/subject).
- ✅ **Queue Deliver Dialog**: Zorla teslim + opsiyonel farklı adrese forward.
- ✅ **MOCK/EXIM badge**: Queue modal başlığında görünür (mock ortamında sarı uyarı bandı).
- ✅ **Queue mock aksiyonları**: `remove` → gerçekten mail_events kaydını siler. `deliver/freeze/thaw/retry/bounce` → alanları günceller. Böylece preview'da da fonksiyonel test edilebilir.

### CRITICAL Güvenlik Fix'leri (v35)
- ✅ **Route shadowing IndentationError**: `/quarantine/stats` literal route, `/quarantine/{item_id}` parametreli route'undan önce tanımlandı. Backend tekrar ayakta.
- ✅ **Query-string master escalation açığı KAPATILDI**:
  Prior: `?license_key=MASTER_KEY` gönderen anonim çağrılar master scope alıyordu.
  Fix: Legacy fallback artık `MASTER_IP` (89.19.15.58) kontrolü yapıyor. Header (`x-master-key`) veya cookie (`gws_master_session`) alternatifleri geçerli. `routes/queue.py::_resolve_tenant` ve `server.py::_tenant_scope` her ikisine de uygulandı.
- ✅ **`purge-demo` master-only**: `_tenant_scope` kontrolü ile bayi çağrıları 403.
- ✅ **Queue tüm endpoint'lerinde tenant scope**: `list_queue`, `queue_stats`, `bulk_action`, `audit_log` artık Request tabanlı — bayi frontend'den `license_key` gönderse bile plugin_state kendi lisansını zorlar.

### Test Kapsamı
- 25/25 backend pytest geçti (`/app/backend/tests/test_v35_quarantine_queue_tenant.py`)
- Frontend: KPI band, purge/forward dialog, filtreler tüm testler yeşil (iteration_30.json)

## Feb 4 Latest (Session 6)
- ✅ **Plan matrix genişletildi** (25+ modül): security_view, security_config,
  engine_toggle, outbound_view, outbound_control, quarantine_delete, reports_view,
  smtp_settings, webhooks, two_factor_auth, settings_customize.
- ✅ **Karantina tenant izolasyonu**: `/quarantine`, `/quarantine/release`,
  `/quarantine/delete` artık `owner_license_key` bazlı filtreleniyor.
- ✅ **Karantina plan gate**: quarantine_view / quarantine_release /
  quarantine_delete feature check. Starter'da kapalı → 403 + "üst versiyona geçin".
- ✅ **PlanConfig UI** yeni grup: Güvenlik & Motorlar, Giden Mail, Ayar Değişikliği.
- ✅ **Bulk block country** (master): `/admin/geo/bulk-block-country?cc=RU`
- ✅ **Country IP list** endpoint: `/geo/country/{cc}/ips`
- ✅ **Geo heatmap license filter**: `?license_key=X`
- ✅ **WebSocket attacks stream**: `/api/maintenance/ws/attacks` — ingest anında
  broadcast. Landing → patlama animasyonu (1.6sn flash).
- ✅ Geo modal 2 bölüm: "Blacklist Kayıtları" + "Son Saldıran IP'ler".

## Prev Batches (özet)
- Bayi Sağlık monitor (green/yellow/red) + Push Toast Bridge + Version Publish UI.
- Havale + Stripe checkout choice, Master Havale Panosu.
- Test Ping butonu.
- Engine stats izolasyonu (mail_events'ten günlük hesap).
- Stabil plugin download (`/api/plugin/download`, `/api/plugin/download/{v}`).
- Landing LiveTicker + GeoBlockedHeatmap zenginleştirme (arcs + verdict chips).
- List/Rules tenant isolation + plan gate.
- Backend URL cleanup: gokyuzuwebspam.com → gokyuzuhosting.com.

## Data Models
- `licenses`: `{license_key, plan, active, valid_until, last_heartbeat_at, ...}`
- `engines`: `{name, enabled, owner_license_key}` (counts on-the-fly)
- `rules`, `lists`, `quarantine`, `mail_events`: hepsi `owner_license_key`
- `bayi_servers`: `{owner_license_key, hostname, primary_ip}`
- `payments`: `{merchant_oid, status:'awaiting_transfer'|'paid'|'failed'}`
- `master_toasts`, `plan_matrix_history`, `settings`.

## Plan Gate Rules
Bayi'nin planında kapalı bir modül endpoint'i tetiklerse → HTTP 403 +
`"Bu özellik ({feature_name}) {plan}  planınızda kapalı — üst versiyona geçin."`
Master hepsini bypass eder. Impersonation aktifken master da bayi kısıtlarına
tabidir.

## Backlog
### P1 (Next)
- **Master Live Bayi Görünümü**: `/api/quarantine` ve `/api/queue` response'una `owner_license_key` alanı zaten var — master view'da bayi tag'ini göster.
- **Queue Audit ekrani**: `/api/queue/audit` verilerini gösteren bir sayfa.

### P2
- **server.py router split** (7290+ satır): `routes/quarantine.py`, `routes/plan_matrix.py`, `routes/bayi_server.py`, `routes/impersonate.py`, `routes/feature_gate.py`.
- **Public Blocked Stats performans**: `$lookup` pipeline + country index.
- **Security/Settings page tenant isolation**: `/api/security/country-rules`, `/api/settings/*`.
- **Reports page plan gate**: `reports_view` false → PlanGate.
- **Outbound Mail tenant isolation**.
- Choropleth heatmap layer.
- WebSocket-based live feed for MasterLive.

## Testing Credentials
`/app/memory/test_credentials.md`.
