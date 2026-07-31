# GökyüzüWebSpam · PRD (Feb 2026)

## Implemented (cumulative - all working)
- Master/Customer split (relaxed: key alone suffices) + Master Session Cookie + Master Unlock button
- Modern Publish Success Modal (confetti + animated) + VersionPublishCard
- **Mail Detail Viewer** tabbed drawer (Özet / Gövde / HTML / Başlıklar / Ekler / Motorlar / SA) with **Mark Spam** + **NEW: "Bu SPAM Değil · Whitelist" button** + **AI Açıklama** panel (Claude Sonnet 4.6)
- Top Suspicious IPs → LiveMailEvents drilldown (URL filter)
- SMTP Relay & Test Mail (10 provider presets)
- Compliance PDF + Alerts Timeline BarChart + Reseller Branding UI + Reseller header injection
- Mobile Bayi View + Push permission button
- Reseller Portal Management (login audit + CRUD + create + password reset with email + activation + activity chart + IP/UA breakdown)
- Users page WHM/DEMO badges + purge, Quarantine `_DEMO_DOMAINS` + purge
- Engines dedupe (24→6), WHM daemon `/users/sync` + `/quarantine-sync`
- Idle bayi rozeti + reminder mail
- Master Onboarding Wizard (4-step, animated progress)
- PWA Push (client-side Notification API + service worker) + **VAPID Web Push COMPLETE** (pywebpush + real Web Push send)
- Auto-suspend cron + Analytics CSV Export (Excel BOM)
- **This turn**:
  - **[A] 🌍 Ülke Bazlı Engelleme**: `POST /api/security/country-rules` collection + UI card in AdminOperationsCard. Master adds/removes ISO-2 country codes with block/allow action. Chip UI with 🗑 delete per country.
  - **[B] ✅ "Bu SPAM Değil" Whitelist**: `POST /api/security/whitelist-from-event` — flips verdict to `whitelisted`, adds sender to `lists.whitelist`, removes from blacklist, queues `release` quarantine action. MailEventDetail now shows a green "Bu SPAM Değil · Otomatik Whitelist + Serbest Bırak" button when event is spam.
  - **[C] 🔔 Push Send Test**: `POST /api/push/send-test` (master-only) — sends VAPID push to ALL subscribers. AdminOperationsCard has a "Test Push Gönder" button; toast reports how many bayis received the notification (or hint if none subscribed).

## New endpoints (this turn)
- `GET/POST /api/security/country-rules` + `DELETE /api/security/country-rules/{code}`
- `POST /api/security/whitelist-from-event?event_id=X&license_key=Y`
- `POST /api/push/send-test`

## DEFERRED (asked to but not done this turn — context budget)
- 🟡 AI Explain Batch Pre-generate (background LLM on high_spam ingest)
- 🟡 AI Weekly Report (Monday cron → LLM summary → master email)
- 🟡 Master Setup Wizard Inline Mini-Forms (SMTP preset picker, brand preview inside kart)
- 🟡 ConfigServer MailScanner FE (dedicated `/panel/mailscanner` module page)
- 🟡 Exploit Scanner module (Perl daemon + `/panel/security` page)

## Key files (this turn)
- `/app/backend/server.py` — 3 new endpoint groups (country, whitelist-from-event, push-send-test)
- `/app/frontend/src/components/MailEventDetail.js` — NotSpam button
- `/app/frontend/src/components/AdminOperationsCard.js` — Country rules + Push test cards
- `/app/frontend/src/lib/api.js` — 5 new methods

## Test credentials
See `/app/memory/test_credentials.md`.
