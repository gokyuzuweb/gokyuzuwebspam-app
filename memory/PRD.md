# GökyüzüWebSpam · PRD

## Original problem statement
Comprehensive WHM/cPanel mail spam plugin (SaaS + local plugin) named **GökyüzüWebSpam**:
- IP-based licensing, reseller scoping, Stripe checkout, multi-language, live License Server
- WHM plugin with systemd heartbeat + cPanel CGI proxy
- Live mail traffic streaming (Exim/MailScanner) to SaaS
- Alert Rules Engine (Discord/Slack webhooks)
- Compliance reporting (CSV/PDF), Health Score dashboards
- License Management UI (CRUD, Bulk IP)

## User language
Turkish only.

## Master / Customer split
- **Master** = X-Forwarded-For contains `89.19.15.58` **AND** license key is master's; OR valid `gws_master_session` cookie
- **One-time unlock**: `POST /api/admin/master-unlock` mints 30-day cookie so subsequent requests don't need X-Forwarded-For spoofing
- Customer view hides License Management, Pricing, MRR, Version Publish

## Implemented (Feb 2026)
- Licenses UI edit pencil fix + Compliance PDF export + Alerts Timeline BarChart + Reseller Branding UI + SMTP Relay & Test Mail + Master/Customer Split + Modern Publish Success Modal + VersionPublishCard + Mail Detail Viewer (tabs, body, HTML, headers, attachments, Mark Spam) + Top Suspicious IPs → LiveMailEvents drilldown
- **NEW this turn**:
  - **Master Session Cookie**: `POST /api/admin/master-unlock` → 30-day HttpOnly=false cookie `gws_master_session`. Backend `_require_master()` accepts cookie OR IP+key. Unlock button on "Yetkisiz Erişim" screen for one-tap bootstrap. `POST /api/admin/master-logout` clears the session.
  - **WHM Plugin body/attachment push**: `mailshield-logtail.pl` new `_spool_content()` sub parses Exim spool `-H` (headers) and `-D` (body) files, extracts:
    - `headers_full` (up to 8KB, strips Exim numeric prefixes)
    - `body_preview` (4KB text; multipart-aware — picks first text/plain part)
    - `attachments[]` (up to 10, from Content-Disposition: attachment headers)
  - **Mobile Bayi View**: `ResellerMobile.js` — bottom-tab-bar iOS-style with 3 tabs (Karantina / Alarm / Hesap), summary pill strip (karantina count, alarm count, kota), auto-detected via `matchMedia("(max-width:640px)")` or `?mobile=1`
  - **Engine duplicates fixed**: `db.engines.name` unique index + startup dedupe. 24 duplicate rows → 6 unique.

## Backlog
- 🟡 Frontend testing agent regression pass on all newly added features
- 🟡 Reseller mobile: enable clicking a karantina card → detail view (currently list-only)
- 🟡 Push notifications (mobile PWA) for critical alerts

## Endpoints (new)
- `GET  /api/admin/whoami` — reads cookie or license key
- `POST /api/admin/master-unlock` — mint 30-day cookie
- `POST /api/admin/master-logout` — revoke cookie
- `GET  /api/events/{event_id}` — full detail
- `POST /api/events/{event_id}/mark-spam`

## Key files
- `/app/backend/server.py` — SMTP, whoami/unlock/logout, `_require_master` (cookie-aware), version publish, engines dedupe
- `/app/backend/routes/events.py` — MailEvent w/ body/attachments, mark-spam
- `/app/backend/.env` — `MASTER_IP`, `MASTER_HOST`, `MASTER_LICENSE_KEY`
- `/app/whm-plugin/scripts/mailshield-logtail.pl` — `_spool_content()` for body/attachments
- `/app/frontend/src/hooks/useIsMaster.js`
- `/app/frontend/src/components/VersionPublishCard.js` — Modern publish + success modal
- `/app/frontend/src/components/MailEventDetail.js` — Tabs + Mark Spam
- `/app/frontend/src/components/SmtpSettings.js`, `BrandingSettings.js`
- `/app/frontend/src/pages/Licenses.js` — `MasterUnlockButton`
- `/app/frontend/src/pages/Reseller.js` — mobile auto-detect
- `/app/frontend/src/pages/ResellerMobile.js` — mobile app-shell

## Test credentials
See `/app/memory/test_credentials.md`.
