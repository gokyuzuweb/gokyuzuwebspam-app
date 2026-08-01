"""v24 batch tests — Smart POS router, license-aware heartbeats, SMTP auto_mode."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------------- Smart POS providers ----------------
class TestSmartPosProviders:
    def test_providers_returns_5(self, s):
        r = s.get(f"{API}/smart-pos/providers", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 5
        keys = [p["key"] for p in data["providers"]]
        for expected in ["paytr", "iyzico", "param", "ipara", "havale"]:
            assert expected in keys, f"missing provider {expected}"
        for p in data["providers"]:
            for f in ["configured", "mode", "health", "recommended", "priority", "supports", "logo"]:
                assert f in p, f"provider {p['key']} missing field {f}"
        havale = next(p for p in data["providers"] if p["key"] == "havale")
        assert havale["configured"] is True
        assert havale["mode"] == "manual"


# ---------------- Smart POS stats ----------------
class TestSmartPosStats:
    def test_stats_shape(self, s):
        r = s.get(f"{API}/smart-pos/stats", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_revenue_30d" in data
        assert data["period_days"] == 30
        assert isinstance(data["stats"], dict)
        for k in ["paytr", "iyzico", "param", "ipara", "havale"]:
            assert k in data["stats"]
            row = data["stats"][k]
            for f in ["name", "logo", "priority", "total", "paid", "revenue", "success_rate"]:
                assert f in row


# ---------------- Smart POS route ----------------
class TestSmartPosRoute:
    def test_route_prefer_havale(self, s):
        payload = {"amount": 199.9, "email": "TEST_v24@example.com",
                   "user_name": "V24 Tester", "prefer": "havale"}
        r = s.post(f"{API}/smart-pos/route", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["selected_provider"] == "havale"
        assert isinstance(data["fallback_chain"], list)
        assert len(data["fallback_chain"]) >= 1
        # havale result should include IBAN
        assert "iban" in data["result"]
        assert "reference" in data["result"]

    def test_route_default_no_prefer(self, s):
        payload = {"amount": 49.5, "email": "TEST_v24b@example.com",
                   "user_name": "V24 Default"}
        r = s.post(f"{API}/smart-pos/route", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        # Highest priority configured healthy provider — havale is always configured,
        # others depend on env. Should be one of the 5.
        assert data["selected_provider"] in ["paytr", "iyzico", "param", "ipara", "havale"]
        assert "fallback_chain" in data


# ---------------- Heartbeats license expiry ----------------
class TestHeartbeatsExpiry:
    def test_heartbeats_expiry_fields(self, s):
        r = s.get(f"{API}/master/relay/heartbeats", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        assert "expiring_soon" in data
        assert "expired" in data
        assert isinstance(data["expiring_soon"], int)
        assert isinstance(data["expired"], int)
        # Each item should have expiry fields (may be null if no license doc)
        for it in data["items"]:
            for f in ["expires_at", "days_left", "expired", "expiring_soon"]:
                assert f in it, f"heartbeat item missing {f}: {it}"


# ---------------- SMTP auto_mode ----------------
class TestSmtpAutoMode:
    def test_get_smtp_has_auto_mode(self, s):
        r = s.get(f"{API}/settings/smtp", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "auto_mode" in data
        assert isinstance(data["auto_mode"], bool)

    def test_put_smtp_auto_mode_false(self, s):
        # Save current
        cur = s.get(f"{API}/settings/smtp", timeout=15).json()
        payload = {
            "enabled": True,
            "auto_mode": False,
            "host": "smtp.example.com",
            "port": 587,
            "username": "u",
            "password": "",
            "from_addr": "noreply@example.com",
            "use_tls": "starttls",
        }
        r = s.put(f"{API}/settings/smtp", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify persistence
        r2 = s.get(f"{API}/settings/smtp", timeout=15).json()
        assert r2["auto_mode"] is False
        assert r2["enabled"] is True
        assert r2["host"] == "smtp.example.com"
        # Restore previous
        restore = {
            "enabled": cur.get("enabled", False),
            "auto_mode": cur.get("auto_mode", True),
            "host": cur.get("host", ""),
            "port": cur.get("port", 587),
            "username": cur.get("username", ""),
            "password": "",
            "from_addr": cur.get("from_addr", ""),
            "use_tls": cur.get("use_tls", "starttls"),
        }
        s.put(f"{API}/settings/smtp", json=restore, timeout=15)
