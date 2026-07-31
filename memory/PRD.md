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

## Master / Customer split (relaxed by user request)
- **Master** = license_key equals master's (either env `MASTER_LICENSE_KEY` or a license bound to `MASTER_IP=89.19.15.58`). IP match is reported for defence-in-depth but no longer required — user asked for master admin to work from any browser as long as the master license key is used.
- **Master session cookie** `gws_master_session` (30 days) available via `POST /api/admin/master-unlock`.

## Implemented (Feb 2026)
- Licenses UI fixes, Compliance PDF, Alerts Timeline, Reseller Branding, SMTP Relay & Test Mail, Master/Customer Split, Modern Publish Success Modal, VersionPublishCard, Mail Detail Viewer (tabs, body, HTML, headers, attachments, Mark Spam), Top Suspicious IPs → LiveMailEvents drilldown, Master Session Cookie, WHM Plugin body/attachment push (Exim spool -H/-D parser), Mobile Bayi View, Engines dedupe (24→6)
- **NEW this turn**:
  - **Master detection relaxed**: `_is_master()` now returns `is_master=key_match` (key alone is enough). Master can use panel from any browser once they have the master key in localStorage.
  - **Reseller Portal Management** (`ResellerAdminPanel` on Licenses page): 3 tabs (Girişler / Bayiler / Alt Hesaplar), live login audit with success+fail status/IP/UserAgent, aggregated sub-account view with owning reseller
  - **Reseller CRUD from master**:
    - `POST /api/admin/resellers/{rid}/reset-password` (bcrypt hash) + Password Reset Modal with random-generator
    - `POST /api/admin/resellers/{rid}/toggle-active` (askıya al/aktifleştir)
    - `DELETE /api/admin/resellers/{rid}` (kalıcı sil + alt hesapları da)
    - `POST /api/admin/resellers` (yeni bayi oluştur) + Create Reseller Modal with password generator
  - **Login audit**: `/reseller/auth/login` now records every attempt (success/fail) into `reseller_logins` with IP, user-agent, timestamp — visible in Master admin's Girişler tab
  - **Users source clarification**: Users page shows a banner explaining data comes from WHM plugin (real) OR demo seed. Each row tagged with WHM/DEMO badge. Master gets a "Demo Verilerini Temizle" button that calls `POST /api/quarantine/purge-demo` to remove seed data.
  - **WHM plugin user sync endpoint**: `POST /api/users/sync` accepts real cPanel accounts from the daemon; auto-purges demo users on first push.
  - **Demo domain filter for quarantine**: `_DEMO_DOMAINS` list identifies seed recipients (kobifirma, teknofirma, sirket, denemedomain, example.com.tr, your.tld, test.local); helper `/quarantine/local-domains` and `/quarantine/purge-demo`.

## Backlog
- 🟡 Wire up WHM plugin daemon to actually POST /api/users/sync every N minutes (need Perl code)
- 🟡 Quarantine detail modal: show attachments list (backend already supports)
- 🟡 Frontend testing agent full regression pass (deferred to save context)
- 🟡 Mobile Bayi: quarantine detail sheet (currently list-only)

## Master admin endpoints
- `GET  /api/admin/whoami` — reads cookie or license key
- `POST /api/admin/master-unlock` — mint 30-day cookie
- `POST /api/admin/master-logout` — revoke cookie
- `GET  /api/admin/resellers` — list all bayis with sub-count + last login
- `POST /api/admin/resellers` — create new reseller
- `POST /api/admin/resellers/{rid}/reset-password`
- `POST /api/admin/resellers/{rid}/toggle-active`
- `DELETE /api/admin/resellers/{rid}` — delete + cascade sub-accounts
- `GET  /api/admin/reseller-logins` — login audit (success+fail)
- `GET  /api/admin/subaccounts` — aggregated with reseller context
- `POST /api/users/sync` (public, license-gated) — WHM plugin pushes real cPanel accounts
- `POST /api/quarantine/purge-demo` — remove seed data
- `GET  /api/quarantine/local-domains` — detect real hosted domains

## Key files (this turn)
- `/app/backend/server.py` — admin_resellers CRUD, /users/sync, /quarantine/purge-demo & local-domains, `_is_master` relaxed
- `/app/backend/routes/reseller.py` — /auth/login records `reseller_logins`
- `/app/frontend/src/components/ResellerAdminPanel.js` — 3 tabs + CRUD actions + `PasswordResetModal` + `CreateResellerModal`
- `/app/frontend/src/pages/Licenses.js` — mounts `ResellerAdminPanel`
- `/app/frontend/src/pages/Users.js` — data-source banner + WHM/DEMO badges + purge button
- `/app/frontend/src/lib/api.js` — 8 new admin endpoints

## Test credentials
See `/app/memory/test_credentials.md`. Existing reseller: `reseller@test.com` / (after master reset: any new pw the master sets).
