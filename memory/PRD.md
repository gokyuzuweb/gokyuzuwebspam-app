# GökyüzüWebSpam · PRD (Feb 2026)

## Implemented (cumulative)
- Master/Customer split + cookie session + master unlock button
- Modern Publish Success Modal (confetti + animated)
- Mail Detail Viewer tabbed drawer (Özet/Gövde/HTML/Başlıklar/Ekler/Motorlar/SA + Mark Spam + **AI Açıklama**)
- Top Suspicious IPs → LiveMailEvents drilldown
- SMTP Relay & Test Mail (10 provider presets)
- Compliance PDF + Alerts Timeline BarChart + Reseller Branding
- Mobile Bayi View + Push permission button
- Reseller Portal Management (login audit, CRUD, create, reset password w/ email, activation)
- Users page WHM/DEMO badges + purge, Quarantine `_DEMO_DOMAINS` purge
- Engines dedupe, WHM daemon `/users/sync` + `/quarantine-sync`
- Reseller Activity LineChart (7/30/90d), Idle badge, Reminder mail
- Master Onboarding Wizard (4-step, animated progress)
- PWA Push client-side (Notification API + service worker)
- Auto-suspend cron + `AdminOperationsCard`
- Analytics CSV Export (Excel BOM, per-bayi aggregates)
- **This turn**:
  - **AI Karantina Öneri Motoru**: `POST /api/ai/explain-spam` uses `emergentintegrations` LlmChat with `claude-sonnet-4-6`. Turkish 2-3-sentence explanation of why a mail was flagged. Cached in `ai_explanations` collection keyed on (sender|subject|verdict|score). MailEventDetail's Özet tab now shows an "AI Açıklama" panel with a "Neden Spam?" / "Bu mail hakkında" button that lazy-loads the explanation.
  - **VAPID Web Push COMPLETE**: `pywebpush 2.3.0` + `py-vapid 1.9.4` installed. VAPID key pair generated and stored in `.env` as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_B64`, `VAPID_SUBJECT`. New endpoints: `POST /api/push/send` (master-only, VAPID-signed), auto-cleanup of expired subscriptions (410/404). Client `push.js` extended: on `requestPermission()` grant, also calls `pushManager.subscribe()` with the VAPID public key and POSTs `/api/push/subscribe`. Full end-to-end real Web Push ready.
  - **Bayi Aktivite IP/UA Breakdown**: `GET /api/admin/resellers/{rid}/activity-breakdown` returns per-IP success/fail counts + last_at + browser/device family aggregation. ActivityChartModal now shows two side-by-side panels below the line chart: IP dağılımı with per-IP success/fail progress bar, and Tarayıcı/Cihaz with per-family count + percentage.
  - **DEFERRED**: Master Setup Wizard inline mini-wizards (would require in-place SMTP/branding forms inside the onboarding kart — each step still routes to its dedicated page for now; the routing UX is fine).

## New endpoints (this turn)
- `POST /api/ai/explain-spam` — LLM explanation (Claude Sonnet 4.6)
- `POST /api/push/send` — server-side Web Push send
- `GET  /api/admin/resellers/{rid}/activity-breakdown` — IP + UA aggregation

## Backlog
- 🟡 Master Setup Wizard inline mini-wizards (SMTP preset picker, branding preview, Stripe key form — all embedded in the Onboarding card without navigation)
- 🟡 AI explanation: batch pre-generate for all high_spam events on ingest so they're instant to view
- 🟡 Push Send UI: add "Test Push Gönder" button in AdminOperationsCard so master can verify subscribers
- 🟡 Full frontend regression pass via testing agent

## Key files (this turn)
- `/app/backend/server.py` — /ai/explain-spam, /push/send, /admin/resellers/{rid}/activity-breakdown
- `/app/backend/requirements.txt` — pywebpush, py-vapid, http-ece
- `/app/backend/.env` — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY_B64, VAPID_SUBJECT
- `/app/frontend/src/components/MailEventDetail.js` — Özet + AIExplainPanel
- `/app/frontend/src/components/ResellerAdminPanel.js` — IP/UA breakdown in ActivityChartModal
- `/app/frontend/src/lib/push.js` — VAPID subscribe wiring
- `/app/frontend/src/lib/api.js` — 3 new methods

## Test credentials
See `/app/memory/test_credentials.md`.
