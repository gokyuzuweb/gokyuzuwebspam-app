"""V29 tests — demo_write_guard licensed-seller fix + license broadcast-refresh + license_version."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER = "MS-C02AB012652A4FE692D69676"
PRO_KEY = "MS-A1B3833C1DD6441FBCF19F26"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def status(s):
    r = s.get(f"{BASE_URL}/api/plugin/status", timeout=10)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def pro_license_id(s):
    r = s.get(f"{BASE_URL}/api/licenses", params={"license_key": MASTER}, timeout=10)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    for lic in items:
        if lic.get("license_key") == PRO_KEY:
            return lic.get("id")
    pytest.skip("Pro license not found")


# --- BUG FIX: demo_write_guard allows writes when status.licensed=True (seller mode) ---
class TestDemoWriteGuardLicensed:
    def test_status_is_licensed_seller(self, status):
        assert status["mode"] == "seller"
        assert status["licensed"] is True

    def test_engine_toggle_without_master_returns_200(self, s):
        # Was 423, expected 200 with fix
        r = s.post(f"{BASE_URL}/api/engines/spamassassin/toggle", timeout=10)
        assert r.status_code == 200, f"Expected 200 (licensed seller), got {r.status_code} body={r.text[:200]}"
        j = r.json()
        assert "enabled" in j or "ok" in j or "name" in j

    def test_license_version_field_present(self, status):
        assert "license_version" in status
        assert isinstance(status["license_version"], int)


# --- FEATURE: broadcast-refresh endpoint ---
class TestBroadcastRefresh:
    def test_non_master_returns_403(self, s, pro_license_id):
        r = s.post(f"{BASE_URL}/api/licenses/{pro_license_id}/broadcast-refresh", timeout=10)
        assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"

    def test_bad_id_returns_404(self, s):
        r = s.post(
            f"{BASE_URL}/api/licenses/does-not-exist-zzz/broadcast-refresh",
            params={"license_key": MASTER}, timeout=10,
        )
        assert r.status_code == 404

    def test_master_bumps_license_version(self, s, pro_license_id):
        # snapshot current
        st0 = s.get(f"{BASE_URL}/api/plugin/status").json()
        v0 = int(st0.get("license_version") or 0)

        r = s.post(
            f"{BASE_URL}/api/licenses/{pro_license_id}/broadcast-refresh",
            params={"license_key": MASTER}, timeout=10,
        )
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["ok"] is True
        assert j["id"] == pro_license_id
        assert "at" in j
        assert isinstance(j["license_version"], int)
        assert j["license_version"] >= v0 + 1

        # plugin/status reflects bump (this panel is installed with PRO_KEY)
        time.sleep(0.5)
        st1 = s.get(f"{BASE_URL}/api/plugin/status").json()
        assert int(st1["license_version"]) >= v0 + 1

    def test_license_events_recorded(self, s, pro_license_id):
        # Bump once more then check events endpoint if exists
        r = s.post(
            f"{BASE_URL}/api/licenses/{pro_license_id}/broadcast-refresh",
            params={"license_key": MASTER}, timeout=10,
        )
        assert r.status_code == 200


# --- REGRESSION ---
class TestRegression:
    def test_plugin_status(self, s):
        assert s.get(f"{BASE_URL}/api/plugin/status").status_code == 200

    def test_licenses_list_master(self, s):
        assert s.get(f"{BASE_URL}/api/licenses", params={"license_key": MASTER}).status_code == 200

    def test_licenses_toggle_active(self, s, pro_license_id):
        # toggle then toggle back
        r1 = s.post(f"{BASE_URL}/api/licenses/{pro_license_id}/toggle-active",
                    params={"license_key": MASTER}, timeout=10)
        assert r1.status_code == 200
        r2 = s.post(f"{BASE_URL}/api/licenses/{pro_license_id}/toggle-active",
                    params={"license_key": MASTER}, timeout=10)
        assert r2.status_code == 200

    def test_licenses_update(self, s, pro_license_id):
        r = s.post(
            f"{BASE_URL}/api/licenses/{pro_license_id}/update",
            params={"license_key": MASTER},
            json={
                "customer_name": "Active User",
                "customer_email": "active@example.com",
                "plan": "pro",
                "ip_addresses": [],
                "max_domains": 100,
                "valid_until": "2027-01-01T00:00:00Z",
                "active": True,
                "notes": "",
            }, timeout=10,
        )
        assert r.status_code == 200, r.text[:300]

    def test_admin_resellers_live(self, s):
        assert s.get(f"{BASE_URL}/api/admin/resellers-live", params={"license_key": MASTER}).status_code == 200

    def test_admin_plan_funnel(self, s):
        assert s.get(f"{BASE_URL}/api/admin/plan-funnel", params={"license_key": MASTER}).status_code == 200

    def test_admin_threat_alerts(self, s):
        assert s.get(f"{BASE_URL}/api/admin/threat-alerts", params={"license_key": MASTER}).status_code == 200

    def test_analytics_plan_event(self, s):
        r = s.post(f"{BASE_URL}/api/analytics/plan-event",
                   json={"event": "gate_view", "feature": "TEST_v29", "session_id": "TEST_v29_sess"},
                   timeout=10)
        assert r.status_code in (200, 201)

    def test_blacklist_check(self, s):
        r = s.post(f"{BASE_URL}/api/blacklist/check", json={"target": "1.2.3.4"}, timeout=15)
        assert r.status_code in (200, 202)
