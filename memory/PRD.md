# GökyüzüWebSpam · PRD

## Product
Multi-module WHM/cPanel mail-security SaaS with a React/FastAPI panel, WHM plugin, cPanel CGI proxy and a standalone License Server. IP-based licensing, reseller scoping, checkout, full i18n.

## Personas
1. **Master admin** — publishes versions, manages MRR/licenses (gokyuzuhosting.com, IP 89.19.15.58).
2. **Reseller** — resells scoped licenses; sees their sub-accounts only.
3. **Customer** — hosting/agency operator running the WHM plugin.

## Core Requirements (Delivered)
- WHM plugin + systemd heartbeat + cPanel CGI proxy
- Live mail traffic streaming (milter → SaaS)
- Alert Rules Engine (webhooks)
- Exploit / Webshell scanner (Perl daemon + backend)
- Independent MailScanner module + AI Auto-Actions
- Global Threat Intelligence (URLhaus / Spamhaus real feeds, IOC store, DMARC agg, Compliance auto-detect)
- AI Predict Score (50ms real-time)
- AI Weekly Report cron + SMTP delivery
- Docs Drawer: persistent AI Chat + walkthrough videos + media uploads
- Country blocking + time-based rules + brute-force auto-block
- Offline TopoJSON attack map
- **v19 (Feb 2026)**: 14 RBLs + delisting, Mail Health (MX/SPF/DKIM/DMARC/PTR), Update Server, PayTR + Havale/EFT, Landing ModulesShowcase, DB usage + selective cleanup, IP block from mail detail, Turkish char fixes, PHP bridge for gokyuzubilgisayar.com
- **v20 (Feb 2026)**: Payments Admin panel (approve/reject havale + inbox), Monthly auto-cleanup cron with email report (archive/delete), Geo Blocked-IP heatmap on Landing + Trust Dashboard, "Havale Yaptım" user notify flow, Trust Center Dashboard tab in Security
- **v21 (Feb 2026)**: Sidebar live badge (pending havale count · animate-pulse), 30-day Trust Score trend line chart with delta/avg/min/max, Country detail modal on Landing map (click bubble/row → IP list + timestamps), Enhanced auto-cleanup email with 30-day trend + top 10 spam source countries

## Payment Integration
- **PayTR iFrame API** — kartla ödeme (mock mode when merchant keys unset)
- **Havale/EFT** — IBAN + reference, admin manual approval
- Old Stripe integration still functional as fallback

## PHP Bridge
Located at `/app/php-bridge/`: `gws-bridge.php` cURL client + 3 example pages (mail-health, RBL check, checkout). Alternative iframe embed documented.

## DB Maintenance
- Two-tier collection categorization: DATA_COLS (deletable) vs SETTINGS_COLS (preserved)
- `POST /api/maintenance/cleanup` requires `confirm='DELETE_DATA'`
- UI (`/panel/maintenance`) requires typing `SIL` before enabling delete button
- Filtering: `older_than_days` optional
- Audit trail in `maintenance_log`

## Nav Structure
Home / Dashboard / MailScanner / Mail Sağlık / Tehdit Zekası / Güvenlik / Quarantine / Whitelist·Blacklist / RBL Delisting / Rules / Engines / Outbound Mail / Notifications / Alert Rules / Reports / Users / Logs / Settings / **DB Bakım** / Installation Guide / Docs

## Backlog (P1/P2)
- P1: PayTR live merchant provisioning UI + admin havale approval dashboard
- P1: Automatic monthly cleanup cron
- P2: Legacy mojibake purge (user-triggered from DB Bakım)
- P2: More sophisticated country geoIP (currently /8 prefix map)
- P2: Multi-tenant PHP bridge with per-license headers
