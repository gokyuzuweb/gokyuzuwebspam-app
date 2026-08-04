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
### P1
- **Security/Settings page tenant isolation**: `/api/security/country-rules`,
  `/api/settings/*` endpoint'lerini owner_license_key ile izole et.
- **Reports page plan gate**: `reports_view` false → sayfada PlanGate göster.
- **Outbound Mail tenant isolation**.

### P2
- server.py (6700+ lines) modular split.
- Choropleth heatmap layer.
- WebSocket-based live feed for MasterLive.

## Testing Credentials
`/app/memory/test_credentials.md`.
