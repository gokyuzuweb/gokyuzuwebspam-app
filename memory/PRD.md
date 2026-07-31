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

## Master / Customer split (implemented Feb 2026)
- **Master** = HTTP `X-Forwarded-For` chain contains `89.19.15.58` **AND** the browser sends a license key that is the master's (either `MASTER_LICENSE_KEY` env or a license bound to master IP).
- **Customer** view hides: License Management, Pricing (both `sellerOnly`+`masterOnly` gated), Version Publish card, MRR panel.
- Backend authoritative gate `_require_master()` enforces on all mutating endpoints (POST /version/publish).
- Frontend UI-only gate via `useIsMaster()` hook and role strip in Sidebar footer.

## Implemented (Feb 2026)
- **Licenses UI**: Edit pencil restored + more visible (bordered pill w/ hover)
- **Compliance PDF export**: printable HTML with logo, KVKK note, signature lines, `window.print()`
- **Alerts Timeline**: 7-day stacked BarChart (Recharts) with per-rule breakdown
- **Reseller Branding UI**: form (name, logo URL, primary/accent) + live preview + `useBranding()` hook + broadcast event; header/logo now consumes it in ResellerDashboard
- **SMTP Relay + Test Mail**:
  - Backend: `_smtp_settings`, `_send_via_smtp` (smtplib in `asyncio.to_thread`), `_send_email` tries SMTP → falls back to local sendmail
  - Endpoints: `GET/PUT /api/settings/smtp`, `POST /api/mail/test`
  - Frontend: `SmtpSettings` component with 10 presets, masked password, live Test Mail
- **Master / Customer Split**:
  - Env: `MASTER_IP`, `MASTER_HOST`, `MASTER_LICENSE_KEY`
  - Endpoint `GET /api/admin/whoami?license_key=X` (returns is_master, ip_match, key_match)
  - Endpoint `POST /api/version/publish` (master-only, auto-detects master's installed version from heartbeat, generates dual URLs `https://gokyuzuhosting.com/dist/...tar.gz` + `http://89.19.15.58/dist/...tar.gz`)
  - Frontend `useIsMaster()` + Sidebar `masterOnly` filter + Licenses page redirect for non-masters
- **Modern Publish Success Modal**:
  - Animated green checkmark with glow pulse
  - Falling confetti (24 pieces, random colors/timings)
  - Dual download URL rows with copy buttons
  - Affected clients count + release timestamp
  - Sonner toast in bottom-right
- **VersionPublishCard**:
  - "Kurulu Sürümü Yayınla" one-click auto-publish (uses master's heartbeat version)
  - "Manuel Yayın" for explicit version + custom changelog
  - IP/KEY badge pills
  - Dual URL display
- **Mail Detail Viewer** (NEW):
  - Extended MailEvent model: `body_preview`, `body_html`, `headers_full`, `attachments` (backward compat)
  - Endpoint `GET /api/events/{event_id}` returns full event
  - Endpoint `POST /api/events/{event_id}/mark-spam` (adds sender to blacklist + queues sa-learn)
  - Rewrote MailEventDetail with tabbed UI: Gövde / HTML (sanitized iframe) / Başlıklar / Ekler / Motorlar / SA Rapor
  - **Prominent red "Bu SPAM · Kara Listeye Ekle + Filtreye Öğret"** CTA at top for non-spam events
  - Attachment cards with malware highlight if `attachments[].malware` set
  - test-ingest now seeds body_preview, headers_full, attachments so demo shows the full flow
- **Top Suspicious IPs → LiveMailEvents drilldown**:
  - Bar chart onClick sets `?ip=X.X.X.X` in URL, dispatches popstate, scrolls to Live table
  - LiveMailEvents filters by IP (from_addr / server_ip / headers_full)
  - Red "filtre: X.X.X.X [temizle]" badge visible

## Backlog
- 🟡 P2 Reseller Sidebar (mobile) branding preview
- 🟡 P2 WHM plugin daemon extension to POST body_preview + attachments (currently only from test-ingest)
- 🟡 P2 Persist master detection over time (heartbeat-based, not per-request IP)
- 🟡 P2 First-time-setup wizard (SMTP + Reseller branding + first license)

## Endpoints
- `GET  /api/admin/whoami?license_key=X`
- `POST /api/version/publish`
- `GET  /api/settings/smtp` / `PUT` (masked password)
- `POST /api/mail/test`
- `GET  /api/reseller/branding` / `PUT`
- `GET  /api/alerts/timeline`
- `GET  /api/events/compliance-snapshot`
- `GET  /api/events/{event_id}`  — full detail with body/attachments
- `POST /api/events/{event_id}/mark-spam` — blacklist + sa-learn

## Key files
- `/app/backend/server.py` — `_send_email`, SMTP endpoints, whoami/publish, `_require_master`
- `/app/backend/routes/events.py` — MailEvent w/ body/attachments, `/events/{id}`, mark-spam
- `/app/backend/routes/insights.py`, `alerts.py` — insights, timeline, webhook test
- `/app/backend/.env` — `MASTER_IP`, `MASTER_HOST`, `MASTER_LICENSE_KEY`
- `/app/frontend/src/hooks/useIsMaster.js`
- `/app/frontend/src/components/VersionPublishCard.js` — Modern publish + success modal
- `/app/frontend/src/components/MailEventDetail.js` — Rewritten with tabs + Mark Spam
- `/app/frontend/src/components/SmtpSettings.js`, `BrandingSettings.js`
- `/app/frontend/src/pages/Dashboard.js` — Top IPs click drilldown
- `/app/frontend/src/pages/Licenses.js` — master gate + VersionPublishCard
- `/app/frontend/src/pages/Reseller.js` — header/logo branding injection

## Test credentials
- Master license key: `MS-C02AB012652A4FE692D69676` (in `/app/backend/.env` as `MASTER_LICENSE_KEY`)
- Access master by: (a) X-Forwarded-For contains `89.19.15.58` **and** (b) localStorage `gws.event_license` = master key
