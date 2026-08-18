"""v43.85 — Master License Protection (delete/suspend/bulk-delete koruması).

Bug: Kullanıcı master license'ı frontend'de görüyor ve silmeye çalışıyor. Backend
tüm delete yollarında (DELETE, POST /delete, bulk-action delete, toggle-active
inaktif) master license'ı korumalı → 403 döner.

Tests:
- 01 GET /licenses master için `is_master: True` ve `protected: True` bayrağı döner
- 02 DELETE /licenses/{master_key} → 403 (Master lisans korumalıdır)
- 03 POST /licenses/{master_key}/delete → 403 (WAF-safe alternate)
- 04 POST /licenses/bulk-action {ids: [master], action: delete} → 403
- 05 POST /licenses/bulk-action {ids: [master], action: suspend} → 403
- 06 POST /licenses/{master_id}/toggle-active → 403 (aktifken inaktif etme)
- 07 Regular license silme (protection scope only master) → başarılı 200
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


class TestMasterLicenseProtection:
    def test_01_licenses_list_has_master_flags(self):
        r = requests.get(f"{API}/licenses", headers=_hdrs(), timeout=10)
        assert r.status_code == 200
        items = r.json()
        m = next((l for l in items if l.get("license_key") == MASTER_KEY), None)
        assert m is not None, "Master license should exist in list"
        assert m.get("is_master") is True
        assert m.get("protected") is True

    def test_02_delete_master_forbidden(self):
        r = requests.delete(f"{API}/licenses/{MASTER_KEY}", headers=_hdrs(), timeout=10)
        assert r.status_code == 403
        assert "master" in r.json().get("detail", "").lower()

    def test_03_post_delete_master_forbidden(self):
        """Frontend'in kullandığı POST alternatifi."""
        r = requests.post(f"{API}/licenses/{MASTER_KEY}/delete",
                          headers=_hdrs(), timeout=10)
        assert r.status_code == 403
        assert "master" in r.json().get("detail", "").lower()

    def test_04_bulk_delete_master_forbidden(self):
        r = requests.post(f"{API}/licenses/bulk-action",
                          headers=_hdrs(),
                          json={"ids": [MASTER_KEY], "action": "delete"},
                          timeout=10)
        assert r.status_code == 403

    def test_05_bulk_suspend_master_forbidden(self):
        r = requests.post(f"{API}/licenses/bulk-action",
                          headers=_hdrs(),
                          json={"ids": [MASTER_KEY], "action": "suspend"},
                          timeout=10)
        assert r.status_code == 403

    def test_06_toggle_active_master_forbidden(self, db):
        master = _run(db.licenses.find_one({"license_key": MASTER_KEY},
                                            {"_id": 0, "id": 1, "active": 1}))
        assert master is not None
        assert master.get("active") is True  # baseline
        r = requests.post(f"{API}/licenses/{master['id']}/toggle-active",
                          headers=_hdrs(), timeout=10)
        assert r.status_code == 403
        # DB'de hala aktif olduğunu doğrula
        after = _run(db.licenses.find_one({"license_key": MASTER_KEY}, {"_id": 0, "active": 1}))
        assert after["active"] is True

    def test_07_regular_license_delete_still_works(self, db):
        """Master koruması diğer lisansları etkilememeli."""
        lic_key = f"MS-DELTEST-{uuid.uuid4().hex[:12].upper()}"
        lic_id = str(uuid.uuid4())
        _run(db.licenses.insert_one({
            "id": lic_id, "license_key": lic_key,
            "customer_name": "Delete Test", "customer_email": "del@test.tld",
            "plan": "starter", "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        try:
            r = requests.post(f"{API}/licenses/{lic_id}/delete",
                              headers=_hdrs(), timeout=10)
            assert r.status_code == 200, r.text
            assert r.json()["deleted"] is True
        finally:
            _run(db.licenses.delete_many({"license_key": lic_key}))
            _run(db.revoked_licenses.delete_many({"license_key": lic_key}))
