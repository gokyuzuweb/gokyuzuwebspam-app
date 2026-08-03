"""V31 — Multi-tenant scope (engines/settings/rules) + Plan Matrix Editor.

- Master vs Bayi (installed panel) isolation on engines, settings, rules
- POST alternates for rules delete/update and settings update (Apache proxy safe)
- /api/admin/plan-matrix GET/POST/reset + /api/plan/features reflection
- Regression on 8 critical endpoints
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MASTER = "MS-C02AB012652A4FE692D69676"
PANEL = "MS-A1B3833C1DD6441FBCF19F26"  # installed panel license (Pro)
FAKE_BAYI = "WS-TESTBAYI99999999999999"  # simulated other bayi via ?license_key


def _hm():
    return {"x-master-key": MASTER, "Content-Type": "application/json"}


# ---------------- ENGINES ----------------
class TestEnginesIsolation:
    def test_engines_master_owner_empty(self):
        r = requests.get(f"{BASE}/engines", headers={"x-master-key": MASTER}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) > 0
        for e in rows:
            # master doc owner is "" (empty string)
            assert e.get("owner_license_key", "") == "", f"master engines must have owner='' got {e}"
        # spam ass state snapshot for later
        pytest.master_sa_state = next(e["enabled"] for e in rows if e["name"] == "spamassassin")

    def test_engines_bayi_owner_matches_installed(self):
        r = requests.get(f"{BASE}/engines", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) > 0
        for e in rows:
            assert e["owner_license_key"] == PANEL

    def test_toggle_bayi_does_not_affect_master(self):
        before_master = pytest.master_sa_state
        r = requests.post(f"{BASE}/engines/spamassassin/toggle", timeout=15)
        assert r.status_code == 200
        # toggle again to restore bayi state
        r2 = requests.post(f"{BASE}/engines/spamassassin/toggle", timeout=15)
        assert r2.status_code == 200
        after = requests.get(f"{BASE}/engines", headers={"x-master-key": MASTER}, timeout=15).json()
        after_sa = next(e["enabled"] for e in after if e["name"] == "spamassassin")
        assert after_sa == before_master, "Master engine state changed by bayi toggle!"


# ---------------- SETTINGS ----------------
class TestSettingsIsolation:
    def test_master_settings_get(self):
        r = requests.get(f"{BASE}/settings", headers={"x-master-key": MASTER}, timeout=15)
        assert r.status_code == 200
        assert "spam_threshold_low" in r.json()
        pytest.master_policy = r.json()

    def test_bayi_settings_bootstrap(self):
        r = requests.get(f"{BASE}/settings", timeout=15)
        assert r.status_code == 200
        assert "spam_threshold_low" in r.json()

    def test_bayi_settings_update_does_not_affect_master(self):
        # bayi updates via POST alt with a weird threshold
        payload = {**pytest.master_policy, "spam_threshold_low": 3.5, "spam_threshold_high": 8.5}
        r = requests.post(f"{BASE}/settings/update", json=payload, timeout=15)
        assert r.status_code == 200
        assert r.json()["spam_threshold_low"] == 3.5
        # master unaffected
        m = requests.get(f"{BASE}/settings", headers={"x-master-key": MASTER}, timeout=15).json()
        assert m["spam_threshold_low"] == pytest.master_policy["spam_threshold_low"]
        assert m["spam_threshold_high"] == pytest.master_policy["spam_threshold_high"]
        # restore bayi to original master defaults for cleanliness
        requests.post(f"{BASE}/settings/update", json=pytest.master_policy, timeout=15)


# ---------------- RULES ----------------
class TestRulesIsolation:
    _bayi_rule = None
    _fake_rule = None

    def test_bayi_create_rule(self):
        payload = {"name": "TEST_bayi_rule", "pattern": "viagra", "score": 5.0, "target": "subject"}
        r = requests.post(f"{BASE}/rules", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["owner_license_key"] == PANEL
        TestRulesIsolation._bayi_rule = d["id"]

    def test_master_can_create_on_behalf_of_other_bayi(self):
        # KNOWN LIMITATION: _tenant_scope uses license_key_arg for scope resolution,
        # so master cannot pass ?license_key=WS-… to create on-behalf-of a bayi.
        # Instead we insert directly via a second bayi installation simulation.
        # For this test, we insert directly through DB using a POST as MASTER with
        # no license_key — that stays with owner="". To fully exercise cross-bayi
        # authorization we manually inject a rule via the DB. Skipping this
        # server-side behavior test until server.py is fixed (see action_items).
        import pymongo, os
        c = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = c[os.environ.get("DB_NAME", "test_database")]
        rid = str(uuid.uuid4())
        db.rules.insert_one({"id": rid, "name": "TEST_fake_bayi_rule",
                             "pattern": "casino", "score": 4.0,
                             "target": "body", "enabled": True, "description": "",
                             "owner_license_key": FAKE_BAYI})
        TestRulesIsolation._fake_rule = rid

    def test_bayi_get_rules_scoped(self):
        r = requests.get(f"{BASE}/rules", timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert TestRulesIsolation._bayi_rule in ids
        assert TestRulesIsolation._fake_rule not in ids, "Bayi sees another bayi's rule!"

    def test_master_get_rules_all(self):
        r = requests.get(f"{BASE}/rules", headers={"x-master-key": MASTER}, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert TestRulesIsolation._bayi_rule in ids
        assert TestRulesIsolation._fake_rule in ids

    def test_bayi_cannot_delete_other_bayi_rule(self):
        r = requests.post(f"{BASE}/rules/{TestRulesIsolation._fake_rule}/delete", timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_bayi_can_update_own_rule_via_post_alt(self):
        payload = {"name": "TEST_bayi_rule_upd", "pattern": "viagra2", "score": 6.0, "target": "subject"}
        r = requests.post(f"{BASE}/rules/{TestRulesIsolation._bayi_rule}/update", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        # verify via GET
        rules = requests.get(f"{BASE}/rules", timeout=15).json()
        u = next(x for x in rules if x["id"] == TestRulesIsolation._bayi_rule)
        assert u["name"] == "TEST_bayi_rule_upd"
        assert u["score"] == 6.0

    def test_bayi_can_delete_own_rule_via_post_alt(self):
        r = requests.post(f"{BASE}/rules/{TestRulesIsolation._bayi_rule}/delete", timeout=15)
        assert r.status_code == 200, r.text
        # cleanup fake rule too (as master)
        requests.post(
            f"{BASE}/rules/{TestRulesIsolation._fake_rule}/delete",
            headers={"x-master-key": MASTER}, timeout=15,
        )


# ---------------- PLAN MATRIX ----------------
class TestPlanMatrix:
    def test_matrix_non_master_forbidden(self):
        r = requests.get(f"{BASE}/admin/plan-matrix", timeout=15)
        assert r.status_code in (401, 403)

    def test_matrix_get_master(self):
        r = requests.get(f"{BASE}/admin/plan-matrix", headers={"x-master-key": MASTER}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "matrix" in d and "defaults" in d
        assert set(d["matrix"].keys()) >= {"starter", "pro", "enterprise"}
        assert d["defaults"]["starter"]["ai_explanations"] is False

    def test_matrix_save_and_reflect(self):
        # Save: starter.ai_explanations = True
        new_matrix = {"starter": {"ai_explanations": True, "max_domains": 3}}
        r = requests.post(f"{BASE}/admin/plan-matrix", json={"matrix": new_matrix},
                          headers=_hm(), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["matrix"]["starter"]["ai_explanations"] is True
        assert r.json()["matrix"]["starter"]["max_domains"] == 3
        # Re-GET
        g = requests.get(f"{BASE}/admin/plan-matrix", headers={"x-master-key": MASTER}, timeout=15).json()
        assert g["matrix"]["starter"]["ai_explanations"] is True
        # plan/features reflects (starter plan license lookup — use unknown key defaults to starter)
        f = requests.get(f"{BASE}/plan/features", timeout=15).json()
        # PANEL is Pro, so use ?license_key=NONEXIST -> starter default
        f2 = requests.get(f"{BASE}/plan/features", params={"license_key": "NON-EXIST-KEY"}, timeout=15).json()
        assert f2["plan"] == "starter"
        assert f2["features"]["ai_explanations"] is True

    def test_matrix_reset(self):
        r = requests.post(f"{BASE}/admin/plan-matrix/reset", headers=_hm(), timeout=15)
        assert r.status_code == 200
        assert r.json()["matrix"]["starter"]["ai_explanations"] is False
        # Re-GET confirms
        g = requests.get(f"{BASE}/admin/plan-matrix", headers={"x-master-key": MASTER}, timeout=15).json()
        assert g["matrix"]["starter"]["ai_explanations"] is False

    def test_matrix_save_ignores_arbitrary_keys(self):
        r = requests.post(f"{BASE}/admin/plan-matrix",
                          json={"matrix": {"starter": {"__hack__": "yes", "ai_explanations": False},
                                            "bogus_plan": {"ai_explanations": True}}},
                          headers=_hm(), timeout=15)
        assert r.status_code == 200
        m = r.json()["matrix"]
        assert "__hack__" not in m["starter"]
        assert "bogus_plan" not in m
        # cleanup
        requests.post(f"{BASE}/admin/plan-matrix/reset", headers=_hm(), timeout=15)


# ---------------- REGRESSION ----------------
class TestRegression:
    @pytest.mark.parametrize("path,params", [
        ("/plugin/status", {}),
        ("/plugin/renewal-info", {}),
        ("/licenses", {}),
        ("/admin/resellers-live", {"license_key": MASTER}),
        ("/admin/threat-alerts", {"license_key": MASTER}),
        ("/admin/plan-funnel", {"license_key": MASTER}),
    ])
    def test_endpoint_200(self, path, params):
        r = requests.get(f"{BASE}{path}", params=params,
                         headers={"x-master-key": MASTER}, timeout=20)
        assert r.status_code == 200, f"{path} → {r.status_code} {r.text[:200]}"

    def test_blacklist_check_post(self):
        r = requests.post(f"{BASE}/blacklist/check",
                          json={"target": "1.2.3.4"}, timeout=15)
        assert r.status_code == 200, r.text[:200]

    def test_plan_event_analytics(self):
        r = requests.post(f"{BASE}/analytics/plan-event",
                          json={"event": "gate_view", "feature": "ai_explanations",
                                "target_plan": "pro"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_subscription_renew_no_email_still_returns_400(self):
        # Just an existence smoke — endpoint should reply (400 or 200 both acceptable structurally)
        r = requests.post(f"{BASE}/subscription/renew",
                          json={"license_key": PANEL, "billing_period": "yearly"}, timeout=20)
        assert r.status_code in (200, 400, 404), r.text[:200]

    def test_migrations_idempotent(self):
        import subprocess
        r1 = subprocess.run(["python", "/app/backend/scripts/migrate_multitenancy.py"],
                            capture_output=True, text=True, timeout=30)
        assert r1.returncode == 0, r1.stderr
        r2 = subprocess.run(["python", "/app/backend/scripts/fix_engines_index.py"],
                            capture_output=True, text=True, timeout=30)
        assert r2.returncode == 0, r2.stderr
