# GökyüzüWebSpam — Product Requirements Document

Master repository for the WHM/cPanel-based multi-tenant mail security SaaS.

## Original Problem Statement
User requested a comprehensive WHM/cPanel mail spam application (plugin) named
**GökyüzüWebSpam** with IP-based licensing, reseller scoping, checkout systems,
full multi-language support, and a standalone live License Server. Master hosting
domain: **gokyuzuhosting.com** (89.19.15.58). Product package name remains
`GökyüzüWebSpam` / `gokyuzuwebspam-{version}.tar.gz`.

## Architecture
- **Backend**: FastAPI + Motor (MongoDB). Master routes at `/api/*`.
- **Frontend**: React + TanStack Query + TailwindCSS + Shadcn UI.
- **Master domain**: `https://gokyuzuhosting.com` (all plugin/download URLs).
- **Package dist**: `/app/backend/dist/gokyuzuwebspam-{version}.tar.gz`.
- **Multi-tenant isolation**: `owner_license_key` field on `rules`, `engines`,
  `mail_events`, `settings:policy:{owner}` docs. `_tenant_scope()` helper decides
  scope from `X-Master-Key` header, `gws_master_session` cookie, or fallback.
- **Impersonation**: `gws_impersonate` cookie → master views panel as reseller.

## Recently Completed (Feb 2026)
- ✅ Backend `IndentationError` fix (duplicate empty `_stripe_client` at 5512).
- ✅ Bayi install URL always uses `https://gokyuzuhosting.com` (never 127.0.0.1).
- ✅ BayiServer.js detailed install guide: prerequisites, SSH, install, systemd,
  test ping, troubleshooting accordion.
- ✅ `/api/admin/resellers-live` merges `db.resellers` + `db.licenses` (master
  excluded) → 18 bayi cards showing traffic breakdown.
- ✅ Engine stats tenant isolation: `/api/engines` now computes
  `scanned_today`/`caught_today` per-owner from `mail_events` today (each
  bayi/master sees own numbers only).
- ✅ Havale (bank transfer) upgrade path — Stripe API key not required:
  - `/api/checkout/create-session` returns Havale response if
    `payment_settings.default_gateway=havale`.
  - `/api/payment/havale/status` polling endpoint.
  - `/api/admin/payment/havale/mark-paid` manual master approval endpoint.
  - `/panel/payment/havale` frontend page with 4-section detailed instructions.
- ✅ Stable plugin download infrastructure:
  - `/api/plugin/download` → latest package (currently 2.6.0).
  - `/api/plugin/download/{version}` → version-pinned.
  - `/api/plugin/versions` → available versions list.
  - `/api/scripts/install-bayi.sh` → working bash installer with systemd unit.
  - `version_manifest` auto-promotes dist when new version published.
- ✅ Landing Live Ticker: bottom-center pill shows "Son dakikada X saldırı
  engellendi · Son 1 saat Y · Z aktif bayi" — 5sn polling with odometer anim.
- ✅ Public URL cleanup: all `gokyuzuwebspam.com` → `gokyuzuhosting.com`
  (invoices, emails, license gate, Landing footer).

## Data Models
- `licenses`: `{license_key, plan, active, valid_until, customer_name, ...}`
- `engines`: `{name, enabled, owner_license_key, version}` (scanned/caught
  computed on-the-fly from mail_events)
- `rules`: `{..., owner_license_key}`
- `mail_events`: `{license_key, engine, verdict, ts, ...}`
- `bayi_servers`: `{owner_license_key, hostname, primary_ip, ns_records, ...}`
- `payments`: `{merchant_oid, status, provider, plan_code, amount, currency}`
- `settings`: `_key`-scoped docs (policy:{owner}, version_manifest,
  payment_settings, landing_traffic_seed, master_public_url).

## Prioritized Backlog

### P1 — Next value-adds
- **Widget Test Ping Button**: BayiServer.js add "🚀 Test Ping Gönder" button
  wired to `POST /api/bayi/test-ping` (backend already exists at server.py:5858).
- **Master Havale Panosu**: `/panel/payments-admin` new tab listing
  `awaiting_transfer` payments with "Onayla" button → `mark-paid`.
- **Version Publish UI**: dropdown listing `/api/plugin/versions` and one-click
  publish that runs `_promote_dist_version()`.

### P2 — Performance / cleanup
- Optimize `public/blocked-stats` $lookup + add `country` compound index.
- Refactor `server.py` (6300+ lines) into `plan_matrix.py`, `bayi_server.py`,
  `impersonate.py`, `feature_gate.py`, `plugin_download.py`, `havale.py`.

### P3 — Nice-to-have
- SHA256 checksum in `version_manifest` for tar.gz integrity verification.
- Landing ticker → SSE (server-sent events) instead of polling.

## Testing Credentials
See `/app/memory/test_credentials.md` for master license & sample bayi keys.
