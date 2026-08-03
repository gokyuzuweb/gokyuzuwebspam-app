"""V28 tests: Plan Upgrade Funnel Analytics + Reseller Threat Ratio Push Notification.

Covers:
  - POST /api/analytics/plan-event (no-auth, valid+invalid events)
  - GET  /api/admin/plan-funnel (master vs anon 403)
  - GET  /api/admin/threat-alerts (master, unseen_only, anon 403)
  - POST /api/admin/threat-alerts/scan (master, dedupe → created:0)
  - POST /api/admin/threat-alerts/{id}/ack + ack-all + 404 for bad id
  - Regression: /admin/resellers-live, /plugin/status, /blacklist/check,
                /licenses, /plan/features, /maintenance/violations/auto-cleanup
"""

import os
import pytest
import requests

def _load_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.strip().partition("=")
                    os.environ.setdefault(k, v)
_load_env()
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
PRO_KEY = "MS-A1B3833C1DD6441FBCF19F26"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Plan analytics events ----------
class TestPlanEvents:
    def test_gate_view_no_auth(self, s):
        r = s.post(f"{BASE_URL}/api/analytics/plan-event", json={
            "event": "gate_view", "feature": "exploit_editor",
            "current_plan": "starter", "target_plan": "pro",
            "session_id": "TEST_sess_v28_1",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True and "id" in j

    def test_all_valid_events(self, s):
        for ev in ["gate_click", "modal_open", "cycle_change", "checkout_click", "purchase"]:
            r = s.post(f"{BASE_URL}/api/analytics/plan-event", json={
                "event": ev, "feature": "TEST_feature", "session_id": "TEST_sess_v28_2",
                "target_plan": "pro", "cycle": "monthly",
            })
            assert r.status_code == 200, f"{ev}: {r.text}"

    def test_invalid_event_400(self, s):
        r = s.post(f"{BASE_URL}/api/analytics/plan-event", json={
            "event": "not_a_real_event", "session_id": "TEST_sess_v28_3",
        })
        assert r.status_code == 400, r.text


# ---------- Plan funnel report ----------
class TestPlanFunnel:
    def test_anon_403(self, s):
        r = s.get(f"{BASE_URL}/api/admin/plan-funnel?days=30")
        assert r.status_code == 403

    def test_master_returns_schema(self, s):
        r = s.get(f"{BASE_URL}/api/admin/plan-funnel", params={"days": 30, "license_key": MASTER_KEY})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "funnel" in j and "by_feature" in j and "by_target_plan" in j and "recent" in j
        # funnel has 5 stages in correct order
        stages = [x["stage"] for x in j["funnel"]]
        assert stages == ["gate_view", "gate_click", "modal_open", "checkout_click", "purchase"]
        for row in j["funnel"]:
            assert "count" in row and "conversion_pct" in row
            assert isinstance(row["count"], int)
        # by_feature entries
        for row in j["by_feature"]:
            assert set(row.keys()) >= {"feature", "clicks", "purchases", "conversion_pct"}
        # recent is <=20
        assert len(j["recent"]) <= 20


# ---------- Threat alerts ----------
class TestThreatAlerts:
    def test_list_anon_403(self, s):
        r = s.get(f"{BASE_URL}/api/admin/threat-alerts")
        assert r.status_code == 403

    def test_list_master(self, s):
        r = s.get(f"{BASE_URL}/api/admin/threat-alerts", params={"license_key": MASTER_KEY})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j and "unseen_count" in j and "returned" in j
        assert isinstance(j["items"], list)

    def test_list_master_unseen_only(self, s):
        r = s.get(f"{BASE_URL}/api/admin/threat-alerts",
                  params={"license_key": MASTER_KEY, "unseen_only": "true"})
        assert r.status_code == 200
        j = r.json()
        # per problem statement existing alert is ack'd → unseen list should be 0 items
        for a in j["items"]:
            assert a.get("seen") is False

    def test_scan_master_dedupe(self, s):
        r = s.post(f"{BASE_URL}/api/admin/threat-alerts/scan",
                   params={"license_key": MASTER_KEY, "min_mails": 10, "threshold_pct": 30})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True and "created" in j
        # dedupe should return 0 since alert already exists in window
        assert j["created"] == 0

    def test_scan_anon_403(self, s):
        r = s.post(f"{BASE_URL}/api/admin/threat-alerts/scan")
        # 423 = demo-write guard (blocks POST without master); 403 = master required
        assert r.status_code in (403, 423)

    def test_ack_bad_id_404(self, s):
        r = s.post(f"{BASE_URL}/api/admin/threat-alerts/does-not-exist/ack",
                   params={"license_key": MASTER_KEY})
        assert r.status_code == 404

    def test_ack_all_master(self, s):
        r = s.post(f"{BASE_URL}/api/admin/threat-alerts/ack-all",
                   params={"license_key": MASTER_KEY})
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True and "acked" in j


# ---------- Regression ----------
class TestRegression:
    def test_plugin_status(self, s):
        r = s.get(f"{BASE_URL}/api/plugin/status", params={"license_key": PRO_KEY})
        assert r.status_code == 200

    def test_blacklist_check(self, s):
        r = s.post(f"{BASE_URL}/api/blacklist/check",
                   params={"license_key": PRO_KEY},
                   json={"target": "1.2.3.4", "type": "ip"})
        assert r.status_code == 200, r.text

    def test_licenses_list(self, s):
        r = s.get(f"{BASE_URL}/api/licenses", params={"license_key": MASTER_KEY})
        assert r.status_code == 200

    def test_plan_features(self, s):
        r = s.get(f"{BASE_URL}/api/plan/features", params={"license_key": PRO_KEY})
        assert r.status_code == 200
        j = r.json()
        assert "plan" in j or "features" in j

    def test_resellers_live(self, s):
        r = s.get(f"{BASE_URL}/api/admin/resellers-live",
                  params={"license_key": MASTER_KEY, "hours": 24})
        assert r.status_code == 200
        j = r.json()
        assert "resellers" in j

    def test_violations_auto_cleanup(self, s):
        r = s.post(f"{BASE_URL}/api/maintenance/violations/auto-cleanup",
                   params={"license_key": MASTER_KEY, "days": 7})
        assert r.status_code == 200
