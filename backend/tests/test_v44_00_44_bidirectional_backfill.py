"""v44.00.44 — Genel Whitelist/Blacklist Motoru (Ekle-de-Unut).

Test kapsami:
  1) POST /api/lists-manager/add  kind=whitelist  => otomatik action=junk_to_inbox
     pending_quarantine_actions olusturur (son 30 gunluk mailleri olan tenant'lar icin).
  2) POST /api/lists-manager/add  kind=blacklist  => otomatik action=inbox_purge
     pending_quarantine_actions olusturur.
  3) GET /api/mailscanner/sa-whitelist.cf  whitelist entries icin whitelist_from ureti.
  4) GET /api/mailscanner/sa-blacklist.cf  blacklist entries icin blacklist_from ureti.
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import motor.motor_asyncio
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BACKEND = "http://127.0.0.1:8001"
MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")

_client = motor.motor_asyncio.AsyncIOMotorClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]

TEST_DOMAIN_W = f"pytest-white-{uuid.uuid4().hex[:6]}.com"
TEST_DOMAIN_B = f"pytest-black-{uuid.uuid4().hex[:6]}.com"


def _cleanup():
    async def go():
        # test lists & test actions
        await _db.lists.delete_many({"value": {"$in": [TEST_DOMAIN_W, TEST_DOMAIN_B]}})
        await _db.pending_quarantine_actions.delete_many(
            {"reason": {"$regex": "pytest-white|pytest-black"}}
        )
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYBIDIR_"}})
        await _db.trusted_domains.delete_many(
            {"domain": {"$in": [TEST_DOMAIN_W, TEST_DOMAIN_B]}}
        )
    asyncio.get_event_loop().run_until_complete(go())


def _seed_mail_event(from_addr: str, license_key: str = MASTER):
    """Backfill'in triggerlanmasi icin son 24 saat icinde bir mail_event ekle."""
    async def go():
        await _db.mail_events.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": license_key,
            "from_addr": from_addr,
            "to_addr": "user@sirket.local",
            "subject": f"PYBIDIR_{uuid.uuid4().hex[:6]}",
            "ts": datetime.now(timezone.utc).isoformat(),
            "direction": "in",
            "verdict": "clean",
            "total_score": 2.0,
        })
    asyncio.get_event_loop().run_until_complete(go())


def _add_list(kind: str, value: str) -> dict:
    r = requests.post(
        f"{BACKEND}/api/lists-manager/add",
        params={"license_key": MASTER},
        json={"kind": kind, "entry_type": "domain", "value": value, "note": "pytest"},
        timeout=15,
    )
    assert r.status_code == 200, f"{kind} add failed: {r.status_code} {r.text}"
    return r.json()


def _count_actions(reason_prefix: str, action_type: str) -> int:
    async def go():
        return await _db.pending_quarantine_actions.count_documents(
            {"reason": {"$regex": f"^{reason_prefix}"}, "action": action_type}
        )
    return asyncio.get_event_loop().run_until_complete(go())


def test_whitelist_add_triggers_junk_to_inbox_action():
    _cleanup()
    _seed_mail_event(from_addr=f"boss@{TEST_DOMAIN_W}")
    resp = _add_list("whitelist", TEST_DOMAIN_W)
    assert resp["ok"] is True
    assert resp["kind"] == "whitelist"
    assert resp["action_type"] == "junk_to_inbox"
    assert resp["purge_queued_licenses"] >= 1, "whitelist eklenince en az 1 action olusmali"
    # DB'de action dogrula
    n = _count_actions(reason_prefix=f"whitelist_add:domain:{TEST_DOMAIN_W}", action_type="junk_to_inbox")
    assert n >= 1
    _cleanup()


def test_blacklist_add_triggers_inbox_purge_action():
    _cleanup()
    _seed_mail_event(from_addr=f"attacker@{TEST_DOMAIN_B}")
    resp = _add_list("blacklist", TEST_DOMAIN_B)
    assert resp["ok"] is True
    assert resp["kind"] == "blacklist"
    assert resp["action_type"] == "inbox_purge"
    assert resp["purge_queued_licenses"] >= 1
    n = _count_actions(reason_prefix=f"blacklist_add:domain:{TEST_DOMAIN_B}", action_type="inbox_purge")
    assert n >= 1
    _cleanup()


def test_sa_whitelist_cf_contains_added_domain():
    _cleanup()
    _add_list("whitelist", TEST_DOMAIN_W)
    r = requests.get(
        f"{BACKEND}/api/mailscanner/sa-whitelist.cf",
        params={"license_key": MASTER}, timeout=15,
    )
    assert r.status_code == 200
    txt = r.text
    assert f"whitelist_from *@{TEST_DOMAIN_W}" in txt, "sa-whitelist.cf'e domain yansimadi"
    _cleanup()


def test_sa_blacklist_cf_contains_added_domain():
    _cleanup()
    _add_list("blacklist", TEST_DOMAIN_B)
    r = requests.get(
        f"{BACKEND}/api/mailscanner/sa-blacklist.cf",
        params={"license_key": MASTER}, timeout=15,
    )
    assert r.status_code == 200
    txt = r.text
    assert f"blacklist_from *@{TEST_DOMAIN_B}" in txt, "sa-blacklist.cf'e domain yansimadi"
    _cleanup()
