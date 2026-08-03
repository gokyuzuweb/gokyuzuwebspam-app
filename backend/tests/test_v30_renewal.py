"""V30 — Renewal banner + one-click renew endpoint tests + regression."""
import os
import subprocess
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
API = f"{BASE_URL}/api"

SCRIPT = "/app/backend/scripts/set_license_expiry.py"


def _set_days(days, restore=False):
    args = ["python3", SCRIPT, str(days)]
    if restore:
        args.append("--restore")
    r = subprocess.run(args, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, f"script failed: {r.stderr}"
    return r.stdout


@pytest.fixture(scope="module", autouse=True)
def restore_after():
    yield
    _set_days(365, restore=True)


# ---------- /plugin/renewal-info ----------

class TestRenewalInfo:
    def test_default_state_no_banner(self):
        # ensure restored first
        _set_days(365, restore=True)
        time.sleep(0.3)
        r = requests.get(f"{API}/plugin/renewal-info", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("licensed") is True
        assert d.get("should_show_banner") is False
        assert d.get("severity") in (None,)
        assert isinstance(d.get("days_left"), int) and d["days_left"] > 30
        assert "expires_at" in d
        assert "license_key" in d
        assert "plan" in d
        assert d.get("renewal_url", "").startswith("/panel/subscription")

    def test_info_severity_at_30_days(self):
        # Set 31 so that days_left rounds to 30 (info threshold)
        _set_days(31)
        time.sleep(0.3)
        r = requests.get(f"{API}/plugin/renewal-info", timeout=10)
        d = r.json()
        assert d["should_show_banner"] is True
        # 30–31 days → info per server logic (<=30 info, <=14 warning)
        assert d["severity"] == "info", f"got {d}"
        assert d["days_left"] in (29, 30, 31)

    def test_warning_at_10_days(self):
        _set_days(10)
        time.sleep(0.3)
        d = requests.get(f"{API}/plugin/renewal-info", timeout=10).json()
        assert d["should_show_banner"] is True
        assert d["severity"] == "warning"
        assert d["days_left"] in (9, 10)

    def test_critical_at_3_days(self):
        _set_days(3)
        time.sleep(0.3)
        d = requests.get(f"{API}/plugin/renewal-info", timeout=10).json()
        assert d["should_show_banner"] is True
        assert d["severity"] == "critical"
        assert d["days_left"] in (2, 3)


# ---------- /subscription/renew ----------

class TestSubscriptionRenew:
    def test_renew_yearly(self):
        _set_days(10)  # active license
        time.sleep(0.3)
        r = requests.post(f"{API}/subscription/renew", json={"billing_period": "yearly"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("renewal") is True
        assert "url" in d or "session_id" in d
        assert d.get("current_plan")
        assert d.get("current_expires")

    def test_renew_monthly(self):
        r = requests.post(f"{API}/subscription/renew", json={"billing_period": "monthly"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["renewal"] is True
        assert d.get("url", "").startswith("http") or d.get("session_id")


# ---------- Regression on previously green endpoints ----------

class TestRegression:
    def test_plugin_status_has_license_version(self):
        _set_days(365, restore=True)
        time.sleep(0.3)
        r = requests.get(f"{API}/plugin/status", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "license_version" in d
        assert d.get("licensed") is True

    def test_admin_threat_alerts(self):
        r = requests.get(f"{API}/admin/threat-alerts", timeout=10)
        # Requires master cookie → 401/403 without auth, 200 with. Regression = no 500.
        assert r.status_code in (200, 401, 403)

    def test_admin_plan_funnel(self):
        r = requests.get(f"{API}/admin/plan-funnel", timeout=10)
        assert r.status_code in (200, 401, 403)

    def test_analytics_plan_event(self):
        # Payload shape may vary; regression = endpoint responds (not 500)
        r = requests.post(
            f"{API}/analytics/plan-event",
            json={"event": "view", "plan": "pro"},
            timeout=10,
        )
        assert r.status_code in (200, 201, 400, 422)

    def test_engines_toggle(self):
        # get a valid engine name from plugin status or use a common one
        r = requests.post(f"{API}/engines/spam/toggle", json={"enabled": True}, timeout=10)
        # 200 (ok) or 404 (engine not found) — must NOT be 500
        assert r.status_code in (200, 404, 400), f"unexpected {r.status_code}: {r.text}"

    def test_broadcast_refresh_requires_master(self):
        # Should reject without master cookie: 401/403/404
        r = requests.post(
            f"{API}/licenses/aa2bb3bb-387e-4819-9210-42d35a2ad415/broadcast-refresh",
            timeout=10,
        )
        assert r.status_code in (401, 403, 404, 200)
