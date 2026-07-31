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
│   ├── server.py                 # Main entry · MongoDB · crons (auto_suspend + weekly report + hourly self-training)
│   ├── deps.py                   # shared client/db/require_master
│   ├── routes/                   # modular routers
│   │   ├── queue.py              # Exim queue (list/stats/bulk×6/audit)
│   │   ├── security_adv.py       # Exploit + Attack Map + IP drilldown + Country brute-force + catalog
│   │   ├── mailscanner.py        # Config/Stats/Rules/Bayes/Policy/URL/BEC/Sandbox/Reputation/SIEM/AI-Analyze/AI-Self-Training
│   │   └── (existing) analytics/plugin/reseller/license_client/invoices/events(+AI prewarm)/alerts/insights
├── frontend/
│   ├── public/geo/countries-110m.json  # Bundled TopoJSON (no CDN)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.js        # REDESIGNED · animated gradient orbs + live-stat hero + feature chips
│   │   │   ├── Dashboard.js      # 7 tabs (Genel Bakış · Coğrafi · Trafik · Karantina · Sağlık · Canlı · Tümü)
│   │   │   ├── Security.js       # 11-module overview + Exploit + BEC + Sandbox + Reputation + Coğrafi
│   │   │   ├── MailScanner.js    # 7 tabs (Config/Stats/Rules/Bayes/Policy/URL/AI Öğrenme) + AI Analyze
│   │   │   └── Docs.js           # NEW · Modül Dokümantasyonu (9 modül card + detay drawer + SVG preview)
│   │   └── components/
│   │       ├── AttackMap.js      # react-simple-maps + hover tooltip (IP/from/to/country/verdict)
│   │       ├── ControlBar.js     # 6 gradient stat cards
│   │       ├── QueueModal.js     # Exim queue viewer + 6 bulk actions
│   │       ├── IpDrilldownDrawer.js  # right-side mail traffic drawer
│   │       └── CountryBlockCard.js  # 4 tabs (list/picker/time/brute)
│   └── src/lib/api.js            # +40 API methods
└── whm-plugin/scripts/           # Perl heartbeat + milter + logtail + quarantine-prune
```

## Completed (Feb 2026 · v18-v19)
- Feb: Queue Modal + Exim bulk-action wrapper (real subprocess when available)
- Feb: Attack Map with react-simple-maps + rich hover tooltip (IP + traffic)
- Feb: IP Drilldown Drawer
- Feb: Advanced Control Bar (6 gradient cards)
- Feb: Country Blocking upgraded — 113-country catalog + time-based scheduling + brute-force auto-block with TTL
- Feb: `/panel/security` — 11-module overview + Exploit Scanner + BEC + Sandbox + Reputation + Coğrafi
- Feb: `/panel/mailscanner` — Config/Stats/Rules/Bayes/UserPolicy/URL/AI-Learning tabs + AI System Analyze
- Feb: **AI Self-Training** — hourly cron feeds Bayes + LLM rule suggestions (user-approved apply)
- Feb: AI Batch Prewarm on `high_spam` ingest → cached
- Feb: Weekly AI Report Cron (Pazartesi 07:00 UTC)
- Feb: BEC/impersonation + URL rewrite + Sandbox queue + Reputation + SIEM (CEF/LEEF/JSON)
- Feb: Dashboard 7-tabbed
- Feb: **Landing redesign** — animated gradient orbs + live-stat hero (real /api/overview data) + feature chip row
- Feb: **`/panel/docs` Modül Dokümantasyonu** — 9 module cards + detail drawer + SVG previews + search/category filter
- Feb: **Offline TopoJSON** — `/public/geo/countries-110m.json` bundled locally, no CDN
- Feb: **Live Mail Traffic bug fixed** — `events` endpoint sorts by `ingested_at` not `ts`, verdict filter now server-side (spam/virus events now visible)

## Backlog (P1/P2)
- P1 · Weekly Report actual email delivery (currently stored-only; needs SMTP or Resend)
- P1 · Real Exim daemon verification on live WHM server
- P2 · Sandbox VM detonation runner
- P2 · MaxMind GeoIP DB (replace /8 prefix map)
- P2 · Reseller-scoped AI usage quota tracking
- P2 · Interactive video walkthroughs in Docs
