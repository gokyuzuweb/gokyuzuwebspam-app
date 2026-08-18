"""v43.86 — Master Protection Bypass + Rotation Wizard + Foreign IP Alarm + License Audit Log."""
import os, uuid, asyncio
from datetime import datetime, timezone
import pytest, requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = l.split("=", 1)[1].strip().rstrip("/")
if not os.environ.get("MONGO_URL") or not os.environ.get("DB_NAME"):
    with open("/app/backend/.env") as f:
        for l in f:
            if l.startswith("MONGO_URL=") and not os.environ.get("MONGO_URL"):
                os.environ["MONGO_URL"] = l.split("=", 1)[1].strip().strip('"')
            if l.startswith("DB_NAME=") and not os.environ.get("DB_NAME"):
                os.environ["DB_NAME"] = l.split("=", 1)[1].strip().strip('"')

MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"


def _hdrs(ip="89.19.15.58"):
    return {"X-Master-Key": MASTER, "X-Forwarded-For": ip, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    yield c[os.environ["DB_NAME"]]
    c.close()


def _run(coro): return asyncio.get_event_loop().run_until_complete(coro)


class TestMasterProtectionBypass:
    def test_01_get_default_active(self, db):
        _run(db.settings.delete_one({"_key": "master_protection"}))
        r = requests.get(f"{API}/settings/master-protection", headers=_hdrs(), timeout=10)
        assert r.status_code == 200
        assert r.json()["protection_active"] is True
        assert r.json()["bypass_active"] is False

    def test_02_disable_requires_two_confirms(self, db):
        r = requests.post(f"{API}/settings/master-protection/disable", headers=_hdrs(),
                          json={"disable_minutes": 5}, timeout=10)
        assert r.status_code == 400
        r2 = requests.post(f"{API}/settings/master-protection/disable", headers=_hdrs(),
                           json={"disable_minutes": 5, "confirm_1": True, "confirm_2": False}, timeout=10)
        assert r2.status_code == 400

    def test_03_disable_success_and_delete_bypass(self, db):
        r = requests.post(f"{API}/settings/master-protection/disable", headers=_hdrs(),
                          json={"disable_minutes": 5, "confirm_1": True, "confirm_2": True, "reason": "test"},
                          timeout=10)
        assert r.status_code == 200
        assert "bypass_until" in r.json()
        # Master delete artık geçmeli
        r2 = requests.post(f"{API}/licenses/{MASTER}/delete", headers=_hdrs(), timeout=10)
        assert r2.status_code == 200
        # Restore master + protection
        _run(db.revoked_licenses.delete_many({"license_key": MASTER}))
        _run(db.licenses.update_one(
            {"license_key": MASTER},
            {"$set": {"license_key": MASTER, "is_master": True, "active": True, "plan": "enterprise",
                       "id": "e6e78026-5c4d-4889-bbf4-3f5e4f69562b",
                       "customer_name": "GökyüzüWebSpam Master",
                       "customer_email": "master@gokyuzuhosting.com",
                       "max_domains": 10000, "ip_addresses": ["89.19.15.58"],
                       "valid_until": "2030-12-31T23:59:59+00:00"}},
            upsert=True))
        requests.post(f"{API}/settings/master-protection/enable", headers=_hdrs(), timeout=10)

    def test_04_audit_log_written(self, db):
        # Aksiyon logları var mı?
        cnt = _run(db.audit_logs.count_documents({"action": {"$in": [
            "master_protection_disabled", "license_deleted",
        ]}}))
        assert cnt >= 2


class TestForeignIpAlarm:
    def test_05_master_key_from_foreign_ip_creates_alert(self, db):
        # Cleanup existing alerts
        _run(db.master_alerts.delete_many({"type": "master_key_from_foreign_ip",
                                             "details.client_ip": "77.77.77.77"}))
        r = requests.get(f"{API}/admin/whoami", headers=_hdrs(ip="77.77.77.77"), timeout=10)
        assert r.status_code == 200
        # Alert should exist
        alert = _run(db.master_alerts.find_one({"type": "master_key_from_foreign_ip",
                                                  "details.client_ip": "77.77.77.77"}))
        assert alert is not None
        assert alert["severity"] == "critical"
        assert alert["details"]["expected_ip"] == "89.19.15.58"


class TestRotationWizard:
    def test_06_generate_candidate(self, db):
        _run(db.settings.delete_one({"_key": "master_rotate_candidate"}))
        r = requests.post(f"{API}/settings/master-rotate/generate", headers=_hdrs(),
                          json={"reason": "annual test"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["new_candidate_key"].startswith("MS-")
        assert len(d["next_steps"]) == 4

    def test_07_complete_without_env_update_fails(self, db):
        r = requests.post(f"{API}/settings/master-rotate/complete", headers=_hdrs(), timeout=10)
        assert r.status_code == 412
        assert "env" in r.json().get("detail", "").lower()

    def test_08_cancel_rotation(self, db):
        r = requests.post(f"{API}/settings/master-rotate/cancel", headers=_hdrs(), timeout=10)
        assert r.status_code == 200
        assert r.json()["ok"] is True
