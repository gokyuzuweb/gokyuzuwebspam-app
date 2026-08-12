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
