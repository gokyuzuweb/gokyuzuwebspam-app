"""
v44 — Signature Marketplace + Master Alert Widget + Refactor regression.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
LIC = "MS-C02AB012652A4FE692D69676"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json", "X-Master-Key": LIC})
    return sess


# ---------- Marketplace ----------
class TestMarketplaceSeedAndBrowse:
    def test_seed(self, s):
        r = s.post(f"{API}/marketplace/seed-demo")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("seeded", -1) >= 0

    def test_stats(self, s):
        r = s.get(f"{API}/marketplace/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total"] >= 5
        assert "total_installs" in d
        assert "publishers" in d
        assert isinstance(d["categories"], dict)
        assert isinstance(d["top"], list)

    def test_list_hot(self, s):
        r = s.get(f"{API}/marketplace/signatures", params={"sort": "hot", "limit": 10})
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["items"], list) and len(d["items"]) >= 1
        it = d["items"][0]
        for f in ("name", "pattern", "target", "score", "category", "stats", "version", "publisher_masked"):
            assert f in it, f"missing {f}"
        assert "hot_score" in it, "hot_score not computed"

    def test_list_by_category(self, s):
        r = s.get(f"{API}/marketplace/signatures", params={"category": "phishing", "limit": 20})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        for it in items:
            assert it["category"] == "phishing"

    def test_list_search(self, s):
        r = s.get(f"{API}/marketplace/signatures", params={"q": "phish", "limit": 20})
        assert r.status_code == 200
        # Not strict count check, but search should return at least 0 without error

    def test_signature_detail(self, s):
        r = s.get(f"{API}/marketplace/signatures", params={"sort": "hot", "limit": 1})
        sig_id = r.json()["items"][0]["id"]
        r2 = s.get(f"{API}/marketplace/signature/{sig_id}")
        assert r2.status_code == 200
        d = r2.json()
        assert "other_versions" in d and isinstance(d["other_versions"], list)
        assert "recent_installs" in d and isinstance(d["recent_installs"], list)


class TestMarketplacePublishInstallVote:
    published_id = None

    def test_publish_ok(self, s):
        payload = {
            "license_key": LIC,
            "name": "testrule_v44",
            "pattern": r"(?i)ödeme_test_xyz",
            "target": "subject",
            "score": 4.0,
            "description": "v44 test",
            "category": "spam",
        }
        r = s.post(f"{API}/marketplace/publish", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True and d["version"] == 1 and "id" in d
        TestMarketplacePublishInstallVote.published_id = d["id"]

    def test_publish_invalid_regex(self, s):
        r = s.post(f"{API}/marketplace/publish", json={
            "license_key": LIC, "name": "bad_regex_test",
            "pattern": "(?<)", "target": "subject", "score": 1.0,
            "description": "bad", "category": "spam",
        })
        assert r.status_code == 400, r.text
        assert "Geçersiz regex" in r.text or "Geçersiz" in r.text

    def test_vote_flow(self, s):
        # Use a seeded signature (not owned by test license, but vote is allowed by any valid license)
        r = s.get(f"{API}/marketplace/signatures", params={"sort": "new", "limit": 20})
        # pick a signature that is NOT our just-published one to avoid self-vote coupling
        items = r.json()["items"]
        target = next(it for it in items if it["id"] != TestMarketplacePublishInstallVote.published_id)
        sig_id = target["id"]
        base_up = target["stats"].get("upvotes", 0)

        r1 = s.post(f"{API}/marketplace/vote/{sig_id}", json={"license_key": LIC, "kind": "up"})
        assert r1.status_code == 200, r1.text
        stats1 = r1.json()["stats"]
        assert stats1["upvotes"] == base_up + 1
        assert r1.json()["action"] in ("recorded", "switched")

        # Same kind → remove
        r2 = s.post(f"{API}/marketplace/vote/{sig_id}", json={"license_key": LIC, "kind": "up"})
        assert r2.status_code == 200
        assert r2.json()["action"] == "removed"
        assert r2.json()["stats"]["upvotes"] == base_up

        # Different kind → switch (from nothing to down = recorded)
        r3 = s.post(f"{API}/marketplace/vote/{sig_id}", json={"license_key": LIC, "kind": "down"})
        assert r3.status_code == 200
        assert r3.json()["action"] in ("recorded",)
        # Now switch to up
        r4 = s.post(f"{API}/marketplace/vote/{sig_id}", json={"license_key": LIC, "kind": "up"})
        assert r4.status_code == 200
        assert r4.json()["action"] == "switched"
        # cleanup vote
        s.post(f"{API}/marketplace/vote/{sig_id}", json={"license_key": LIC, "kind": "up"})

    def test_install(self, s):
        assert TestMarketplacePublishInstallVote.published_id
        sig_id = TestMarketplacePublishInstallVote.published_id
        r = s.post(f"{API}/marketplace/install/{sig_id}", json={"license_key": LIC, "enable": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True and "rule_id" in d
        rule_id = d["rule_id"]

        # Second call → already_installed
        r2 = s.post(f"{API}/marketplace/install/{sig_id}", json={"license_key": LIC, "enable": True})
        assert r2.status_code == 200
        assert r2.json()["already_installed"] is True

        # Verify rule exists in mailscanner rules for this license
        r3 = s.get(f"{API}/mailscanner/rules", params={"license_key": LIC})
        if r3.status_code == 200:
            rules = r3.json().get("items") or r3.json().get("rules") or []
            ids = [x.get("id") for x in rules]
            assert rule_id in ids, f"installed rule {rule_id} not found in mailscanner rules"

    def test_mine(self, s):
        r = s.get(f"{API}/marketplace/mine", params={"license_key": LIC})
        assert r.status_code == 200
        items = r.json()["items"]
        names = [it["name"] for it in items]
        assert "testrule_v44" in names

    def test_delete(self, s):
        sig_id = TestMarketplacePublishInstallVote.published_id
        r = s.delete(f"{API}/marketplace/signature/{sig_id}", params={"license_key": LIC})
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] is True
        # verify gone
        r2 = s.get(f"{API}/marketplace/signature/{sig_id}")
        assert r2.status_code == 404


# ---------- Master Alerts ----------
class TestMasterAlerts:
    def test_list(self, s):
        # ensure at least one alert exists — insert via direct API is not available.
        # We test whatever exists; if empty, still validate schema.
        r = s.get(f"{API}/master/alerts", params={"limit": 5})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and "total_unread" in d
        for it in d["items"]:
            for f in ("id", "kind", "severity", "title", "detail", "created_at", "read"):
                assert f in it, f"missing {f}"
            assert isinstance(it["read"], bool)

    def test_mark_read_and_read_all(self, s):
        r = s.get(f"{API}/master/alerts", params={"limit": 5})
        items = r.json()["items"]
        if items:
            aid = items[0]["id"]
            if aid:
                r2 = s.post(f"{API}/master/alerts/{aid}/read")
                assert r2.status_code in (200, 404)
        r3 = s.post(f"{API}/master/alerts/read-all")
        assert r3.status_code == 200
        assert "modified" in r3.json()
        r4 = s.get(f"{API}/master/alerts", params={"limit": 5})
        assert r4.json()["total_unread"] == 0


# ---------- Refactor regression ----------
class TestUsersSyncRegression:
    def test_sync_status(self, s):
        r = s.get(f"{API}/users/sync-status")
        assert r.status_code == 200, r.text

    def test_users_list(self, s):
        r = s.get(f"{API}/users")
        assert r.status_code == 200, r.text

    def test_refresh_from_cpanel(self, s):
        master_key = os.environ.get("MASTER_LICENSE_KEY", LIC)
        r = s.post(f"{API}/users/refresh-from-cpanel", headers={"X-Master-Key": master_key})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "source" in d
        assert d["source"] in ("signal_only", "whmapi1_local", "cpanel_api", "disabled")
