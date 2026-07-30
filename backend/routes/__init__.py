"""
GökyüzüWebSpam backend route modules.

Modules extracted from monolithic server.py during v1.4 refactor:
  - analytics.py     : MRR / ARR / churn / LTV analytics (seller-only)
  - plugin.py        : Plugin tarball download + install-info
  - reseller.py      : Reseller sub-account management + JWT auth
  - license_client.py: Client for remote license server

Rest of endpoints (mail scanning, quarantine, engines, notifications,
settings, licensing core, checkout, ai/rules, i18n) remain in server.py
and will be gradually migrated. Import routers here and include in server.py:

    from backend.routes.analytics import router as analytics_router
    app.include_router(analytics_router, prefix="/api")
"""
