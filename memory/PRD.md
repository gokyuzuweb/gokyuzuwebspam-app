# GökyüzüWebSpam · PRD

## Product Summary
Turkish WHM/cPanel mail spam management SaaS with dual-mode architecture (seller/customer).
React 19 + FastAPI + MongoDB. IP-based licensing, Stripe (Emergent test key) checkout,
reseller white-labeling, live mail streaming, alerts engine, quarantine, compliance PDF,
Emergent LLM Key (Claude Sonnet 4.6) for AI features, VAPID push notifications.

## Test Credentials
See `/app/memory/test_credentials.md`.

## Architecture
```
/app/
├── backend/
│   ├── server.py                 # Main entry, MongoDB, crons, legacy routes, weekly AI report
│   ├── deps.py                   # shared client/db/require_master
│   ├── routes/                   # modular routers
│   │   ├── analytics.py, plugin.py, reseller.py, license_client.py
│   │   ├── invoices.py, events.py (+ AI prewarm hook), alerts.py, insights.py
│   │   ├── queue.py              # NEW · exim queue mgmt (list/stats/bulk/audit)
│   │   ├── security_adv.py       # NEW · exploit scanner + attack map + IP drilldown
│   │   │                         #        + country brute-force + country catalog
│   │   └── mailscanner.py        # NEW · independent MailScanner (config/stats/rules
│   │                             #        /bayes/policy/URL/BEC/sandbox/reputation/
│   │                             #        SIEM/AI analyze/modules overview)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.js      # REWRITTEN · 7-tab layout (Genel/Coğrafi/Trafik/…/Tümü)
│   │   │   ├── Security.js       # NEW · 10-module overview + Exploit/BEC/Sandbox/Reputation/Geo
│   │   │   ├── MailScanner.js    # NEW · Config/Stats/Rules/Bayes/Policy/URL + AI Analyze card
│   │   │   └── Dashboard, Quarantine, Licenses, Reseller, ... (existing)
│   │   ├── components/
│   │   │   ├── AttackMap.js      # NEW · react-simple-maps world map w/ hover tooltip
│   │   │   ├── ControlBar.js     # NEW · 6 colored gradient stat cards
│   │   │   ├── QueueModal.js     # NEW · Exim queue viewer w/ bulk actions
│   │   │   ├── IpDrilldownDrawer.js # NEW · right-side drawer with mail traffic
│   │   │   └── CountryBlockCard.js # REWRITTEN · 4 tabs (list/picker/time/brute)
│   │   └── lib/api.js            # +30 new API methods
├── whm-plugin/
```

## Completed (this session · 2026-02)
- Feb: Queue Modal + Exim bulk-action wrapper (mock fallback, real cmd support)
- Feb: Attack Map with react-simple-maps + tooltip showing IP/from/to/country
- Feb: IP Drilldown Drawer (bar-chart click → mail traffic)
- Feb: Advanced Control Bar (6 gradient cards, micro animations)
- Feb: Country Blocking upgraded — full 113-country catalog + time-based scheduling (active_hours/days) + brute-force auto-block with TTL
- Feb: Security page `/panel/security` — 11-module overview grid + Exploit Scanner + BEC tester + Sandbox + Reputation + Country tab
- Feb: MailScanner page `/panel/mailscanner` — Config/Stats/Rules/Bayes/UserPolicy/URL tabs + AI System Analyze (LLM report)
- Feb: 10 security modules: Antivirus/Spam-Phish/Sandbox/SPF-DKIM-DMARC/BEC/Quarantine/Outbound/URL/AI/SIEM
- Feb: AI Batch Prewarm on `high_spam` ingest → cached explanation
- Feb: Weekly AI Report Cron (Pazartesi 07:00 UTC)
- Feb: BEC/impersonation heuristic (Levenshtein lookalike + urgency)
- Feb: URL rewrite + time-of-click inspection
- Feb: Sandbox job queue + reputation heuristic + SIEM CEF/LEEF/JSON export
- Feb: Dashboard tabbed (Genel Bakış / Coğrafi / Trafik / Karantina / Sağlık / Canlı / Tümünü Göster)
- Feb: Sidebar nav for MailScanner + Güvenlik in Turkish

## Backlog (P1/P2)
- P1 · Landing / Home page redesign (user requested)
- P1 · Local TopoJSON bundle for AttackMap (offline safety)
- P1 · Real exim daemon integration on WHM (currently mock in preview)
- P2 · Sandbox VM detonation actual runner (currently queue-only)
- P2 · MaxMind GeoIP DB (replace /8 prefix map)
- P2 · Weekly Report mail delivery (currently only stored, not emailed)
- P2 · Reseller-scoped AI usage quota tracking
