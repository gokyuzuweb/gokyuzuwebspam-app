"""v43.71 Plan Feature Guard + Tenant Isolation tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
BAYI_STARTER = "MS-TESTBAYI-STARTER-V4371"
BAYI_PRO = "MS-TESTBAYI-PRO-V4371"

NEW_V4371_KEYS = [
    "mailscanner", "mail_health", "live_diagnostic", "my_server",
    "docs_view", "whitelist_history", "marketplace", "bounce_digest",
    "notifications_view", "users_view",
]


@pytest.fixture(scope="session", autouse=True)
def ensure_bayi_licenses():
    """Ensure test bayi licenses exist in db.licenses; create via master API if missing."""
    # Ensure starter
    for lk, plan in [(BAYI_STARTER, "starter"), (BAYI_PRO, "pro")]:
        r = requests.get(f"{API}/plan/effective", headers={"X-Master-Key": lk}, timeout=10)
        if r.status_code == 200 and r.json().get("license_key") == lk:
            continue
        # Create via master admin endpoint if available
        try:
            requests.post(
                f"{API}/admin/licenses",
                headers={"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"},
                json={"license_key": lk, "plan": plan, "active": True,
                      "customer_email": f"{lk.lower()}@test.local",
                      "customer_name": f"Test {plan}"},
                timeout=10,
            )
        except Exception:
            pass
    yield
    # Reset plan matrix so tests do not pollute
    try:
        requests.post(f"{API}/admin/plan-matrix/reset",
                      headers={"X-Master-Key": MASTER_KEY}, timeout=10)
    except Exception:
        pass


class TestPlanEffective:
    def test_visitor_no_header_returns_starter(self):
        r = requests.get(f"{API}/plan/effective", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["plan"] == "starter"
        assert d["is_master"] is False
        assert d["impersonated"] is False
        assert d["features"]["dashboard"] is True
        assert d["features"]["custom_rules"] is False
        assert d["features"]["marketplace"] is False
        # schema
        for k in ("plan", "plan_label", "features", "next_plan",
                  "next_plan_features", "license_key", "impersonated", "is_master"):
            assert k in d, f"missing key {k}"

    def test_master_key_returns_enterprise(self):
        r = requests.get(f"{API}/plan/effective",
                         headers={"X-Master-Key": MASTER_KEY}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["plan"] == "enterprise"
        assert d["is_master"] is True
        assert d["license_key"] == "__master__"
        assert d["features"]["custom_rules"] is True

    def test_bayi_starter_key(self):
        r = requests.get(f"{API}/plan/effective",
                         headers={"X-Master-Key": BAYI_STARTER}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["plan"] == "starter", f"got {d}"
        assert d["is_master"] is False
        assert d["license_key"] == BAYI_STARTER
        assert d["features"]["custom_rules"] is False
        assert d["features"]["marketplace"] is False

    def test_bayi_pro_key(self):
        r = requests.get(f"{API}/plan/effective",
                         headers={"X-Master-Key": BAYI_PRO}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["plan"] == "pro", f"got {d}"
        assert d["is_master"] is False
        assert d["license_key"] == BAYI_PRO
        assert d["features"]["custom_rules"] is True
        assert d["features"]["marketplace"] is True
        assert d["features"]["custom_branding"] is False

    def test_all_new_v4371_keys_present(self):
        r = requests.get(f"{API}/plan/effective", timeout=10)
        assert r.status_code == 200
        feats = r.json()["features"]
        for k in NEW_V4371_KEYS:
            assert k in feats, f"missing new v43.71 key: {k}"


class TestPlanMatrixAdmin:
    def test_get_plan_matrix_contains_new_keys(self):
        r = requests.get(f"{API}/admin/plan-matrix",
                         headers={"X-Master-Key": MASTER_KEY}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        matrix = d["matrix"]
        for plan in ("starter", "pro", "enterprise"):
            for k in NEW_V4371_KEYS:
                assert k in matrix[plan], f"{plan} missing {k}"

    def test_get_plan_matrix_requires_master(self):
        r = requests.get(f"{API}/admin/plan-matrix", timeout=10)
        assert r.status_code in (401, 403)

    def test_toggle_marketplace_for_starter_and_reset(self):
        # 1) GET current matrix
        r = requests.get(f"{API}/admin/plan-matrix",
                         headers={"X-Master-Key": MASTER_KEY}, timeout=10)
        assert r.status_code == 200
        matrix = r.json()["matrix"]
        # 2) toggle starter.marketplace=True
        matrix["starter"]["marketplace"] = True
        s = requests.post(
            f"{API}/admin/plan-matrix",
            headers={"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"},
            json={"matrix": matrix}, timeout=10,
        )
        assert s.status_code == 200, s.text
        assert s.json().get("ok") is True

        # 3) Verify bayi starter now sees marketplace=True
        r2 = requests.get(f"{API}/plan/effective",
                          headers={"X-Master-Key": BAYI_STARTER}, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["features"]["marketplace"] is True, "starter change not reflected"

        # 4) Reset
        rr = requests.post(f"{API}/admin/plan-matrix/reset",
                           headers={"X-Master-Key": MASTER_KEY}, timeout=10)
        assert rr.status_code == 200

        # 5) Verify reverted
        r3 = requests.get(f"{API}/plan/effective",
                          headers={"X-Master-Key": BAYI_STARTER}, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["features"]["marketplace"] is False, "reset failed to revert"


class TestTenantIsolation:
    def test_events_scoped_to_starter(self):
        r = requests.get(
            f"{API}/events",
            params={"license_key": BAYI_STARTER, "limit": 50},
            headers={"X-Master-Key": BAYI_STARTER},
            timeout=15,
        )
        # events endpoint may require auth; accept 200 or 401
        if r.status_code == 401:
            pytest.skip("events endpoint requires auth we don't have")
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            return
        for ev in items:
            lk = ev.get("license_key") or ev.get("owner_license_key")
            if lk is None:
                continue
            assert lk == BAYI_STARTER, f"leak: {lk}"

    def test_events_scoped_to_pro(self):
        r = requests.get(
            f"{API}/events",
            params={"license_key": BAYI_PRO, "limit": 50},
            headers={"X-Master-Key": BAYI_PRO},
            timeout=15,
        )
        if r.status_code == 401:
            pytest.skip("events endpoint requires auth we don't have")
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            return
        for ev in items:
            lk = ev.get("license_key") or ev.get("owner_license_key")
            if lk is None:
                continue
            assert lk == BAYI_PRO, f"leak: {lk}"

    def test_master_does_not_see_bayi_events(self):
        # master queries with its own license_key -> should see master's scope only
        r = requests.get(
            f"{API}/events",
            params={"limit": 100, "license_key": MASTER_KEY},
            headers={"X-Master-Key": MASTER_KEY},
            timeout=15,
        )
        if r.status_code == 401:
            pytest.skip("events endpoint requires auth")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            return
        for ev in items:
            lk = ev.get("license_key") or ev.get("owner_license_key")
            if lk in (BAYI_STARTER, BAYI_PRO):
                pytest.fail(f"master sees bayi event: {lk}")
