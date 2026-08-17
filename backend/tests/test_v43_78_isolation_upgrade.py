"""v43.78 backend tests (single class → single xdist worker, sequential).

Covers:
- Country rules tenant isolation (master vs bayilerv)
- Starter plan feature gate on security_config
- Master country rule + PRO does not see it
- Delete isolation (PRO cannot delete master's rule)
- Slash aliases CRUD (master-only)
- Havale approve auto-upgrade of bayi plan (starter → pro)
- Marketplace trusted_only filter
"""
import os
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

# ensure MONGO_URL / DB_NAME are set
if not os.environ.get("MONGO_URL") or not os.environ.get("DB_NAME"):
    with open("/app/backend/.env") as f:
        for l in f:
            if l.startswith("MONGO_URL=") and not os.environ.get("MONGO_URL"):
                os.environ["MONGO_URL"] = l.split("=", 1)[1].strip().strip('"')
            elif l.startswith("DB_NAME=") and not os.environ.get("DB_NAME"):
                os.environ["DB_NAME"] = l.split("=", 1)[1].strip().strip('"')

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
MASTER_IP = "89.19.15.58"
STARTER_KEY = "MS-TESTBAYI-STARTER-V4371"
PRO_KEY = "MS-TESTBAYI-PRO-V4371"
STARTER_EMAIL = "starter-bayi-v4378@example.com"


def _hm():
    return {"X-Master-Key": MASTER_KEY, "X-Forwarded-For": MASTER_IP,
            "Content-Type": "application/json"}

def _hb(key):
    return {"X-Master-Key": key, "Content-Type": "application/json"}


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


class TestV4378Isolation:
    """One-class suite so xdist loadscope keeps all tests on one worker."""
    _merchant_oid = None

    @classmethod
    def setup_class(cls):
        async def go():
            db = await _db()
            await db.licenses.update_one(
                {"license_key": STARTER_KEY},
                {"$set": {"email": STARTER_EMAIL, "active": True, "plan": "starter"}},
            )
            # Clean any leftover test rules
            await db.country_rules.delete_many(
                {"country_code": {"$in": ["CN", "RU", "DE"]},
                 "owner_license_key": {"$in": [PRO_KEY, STARTER_KEY, "__master__"]}}
            )
            await db.slash_aliases.delete_many({"name": "testalias"})
        _run(go())

    @classmethod
    def teardown_class(cls):
        async def go():
            db = await _db()
            await db.licenses.update_one(
                {"license_key": STARTER_KEY},
                {"$set": {"plan": "starter"},
                 "$unset": {"subscription_expires_at": "", "last_upgrade_at": "",
                            "last_upgrade_from": "", "last_upgrade_merchant_oid": ""}},
            )
            await db.country_rules.delete_many(
                {"country_code": {"$in": ["CN", "RU", "DE"]},
                 "owner_license_key": {"$in": [PRO_KEY, STARTER_KEY, "__master__"]}}
            )
            await db.slash_aliases.delete_many({"name": "testalias"})
        _run(go())

    # ---- Country rules isolation ----
    def test_01_pro_bayi_add_cn(self):
        r = requests.post(f"{BASE_URL}/api/security/country-rules",
                          json={"country_code": "CN", "action": "block", "note": "pro-only"},
                          headers=_hb(PRO_KEY))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("owner_license_key") == PRO_KEY

    def test_02_master_get_excludes_pro_cn(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hm())
        assert r.status_code == 200
        d = r.json()
        assert d.get("is_master") is True
        codes = [x.get("country_code") for x in d.get("items", [])]
        assert "CN" not in codes, f"master leak: {d['items']}"

    def test_03_pro_get_includes_cn(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hb(PRO_KEY))
        assert r.status_code == 200
        d = r.json()
        assert d.get("is_master") is False
        codes = [x.get("country_code") for x in d.get("items", [])]
        assert "CN" in codes

    def test_04_starter_get_excludes_pro_cn(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hb(STARTER_KEY))
        assert r.status_code == 200
        codes = [x.get("country_code") for x in r.json().get("items", [])]
        assert "CN" not in codes

    # ---- Starter plan gate ----
    def test_05_starter_post_forbidden(self):
        r = requests.post(f"{BASE_URL}/api/security/country-rules",
                          json={"country_code": "DE", "action": "block"},
                          headers=_hb(STARTER_KEY))
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "plan" in detail.lower(), detail

    # ---- Master rule + isolation ----
    def test_06_master_add_ru(self):
        r = requests.post(f"{BASE_URL}/api/security/country-rules",
                          json={"country_code": "RU", "action": "block", "note": "master"},
                          headers=_hm())
        assert r.status_code == 200, r.text
        assert r.json().get("owner_license_key") == "__master__"

    def test_07_master_get_includes_ru(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hm())
        assert r.status_code == 200
        codes = [x.get("country_code") for x in r.json().get("items", [])]
        assert "RU" in codes

    def test_08_pro_get_excludes_master_ru(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hb(PRO_KEY))
        codes = [x.get("country_code") for x in r.json().get("items", [])]
        assert "RU" not in codes, f"pro leak: {r.json()['items']}"

    # ---- Delete isolation ----
    def test_09_pro_cannot_delete_master_ru(self):
        r = requests.delete(f"{BASE_URL}/api/security/country-rules/RU", headers=_hb(PRO_KEY))
        assert r.status_code == 200
        assert r.json().get("deleted") == 0

    def test_10_master_ru_still_exists(self):
        r = requests.get(f"{BASE_URL}/api/security/country-rules", headers=_hm())
        codes = [x.get("country_code") for x in r.json().get("items", [])]
        assert "RU" in codes

    # ---- Slash aliases ----
    def test_11_master_post_alias(self):
        r = requests.post(f"{BASE_URL}/api/slash-aliases",
                          json={"name": "testalias",
                                "expansion": "/run health-check @all",
                                "description": "test"}, headers=_hm())
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_12_master_get_alias(self):
        r = requests.get(f"{BASE_URL}/api/slash-aliases", headers=_hm())
        assert r.status_code == 200
        names = [x.get("name") for x in r.json().get("items", [])]
        assert "testalias" in names

    def test_13_non_master_post_forbidden(self):
        r = requests.post(f"{BASE_URL}/api/slash-aliases",
                          json={"name": "hackalias",
                                "expansion": "/run pwned", "description": ""},
                          headers=_hb(PRO_KEY))
        assert r.status_code in (401, 403), r.text

    def test_14_master_delete_alias(self):
        r = requests.delete(f"{BASE_URL}/api/slash-aliases/testalias", headers=_hm())
        assert r.status_code == 200
        assert r.json().get("deleted") == 1

    # ---- Havale approve auto-upgrade ----
    def test_15_create_havale(self):
        r = requests.post(f"{BASE_URL}/api/payments/havale/create",
                          json={"email": STARTER_EMAIL, "user_name": "Test Starter",
                                "plan": "pro", "amount": 749, "cycle": "monthly"},
                          headers={"Content-Type": "application/json"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("merchant_oid", "").startswith("TRF")
        TestV4378Isolation._merchant_oid = d["merchant_oid"]

    def test_16_approve_triggers_upgrade(self):
        oid = TestV4378Isolation._merchant_oid
        assert oid
        r = requests.post(f"{BASE_URL}/api/payments/havale/approve",
                          json={"merchant_oid": oid, "admin_note": "test approval"},
                          headers=_hm())
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "paid"
        up = d.get("upgrade") or {}
        assert up.get("upgraded") is True, up
        assert up.get("from_plan") == "starter"
        assert up.get("to_plan") == "pro"
        assert up.get("license_key") == STARTER_KEY

    def test_17_license_plan_persisted(self):
        async def go():
            db = await _db()
            return await db.licenses.find_one({"license_key": STARTER_KEY},
                                               {"_id": 0, "plan": 1,
                                                "subscription_expires_at": 1})
        lic = _run(go())
        assert lic.get("plan") == "pro", lic
        assert lic.get("subscription_expires_at"), lic

    def test_18_master_alert_created(self):
        async def go():
            db = await _db()
            return await db.master_alerts.find_one(
                {"type": "plan_upgraded", "license_key": STARTER_KEY},
                sort=[("created_at", -1)], projection={"_id": 0})
        row = _run(go())
        assert row is not None
        assert row.get("details", {}).get("to_plan") == "pro"

    # ---- Marketplace trusted_only ----
    def test_19_marketplace_trusted_only(self):
        r_all = requests.get(f"{BASE_URL}/api/marketplace/signatures", headers=_hb(PRO_KEY))
        r_t = requests.get(f"{BASE_URL}/api/marketplace/signatures?trusted_only=true",
                           headers=_hb(PRO_KEY))
        assert r_all.status_code == 200
        assert r_t.status_code == 200
        all_items = r_all.json().get("items", [])
        trusted = r_t.json().get("items", [])
        for it in trusted:
            assert "publisher_tier" in it, f"missing publisher_tier: {it}"
        assert len(trusted) <= len(all_items)
