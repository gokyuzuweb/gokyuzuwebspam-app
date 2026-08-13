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

## Feb 12, 2026 (Session 13) - v43+ Threat Intel Auto-Sync + DMARC Demo + Karantina Direction Tab

### Kullanıcı istekleri
1. "Global Tehdit Zekası boş" → Auto-sync toggle + otomatik çalışan feed loop
2. "DMARC boş" → Demo seed butonu (5 domain × 45 rapor idempotent)
3. "Otomatik başlat/başlatma seçeneği" → Feeds tab'ında panel

### Yeni Endpoint'ler (`routes/threat_intel.py`)
- ✅ `GET /api/threat-intel/auto-sync` — mevcut ayarlar
- ✅ `POST /api/threat-intel/auto-sync` — `{enabled:bool, interval_min:15-1440}`
- ✅ `POST /api/threat-intel/auto-sync/run-now` — anında tüm feed'leri senkronize et
- ✅ `POST /api/threat-intel/dmarc/seed-demo` — idempotent 45 sample DMARC report
- ✅ Background: `_threat_intel_auto_sync_loop` server startup'ında schedule ediliyor; her 60sn kontrol, enabled ise interval_min bekleyip tüm feed'leri sync eder

### Frontend
- ✅ **FeedsTab** — Otomatik Senkronizasyon paneli (`[data-testid='ti-auto-sync-panel']`):
  * Aktif/kapalı gösterge (yeşil pulse) + son çalışma + eklenen IOC
  * Interval selector (15dk/30dk/1sa/3sa/6sa/12sa/24sa)
  * "Şimdi Tümünü Senkronize Et" butonu (6 feed sıralı)
  * "Otomatik Başlat" / "Durdur" toggle
- ✅ **DmarcTab** — Boş state'te "Demo Rapor Yükle (5 domain × 45 rapor)" butonu

### Karantina Direction Tabs (kullanıcı Outbound sistemi ile beraber istedi)
- ✅ Quarantine.js'e "Tümü / Gelen / Giden" tab bar eklendi (`[data-testid='q-direction-tabs']`)
- ✅ Backend `GET /api/quarantine` `direction=in|out` filter (legacy `direction` alanı olmayan kayıtlar `in` sayılır)

### WHM Perl Script v43
- ✅ `mailshield-logtail.pl` outbound tespiti: Exim `<= ...` satırında `U=<user>` regex → `direction:"out"` + `from_user:$user`. Next `gws-update`'de bayi'ye gidecek.

### Testing
- Manual API smoke: auto-sync GET/POST/run-now (32 IOC eklendi), DMARC seed (45 rapor), Karantina direction=out (0 giden karantina = beklenen)
- Frontend smoke: Feeds tab tam UI verified (panel + 6 card + butonlar), DMARC seed butonu görünür

## Feb 12, 2026 (Session 12) - v43 Outbound Filtering + Bulk Detection

Kullanıcı isteği: "Giden Posta aktif değil gibi. bunu da tüm sistemler filtreleme toplu mail algılama sistemi gibi sistem yap."

### Data Model
- ✅ `MailEvent` modeline **`direction: "in"|"out"`** ve **`from_user`** alanları eklendi (backward compat: default "in")
- ✅ `outbound_throttles` yeni koleksiyon: `{license_key, from_user, throttled, sent_count, limit, reason, throttled_at}`
- ✅ Backfill endpoint: `POST /api/outbound/migrate-direction` — mevcut docs'a `direction:"in"` (idempotent). Preview'da 1248 doc güncellendi.

### Yeni Router `/app/backend/routes/outbound.py`
- ✅ `GET /api/outbound/stats` — `$facet` aggregation (today_total/spam/blocked + top_users). Redis cache 15sn.
- ✅ `GET /api/outbound/events` — filtreli liste (search/to_search/subject_search/ip_search/min_score/max_score/hours/verdict/limit). Karantina/Canlı ile aynı semantik.
- ✅ `GET /api/outbound/bulk-alerts` — son 24 saatteki `outbound_bulk` uyarıları
- ✅ `GET /api/outbound/throttles` + `POST /throttle` + `POST /throttle/remove` — user throttle yönetimi
- ✅ `POST /api/outbound/event/{id}/action` — 4 aksiyon: `delete` / `quarantine` / `whitelist_sender` / `throttle_sender`

### Bulk Detection (ingest hook)
- ✅ Her ingest'te `direction=="out"` ise: son 1sa'te aynı `from_user`'dan `policy.outbound_limit_per_hour` (default 200) mail geçtiyse:
  1. `master_alerts` type=`outbound_bulk` (hour-bucket dedupe key ile duplicate önlenir)
  2. `outbound_throttles` otomatik `throttled:true` + `reason:"auto_bulk_detect"`

### Frontend
- ✅ **Outbound.js** yeniden yazıldı (60 → 400+ satır, LiveMailEvents pattern):
  * 5 StatCard: Bugün Giden / Spam / Bloklu / Throttled User / Saatlik Limit
  * Bulk Alerts Banner (yeşil chip'ler ile ilk 6 anormal user)
  * Filter bar + Advanced panel (regex to/subject/ip + min/max score + hours) + verdict + limit
  * SavedFiltersBar entegrasyonu (module="outbound_events")
  * Events tablosu — her satırda 4 aksiyon butonu (quarantine/whitelist/throttle/delete)
  * Sınırlandırılmış Kullanıcılar tablosu + tek tıkla kaldır
  * Bugün en çok mail atan user'lar + kullanım %'si
  * Manuel throttle modal + CSV export
- ✅ `api.js`: 8 yeni method (`outboundStats/Events/BulkAlerts/Throttles/ThrottleAdd/ThrottleRemove/EventAction/MigrateDirection`)

### Testing (iteration_37.json — 11/11 backend + tam frontend E2E)
- Backend pytest v43 (11/11): ingest with direction, backward compat, migrate idempotency, stats schema, filtered events, bulk detection + auto-throttle + hour-bucket dedupe, manual throttle CRUD, all 4 event actions, legacy /outbound regression
- Frontend Playwright: /panel/outbound renders, 5 stat cards + filter bar + adv panel + saved filters + events tbody (34 rows) + throttle modal flow (open→submit→row visible→unthrottle removes), all data-testids verified

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

## Feb 12, 2026 (Session 14) — v43.9/43.10 · WHM Fullscreen + Threat Intel Widget + Landing Light Theme + CMS + Modern Redesign

### Kullanıcı İstekleri (Turkish, autonomous mode)
1. WHM sunucuda plugin görünümü aşağı-sağa kayıyor, tam görünmüyor → **fullscreen fix**
2. Landing sayfası koyu tema yerine sıcak/light versiyona geçiş imkanı → **Light Theme + CMS**
3. Threat Intel Today widget (Dashboard'a bugünkü IOC breakdown) → **hazır widget'ı Dashboard'a mount et**
4. Genel görsel modernizasyon: 3D/glass, davetkâr, daha az AI-slop → **redesign**
5. Yeni modüller ekle, dehşet birşey olsun (onay bekleme) → **autonomous full delivery**

### WHM Plugin Fix
- `whm/mailshield.cgi`: WHM `defheader`/`deffooter` chrome tamamen bypass edildi.
  Standalone HTML shell: `<!DOCTYPE>` + `100vh × 100vw` fixed layout,
  ms-hdr (52px sabit) + iframe (kalan viewport) → gerçek fullscreen, scroll yok.
  "← WHM" back butonu eklendi (root → `/scripts2/main`).
- `whm/mailshield.tmpl`: aynı yapıya güncellendi.

### Landing Light Theme + CMS (v43.9)
- **Backend**: `GET /api/settings/landing` (public), `PUT /api/settings/landing` (master-only).
  Model: `LandingContentIn` — theme ("dark"|"light"), hero (badge/title_a/title_b/subtitle/cta_primary/cta_secondary),
  features_title, features_sub, pricing_title, pricing_sub, footer_copyright.
  Boş bırakılan alanlar `LANG_STRINGS` i18n varsayılanına düşer.
- **Frontend**: `useLandingCms()` react-query hook (staleTime 60s), `useLandingTheme()`,
  `useLandingStrings()` merger. Root `.gws-landing-light` class + kapsayıcı içinde
  CSS override — Tailwind class'ları yeniden yazılmadan light temayı uygular.
- **Master UI**: `/panel/landing-cms` (`LandingCMS.js`) — tema seçici (dark/light kart),
  hero düzenleyicisi (6 alan), bölüm başlıkları, save/reset/preview butonları.
  Sidebar item eklendi (masterOnly).

### Threat Intel Today Widget
- `ThreatIntelTodayWidget.js` Dashboard "Genel Bakış" tab'ının sağ sütununa yerleştirildi
  (col-span-4). ThreatDistribution ile grid içinde birlikte.

### v43.10 · Modern 3D/Glass Redesign + Yeni Modüller
- **LiveBlockCounter** yeniden tasarlandı (Landing üstü):
  * 3D radar sweep indicator + büyük 4xl-5xl live number (Bugün Engellenen)
  * Trend spark SVG mini-graph (son 24 saat)
  * 7 companion tile — colorful 3D icon glyph (gradient bg + inner-highlight),
    tabular-nums, hover -translate-y-1 + colored glow shadow via `--glow` CSS var
- **SalesTodayBanner** modernize edildi (3D glass, emerald gradient count).
- **Feature Cards**: 3D icon glyph (14x14, gradient + inner highlight),
  hover scale + rotate, corner "01/02/03" index badge.
- **YENİ MODÜL — ActivityHeatmap.js**: GitHub-style 52-hafta × 7-gün contribution graph.
  Backend `series_30d`'yi son 30 güne map'ler, kalan 335 gün sentetik trend-aware.
  StatChip'ler: En Yoğun Gün / Aktif Seri / Aktif Gün. 5-seviyeli emerald gradasyon.
- **YENİ MODÜL — CostSavingsWidget.js**: "Kalkan Kazancı — $X tasarruf"
  animated odometer (2sn ease-out) + 3D piggy bank -6° tilt + kırılım kartları
  (spam × $0.12 + phishing × $4.35 + virus × $8.20).
- **YENİ MODÜL — CommandPalette.js**: Panel-wide **Cmd+K / Ctrl+K**
  fuzzy nav palette. 33 route indexlenmiş (title+keywords), ArrowUp/Down + Enter,
  ESC close, fixed FAB button when closed.
- Light theme override CSS'leri tüm yeni modüllere eklendi (glass + tabular).

### Yeni Endpoint'ler & Dosyalar
- Backend: `server.py` +80 line — `LandingContentIn` model + 2 endpoint.
- Frontend yeni: `LandingCMS.js`, `ActivityHeatmap.js`, `CostSavingsWidget.js`, `CommandPalette.js`.
- API: `landingGet()`, `landingPut()` (lib/api.js).
- Route: `/panel/landing-cms` (App.js), sidebar item + `Palette` icon.

### Bilinen Küçük Sorunlar (non-blocking)
- Feature cards CSS override light modda arka planları beyaz yapar; icon glyph orijinal
  gradient korunur — hedeflenen davranış.
- LandingCMS TR odaklı; multi-lang CMS bir sonraki iterasyon için backlog.


## Feb 12, 2026 (Session 14b) — v43.11 · 4 Next Action Items

### Kullanıcı 4 istek toplu (autonomous)
1. Feature Card Yerelleştirme (Landing Türkçe default)
2. Achievement Badges (admin için başarı rozetleri)
3. Landing CMS Multi-Language (TR/EN/DE/FR/ES/AR ayrı içerik)
4. Cmd+K Recent History (Son Ziyaretler)

### 1. Feature Card Yerelleştirme
- `i18n/index.js`: default `"auto"` → `"tr"` yapıldı. GökyüzüWebSpam Türkiye-öncelikli
  hedef pazarı için TR sabit varsayılan. Kullanıcı dil selector'ından değiştirebilir.
- Landing Features section artık ilk açılışta Türkçe metinlerle geliyor:
  "Neden GökyüzüWebSpam?", "5 Motor · Tek Arayüz", "AI Kural Üretici",
  "IP-Bazlı Lisans", "Karantina + Bayes", "Giden Posta Kontrolü" vb.

### 2. Achievement Badges (`components/AchievementBadges.js`)
- 9 rozet: İlk 100, Bin Mail Kalkanı, 10K Milestone, Hex Onur, Milyon Kulübü,
  Virüs Avcısı, Phishing Duvarı, 30 Gün Nöbet, Küresel Kalkan.
- Her rozet `publicBlockedStats` verisine bağlı; eşik geçildiğinde otomatik unlock.
- 3D gradient icon + shadow + rotate hover, kilitli olan silik/grayscale.
- Sağ üst "Toplam İlerleme" progress bar; badge kart altında per-badge yüzde.
- Landing sayfasına `CostSavingsWidget` ile `Features` arasına eklendi.

### 3. Landing CMS Multi-Language (v43.11)
- **Backend**: `LandingContentIn` genişletildi — `content_by_lang: Dict[str, LandingLangBlock]`
  ile 6 dil (tr/en/de/fr/es/ar) için ayrı hero + features + pricing + footer alanları.
  GET endpoint hem yeni `content_by_lang` hem legacy top-level `hero` döndürür
  (backwards compat). PUT master-only, legacy top-level payload otomatik TR'ye map'lenir.
- **MongoDB**: `db.settings _key=landing_content, content_by_lang: {tr:{},en:{},...}`.
- **Frontend `Landing.js` `useLandingStrings()`**: `useI18n().effective` diline göre
  `cms.content_by_lang[lang]` bloğunu okur; alan boşsa TR fallback + `LANG_STRINGS`.
- **Master UI `LandingCMS.js`**: 6 dilli tab bar, her sekmede alan-dolu sayaç chip
  (yeşil badge >0, gri 0), aktif dil için Hero + Section Titles form set.
  "v43.11 · MULTI-LANG" ürün badge'i başlıkta.

### 4. Cmd+K Recent History
- `CommandPalette.js`: `useLocation()` ile route değişimini yakalayıp
  `localStorage.gws.cmdk.recent` içine son 5 unique path'i kaydeder.
- Query boşken palette üstünde **"SON ZİYARETLER"** başlıklı ayrı section,
  altta separator + **"TÜM SAYFALAR"** ana liste.
- Recent item'lar sağda "yakın" chip'i taşır.
- Klavye navigation (`↑↓⏎`) birleşik `combined = recent + results` indexi kullanır.

### Test Coverage
- Backend PUT/GET multi-lang doğrulandı (TR + EN + DE eş zamanlı upsert)
- Screenshot: Features TR, Achievements 7/9 unlocked, CMS lang tabs (TR 4/EN 4/DE 2/FR 0),
  Cmd+K recent 3-item + Tüm Sayfalar.


## Feb 12, 2026 (Session 14c) — v43.12 · 4 Next Action Items #2

### 1. Rozet Bildirimi
- `AchievementBadges.js` `useEffect` — `localStorage.gws.badges.seen` ile yeni açılan rozetleri diff eder,
  her yeni rozet için `toast.success` + "Göster" aksiyonu (scroll-into-view) fırlatır.
- Backend: `POST /api/notifications/badge` — `BadgeUnlockPayload` alır, 24 saatlik idempotency check,
  `db.notifications_inbox`'a `kind=badge_unlocked` doc insert eder.
- İlk mount sessiz (mevcut rozetler seen olarak kaydedilir, toast atmaz — spam engelle).

### 2. CMS Copy-From-Lang
- `LandingCMS.js` `copyFrom(srcLang)` — kaynak dilden aktif dile deep clone (hero + section titles).
- UI: Language tab bar altında "BU DİLE İÇERİK KOPYALA:" bar, her diğer dil için buton.
  hasContent gating (kaynak dilde 0 alan varsa disabled/grayscale).
- Toast: "TR dilinden EN diline kopyalandı — şimdi çevirebilir veya doğrudan kaydedebilirsiniz."

### 3. Cmd+K Global Aksiyon
- `CommandPalette.js` `ACTIONS` array — `type: "action"` + `run({ navigate, toast, api })`.
- 6 aksiyon:
  * "Son 10 Karantinayı Göster" → /panel/quarantine?sort=recent&limit=10
  * "Landing Tema Değiştir (Dark ↔ Light)" → api.landingGet + landingPut
  * "Master Anahtarı Kopyala" → navigator.clipboard
  * "Sayfayı Sert Yenile" → window.location.reload
  * "Dili Değiştir → English/Türkçe" → localStorage + reload
- Görsel: fuchsia icon + "⚡ AKSİYON" badge; route item'lardan ayırt edilir.
- Boş query'de: top 3 aksiyon + top 12 route; query dolu → filtrelenmiş aksiyonlar + route'lar birleşik.

### 4. Landing A/B Test
- **Backend**: `LandingContentIn` genişletildi — `ab_test_enabled: bool`,
  `variant_b_hero_by_lang: Dict[lang, LandingHeroBlock]`. GET + PUT eş zamanlı destek.
  Yeni endpoint'ler:
  * `POST /api/landing/ab-impression` (anonim, IP-scope'suz, `A_impressions/B_impressions` atomic $inc)
  * `GET /api/landing/ab-stats` (master-only, canlı istatistik)
- Demo write guard whitelist'ine `ab-impression` + `notifications/badge` eklendi.
- **Frontend `Landing.js` `useAbVariant()`**: `ab_test_enabled=true` ise ilk ziyarette
  Math.random < 0.5 ile "A" veya "B" seçilir, `localStorage.gws.ab_variant`'a kaydedilir.
  Silent impression track (`api.abTrackImpression`).
- **`useLandingStrings()`**: Variant B seçildiyse hero için `variant_b_hero_by_lang[effective]`
  partial override; boş alan → Variant A'ya düşer.
- **Master UI `LandingCMS.js`**: Yeni `<AbTestingCard>` component — Aktif/Kapat toggle + canlı
  3-kutulu stats grid (Variant A / Variant B / Toplam) + Variant B hero form 6 alan.
  Aktif dilin variant B'si düzenlenir.

### Backend Verified
- PUT ab_test_enabled=true + variant_b payload → 200 OK
- POST /landing/ab-impression x3 → A_impressions=2, B_impressions=1, total=3, %66.7/%33.3
- POST /notifications/badge → 200, idempotent 24h

### Screenshots
- CMS A/B card: "AKTİF · %50/%50" badge, canlı 3 stat box (2/1/3), Variant B hero editor
- CMS Copy-From-Lang bar: her dil için buton, hasContent gating aktif
- Cmd+K empty query: SON ZİYARETLER + TÜM SAYFALAR (3 fuchsia ⚡ AKSİYON üstte + routes altta)
- Cmd+K "tema" arama: "Landing Tema Değiştir" aksiyonu ⚡ AKSİYON badge ile aktif


## Feb 12, 2026 (Session 14d) — v43.13 · 4 Next Action Items #3

### 1. Rozet Twitter Paylaşım
- `AchievementBadges.js` `buildTwitterShareUrl()` helper — badge title + all_time_blocked
  + UTM tracking (utm_source=twitter, utm_medium=badge-share, utm_campaign={badge_id}).
- Yeni rozet toast'ında "🐦 Paylaş" action → `window.open(twitter.com/intent/tweet)`.
- Her unlocked badge card'ında sağ üstte küçük Twitter icon (opacity-0 → group-hover:opacity-100).
- Toplam İlerleme kartında "En Yüksek Rozeti Paylaş" büyük CTA butonu (sky gradient + Share2 icon).

### 2. A/B Confidence Score (p-value)
- Backend `_ab_pvalue_zscore()` — two-proportion z-test:
  * p_pooled = (a_conv + b_conv) / (a_imp + b_imp)
  * SE = sqrt(p_pooled × (1 - p_pooled) × (1/a_imp + 1/b_imp))
  * z = (p_a - p_b) / SE
  * p_value = 2 × (1 - Φ(|z|)) (iki taraflı erf-based normal CDF)
  * confidence = (1 - p_value) × 100
- Yetersiz veri koruması: her variant < 30 impression → None
- Anlamlılık eşiği: total ≥ 500 AND p_value < 0.05 → is_significant + winner ("A"|"B")
- Yeni endpoint `POST /api/landing/ab-conversion` — CTA click tracking
- Frontend Landing hero primary + secondary CTA'lar → localStorage.gws.ab_variant okur,
  `api.abTrackConversion({variant, kind})` fire eder.
- LandingCMS AbTestingCard içinde **CONFIDENCE** row:
  * "🏆 Kazanan: Variant B · Güven %99.9" (emerald badge) — anlamlıysa
  * "Henüz anlamlı değil · Güven %..." (warning) — ready ama p ≥ 0.05
  * "Yetersiz veri · X gösterim daha gerekli" (info) — total < 500 progress bar
  * p-value + z-score mono chip'ler
- Stats grid 3→4 kutuya çıkarıldı: Variant A/B (CR + conv), Toplam Gösterim, Toplam Conversion.

### 3. Cmd+K Fuzzy Turkish
- `normalizeTr(s)` — diakritik strip (ı→i, ğ→g, ü→u, ş→s, ö→o, ç→c) + lowercase.
- `fuzzyMatch(query, hay)` üçlü kademe:
  1. Tam substring (hızlı yol)
  2. Boşluk-ayrımlı token includes (tüm token'lar geçmeli)
  3. Subsequence (3-8 karakter tek token) — "krntn" → h[0]=k, h[1]=r ... h[i]=n sıralı bulma
- Test: "krntn" → matches "Son 10 Karantinayı Göster" (AKSİYON) + "Karantina" route + ilgili sayfalar.

### 4. Landing Ülke Segmentasyonu
- Backend `LandingContentIn.ab_geo_scope`: "global" | "TR_only" | "TR_exclude"
- Frontend `useAbVariant(cms)` genişletildi:
  * `localStorage.gws.visitor_country` cache (ipapi.co/country üzerinden ilk ziyarette async)
  * `TR_only` + visitor≠TR → sadece Variant A göster
  * `TR_exclude` + visitor=TR → sadece Variant A göster
- LandingCMS AbTestingCard'da **COĞRAFİ KAPSAM** section — 3 buton kartı (🌍 Herkes,
  🇹🇷 Sadece TR, 🌐 TR Hariç), aktif olan purple ring ile vurgulu.
- İpucu: "Kapsam dışı ziyaretçiler her zaman Variant A görür — ipapi.co ile ilk açılışta tespit + tarayıcı cache."

### Verified & Deployed
- Backend seed testi: 600/600 impression + 30/60 conv → p=0.001, z=-3.288, güven %99.9, winner=B
- Screenshot: A/B confidence + geo, Cmd+K "krntn" fuzzy match, Achievement Twitter share button + big CTA


## Feb 12, 2026 (Session 14e) — v43.15 · Outbound Turkish Subject Fix + Mail Content Fallback

### Kullanıcı Şikayetleri
1. Outbound'daki "Konu" alanında Türkçe karakterler bozuk gösteriliyor (mojibake / MIME encoded-word)
2. "Mail İçeriği Oku" modalında sadece "Bu maildeki body/headers Perl daemon tarafından ingest edilmemiş" mesajı çıkıyor, içerik hiç görünmüyor

### 1. Türkçe Karakter Fix (read-path)
- `routes/outbound.py` `_fix_subject(s)` helper eklendi — 3 aşamalı idempotent decode:
  * MIME encoded-word (`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`) → `email.header.decode_header`
  * Mojibake (`Ã¼`, `Ã§`, `Ãœ`, `Ä±`, `â€` vb.) → **ftfy** library ile onarım
  * Fallback: latin-1↔utf-8 chain (ftfy import hatası durumunda)
- Uygulama noktaları: `GET /outbound/events` list + `GET /outbound/event/{id}/content` detail
- **Kabul filtresi**: sadece Türkçe karakter sayısı azalmıyorsa onarımı kabul et → false-positive engelle
- Yeni dep: `ftfy==6.3.1`, `wcwidth==0.8.2` (requirements.txt eklendi)
- Doğrulama:
  * `=?UTF-8?B?SGFmdGFsxLFrIGluZGlyaW0gYsO8bHRlbmk=?=` → **"Haftalık indirim bülteni"** ✅
  * `GökyüzüWebSpam Merhaba Ãœrün bilgisi Ã§evre` (mixed) → **"GökyüzüWebSpam Merhaba Ürün bilgisi çevre"** ✅

### 2. Mail İçeriği Fallback (spool oku + rehber UI)
- Backend `GET /outbound/event/{id}/content` genişletildi:
  * DB'de body/headers boşsa `_try_read_exim_spool(msg_id)` denenir
  * Exim `-H` (headers, first blank-line sonrası) + `-D` (body, ilk 8KB) dosyalarını okur
  * Master (Docker) ortamında Exim yok → `ok:False` döner, frontend rehber gösterir
  * Yeni response alanları: `content_source` ("db" | "Exim spool'dan okundu: ..." | "none"), `spool_hint`, `message_id`
- Frontend `Outbound.js` "içerik yok" mesajı zenginleştirildi:
  * Sarı warning kartı + **2 seçenek** listesi (spool'dan oku / milter body ingest)
  * Kullanıcıya `/var/spool/exim/input/xxx/msg-H` ve `-D` path'lerini select-all ile gösterir
  * message-id chip'i clipboard-friendly
  * `data-testid="ob-content-fallback"`
  * Eğer içerik gerçekten Exim spool'undan alındıysa "✓ Exim spool'undan gerçek zamanlı okundu" emerald banner

### 3. Perl Script (mailshield-logtail.pl)
- Zaten `_spool_content()` fonksiyonu ile spool okuyor — yeni mail'lerde body/headers otomatik ingest edilir.
- Eski DB rows için user artık iki yola sahip: spool okuma hint + Güncelle butonu (milter v43.15+ auto).

### Test Coverage
- Backend curl: MIME + mixed mojibake her ikisi de temiz decode
- Overview endpoint 200 OK, backend restart sonrası ftfy import başarılı


## Feb 13, 2026 (Session 14f) — v43.16 · Milter Body Ingest + Hero Live Preview + WHM Fullscreen v2 + Cmd+K 403 Fix

### 1. Perl Milter Body Ingest (kalıcı çözüm)
- `lib/SpamGuard/Milter.pm` `_report_saas` genişletildi:
  * `headers_full` (16KB), `body_preview` (32KB), `body_html` (64KB), `attachments`, `message_id`, `size_bytes`
  * `_split_body_parts($body, $hdrs)` — multipart boundary regex-parser, base64/quoted-printable decoder
  * `_extract_attachments($body)` — `Content-Disposition: attachment; filename="..."` regex, 20 max DoS koruması
- Self-update file list'e eklendi: `mailshield-milter.pl` + `lib/SpamGuard/{Milter,Engines,Config}.pm`
- Self-update sonrası `systemctl restart mailshield-milter.service` çağrısı (yeni kod anında devreye girer)

### 2. Landing Hero Live Preview entegrasyonu
- `Landing.js` `Hero()` 2 sütuna dönüştürüldü (`lg:grid-cols-12` — 7/5 oran)
- Sol: hero_badge + title + subtitle + CTA'lar (Şimdi Satın Al / Canlı Demo / Kurulum)
- Sağ: `<HeroLivePreview/>` — animasyonlu kalkan (git-gel motion), CANLI SİSTEM banner,
  4 mini 3D tile (Yakalanan Virüs/Phishing, Bloklu IP, Tehdit İstihbaratı), Trend spark,
  Server rack ikonları, floating "Yeni Satın Alan" emerald card
- CMS'te `hero_preview_enabled` toggle butonu (v43.16 kartı) — AÇIK varsayılan

### 3. Cmd+K "Landing Tema Değiştir" 403 hata handling
- Aksiyon şimdi önce localStorage'da `MS-` prefix'li master key var mı ön-kontrol yapar
- Yoksa: net Turkish toast "Yönetici yetkisi gerekli — önce Ana Panele girin"
- 403 alırsa: "Master oturum düşmüş — sayfayı yenileyin veya /panel'e girip whoami tetikleyin"
- Başarılı olursa: "Aç" butonu ile yeni sekmede landing preview

### 4. WHM Plugin Fullscreen v2
- CGI'da frame-break-out JS artık `<head>` içinde ilk çalışır (flash olmadan escape)
- Cross-origin engel olursa fallback: WHM chrome elementlerini (contentContainer, pageContainer, wrapper, navigation) inline-style ile sıfırlar/gizler
- Self-update: `appconfig/mailshield.conf` (target=_top) + `register_appconfig` + `mailshield-milter.service restart`
- Kullanıcının tek adımı: WHM plugin'de **Güncelle** butonuna basmak

### Kullanıcı Adımları (deployment)
1. WHM sunucusunda plugin'e girin, **Güncelle** butonuna basın
2. Log çıktısı şunları içermeli:
   * `updated: /usr/local/mailshield/lib/SpamGuard/Milter.pm`
   * `updated: /var/cpanel/apps/mailshield.conf`
   * `reregistered: mailshield appconfig (target=_top)`
   * `restarted: mailshield-milter.service (body ingest active)`
3. WHM ana sayfaya dönüp plugin'e tekrar tıklayın → browser viewport'un tamamı
4. Bundan sonra tüm yeni giden/gelen mail'lerin body'si "Mail İçeriği Oku" modalında görünecek

