"""v43.41 backend tests
Covers:
  - POST /api/outbound/ai-insights (LLM-powered summary)
  - POST /api/outbound/anomaly/run-now + GET /api/outbound/anomaly/status
  - GET  /api/outbound/diagnostic (v43.41 plugin_states/stale_plugins_count)
  - Rules refactor regression (routes/rules.py CRUD + alias routes)
  - Sanity regression: /api/users/sync-status, /api/marketplace/seed-demo,
    /api/master/alerts
"""
from __future__ import annotations
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    "https://mailscanner-pro.preview.emergentagent.com"
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
H = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}


# --- AI Insights ------------------------------------------------------------
class TestAIInsights:
    def test_ai_insights_returns_expected_shape(self):
        r = requests.post(f"{BASE_URL}/api/outbound/ai-insights?hours=24",
                          headers=H, timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert isinstance(j.get("summary"), str) and len(j["summary"]) > 0
        assert j.get("risk_level") in ("low", "medium", "high", "critical", "unknown")
        assert isinstance(j.get("actions"), list)
        assert len(j["actions"]) <= 3
        m = j.get("metrics") or {}
        for k in ("total", "spam", "spam_ratio_pct", "top_users",
                  "top_domains", "risky_tlds_hit"):
            assert k in m, f"missing metrics.{k}"
        assert isinstance(m["top_users"], list)
        assert isinstance(m["top_domains"], list)
        assert isinstance(m["risky_tlds_hit"], list)


# --- Anomaly detection ------------------------------------------------------
class TestAnomaly:
    def test_run_now_returns_ok(self):
        r = requests.post(f"{BASE_URL}/api/outbound/anomaly/run-now",
                          headers=H, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert isinstance(j.get("licenses_scanned"), int)
        assert j["licenses_scanned"] >= 0
        assert isinstance(j.get("flagged"), int)
        assert j["flagged"] >= 0

    def test_status_contains_test_spammer(self):
        r = requests.get(f"{BASE_URL}/api/outbound/anomaly/status", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "last_run_at" in j  # nullable string
        assert isinstance(j.get("last_flagged"), int)
        recent = j.get("recent")
        assert isinstance(recent, list)
        # Verify at least 1 anomaly for test_spammer_ab0162 present
        users = [x.get("user") for x in recent]
        assert "test_spammer_ab0162" in users, f"users seen: {users}"


# --- Diagnostic (v43.41 plugin fields) --------------------------------------
class TestDiagnostic:
    def test_plugin_fields_present(self):
        r = requests.get(f"{BASE_URL}/api/outbound/diagnostic", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j.get("plugin_states"), list)
        assert isinstance(j.get("stale_plugins_count"), int)
        assert isinstance(j.get("diagnosis"), list)
        assert isinstance(j.get("fix_hints"), list)


# --- Rules CRUD refactor regression -----------------------------------------
class TestRulesCRUD:
    created_id = None

    def test_1_list_rules(self):
        r = requests.get(f"{BASE_URL}/api/rules", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # At least one rule should exist in preview
        assert len(data) >= 1

    def test_2_create_rule(self):
        payload = {
            "name": "TEST_v43_41_rule",
            "pattern": "TEST_v43_41",
            "score": 3.14,
            "target": "subject",
            "enabled": True,
            "description": "regression test rule",
        }
        r = requests.post(f"{BASE_URL}/api/rules", headers=H, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j
        assert j["name"] == payload["name"]
        assert j["score"] == payload["score"]
        TestRulesCRUD.created_id = j["id"]

    def test_3_update_rule_put(self):
        rid = TestRulesCRUD.created_id
        assert rid, "create step must succeed first"
        payload = {
            "name": "TEST_v43_41_rule",
            "pattern": "TEST_v43_41",
            "score": 7.77,
            "target": "subject",
            "enabled": True,
            "description": "updated",
        }
        r = requests.put(f"{BASE_URL}/api/rules/{rid}", headers=H,
                         json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == {"updated": True}
        # verify persistence
        rr = requests.get(f"{BASE_URL}/api/rules", headers=H, timeout=30).json()
        found = next((x for x in rr if x.get("id") == rid), None)
        assert found is not None
        assert float(found["score"]) == 7.77

    def test_4_update_rule_post_alias(self):
        rid = TestRulesCRUD.created_id
        assert rid
        payload = {
            "name": "TEST_v43_41_rule",
            "pattern": "TEST_v43_41",
            "score": 4.44,
            "target": "subject",
            "enabled": False,
            "description": "alias updated",
        }
        r = requests.post(f"{BASE_URL}/api/rules/{rid}/update", headers=H,
                          json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == {"updated": True}

    def test_5_delete_alias_then_delete(self):
        # Create a 2nd rule to test POST /delete alias, then DELETE
        payload = {
            "name": "TEST_v43_41_rule_alias",
            "pattern": "TEST_v43_41_alias",
            "score": 1.0,
            "target": "any",
            "enabled": True,
            "description": "",
        }
        c = requests.post(f"{BASE_URL}/api/rules", headers=H, json=payload, timeout=30)
        assert c.status_code == 200
        alias_id = c.json()["id"]
        r = requests.post(f"{BASE_URL}/api/rules/{alias_id}/delete",
                          headers=H, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == {"deleted": True}

        # Now delete original with DELETE
        rid = TestRulesCRUD.created_id
        r = requests.delete(f"{BASE_URL}/api/rules/{rid}", headers=H, timeout=30)
        assert r.status_code == 200
        assert r.json() == {"deleted": True}
        # Second DELETE → 404
        r2 = requests.delete(f"{BASE_URL}/api/rules/{rid}", headers=H, timeout=30)
        assert r2.status_code == 404


# --- Regression: existing endpoints still work ------------------------------
class TestRegressionExisting:
    def test_users_sync_status(self):
        r = requests.get(f"{BASE_URL}/api/users/sync-status", headers=H, timeout=30)
        assert r.status_code == 200, r.text

    def test_marketplace_seed_demo(self):
        r = requests.post(f"{BASE_URL}/api/marketplace/seed-demo",
                          headers=H, timeout=45)
        assert r.status_code == 200, r.text

    def test_master_alerts(self):
        r = requests.get(f"{BASE_URL}/api/master/alerts", headers=H, timeout=30)
        assert r.status_code == 200, r.text
