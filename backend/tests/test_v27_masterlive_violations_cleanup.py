"""V27 tests:
  - GET /api/admin/resellers-live (master-only aggregate)
  - POST /api/maintenance/violations/auto-cleanup (manual cron trigger + idempotency)
  - Regression: /api/plugin/status, /api/plan/features, /api/blacklist/*, /api/licenses,
    POST /api/licenses/{id}/update
"""
import os
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as fh:
                for line in fh:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    if not v:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return v.rstrip("/")


BASE_URL = _load_backend_url()
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
PRO_LICENSE = "MS-A1B3833C1DD6441FBCF19F26"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------------------ NEW: /admin/resellers-live ------------------

class TestResellersLive:
    def test_without_master_key_returns_403(self, api):
        r = api.get(f"{BASE_URL}/api/admin/resellers-live")
        assert r.status_code == 403, r.text

    @pytest.mark.parametrize("hours", [1, 24, 168])
    def test_with_master_key_query_hours(self, api, hours):
        r = api.get(
            f"{BASE_URL}/api/admin/resellers-live?hours={hours}&license_key={MASTER_KEY}",
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["hours"] == hours
        for key in ("generated_at", "total_resellers", "online_count", "resellers"):
            assert key in data
        assert isinstance(data["resellers"], list)
        if data["resellers"]:
            row = data["resellers"][0]
            for k in ("id", "email", "company", "license_key", "plan",
                      "active", "online", "last_seen_at", "counters",
                      "violations_period", "spam_ratio_pct"):
                assert k in row, f"missing key {k}"
            for c in ("mails", "spam", "virus", "phish", "blocks", "clean"):
                assert c in row["counters"]

    def test_with_license_key_query(self, api):
        r = api.get(
            f"{BASE_URL}/api/admin/resellers-live?hours=24&license_key={MASTER_KEY}"
        )
        assert r.status_code == 200, r.text


# ------------------ NEW: violations auto-cleanup ------------------

class TestViolationsAutoCleanup:
    def test_manual_trigger_ok(self, api):
        r = api.post(
            f"{BASE_URL}/api/maintenance/violations/auto-cleanup?days=7",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["older_than_days"] == 7
        assert "deleted" in data
        assert isinstance(data["deleted"], int)

    def test_idempotent_second_call(self, api):
        r1 = api.post(
            f"{BASE_URL}/api/maintenance/violations/auto-cleanup?days=7",
            headers={"X-Master-Key": MASTER_KEY},
        )
        r2 = api.post(
            f"{BASE_URL}/api/maintenance/violations/auto-cleanup?days=7",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r1.status_code == 200
        assert r2.status_code == 200
        # second run should have deleted 0 (nothing older left after first cleanup)
        assert r2.json()["deleted"] == 0


# ------------------ REGRESSION ------------------

class TestRegression:
    def test_plugin_status(self, api):
        r = api.get(f"{BASE_URL}/api/plugin/status")
        assert r.status_code == 200, r.text

    def test_plan_features_pro(self, api):
        r = api.get(f"{BASE_URL}/api/plan/features?license_key={PRO_LICENSE}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("plan") == "pro", data

    def test_blacklist_requests_list(self, api):
        r = api.get(f"{BASE_URL}/api/blacklist/requests")
        assert r.status_code in (200, 401, 403), r.text

    def test_blacklist_check(self, api):
        r = api.post(
            f"{BASE_URL}/api/blacklist/check",
            json={"target": "1.2.3.4"},
        )
        assert r.status_code == 200, r.text

    def test_licenses_list_master(self, api):
        r = api.get(
            f"{BASE_URL}/api/licenses",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_licenses_update_no_500(self, api):
        # find pro license doc id
        r = api.get(
            f"{BASE_URL}/api/licenses",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 200
        lst = r.json() if isinstance(r.json(), list) else r.json().get("licenses", [])
        target = None
        for row in lst:
            if row.get("license_key") == PRO_LICENSE or row.get("key") == PRO_LICENSE:
                target = row
                break
        if not target:
            pytest.skip("pro license row not found for update test")
        lic_id = target.get("id") or target.get("_id")
        payload = {
            "customer_name": target.get("customer_name", "Active User"),
            "customer_email": target.get("customer_email", ""),
            "plan": target.get("plan", "pro"),
            "ip_addresses": target.get("ip_addresses", []),
            "max_domains": target.get("max_domains", 100),
            "valid_until": target.get("valid_until") or "2030-12-31T00:00:00+00:00",
            "active": target.get("active", True),
            "notes": target.get("notes", ""),
        }
        r2 = api.post(
            f"{BASE_URL}/api/licenses/{lic_id}/update",
            json=payload,
            headers={"X-Master-Key": MASTER_KEY},
        )
        # main assertion: no 500 (was 500 in v20)
        assert r2.status_code != 500, r2.text
        assert r2.status_code == 200, r2.text
