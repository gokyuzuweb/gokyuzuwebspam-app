"""v43.82 — Discord embed delivery + Karantina Weekly Report.

Tests:
- 01 bounce_digest config accepts delivery_method='discord' + discord_webhook_url
- 02 test-discord returns 400 if method != discord
- 03 test-discord returns 400 if URL invalid
- 04 weekly-report endpoint returns count of new suggestions (last 7d)
- 05 weekly-report response contains top_rows with license_key + new_count
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


class TestDiscordDelivery:
    def test_01_config_accepts_discord_method(self, db):
        r = requests.post(
            f"{API}/bounce-digest/config",
            headers=_hdrs(),
            json={
                "enabled": True, "send_hour_utc": 9,
                "delivery_method": "discord",
                "discord_webhook_url": "https://discord.com/api/webhooks/1234/abcd",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/bounce-digest/config", headers=_hdrs(), timeout=10)
        cfg = r2.json()
        assert cfg["delivery_method"] == "discord"
        assert cfg["discord_webhook_url"].startswith("https://discord.com/api/webhooks/")

    def test_02_test_discord_wrong_method_returns_400(self, db):
        # Reset method to panel
        requests.post(f"{API}/bounce-digest/config", headers=_hdrs(),
                      json={"enabled": True, "send_hour_utc": 9,
                            "delivery_method": "panel"}, timeout=10)
        r = requests.post(f"{API}/bounce-digest/test-discord", headers=_hdrs(), timeout=10)
        assert r.status_code == 400
        assert "discord" in r.json().get("detail", "").lower()

    def test_03_test_discord_invalid_url_returns_400(self, db):
        # Set method=discord but with bad URL
        requests.post(f"{API}/bounce-digest/config", headers=_hdrs(),
                      json={"enabled": True, "send_hour_utc": 9,
                            "delivery_method": "discord",
                            "discord_webhook_url": "https://example.com/not-discord"}, timeout=10)
        r = requests.post(f"{API}/bounce-digest/test-discord", headers=_hdrs(), timeout=10)
        assert r.status_code == 400
        assert "discord" in r.json().get("detail", "").lower()


class TestWeeklyReport:
    LIC = f"MS-WEEKLY-TEST-{uuid.uuid4().hex[:8].upper()}"

    def _seed_suggestions(self, db, n=3):
        now = datetime.now(timezone.utc).isoformat()
        for i in range(n):
            _run(db.mailscanner_rule_suggestions.insert_one({
                "id": str(uuid.uuid4()), "license_key": self.LIC,
                "name": f"weekly_test_{i}", "pattern": rf"\bwk{i}\b",
                "target": "sender", "score": 4.5,
                "hit_count": 10 + i,
                "description": "weekly report seed",
                "source": "quarantine_pattern",
                "sub_source": "sender_domain",
                "applied": False, "created_at": now,
            }))

    def _cleanup(self, db):
        _run(db.mailscanner_rule_suggestions.delete_many({"license_key": self.LIC}))
        _run(db.ai_training_log.delete_many({"kind": "quarantine_weekly_report"}))

    def test_04_weekly_report_counts_recent_suggestions(self, db):
        self._cleanup(db)
        self._seed_suggestions(db, 3)
        r = requests.post(
            f"{API}/mailscanner/ai/quarantine-recommend/weekly-report",
            headers=_hdrs(), timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["total_new_suggestions"] >= 3
        assert d["active_licenses"] >= 1
        assert isinstance(d["top_rows"], list)
        # LIC should appear in top_rows
        lic_row = next((r for r in d["top_rows"] if r["_id"] == self.LIC), None)
        assert lic_row is not None
        assert lic_row["new_count"] == 3

    def test_05_weekly_report_saved_to_audit_log(self, db):
        # After test_04, ai_training_log should have a report entry
        entry = _run(db.ai_training_log.find_one(
            {"kind": "quarantine_weekly_report"},
            sort=[("generated_at", -1)],
        ))
        assert entry is not None
        assert entry["total_new_suggestions"] >= 3
        self._cleanup(db)
