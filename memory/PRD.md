# GökyüzüWebSpam · PRD (Feb 2026)

## User language
Turkish only.

## Implemented (cumulative)
- Master/Customer split with cookie session, Modern Publish Modal, Mail Detail Viewer with tabs+Mark Spam, Top IP drilldown, SMTP Relay & Test Mail (10 presets), Compliance PDF, Alerts Timeline, Reseller Branding UI + header injection, Mobile Bayi View, Reseller Portal Management (login audit + CRUD + create + password reset), Users page WHM/DEMO badges + purge demo, Quarantine `_DEMO_DOMAINS` + purge, Engines dedupe (24→6), WHM Daemon `/users/sync`, Password reset email, Reseller Activity Chart (7/30/90d).
- **This turn (Feb 2026)**:
  - **cPanel Karantina Sync**: `heartbeat.pl` new `_sync_cpanel_quarantine()` scans `/var/spool/MailScanner/quarantine` and `/var/cpanel/quarantine`, extracts headers+body_preview+X-Spam-Score+verdict from each file (last 24h, max 50 items/tick, size cap 200B–10MB), POSTs to `/api/events/ingest-batch`. Log: `/var/log/mailshield/quarantine-sync.log`.
  - **Bayi Aktivite Uyarısı**: `GET /api/admin/resellers` now returns `inactivity_days`, `idle` (>=7d), and `idle_count`. Bayi tablosunda 😴 uyku ({N}g) rozeti + 🔔 hatırlatma butonu (idle bayiler için). `POST /api/admin/resellers/{rid}/send-reminder` bayiye SMTP ile e-posta gönderir.
  - **Master Onboarding Wizard**: `GET /api/admin/onboarding-status` returns 4-step checklist (license/smtp/branding/stripe). `OnboardingWizard` component mounts at top of Dashboard for master-only, shows progress bar + 4 clickable step cards (each links to relevant page). "Kurulum Tamam" button + X dismiss. `POST /api/admin/onboarding-complete` marks done. Uses localStorage `gws.onboarding_dismissed` for persistent dismiss.
  - **PWA Push Notifications**: `/app/frontend/src/lib/push.js` — service-worker registration (blob-inline), `requestPermission()`, `notifyIfNew()` triggers local `new Notification()` for critical alerts (verdict=virus/phish/high_spam OR score>=10), audio ping, tab-title badge count. ResellerMobile header has 🔔/🔕 toggle button. Web Push (VAPID) foundation ready — server subscription endpoint pending.

## Endpoints (this turn)
- `POST /api/admin/resellers/{rid}/send-reminder` — send idle-reminder email
- `GET  /api/admin/onboarding-status`
- `POST /api/admin/onboarding-complete`
- `/api/admin/resellers` now includes `inactivity_days`, `idle`, `idle_count`

## Key files
- `/app/whm-plugin/scripts/heartbeat.pl` — `_sync_cpanel_quarantine`, `_add_quarantine_item`, `_iso_time`
- `/app/backend/server.py` — inactivity flags, send-reminder, onboarding-status/complete
- `/app/frontend/src/components/OnboardingWizard.js` (new)
- `/app/frontend/src/components/ResellerAdminPanel.js` — uyku badge + 🔔 button, `remind` mutation
- `/app/frontend/src/lib/push.js` (new) — PWA notification helper
- `/app/frontend/src/pages/ResellerMobile.js` — push toggle + notifyIfNew
- `/app/frontend/src/pages/Dashboard.js` — mounts OnboardingWizard

## Backlog
- 🟡 Web Push server subscription (VAPID keys + `POST /api/push/subscribe`) for offline notifications
- 🟡 Karantina detay: fetch full body/attachments on-demand (currently uses preview object)
- 🟡 Full frontend testing agent regression

## Test credentials
See `/app/memory/test_credentials.md`.
