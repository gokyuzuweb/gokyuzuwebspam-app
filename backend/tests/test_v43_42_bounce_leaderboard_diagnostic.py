"""v43.42 backend tests: Bounce Digest, Marketplace Leaderboard, Live Server Diagnostic."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
H = {"X-Master-Key": MASTER_KEY}


# ---- Bounce Digest ----
class TestBounceDigest:
    def test_get_config(self):
        r = requests.get(f"{BASE_URL}/api/bounce-digest/config", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["enabled", "recipient_email", "send_hour_utc", "delivery_method", "webhook_url", "last_run_at", "last_bounces"]:
            assert k in d, f"missing {k}"

    def test_post_and_get_config(self):
        payload = {"enabled": True, "recipient_email": "test@example.com", "send_hour_utc": 9, "delivery_method": "panel", "webhook_url": None}
        r = requests.post(f"{BASE_URL}/api/bounce-digest/config", headers=H, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # verify persistence
        r2 = requests.get(f"{BASE_URL}/api/bounce-digest/config", headers=H, timeout=15)
        d = r2.json()
        assert d["enabled"] is True
        assert d["recipient_email"] == "test@example.com"
        assert d["send_hour_utc"] == 9
        assert d["delivery_method"] == "panel"
        assert d["webhook_url"] is None

    def test_config_forbidden_without_master(self):
        r = requests.get(f"{BASE_URL}/api/bounce-digest/config", timeout=15)
        assert r.status_code == 403

    def test_preview(self):
        r = requests.get(f"{BASE_URL}/api/bounce-digest/preview?hours=24", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_bounces"] >= 0
        for k in ["top_users", "top_domains", "top_reasons", "samples", "html_preview"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["top_users"], list)
        assert isinstance(d["top_domains"], list)
        assert isinstance(d["top_reasons"], list)
        assert isinstance(d["samples"], list)
        assert isinstance(d["html_preview"], str) and len(d["html_preview"]) > 0
        assert "<html" in d["html_preview"].lower() or "<!doctype" in d["html_preview"].lower()

    def test_run_now(self):
        r = requests.post(f"{BASE_URL}/api/bounce-digest/run-now", headers=H, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("generated", -1) >= 0

    def test_history(self):
        r = requests.get(f"{BASE_URL}/api/bounce-digest/history", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        assert d.get("count", -1) >= 0
        assert d["count"] == len(d["items"])


# ---- Marketplace Leaderboard ----
class TestMarketplaceLeaderboard:
    VALID_TIERS = {"starter", "bronze", "silver", "gold", "diamond"}

    def _check_shape(self, d, period):
        assert d["period"] == period
        assert "top_publishers" in d and isinstance(d["top_publishers"], list)
        assert "top_signatures" in d and isinstance(d["top_signatures"], list)
        assert "badge_tiers" in d and isinstance(d["badge_tiers"], list)
        assert len(d["badge_tiers"]) == 5
        tiers = {b["tier"] for b in d["badge_tiers"]}
        assert tiers == self.VALID_TIERS, f"badge tiers {tiers}"
        for b in d["badge_tiers"]:
            for k in ["tier", "label", "color", "min"]:
                assert k in b
        for p in d["top_publishers"]:
            for k in ["publisher_masked", "signatures", "total_installs", "total_upvotes", "badge", "period_installs"]:
                assert k in p, f"pub missing {k}"
            assert p["badge"]["tier"] in self.VALID_TIERS

    def test_week(self):
        r = requests.get(f"{BASE_URL}/api/marketplace/leaderboard?period=week", timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json(), "week")

    def test_month(self):
        r = requests.get(f"{BASE_URL}/api/marketplace/leaderboard?period=month", timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json(), "month")

    def test_all(self):
        r = requests.get(f"{BASE_URL}/api/marketplace/leaderboard?period=all", timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json(), "all")


# ---- Live Server Diagnostic ----
class TestLiveDiagnostic:
    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/live-diagnostic/status", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "generated_at" in d
        assert "licenses_count" in d
        assert "rows" in d and isinstance(d["rows"], list)
        assert d["licenses_count"] == len(d["rows"])
        for row in d["rows"]:
            for k in ["license_masked", "hostname", "plugin_version", "checks", "health_score", "health_pct", "overall"]:
                assert k in row, f"row missing {k}"
            assert isinstance(row["checks"], list)
            assert len(row["checks"]) == 5
            assert row["overall"] in ["healthy", "degraded", "critical"]
            for c in row["checks"]:
                for k in ["id", "label", "pass", "detail", "hint"]:
                    assert k in c

    def test_status_forbidden(self):
        r = requests.get(f"{BASE_URL}/api/live-diagnostic/status", timeout=15)
        assert r.status_code == 403

    def test_commands(self):
        r = requests.get(f"{BASE_URL}/api/live-diagnostic/commands", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "phases" in d and isinstance(d["phases"], list)
        assert len(d["phases"]) == 4
        for p in d["phases"]:
            for k in ["id", "title", "commands"]:
                assert k in p
            assert isinstance(p["commands"], list)
            for c in p["commands"]:
                for k in ["cmd", "expects", "if_not"]:
                    assert k in c

    def test_report_install_allowlisted(self):
        payload = {
            "license_key": MASTER_KEY,
            "gws_update_stdout": "TEST_v43_42 install stdout",
            "gws_update_stderr": "",
            "heartbeat_manual_output": "",
            "exim_tail_log": "",
        }
        # No master header — should pass because in demo-write allowlist
        r = requests.post(f"{BASE_URL}/api/live-diagnostic/report-install", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_install_reports_lists_recent(self):
        r = requests.get(f"{BASE_URL}/api/live-diagnostic/install-reports", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        # verify the reported install shows up
        found = any("TEST_v43_42" in (it.get("gws_update_stdout") or "") for it in d["items"])
        assert found, "Just-reported install not found in install-reports"

    def test_install_reports_forbidden(self):
        r = requests.get(f"{BASE_URL}/api/live-diagnostic/install-reports", timeout=15)
        assert r.status_code == 403
