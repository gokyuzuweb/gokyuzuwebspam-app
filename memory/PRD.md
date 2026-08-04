# GökyüzüWebSpam — Product Requirements Document

## Original Problem Statement
User requested a comprehensive WHM/cPanel mail spam application (plugin) named
**GökyüzüWebSpam** with IP-based licensing, reseller scoping, checkout systems,
full multi-language support, and a standalone live License Server. Master hosting
domain: **gokyuzuhosting.com** (89.19.15.58). Product package name remains
`GökyüzüWebSpam` / `gokyuzuwebspam-{version}.tar.gz`.

## Architecture
- **Backend**: FastAPI + Motor (MongoDB). Master routes at `/api/*`.
- **Frontend**: React + TanStack Query + TailwindCSS + Shadcn UI.
- **Master domain**: `https://gokyuzuhosting.com`.
- **Package dist**: `/app/backend/dist/gokyuzuwebspam-{version}.tar.gz`.
- **Multi-tenant isolation**: `owner_license_key` on `rules`, `engines`,
  `mail_events`, `settings:policy:{owner}` docs. `_tenant_scope()` scope helper.
- **Impersonation**: `gws_impersonate` cookie → master views panel as reseller.

## Recently Completed (Feb 2026)
### Feb 4 batch
- ✅ Engine stats tenant isolation: `/api/engines` computes today's
  `scanned_today`/`caught_today` per-tenant from `mail_events`.
- ✅ Havale (bank transfer) upgrade path — Stripe API key not required.
- ✅ Stable plugin download: `/api/plugin/download`, `/download/{version}`,
  `/api/plugin/versions`, `/api/scripts/install-bayi.sh`.
- ✅ Landing LiveTicker component (bottom-center pill, 5sn polling).
- ✅ **Bayi Sağlık Monitörü**: `/api/admin/bayi-health` returns green/yellow/red
  status per license based on `last_heartbeat_at`. Colored dots on MasterLive
  cards + aggregated totals.
- ✅ **Master Havale Panosu**: existing PaymentsAdmin retains flow; `mark-paid`
  extended to send customer confirmation email + push master toast.
- ✅ **Test Ping Button**: BayiServer.js has "🚀 Test Ping Gönder" button —
  clicking sends synthetic mail_event → widget turns green in 10s. Tested E2E.
- ✅ **Version Publish UI**: `/panel/version-publish` — dropdown of dist
  packages, one-click publish → auto-promotes dist + version_manifest.
- ✅ **Push Toast Bridge**: `PushToastBridge` component polls /api/push/toasts
  every 10s; new events → Sonner toast + browser Notification API. Wired for
  bayi_registered, payment_confirmed events.
- ✅ Public URLs cleanup: `gokyuzuwebspam.com` → `gokyuzuhosting.com`.
- ✅ Backend IndentationError fixed (duplicate empty `_stripe_client`).
- ✅ Bayi install URL always `https://gokyuzuhosting.com` (never 127.0.0.1).
- ✅ BayiServer detailed install guide (SSH, systemd, troubleshooting).
- ✅ `admin/resellers-live` merges `db.resellers` + `db.licenses`.

## Data Models
- `licenses`: `{license_key, plan, active, valid_until, customer_name,
   last_heartbeat_at, last_heartbeat_ip, last_heartbeat_version, ...}`
- `engines`: `{name, enabled, owner_license_key, version}` (counts on-the-fly)
- `rules`: `{..., owner_license_key}`
- `mail_events`: `{license_key, engine, verdict, ts, ...}`
- `bayi_servers`: `{owner_license_key, hostname, primary_ip, ...}`
- `payments`: `{merchant_oid, status, provider, plan_code, amount, currency}`
- `master_toasts`: `{id, kind, title, body, link, meta, created_at, seen}`
- `settings`: `_key`-scoped docs.

## Health Dot Rules
- 🟢 **green**: `last_heartbeat_at` within 5 minutes (active)
- 🟡 **yellow**: 5-30 minutes (slowed)
- 🔴 **red**: 30+ minutes or no heartbeat (disconnected)

Endpoints:
- `GET /api/admin/bayi-health` → master-only, aggregated totals + sorted list
- `admin/resellers-live` also exposes `health` field per bayi card

## Prioritized Backlog

### P1 — Next value-adds
- **Bayi Health Dashboard Page**: dedicated `/panel/bayi-health` with filter
  by health color + bulk "ping tümü" action.
- **Email templates config**: allow master to customize onboarding + havale
  confirmation email body/subject via settings.
- **SHA256 in version_manifest**: verify tar.gz integrity before install.

### P2 — Performance / cleanup
- Optimize `public/blocked-stats` $lookup + country compound index.
- Refactor `server.py` (6600+ lines) into modules.

### P3 — Nice-to-have
- SSE/WebSocket for push toasts (replace 10sn polling).
- Delta package updates (rsync-style) for faster upgrades.

## Testing Credentials
See `/app/memory/test_credentials.md`.
