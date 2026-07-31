# GökyüzüWebSpam · PRD

## Product Summary
Turkish WHM/cPanel mail spam SaaS. React 19 + FastAPI + MongoDB. IP-based licensing,
Stripe (Emergent test), reseller white-labeling, Emergent LLM Key (Claude Sonnet 4.6),
VAPID push. Modern global threat intelligence + AI-powered auto-actions.

## Architecture
```
/app/
├── backend/routes/
│   ├── queue.py · security_adv.py
│   ├── mailscanner.py (25+ endpoints)
│   ├── threat_intel.py           # NEW · IOC feed + DMARC + Global Feeds + Compliance
│   └── events.py (AI predict + prewarm)
├── frontend/src/pages/
│   ├── Dashboard · Security · MailScanner · Docs · Landing
│   └── ThreatIntel.js            # NEW · 4 tabs (IOC/DMARC/Feeds/Compliance)
```

## Completed
- v18/19/20/21 (Feb): Queue Modal · Attack Map · Country Blocking (113) · MailScanner Independent · Security Center · Docs · Landing Redesign · Offline TopoJSON · AI Self-Training · AI Predict Score · AI Docs Narration · Testimonials · Weekly Mail · Docs Media Upload · AI Auto-Quarantine · AI Rule Auto-Apply
- v22 (Feb): **Global Threat Intelligence Module**
  - IOC feed: IP/domain/URL/hash/email with tags (spam/phishing/malware/c2/ransomware), confidence 0-100, TTL auto-expire
  - DMARC aggregate reports: domain-based summary with SPF/DKIM/DMARC pass rates
  - Global Blocklist Sync: 6 feeds (Spamhaus/Barracuda/SORBS/UCEPROTECT/URLhaus/PhishTank) with mock sync
  - Compliance Center: 4 frameworks (KVKK/GDPR/HIPAA/SOC2) with weighted scoring + item toggles + auto-persistent state
  - Frontend `/panel/threat-intel` with 4 tabs + progress bars + colored score cards
  - Nav sidebar: "Tehdit Zekası" (Türkçe) with Globe icon

## Backlog (P1/P2)
- P1 · SMTP Weekly Recipient field in Settings UI
- P1 · Real Exim daemon verification on live WHM
- P2 · Sandbox VM detonation runner
- P2 · MaxMind GeoIP DB
- P2 · IOC → mail_events auto-block enforcement (currently list-only)
- P2 · DMARC XML parser endpoint (currently expects pre-parsed JSON)
- P2 · Docs Media drag-drop ordering + hero banner
