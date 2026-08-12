"""v40 backend regression:
  - /api/events/saved-filters  GET/POST/{sid}/delete  (per-module, per-owner)
  - /api/events/pending-actions/{id}/complete → master_alerts entry (plugin_update_complete)
  - /api/admin/threat-alerts GET returns the entry
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
HDRS = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}


# ---------------------------------------------------------------- saved-filters
class TestSavedFilters:
    def test_list_no_module(self):
        r = requests.get(f"{BASE_URL}/api/events/saved-filters", headers=HDRS, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)

    def test_create_and_list_quarantine(self):
        payload = {
            "name": f"TEST_qf_{uuid.uuid4().hex[:6]}",
            "module": "quarantine",
            "filters": {"verdict": "spam", "ageFilter": "1d", "minCount": 8},
        }
        r = requests.post(f"{BASE_URL}/api/events/saved-filters", json=payload, headers=HDRS, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "id" in d and "item" in d
        assert d["item"]["module"] == "quarantine"
        assert d["item"]["filters"]["verdict"] == "spam"
        sid = d["id"]

        # GET, filtered by module=quarantine, should contain this id
        r2 = requests.get(f"{BASE_URL}/api/events/saved-filters?module=quarantine",
                          headers=HDRS, timeout=10)
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json().get("items", [])]
        assert sid in ids

        # module isolation — quarantine filter should NOT appear under live_events
        r3 = requests.get(f"{BASE_URL}/api/events/saved-filters?module=live_events",
                          headers=HDRS, timeout=10)
        assert r3.status_code == 200
        ids_live = [x["id"] for x in r3.json().get("items", [])]
        assert sid not in ids_live

        # Delete
        rd = requests.post(f"{BASE_URL}/api/events/saved-filters/{sid}/delete",
                            headers=HDRS, timeout=10)
        assert rd.status_code == 200
        assert rd.json().get("ok") is True

        # Delete again → 404
        rd2 = requests.post(f"{BASE_URL}/api/events/saved-filters/{sid}/delete",
                             headers=HDRS, timeout=10)
        assert rd2.status_code == 404

    def test_create_live_events(self):
        payload = {
            "name": f"TEST_lf_{uuid.uuid4().hex[:6]}",
            "module": "live_events",
            "filters": {"fromSearch": "attacker@", "minScore": 8, "hoursFilter": 24},
        }
        r = requests.post(f"{BASE_URL}/api/events/saved-filters", json=payload, headers=HDRS, timeout=10)
        assert r.status_code == 200
        sid = r.json()["id"]
        # cleanup
        requests.post(f"{BASE_URL}/api/events/saved-filters/{sid}/delete", headers=HDRS, timeout=10)

    def test_invalid_module_rejected(self):
        r = requests.post(f"{BASE_URL}/api/events/saved-filters",
                          json={"name": "x", "module": "bogus", "filters": {}},
                          headers=HDRS, timeout=10)
        assert r.status_code in (400, 422)


# ---------------------------------------------------------------- plugin_update_complete
class TestPluginUpdateComplete:

    @pytest.fixture(scope="class")
    def bayi_license(self):
        """Return an existing bayi license key from DB, else skip."""
        r = requests.get(f"{BASE_URL}/api/admin/plugin-health/list?hours=24",
                          headers=HDRS, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"plugin-health/list not accessible: {r.status_code}")
        items = r.json().get("items", [])
        if not items:
            pytest.skip("No resellers/licenses present")
        return items[0].get("license_key") or items[0].get("licenseKey")

    def test_queue_update_and_complete_flow(self, bayi_license):
        assert bayi_license, "no bayi license available"
        # 1) Queue plugin update via master-only endpoint
        r = requests.post(f"{BASE_URL}/api/admin/plugin-health/{bayi_license}/queue-update",
                          headers=HDRS, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        action_id = d.get("action_id")
        assert action_id, d

        # 2) Complete it (simulate bayi plugin)
        r2 = requests.post(
            f"{BASE_URL}/api/events/pending-actions/{action_id}/complete"
            f"?license_key={bayi_license}",
            json={"ok": True, "result": "ok", "output": "install-bayi.sh finished"},
            timeout=10,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("ok") is True
        assert r2.json().get("completed_at")

        # 3) master_alerts should now contain a plugin_update_complete entry
        time.sleep(1)
        r3 = requests.get(
            f"{BASE_URL}/api/admin/threat-alerts?limit=30",
            headers=HDRS, timeout=10,
        )
        assert r3.status_code == 200, r3.text
        items = r3.json().get("items", [])
        matched = [
            a for a in items
            if a.get("type") == "plugin_update_complete" and a.get("action_id") == action_id
        ]
        assert matched, f"master_alerts entry not found for action {action_id}"
        alert = matched[0]
        assert alert.get("severity") == "info"
        assert alert.get("license_key") == bayi_license
        assert "plugin" in (alert.get("message") or "").lower()

    def test_complete_with_ok_false_creates_warning(self, bayi_license):
        # queue another
        r = requests.post(f"{BASE_URL}/api/admin/plugin-health/{bayi_license}/queue-update",
                          headers=HDRS, timeout=10)
        assert r.status_code == 200
        j = r.json()
        # If already queued (idempotent guard), we still get an action_id
        action_id = j.get("action_id")
        assert action_id

        r2 = requests.post(
            f"{BASE_URL}/api/events/pending-actions/{action_id}/complete"
            f"?license_key={bayi_license}",
            json={"ok": False, "result": "fail", "output": "rc=1 install failed"},
            timeout=10,
        )
        assert r2.status_code == 200
        time.sleep(1)
        r3 = requests.get(f"{BASE_URL}/api/admin/threat-alerts?limit=30",
                          headers=HDRS, timeout=10)
        assert r3.status_code == 200
        items = r3.json().get("items", [])
        # There should be at least one warning entry for plugin_update_complete
        warns = [a for a in items
                 if a.get("type") == "plugin_update_complete"
                 and a.get("action_id") == action_id]
        assert warns, "warning alert not created for failed plugin update"
        assert warns[0]["severity"] == "warning"

    def test_complete_unknown_action_404(self):
        r = requests.post(
            f"{BASE_URL}/api/events/pending-actions/does-not-exist/complete?license_key={MASTER_KEY}",
            json={"ok": True}, timeout=10,
        )
        assert r.status_code == 404
