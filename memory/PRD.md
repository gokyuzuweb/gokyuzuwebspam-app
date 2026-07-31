# GökyüzüWebSpam · PRD (Feb 2026)

## User language
Turkish only.

## Implemented (cumulative — 6 sessions worth)
- Master/Customer split with cookie session, Modern Publish Modal (confetti), Mail Detail Viewer with tabs+Mark Spam, Top IP drilldown, SMTP Relay & Test Mail (10 presets), Compliance PDF, Alerts Timeline, Reseller Branding UI + header injection, Mobile Bayi View, Reseller Portal Management (login audit + CRUD + create + reset password + activation), Users page WHM/DEMO badges + purge, Quarantine `_DEMO_DOMAINS` + purge, Engines dedupe, WHM Daemon `/users/sync` + `/quarantine-sync`, Password reset e-mail, Reseller Activity LineChart, Idle Bayi rozeti + reminder mail, Master Onboarding Wizard, PWA Push (client-side), Auto-suspend cron, Analytics CSV export.
- **This turn**:
  - **VAPID Web Push foundation**: `POST /api/push/subscribe` stores endpoint+keys in `push_subscriptions` collection. `GET /api/push/vapid-public` returns configured public key. Server-side push send using `pywebpush` is one env var (`VAPID_PUBLIC_KEY`+`VAPID_PRIVATE_KEY`) away from working end-to-end.
  - **Auto-suspend cron**: Background asyncio task `_auto_suspend_daily_task` runs every 24h. Reads `settings.auto_suspend`, suspends idle bayis, updates `last_run_at`/`last_suspended_count`. Sends notification email if enabled.
  - **Analytics CSV Export**: `GET /api/admin/analytics/export?fmt=csv&days=30` returns Excel-BOM CSV with per-bayi aggregate: sub_accounts, login stats (period), mail volume, spam count, spam ratio, last_login. Direct download link in `AdminOperationsCard`.
  - **Mail Detay Özet sekmesi** (user-reported bug fix): MailEventDetail now always shows an "Özet" tab as the default with structured metadata (Konu, Gönderen, Alıcı, Verdict, Skor, Aksiyon, Exim MID, Sunucu, IP, Zaman, motor skorları). When body/headers/attachments aren't stored yet, a friendly amber notice explains that the WHM plugin needs to be updated to sync full mail content.
  - **AdminOperationsCard**: New Licenses page card with auto-suspend rule toggle + threshold + notify-before checkbox + "Şimdi Çalıştır" button, and analytics CSV download with 7/30/90/365-day selector.

## Backend endpoints (this turn)
- `GET  /api/admin/auto-suspend` / `PUT` / `POST /run`
- `GET  /api/admin/analytics/export?fmt=csv&days=N`
- `POST /api/push/subscribe`, `DELETE /api/push/subscribe?endpoint=…`
- `GET  /api/push/vapid-public`

## Key files (this turn)
- `/app/backend/server.py` — auto-suspend endpoints + startup task, analytics export, push subscribe, vapid-public
- `/app/frontend/src/components/AdminOperationsCard.js` (new)
- `/app/frontend/src/components/MailEventDetail.js` — Özet tab with `SumRow` helper
- `/app/frontend/src/pages/Licenses.js` — mounts `AdminOperationsCard`
- `/app/frontend/src/lib/api.js` — 7 new API methods (auto-suspend, analytics, push)

## Backlog
- 🟡 VAPID key generation + server-side push send (pywebpush + FastAPI trigger)
- 🟡 Reseller Dashboard mobile detail bottom-sheet (started but deferred)
- 🟡 Full frontend testing agent regression pass

## Test credentials
See `/app/memory/test_credentials.md`.
