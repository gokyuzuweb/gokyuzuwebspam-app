"""Tests for new /api/users/sync-status, /api/users/sync and threat-intel auto-sync endpoints."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------- /api/users/sync-status ----------
def test_sync_status_no_header(s):
    r = s.get(f"{BASE_URL}/api/users/sync-status", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total", "last_synced_at", "last_source", "sources", "generated_at"):
        assert k in d, f"missing {k} in {d}"
    assert isinstance(d["sources"], (list, dict))
    assert isinstance(d["total"], int)


def test_sync_status_with_master_header(s):
    r = s.get(
        f"{BASE_URL}/api/users/sync-status",
        headers={"X-Master-Key": MASTER_KEY},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total", "last_synced_at", "last_source", "sources", "generated_at"):
        assert k in d


# ---------- /api/users/sync ----------
def test_users_sync_and_status_reflects(s):
    payload = {
        "license_key": MASTER_KEY,
        "accounts": [
            {
                "username": "testsync1",
                "domain": "testsync.com",
                "email_count_today": 10,
                "spam_caught_today": 2,
                "quarantine_size": 1,
            }
        ],
    }
    r = s.post(
        f"{BASE_URL}/api/users/sync",
        json=payload,
        headers={"X-Master-Key": MASTER_KEY},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("synced") == 1, d

    # verify status reflects update
    r2 = s.get(
        f"{BASE_URL}/api/users/sync-status",
        headers={"X-Master-Key": MASTER_KEY},
        timeout=15,
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["total"] >= 1
    assert d2["last_synced_at"] is not None
    assert isinstance(d2["last_synced_at"], str)


def test_users_list_contains_testsync1(s):
    r = s.get(
        f"{BASE_URL}/api/users",
        headers={"X-Master-Key": MASTER_KEY},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    users = data if isinstance(data, list) else data.get("users") or data.get("items") or []
    usernames = [u.get("username") for u in users if isinstance(u, dict)]
    assert "testsync1" in usernames, f"testsync1 not found; got sample={usernames[:10]}"


# ---------- /api/threat-intel/auto-sync ----------
def test_threat_intel_auto_sync_get(s):
    r = s.get(f"{BASE_URL}/api/threat-intel/auto-sync", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "enabled" in d
    assert "interval_min" in d


def test_threat_intel_auto_sync_post_disabled(s):
    r = s.post(
        f"{BASE_URL}/api/threat-intel/auto-sync",
        json={"enabled": False, "interval_min": 60},
        headers={"X-Master-Key": MASTER_KEY},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("enabled") is False


def test_threat_intel_run_now(s):
    r = s.post(
        f"{BASE_URL}/api/threat-intel/auto-sync/run-now",
        headers={"X-Master-Key": MASTER_KEY},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert isinstance(d.get("feeds"), int) and d["feeds"] > 0
    assert "results" in d and isinstance(d["results"], list)
    # each result entry should identify the feed
    for item in d["results"]:
        assert isinstance(item, dict)


# ---------- Regression ----------
def test_regression_signal_log(s):
    r = s.get(f"{BASE_URL}/api/plugin/signal-log?limit=5", timeout=15)
    assert r.status_code == 200, r.text


def test_regression_mailscanner_config(s):
    r = s.get(
        f"{BASE_URL}/api/mailscanner/config",
        params={"license_key": MASTER_KEY},
        timeout=15,
    )
    assert r.status_code == 200, r.text
