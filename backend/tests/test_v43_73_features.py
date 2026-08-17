"""v43.73 backend tests: upgrade_options, marketplace weekly leaderboard,
idle-lock-event audit, reseller branding, remote admin push notification."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
BAYI_STARTER = "MS-TESTBAYI-STARTER-V4371"
BAYI_PRO = "MS-TESTBAYI-PRO-V4371"

H_MASTER = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}
H_STARTER = {"X-Master-Key": BAYI_STARTER, "Content-Type": "application/json"}
H_PRO = {"X-Master-Key": BAYI_PRO, "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def ensure_licenses_and_reset():
    for lk, plan in [(BAYI_STARTER, "starter"), (BAYI_PRO, "pro")]:
        r = requests.get(f"{API}/plan/effective", headers={"X-Master-Key": lk}, timeout=15)
        if r.status_code == 200 and r.json().get("license_key") == lk:
            continue
        try:
            requests.post(f"{API}/admin/licenses", headers=H_MASTER,
                          json={"license_key": lk, "plan": plan, "active": True,
                                "customer_email": f"{lk.lower()}@test.local",
                                "customer_name": f"Test {plan}"}, timeout=15)
        except Exception:
            pass
    # Reset plan matrix defaults
    requests.post(f"{API}/admin/plan-matrix/reset", headers=H_MASTER, timeout=15)
    yield
    requests.post(f"{API}/admin/plan-matrix/reset", headers=H_MASTER, timeout=15)


# ---------------------------------------------------------------- #
# 1. /api/plan/effective upgrade_options
# ---------------------------------------------------------------- #
class TestPlanEffectiveUpgradeOptions:
    def test_starter_bayi_has_upgrade_options_pro_enterprise(self):
        r = requests.get(f"{API}/plan/effective", headers={"X-Master-Key": BAYI_STARTER}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["plan"] == "starter"
        assert "upgrade_options" in d
        opts = d["upgrade_options"]
        assert isinstance(opts, list) and len(opts) == 2
        plans = [o["plan"] for o in opts]
        assert plans == ["pro", "enterprise"]
        for o in opts:
            assert "plan_label" in o
            assert "features" in o
            assert "custom_branding" in o["features"]
        # By default: pro custom_branding=False, enterprise=True
        pro = next(o for o in opts if o["plan"] == "pro")
        ent = next(o for o in opts if o["plan"] == "enterprise")
        assert pro["features"]["custom_branding"] is False
        assert ent["features"]["custom_branding"] is True

    def test_toggle_pro_custom_branding_reflects_in_upgrade_options(self):
        # Set pro.custom_branding = false explicitly (already default),
        # and enterprise=True — then verify upgrade_options
        payload = {"matrix": {
            "pro": {"custom_branding": False},
            "enterprise": {"custom_branding": True},
        }}
        r = requests.post(f"{API}/admin/plan-matrix", headers=H_MASTER, json=payload, timeout=15)
        assert r.status_code == 200, r.text

        r2 = requests.get(f"{API}/plan/effective", headers={"X-Master-Key": BAYI_STARTER}, timeout=15)
        assert r2.status_code == 200
        opts = r2.json()["upgrade_options"]
        assert opts[0]["plan"] == "pro"
        assert opts[0]["features"]["custom_branding"] is False
        assert opts[1]["plan"] == "enterprise"
        assert opts[1]["features"]["custom_branding"] is True

    def test_reset_restores_defaults(self):
        r = requests.post(f"{API}/admin/plan-matrix/reset", headers=H_MASTER, timeout=15)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/plan/effective", headers={"X-Master-Key": BAYI_STARTER}, timeout=15)
        opts = r2.json()["upgrade_options"]
        pro = next(o for o in opts if o["plan"] == "pro")
        ent = next(o for o in opts if o["plan"] == "enterprise")
        assert pro["features"]["custom_branding"] is False
        assert ent["features"]["custom_branding"] is True


# ---------------------------------------------------------------- #
# 2. Marketplace weekly leaderboard
# ---------------------------------------------------------------- #
class TestMarketplaceWeeklyLeaderboard:
    def test_weekly_returns_shape(self):
        r = requests.get(f"{API}/marketplace/leaderboard/weekly", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("winner", "top10", "week_start", "generated_at"):
            assert k in d, f"missing {k}"
        assert isinstance(d["top10"], list)
        # If empty top10, winner must be null
        if not d["top10"]:
            assert d["winner"] is None


# ---------------------------------------------------------------- #
# 3. Idle-lock audit event
# ---------------------------------------------------------------- #
class TestIdleLockEvent:
    def test_lock_event_no_auth_writes_audit(self):
        r = requests.post(f"{API}/audit/idle-lock-event",
                          json={"event": "lock", "idle_seconds": 900}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify audit log entry exists (master)
        rl = requests.get(f"{API}/audit/logs", headers={"X-Master-Key": MASTER_KEY},
                          params={"action": "idle_lock_lock", "limit": 20}, timeout=15)
        assert rl.status_code == 200
        body = rl.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        assert isinstance(items, list)
        assert any(it.get("action") == "idle_lock_lock" for it in items), \
            f"idle_lock_lock not found in audit logs: sample={items[:2]}"

    def test_unlock_event_with_license_key_actor_label(self):
        r = requests.post(f"{API}/audit/idle-lock-event",
                          json={"event": "unlock", "license_key": BAYI_STARTER}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        rl = requests.get(f"{API}/audit/logs", headers={"X-Master-Key": MASTER_KEY},
                          params={"action": "idle_lock_unlock", "limit": 20}, timeout=15)
        assert rl.status_code == 200
        body = rl.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        match = [it for it in items if it.get("action") == "idle_lock_unlock"
                 and (it.get("actor_label") or "").startswith("MS-TESTBAYI")]
        assert match, f"no idle_lock_unlock with MS-TESTBAYI actor_label; items={items[:3]}"


# ---------------------------------------------------------------- #
# 4. Reseller branding
# ---------------------------------------------------------------- #
UNIQUE_DOMAIN = f"mail.test-v4373-{uuid.uuid4().hex[:6]}.com"


class TestResellerBranding:
    def test_me_without_header_401(self):
        r = requests.get(f"{API}/reseller-branding/me", timeout=15)
        assert r.status_code == 401, r.text

    def test_me_with_bayi_returns_defaults(self):
        r = requests.get(f"{API}/reseller-branding/me", headers={"X-Master-Key": BAYI_STARTER}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Default doc has license_key echoed
        assert d.get("license_key") == BAYI_STARTER or d.get("custom_domain") is None

    def test_save_and_conflict(self):
        # Save under starter
        r = requests.post(f"{API}/reseller-branding/me", headers=H_STARTER,
                          json={"custom_domain": UNIQUE_DOMAIN, "brand_name": "Test",
                                "primary_color": "#10b981", "active": True}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        assert r.json().get("custom_domain") == UNIQUE_DOMAIN.lower()

        # Conflict from pro bayi w/ same domain
        r2 = requests.post(f"{API}/reseller-branding/me", headers=H_PRO,
                           json={"custom_domain": UNIQUE_DOMAIN, "brand_name": "Other",
                                 "primary_color": "#111111", "active": True}, timeout=15)
        assert r2.status_code == 409, r2.text

    def test_public_lookup(self):
        r = requests.get(f"{API}/public/reseller-branding", params={"host": UNIQUE_DOMAIN}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("custom_domain") == UNIQUE_DOMAIN.lower()
        # public must not expose license_key
        assert "license_key" not in d

    def test_public_unknown_host_404(self):
        r = requests.get(f"{API}/public/reseller-branding",
                         params={"host": f"unknown-{uuid.uuid4().hex[:8]}.example.com"}, timeout=15)
        assert r.status_code == 404

    def test_invalid_domain_400(self):
        r = requests.post(f"{API}/reseller-branding/me", headers=H_STARTER,
                          json={"custom_domain": "not a domain 123!@#", "brand_name": "X",
                                "primary_color": "#123456", "active": True}, timeout=15)
        assert r.status_code == 400, r.text
        assert "Geçersiz" in (r.json().get("detail") or "")


# ---------------------------------------------------------------- #
# 5. Remote admin push alert
# ---------------------------------------------------------------- #
class TestRemoteAdminComplete:
    def test_dispatch_then_complete_emits_master_alert(self):
        # dispatch a health_check
        r = requests.post(f"{API}/remote-admin/dispatch", headers=H_MASTER,
                          json={"license_key": BAYI_STARTER, "command": "health_check",
                                "params": {}}, timeout=15)
        assert r.status_code == 200, r.text
        action_id = r.json()["action_id"]

        # Complete
        rc = requests.post(f"{API}/events/pending-actions/{action_id}/complete",
                           params={"license_key": BAYI_STARTER},
                           json={"ok": True, "output": "docker OK"}, timeout=15)
        assert rc.status_code == 200, rc.text

        # Check master_alerts via master alerts endpoint
        ra = requests.get(f"{API}/admin/threat-alerts", headers={"X-Master-Key": MASTER_KEY},
                         params={"limit": 50}, timeout=15)
        assert ra.status_code == 200, ra.text
        body = ra.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        assert isinstance(items, list)
        match = [a for a in items if a.get("type") == "remote_admin_complete"
                 and a.get("action_id") == action_id]
        assert match, f"remote_admin_complete alert not found for action {action_id}; sample={items[:2]}"
        m = match[0]
        assert m.get("severity") == "info"
        assert "health_check" in (m.get("message") or "")
        assert "tamamlandı" in (m.get("message") or "")
