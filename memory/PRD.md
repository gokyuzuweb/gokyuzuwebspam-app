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
│   ├── server.py                 # Main · crons (auto_suspend + weekly report + hourly self-training)
│   │                             # + SMTP-based weekly mail delivery helper
│   ├── deps.py
│   ├── routes/
│   │   ├── queue.py              # Exim queue mgmt
│   │   ├── security_adv.py       # Exploit + Attack Map + IP drilldown + Country brute-force
│   │   ├── mailscanner.py        # 25+ endpoints: Config/Stats/Rules/Bayes/Policy/URL/BEC/Sandbox
│   │   │                         # /Reputation/SIEM/AI-Analyze/Self-Training/Predict-Score/Docs-Narrate
│   │   └── events.py             # + _ai_prewarm + _ai_predict_bg (async heuristic score)
├── frontend/
│   ├── public/geo/countries-110m.json  # Local TopoJSON
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.js        # + Testimonials section + case studies
│   │   │   ├── Dashboard.js      # 7-tabbed
│   │   │   ├── Security.js
│   │   │   ├── MailScanner.js    # 7 tabs (last: AI Öğrenme)
│   │   │   └── Docs.js           # + AnimatedWalkthrough (30sn scenes) + AiNarration (Claude+TTS)
│   │   └── components/
│   │       ├── AttackMap.js · ControlBar · QueueModal · IpDrilldownDrawer · CountryBlockCard
│   └── src/lib/api.js            # +45 API methods
```

## Completed
- v18 (Feb): Queue Modal, Attack Map, IP Drilldown, Control Bar, Country Blocking (113 ülke + time + brute-force), Security page 11 modules, MailScanner independent module, AI Batch Prewarm, Weekly Report Cron
- v19 (Feb): AI Self-Training (hourly), Docs page, Landing redesign, Offline TopoJSON, Live Traffic bug fix (ingested_at sort + server-side verdict filter)
- v20 (Feb): 
  - **AI Predict Score** — `/api/mailscanner/ai/predict-score` (heuristic <5ms + optional LLM hybrid). Auto-runs on every ingest → `predicted_score`, `predicted_verdict`, `predicted_reasons` on mail_events
  - **AI Docs Narration** — `/api/mailscanner/ai/docs-narrate` returns Turkish narration; frontend typewriter + browser SpeechSynthesis "Sesli Oku"
  - **Docs Animated Walkthrough** — 30sn per-module scene player (3 keyframe animations) in drawer
  - **Landing Testimonials + Case Studies** — 3 case-study cards (E-Ticaret / Fintech / Üniversite) + 3 quoted testimonials
  - **Weekly Mail Delivery** — reuses existing db.settings SMTP config; `/api/settings/smtp/test-weekly` endpoint (master only); auto-sends on Monday cron; falls back gracefully

## Backlog (P1/P2)
- P1 · SMTP UI wizard in Settings page (currently API-only)
- P1 · Real Exim daemon on live WHM (backend already tries real subprocess)
- P2 · Sandbox VM detonation runner
- P2 · MaxMind GeoIP DB
- P2 · Reseller AI usage quota
- P2 · Actual GIF/video recordings in Docs (currently CSS+SVG scenes)
