# GökyüzüWebSpam · PRD

## Product Summary
Turkish WHM/cPanel mail spam SaaS. React 19 + FastAPI + MongoDB. IP-based licensing,
Stripe (Emergent test key), reseller white-labeling, live mail streaming, alerts engine,
quarantine, compliance PDF, Emergent LLM Key (Claude Sonnet 4.6), VAPID push.

## Test Credentials
See `/app/memory/test_credentials.md`.

## Architecture
```
/app/
├── backend/
│   ├── server.py                 # + weekly mail delivery + SMTP test endpoint
│   ├── uploads/docs/             # NEW · Docs media files (GIF/PNG/MP4)
│   ├── routes/
│   │   ├── queue.py · security_adv.py
│   │   ├── mailscanner.py        # + docs media upload/list/get/delete + AI auto-actions config
│   │   └── events.py             # _ai_predict_bg → auto-quarantine hook when config allows
├── frontend/
│   ├── public/geo/countries-110m.json
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.js        # + Testimonials + case studies
│   │   │   ├── Dashboard.js      # 7 tabs
│   │   │   ├── Security.js
│   │   │   ├── MailScanner.js    # + AI Auto-Actions (Config tab: auto-quarantine + rule auto-apply)
│   │   │   └── Docs.js           # + MediaGallery (user upload GIF/video/PNG per module)
│   └── src/lib/api.js
```

## Completed
- v18/19 (Feb): Queue Modal, Attack Map, Country Blocking 113 ülke, MailScanner independent, Docs page, Landing redesign, Offline TopoJSON
- v20 (Feb): AI Predict Score, AI Docs Narration, Weekly Mail Delivery, Docs animated walkthrough, Landing Testimonials
- v21 (Feb):
  - **Docs Media Upload** — `/api/mailscanner/docs/media` POST/GET/LIST/DELETE endpoints; frontend `MediaGallery` per module with file picker (GIF/PNG/JPEG/WEBP/MP4/WEBM, max 20MB); base64 upload
  - **AI Predict Auto-Quarantine** — MailScanner config `ai_auto_quarantine` (enabled + threshold + action=quarantine/tag/reject); `_ai_predict_bg` in events.py auto-overrides verdict when config allows
  - **AI Rule Auto-Apply** — MailScanner config `ai_rule_auto_apply` (enabled + min_score); `_suggest_rule` cron auto-inserts rule when LLM suggestion score ≥ threshold
  - Frontend MailScanner Config tab: new "🤖 AI OTOMATİK AKSİYONLAR" section with 2 side-by-side cards

## Backlog (P1/P2)
- P1 · Real Exim daemon verification on live WHM
- P1 · Predict Score + LLM hybrid ingest-time (currently heuristic-only auto-quarantine; LLM hybrid via ?use_llm=true still opt-in)
- P2 · Sandbox VM detonation runner
- P2 · MaxMind GeoIP DB
- P2 · Reseller AI usage quota
- P2 · SMTP UI wizard in Settings (currently API-only for weekly reports)
