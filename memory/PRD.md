# GökyüzüWebSpam · PRD

## Original problem statement
Comprehensive WHM/cPanel mail spam plugin (SaaS + local plugin). Full description in prior versions.

## User language
Turkish only.

## Implemented (Feb 2026) — cumulative
- Master/Customer split (relaxed: key alone is enough), Master Session Cookie
- Modern Publish Success Modal + VersionPublishCard (auto-detect + dual URLs)
- Mail Detail Viewer + Top IP drilldown + Mark Spam
- SMTP Relay & Test Mail with 10 provider presets
- Compliance PDF + Alerts Timeline + Reseller Branding UI
- Mobile Bayi View
- Reseller Portal Management (login audit + CRUD + create + password reset + activation)
- Users page with WHM/DEMO source badges + purge demo
- Quarantine `_DEMO_DOMAINS` filter + purge endpoint
- Engines duplicate dedupe (24 → 6)
- **This turn**:
  - **WHM Daemon `/users/sync` push**: `heartbeat.pl` extended with `_sync_cpanel_accounts()` — calls `whmapi1 --output=json listaccts`, extracts user/domain/plan/suspended, POSTs to `POST /api/users/sync` every heartbeat (15 min). Dovecot statistics best-effort for mail counts. Logged to `/var/log/mailshield/user-sync.log`.
  - **Reseller Notification email**: Password reset now sends bayi an email with new password (SMTP → sendmail fallback). Return payload includes `notification: {sent, via, error}`.
  - **Reseller Activity Chart**: `GET /api/admin/resellers/{rid}/activity?days=N` returns per-day success/fail login counts, backfilled with zero rows. `ActivityChartModal` renders Recharts LineChart (green = success, red dashed = fail) with 7/30/90 day toggle and 3 metric pills.
  - **Quarantine Detail Drawer**: Rewrote quarantine modal into a tabbed drawer identical to MailEventDetail: Gövde / HTML (sandboxed iframe) / Başlıklar / Ekler / Kurallar / Motorlar. Bottom action bar (Bayes'e Öğret / Serbest Bırak / Sil).

## Endpoints (this turn)
- `POST /api/users/sync` — WHM plugin pushes cPanel account list
- `GET  /api/admin/resellers/{rid}/activity` — per-day login series
- (existing) `POST /api/admin/resellers/{rid}/reset-password` now also emails the bayi

## Key files
- `/app/whm-plugin/scripts/heartbeat.pl` — cPanel account sync
- `/app/backend/server.py` — reset-password email, `/admin/resellers/{rid}/activity`
- `/app/frontend/src/pages/Quarantine.js` — `QuarantineDetail` tabbed drawer
- `/app/frontend/src/components/ResellerAdminPanel.js` — `ActivityChartModal` + activity button in ResellersTable
- `/app/frontend/src/lib/api.js` — `adminResellerActivity`

## Backlog
- 🟡 WHM plugin daemon SMTP config sync (currently master-configured only)
- 🟡 Quarantine detail: fetch full body/attachments on demand (currently uses `preview` object as-is)
- 🟡 Mobile Bayi: quarantine detail sheet
- 🟡 Full frontend regression testing pass

## Test credentials
See `/app/memory/test_credentials.md`.
