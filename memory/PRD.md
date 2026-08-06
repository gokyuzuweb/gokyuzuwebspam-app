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
