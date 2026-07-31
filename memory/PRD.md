# GökyüzüWebSpam · PRD

## Product Summary
Turkish WHM/cPanel mail spam SaaS. React 19 + FastAPI + MongoDB. Modern global threat
intelligence + AI-powered auto-actions + compliance auto-detection.

## Architecture (v23)
- Backend routes: queue, security_adv, mailscanner (30+ endpoints), threat_intel, events
- Frontend pages: Dashboard (7-tab), Security, MailScanner, ThreatIntel, Docs, Landing
- AI hooks: predict-score on ingest, prewarm on high_spam, hourly self-training, weekly report

## v23 Global Feeds + Compliance Auto-Detection (Feb 2026)
- **Real URLhaus fetch** — `urlhaus.abuse.ch/downloads/json_recent/` (auth-free) → 20 URLs per sync into `threat_iocs` with 14-day TTL
- **Real Spamhaus ZEN DNS** — top-30 recent spam IPs reverse-queried against `zen.spamhaus.org`; matched IPs auto-added as IOC with 95% confidence
- **Compliance Auto-Detection** — 11 items auto-verified from system state:
  - `kvkk.audit_logs` / `soc2.access_logs` / `hipaa.audit_trail` → checks alerts_fired + queue_audit collections
  - `kvkk.data_encryption` / `hipaa.phi_encryption` → MongoDB TLS = True
  - `kvkk.data_retention` → checks mailscanner_config.quarantine_ttl_days
  - `kvkk.data_export` / `gdpr.data_export` / `gdpr.right_to_erasure` → endpoints exist
  - `gdpr.cookie_consent` → FE banner
  - `soc2.backup_daily` → checks db.settings backup enabled
  - `soc2.mfa_required` → checks users.mfa_enabled admins
- Frontend: `AUTO` green badges next to auto-detected items + "N item sistem tarafından otomatik doğrulandı" header pill

## Completed (all versions)
- v18-v22: Queue Modal · Attack Map · Country Blocking (113) · MailScanner Independent · Security · Docs · Landing · TopoJSON · AI Self-Training · Predict Score · Docs Narration · Testimonials · Weekly Mail · Docs Media Upload · Auto-Quarantine · Rule Auto-Apply · Threat Intel (IOC + DMARC + Feeds + Compliance)

## Backlog (P2)
- Reseller AI usage quota
- IOC → mail_events auto-block enforcement (ingest-time IP/URL check)
- DMARC XML parser (mail-based rua= receiver)
- Sandbox VM detonation runner
- MaxMind GeoIP DB replacement
- Docs Media drag-drop ordering + hero banner
