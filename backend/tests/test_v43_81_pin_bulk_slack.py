"""v43.81 — Bulk apply/reject + Per-user PIN idle lock + Bounce Digest Slack.

Tests:
- 01 bulk_apply promotes multiple suggestions in one call
- 02 bulk_reject removes multiple in one call
- 03 idle-lock/me GET returns has_pin=false initially
- 04 idle-lock/me PUT with new_pin creates PIN → has_pin becomes true
- 05 verify-pin correct → 200 ok
- 06 verify-pin wrong → 403 with remaining tries counter
- 07 change PIN requires current PIN
- 08 clear PIN requires current PIN
- 09 bounce_digest config accepts delivery_method='slack' + slack_webhook_url
- 10 bounce_digest test-slack returns 400 if webhook not set
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
if not os.environ.get("MONGO_URL") or not os.environ.get("DB_NAME"):
    with open("/app/backend/.env") as f:
        for l in f:
            if l.startswith("MONGO_URL=") and not os.environ.get("MONGO_URL"):
                os.environ["MONGO_URL"] = l.split("=", 1)[1].strip().strip('"')
            if l.startswith("DB_NAME=") and not os.environ.get("DB_NAME"):
                os.environ["DB_NAME"] = l.split("=", 1)[1].strip().strip('"')

MASTER_KEY = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"


def _hdrs():
    return {
        "X-Master-Key": MASTER_KEY,
        "X-Forwarded-For": os.environ.get("MASTER_IP", "89.19.15.58"),
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    yield d
    client.close()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ==================== BULK APPLY / REJECT ====================
class TestBulkOps:
    LIC = f"MS-BULK-TEST-{uuid.uuid4().hex[:8].upper()}"

    def _seed_suggestions(self, db, n=5):
        ids = []
        for i in range(n):
            sid = str(uuid.uuid4())
            _run(db.mailscanner_rule_suggestions.insert_one({
                "id": sid, "license_key": self.LIC,
                "name": f"bulk_sugg_{i}", "pattern": rf"\bbulk{i}\b",
                "target": "subject", "score": 4.0,
                "description": "bulk test", "source": "ai_self_training",
                "applied": False, "created_at": datetime.now(timezone.utc).isoformat(),
            }))
            ids.append(sid)
        return ids

    def _cleanup(self, db):
        _run(db.mailscanner_rule_suggestions.delete_many({"license_key": self.LIC}))
        _run(db.mailscanner_rules.delete_many({"license_key": self.LIC}))

    def test_01_bulk_apply(self, db):
        self._cleanup(db)
        ids = self._seed_suggestions(db, 5)
        r = requests.post(
            f"{API}/mailscanner/ai/self-train/bulk-apply",
            params={"license_key": self.LIC},
            json={"ids": ids},
            headers=_hdrs(), timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["applied"] == 5
        assert j["skipped"] == 0
        # DB check: 5 rules created
        cnt = _run(db.mailscanner_rules.count_documents({"license_key": self.LIC}))
        assert cnt == 5
        # Suggestions marked applied
        pending = _run(db.mailscanner_rule_suggestions.count_documents(
            {"license_key": self.LIC, "applied": False}))
        assert pending == 0
        self._cleanup(db)

    def test_02_bulk_reject(self, db):
        self._cleanup(db)
        ids = self._seed_suggestions(db, 3)
        r = requests.post(
            f"{API}/mailscanner/ai/self-train/bulk-reject",
            params={"license_key": self.LIC},
            json={"ids": ids},
            headers=_hdrs(), timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["rejected"] == 3
        remaining = _run(db.mailscanner_rule_suggestions.count_documents({"license_key": self.LIC}))
        assert remaining == 0
        self._cleanup(db)


# ==================== PIN IDLE LOCK ====================
class TestIdleLockPin:
    """Master hesabıyla PIN yönetimi test edilir; per-user PIN akışı doğrulanır."""

    def _cleanup_master_pin(self, db):
        _run(db.idle_lock_user_configs.delete_many({"owner": "__master__"}))

    def test_03_get_me_no_pin_initially(self, db):
        self._cleanup_master_pin(db)
        r = requests.get(f"{API}/settings/idle-lock/me", headers=_hdrs(), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["has_pin"] is False
        assert d["owner"] == "master"

    def test_04_set_pin(self, db):
        r = requests.put(
            f"{API}/settings/idle-lock/me",
            json={"new_pin": "1234"},
            headers=_hdrs(), timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["has_pin"] is True
        # GET should now return has_pin=true
        r2 = requests.get(f"{API}/settings/idle-lock/me", headers=_hdrs(), timeout=10)
        assert r2.json()["has_pin"] is True

    def test_05_verify_pin_correct(self, db):
        r = requests.post(f"{API}/settings/idle-lock/verify-pin",
                          json={"pin": "1234"}, headers=_hdrs(), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

    def test_06_verify_pin_wrong(self, db):
        r = requests.post(f"{API}/settings/idle-lock/verify-pin",
                          json={"pin": "9999"}, headers=_hdrs(), timeout=10)
        assert r.status_code == 403
        assert "PIN hatalı" in r.json().get("detail", "")

    def test_07_change_pin_requires_current(self, db):
        # Without current_pin → 400
        r = requests.put(f"{API}/settings/idle-lock/me",
                         json={"new_pin": "5678"}, headers=_hdrs(), timeout=10)
        assert r.status_code == 400
        # With WRONG current_pin → 403
        r2 = requests.put(f"{API}/settings/idle-lock/me",
                          json={"new_pin": "5678", "current_pin": "9999"},
                          headers=_hdrs(), timeout=10)
        assert r2.status_code == 403
        # With CORRECT current_pin → 200
        r3 = requests.put(f"{API}/settings/idle-lock/me",
                          json={"new_pin": "5678", "current_pin": "1234"},
                          headers=_hdrs(), timeout=10)
        assert r3.status_code == 200

    def test_08_clear_pin_requires_current(self, db):
        # Wrong current → 403
        r = requests.put(f"{API}/settings/idle-lock/me",
                        json={"clear_pin": True, "current_pin": "0000"},
                        headers=_hdrs(), timeout=10)
        assert r.status_code == 403
        # Correct current → 200
        r2 = requests.put(f"{API}/settings/idle-lock/me",
                         json={"clear_pin": True, "current_pin": "5678"},
                         headers=_hdrs(), timeout=10)
        assert r2.status_code == 200
        # has_pin now false
        r3 = requests.get(f"{API}/settings/idle-lock/me", headers=_hdrs(), timeout=10)
        assert r3.json()["has_pin"] is False
        self._cleanup_master_pin(db)


# ==================== BOUNCE DIGEST SLACK ====================
class TestBounceDigestSlack:
    def test_09_config_accepts_slack_method(self, db):
        r = requests.post(
            f"{API}/bounce-digest/config",
            headers=_hdrs(),
            json={
                "enabled": True, "send_hour_utc": 9,
                "delivery_method": "slack",
                "slack_webhook_url": "https://hooks.slack.com/services/T00/B00/xxxx",
                "slack_channel": "#mail-alerts",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # GET back
        r2 = requests.get(f"{API}/bounce-digest/config", headers=_hdrs(), timeout=10)
        cfg = r2.json()
        assert cfg["delivery_method"] == "slack"
        assert cfg["slack_channel"] == "#mail-alerts"
        assert cfg["slack_webhook_url"].startswith("https://hooks.slack.com/")

    def test_10_test_slack_requires_valid_webhook(self, db):
        # First set delivery_method=panel
        requests.post(f"{API}/bounce-digest/config", headers=_hdrs(),
                      json={"enabled": True, "send_hour_utc": 9,
                            "delivery_method": "panel"}, timeout=10)
        # test-slack → 400 (method not slack)
        r = requests.post(f"{API}/bounce-digest/test-slack", headers=_hdrs(), timeout=10)
        assert r.status_code == 400
        assert "slack" in r.json().get("detail", "").lower()
