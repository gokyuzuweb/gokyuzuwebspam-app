"""v23 batch tests: Bayi Panosu heartbeats, publish-version, releases, whitelist list/remove, blocked-stats region filter."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# --- Master heartbeats ---
class TestMasterHeartbeats:
    def test_heartbeats_shape(self, s):
        # ensure at least one heartbeat exists
        s.get(f"{API}/master/relay/heartbeat", params={"license_key": "MS-TEST-v23", "plugin_version": "1.0.0"})
        r = s.get(f"{API}/master/relay/heartbeats")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "outdated_count" in data
        assert isinstance(data["items"], list)
        assert len(data["items"]) >= 1
        row = data["items"][0]
        for k in ("reseller_name", "email", "plan", "plugin_version", "online", "age_seconds"):
            assert k in row, f"missing {k}"


# --- Publish version ---
class TestPublishVersion:
    def test_publish_and_update_check(self, s):
        payload = {"version": "2.6.0", "changelog": "v23 test publish", "download_url": ""}
        r = s.post(f"{API}/master/publish-version", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("version") == "2.6.0"
        assert data.get("cache_cleared") is True
        assert "resellers_outdated" in data

        # update-check should reflect new version
        r2 = s.get(f"{API}/master/relay/update-check", params={"version": "1.0.0"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["latest_version"] == "2.6.0"
        assert d2["cache"] == "publish"
        assert d2["outdated"] is True

    def test_releases(self, s):
        r = s.get(f"{API}/master/releases")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "current" in data
        assert isinstance(data["items"], list)
        if data["items"]:
            assert "published_at" in data["items"][0]
            assert "version" in data["items"][0]


# --- Whitelist list/remove ---
class TestWhitelist:
    def test_whitelist_list(self, s):
        # seed one
        s.post(f"{API}/maintenance/ip/whitelist", json={"ip": "203.0.113.201", "reason": "TEST_v23"})
        r = s.get(f"{API}/maintenance/whitelist/list")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert any(it.get("value") == "203.0.113.201" for it in data["items"])
        row = next(it for it in data["items"] if it.get("value") == "203.0.113.201")
        assert "source" in row and "event_count" in row

    def test_whitelist_remove(self, s):
        s.post(f"{API}/maintenance/ip/whitelist", json={"ip": "203.0.113.202", "reason": "TEST_v23"})
        r = s.post(f"{API}/maintenance/whitelist/remove", json={"ip": "203.0.113.202"})
        assert r.status_code == 200
        assert r.json().get("removed", 0) >= 1
        # verify gone
        r2 = s.get(f"{API}/maintenance/whitelist/list")
        assert not any(it.get("value") == "203.0.113.202" for it in r2.json()["items"])


# --- Region filter for blocked stats ---
class TestBlockedStatsRegion:
    def test_region_all(self, s):
        r = s.get(f"{API}/maintenance/public/blocked-stats", params={"region": "all"})
        assert r.status_code == 200
        d = r.json()
        assert d["region"] == "all"
        assert len(d["series_30d"]) == 30

    def test_region_tr(self, s):
        r = s.get(f"{API}/maintenance/public/blocked-stats", params={"region": "tr"})
        assert r.status_code == 200
        d = r.json()
        assert d["region"] == "tr"
        assert len(d["series_30d"]) == 30

    def test_region_external(self, s):
        r = s.get(f"{API}/maintenance/public/blocked-stats", params={"region": "external"})
        assert r.status_code == 200
        d = r.json()
        assert d["region"] == "external"
        assert len(d["series_30d"]) == 30
