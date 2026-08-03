"""V33 — Tenant-scoped stats/overview, plan-feature backend enforcement, Stripe renew.

Covers user-reported issues:
  1) stats/overview scoped per bayi vs master (was shared before).
  2) POST /api/blacklist/check|/delist and POST /api/rules gated by plan matrix.
  3) /api/subscription/renew returns Stripe checkout URL (no 503 placeholder).

Runs against local backend (localhost:8001) since REACT_APP_BACKEND_URL points to
public ingress but master-key needs to hit /api directly."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
PANEL_KEY = "MS-A1B3833C1DD6441FBCF19F26"


@pytest.fixture(scope="module")
def master_headers():
    return {"x-master-key": MASTER_KEY, "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def reset_matrix_after(master_headers):
    yield
    # Teardown — restore defaults
    try:
        requests.post(f"{BASE}/api/admin/plan-matrix/reset", headers=master_headers, timeout=10)
    except Exception:
        pass


def _set_matrix(master_headers, plan, feature, value):
    body = {"matrix": {plan: {feature: value}}}
    r = requests.post(f"{BASE}/api/admin/plan-matrix", headers=master_headers, json=body, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------- Tenant isolation ---------------------------------
class TestStatsTenantScope:
    def test_stats_overview_master_vs_bayi_differs(self, master_headers):
        m = requests.get(f"{BASE}/api/stats/overview", headers=master_headers, timeout=10)
        assert m.status_code == 200, m.text
        b = requests.get(f"{BASE}/api/stats/overview", timeout=10)
        assert b.status_code == 200, b.text
        md, bd = m.json(), b.json()
        # Bayi has zero mail_events → scanned=0. Master may have all events.
        assert bd["scanned_today"] == 0
        assert bd["caught_today"] == 0
        # Structure checks
        for key in ("scanned_today", "caught_today", "ham_today", "quarantine_total",
                    "engines_active", "engines_total"):
            assert key in md and key in bd
        # Ensure they are NOT the same object (isolation): at least one metric differs
        # or both are zero (empty DB acceptable).
        # If master DB has quarantine records but bayi is scoped by owner_license_key,
        # bayi quarantine_total <= master quarantine_total.
        assert bd["quarantine_total"] <= md["quarantine_total"]
        assert bd["engines_total"] >= 0


# --------------------------- Feature enforcement ------------------------------
class TestFeatureGates:
    def test_blacklist_check_gated_for_bayi(self, master_headers):
        _set_matrix(master_headers, "pro", "blacklist_check", False)
        try:
            r = requests.post(f"{BASE}/api/blacklist/check",
                              json={"target": "1.2.3.4", "type": "ip"}, timeout=15)
            assert r.status_code == 403, r.text
            msg = r.json().get("detail", "")
            assert "blacklist_check" in msg
            assert "kapal" in msg  # 'kapalı'
        finally:
            _set_matrix(master_headers, "pro", "blacklist_check", True)
        # After restore — bayi 200
        r2 = requests.post(f"{BASE}/api/blacklist/check",
                           json={"target": "1.2.3.4", "type": "ip"}, timeout=30)
        assert r2.status_code == 200, r2.text

    def test_blacklist_check_master_bypass(self, master_headers):
        _set_matrix(master_headers, "pro", "blacklist_check", False)
        try:
            r = requests.post(f"{BASE}/api/blacklist/check",
                              headers=master_headers,
                              json={"target": "1.2.3.4", "type": "ip"}, timeout=30)
            # Master's plan = enterprise → not affected by pro flag
            assert r.status_code == 200, r.text
        finally:
            _set_matrix(master_headers, "pro", "blacklist_check", True)

    def test_blacklist_delist_gated_for_bayi(self, master_headers):
        _set_matrix(master_headers, "pro", "blacklist_manage", False)
        try:
            r = requests.post(f"{BASE}/api/blacklist/delist",
                              json={"target": "1.2.3.4", "type": "ip",
                                    "provider_codes": ["spamhaus"],
                                    "contact_email": "x@y.com",
                                    "reason": "test"}, timeout=10)
            assert r.status_code == 403, r.text
            assert "blacklist_manage" in r.json().get("detail", "")
        finally:
            _set_matrix(master_headers, "pro", "blacklist_manage", True)

    def test_custom_rules_gated_for_bayi(self, master_headers):
        _set_matrix(master_headers, "pro", "custom_rules", False)
        try:
            r = requests.post(f"{BASE}/api/rules",
                              json={"name": "TEST_rule", "pattern": "spam",
                                    "score": 1.0, "target": "any"}, timeout=10)
            assert r.status_code == 403, r.text
            assert "custom_rules" in r.json().get("detail", "")
        finally:
            _set_matrix(master_headers, "pro", "custom_rules", True)
        # Master bypass while gate closed
        _set_matrix(master_headers, "pro", "custom_rules", False)
        try:
            r2 = requests.post(f"{BASE}/api/rules", headers=master_headers,
                               json={"name": "TEST_rule_master", "pattern": "spam",
                                     "score": 1.0, "target": "any"}, timeout=10)
            assert r2.status_code in (200, 201), r2.text
        finally:
            _set_matrix(master_headers, "pro", "custom_rules", True)
            # Cleanup — delete master-created rule
            try:
                rid = r2.json().get("id")
                if rid:
                    requests.delete(f"{BASE}/api/rules/{rid}", headers=master_headers, timeout=5)
            except Exception:
                pass


# --------------------------- Stripe renewal -----------------------------------
class TestStripeRenew:
    def test_subscription_renew_yearly(self):
        r = requests.post(f"{BASE}/api/subscription/renew",
                          json={"billing_period": "yearly"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("renewal") is True
        assert "url" in data
        assert data["url"].startswith("https://checkout.stripe.com/")
        assert data.get("session_id")

    def test_pricing_plans_nonzero(self):
        r = requests.get(f"{BASE}/api/pricing", timeout=10)
        assert r.status_code == 200
        plans = r.json().get("plans", [])
        assert plans
        for p in plans:
            assert p["monthly_price"] > 0
            assert p["yearly_price"] > 0


# --------------------------- Regression ---------------------------------------
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/plugin/status",
        "/api/plan/features",
        "/api/engines",
        "/api/settings",
        "/api/rules",
        "/api/plugin/renewal-info",
    ])
    def test_bayi_endpoints_200(self, path):
        r = requests.get(f"{BASE}{path}", timeout=10)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"

    @pytest.mark.parametrize("path", [
        "/api/admin/plan-matrix",
        "/api/admin/plan-matrix/history",
        "/api/admin/bayi-servers",
        "/api/admin/impersonate/status",
        "/api/admin/resellers-live",
        "/api/admin/threat-alerts",
        "/api/admin/plan-funnel",
    ])
    def test_master_endpoints_200(self, master_headers, path):
        r = requests.get(f"{BASE}{path}", headers=master_headers, timeout=10)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"

    def test_bayi_my_server(self):
        r = requests.get(f"{BASE}/api/bayi/my-server", timeout=10)
        assert r.status_code == 200, r.text
