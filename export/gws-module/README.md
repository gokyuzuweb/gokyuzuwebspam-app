# GökyüzüWebSpam Modülü — Portable Package
# =========================================
# Bu klasör, cyber-security-18 gibi başka bir Emergent projesine
# entegre edilmek üzere hazırlanmış tam-portable satış+lisans+admin modülüdür.
#
# gokyuzubilgisayar.com altında tüm işlemler:
#   • Landing:      gokyuzubilgisayar.com/gws
#   • Satış:        gokyuzubilgisayar.com/gws/shop
#   • Bayi:         gokyuzubilgisayar.com/gws/reseller
#   • Admin:        gokyuzubilgisayar.com/gws/admin
#   • Kurulum:      gokyuzubilgisayar.com/api/plugin/download
#   • Lisans API:   gokyuzubilgisayar.com/api/license-server/*
#   • Heartbeat:    gokyuzubilgisayar.com/api/plugin/verify-license
#
# Klasör yapısı:
#   backend/            → cyber-security-18/backend içine kopyalanacak
#     routes/           → APIRouter modülleri (analytics, plugin, reseller, invoices, license_client)
#     deps.py           → shared DB + env
#   frontend/           → cyber-security-18/frontend/src altına
#     pages/            → Shop, Reseller, Licenses, Pricing, Landing
#     components/       → MrrPanel, LicenseServerStatus, LicenseGate, Header, ui-primitives
#     i18n/             → 6-dil context (TR/EN/DE/FR/ES/AR)
#     lib/api.js        → axios client
#   license-server/     → Ayrı FastAPI process (opsiyonel)
#   deploy/             → Docker Compose (Redis + license cluster)
#   docs/               → INTEGRATION.md
#
# Kurulum: cyber-security-18 agent'a docs/AGENT_PROMPT.md içeriğini yapıştırın.
