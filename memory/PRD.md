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

## Master / Customer split (pending — next priority)
- **Master** = server IP `89.19.15.58` (gokyuzuhosting.com) **AND** license key bound to that IP (Enterprise `MS-C02AB012652A4FE692D69676`)
- **Customer** = anything else. Hides License Management, Pricing edit, MRR panel, Version publish
- Version `download_url` scheme (dual): `https://gokyuzuhosting.com/dist/gokyuzuwebspam-X.Y.Z.tar.gz` AND `http://89.19.15.58/dist/gokyuzuwebspam-X.Y.Z.tar.gz`
- "Yeni Sürüm Yayınla" auto-detects master server's installed version and publishes it
- Modern success screen for "Güncelle" (animated toast/modal, not plain alert)

## Implemented (Feb 2026)
- **Licenses UI**: Edit pencil restored + more visible (bordered pill w/ hover)
- **Compliance PDF export**: printable HTML with logo, KVKK note, signature lines, `window.print()`
- **Alerts Timeline**: 7-day stacked BarChart (Recharts) with per-rule breakdown
- **Reseller Branding UI**: form (name, logo URL, primary/accent) + live preview + `useBranding()` hook + `gws.branding.changed` event
- **SMTP Relay + Test Mail**:
  - Backend: `_smtp_settings`, `_send_via_smtp` (smtplib in `asyncio.to_thread`), `_send_email` tries SMTP → fallback to local sendmail
  - Endpoints: `GET/PUT /api/settings/smtp`, `POST /api/mail/test`
  - Frontend: `SmtpSettings` component with 10 provider presets, masked password, live Test Mail Gönder button, mounted at top of `/panel/notifications`

## Backlog (P0/P1)
- 🔴 P0 Master/Customer access control (IP + license key both required)
- 🔴 P0 Sidebar gating: hide License Management, Pricing, Version publish for customers
- 🔴 P0 Modern update success UI (replace plain alerts) + auto-fetch master server version on publish
- 🟠 P1 Reseller header/sidebar consuming branding from `useBranding()`
- 🟠 P1 Advanced Health Score sub-metrics per server
- 🟡 P2 Full-page onboarding wizard for first-time SMTP setup

## Endpoints (this session)
- `GET /api/settings/smtp` – masked config
- `PUT /api/settings/smtp` – upsert (password preserved when masked)
- `POST /api/mail/test` `{to, subject?, body?}` – real send
- `GET /api/reseller/branding` / `PUT`
- `GET /api/alerts/timeline`
- `GET /api/events/compliance-snapshot`

## Key files
- `/app/backend/server.py` — `_send_email`, `_send_via_smtp`, `_smtp_settings`, `/mail/test`, `/settings/smtp`
- `/app/backend/routes/insights.py` — branding, timeline, compliance
- `/app/backend/routes/alerts.py` — rules engine, test-webhook
- `/app/frontend/src/components/SmtpSettings.js` (new)
- `/app/frontend/src/components/BrandingSettings.js` (new)
- `/app/frontend/src/components/ComplianceSnapshot.js` — PDF added
- `/app/frontend/src/pages/AlertsRules.js` — timeline chart added
- `/app/frontend/src/pages/Notifications.js` — SmtpSettings mounted
- `/app/frontend/src/pages/Reseller.js` — BrandingSettings mounted, `useBranding()`
- `/app/frontend/src/pages/Licenses.js` — pencil button visibility fix
