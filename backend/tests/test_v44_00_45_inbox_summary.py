"""v44.00.45 — Bayi INBOX/Junk Ozet Karti endpoint testleri.

`GET /api/lists-manager/inbox-summary` bayi kendi lisansi icin son 24 saatteki
INBOX teslim / Junk atma sayilarini ve Ekle-de-Unut motorunun retroaktif
istatistiklerini dondurmeli.
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

MARK = f"PYSUM_{uuid.uuid4().hex[:6]}"


def _cleanup():
    async def go():
        await _db.mail_events.delete_many({"subject": {"$regex": f"^{MARK}"}})
        await _db.pending_quarantine_actions.delete_many(
            {"reason": {"$regex": f"^{MARK.lower()}"}}
        )
    asyncio.get_event_loop().run_until_complete(go())


def _insert_event(verdict: str):
    async def go():
        await _db.mail_events.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": MASTER,
            "from_addr": f"user@{MARK.lower()}.com",
            "to_addr": "boss@sirket.local",
            "subject": f"{MARK}_{verdict}",
            "ts": datetime.now(timezone.utc).isoformat(),
            "direction": "in",
            "verdict": verdict,
            "total_score": 3.0 if verdict == "clean" else 8.5,
        })
    asyncio.get_event_loop().run_until_complete(go())


def _insert_action(action: str, completed: bool = False):
    async def go():
        await _db.pending_quarantine_actions.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": MASTER,
            "action": action,
            "match": {"entry_type": "domain", "value": f"{MARK.lower()}.com", "since_days": 30},
            "reason": f"{MARK.lower()}:{action}",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat() if completed else None,
            "result": "ok" if completed else None,
        })
    asyncio.get_event_loop().run_until_complete(go())


def _fetch_summary(hours: int = 24) -> dict:
    r = requests.get(
        f"{BACKEND}/api/lists-manager/inbox-summary",
        params={"license_key": MASTER, "hours": hours},
        timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    return r.json()


def test_inbox_summary_shape():
    _cleanup()
    j = _fetch_summary()
    for key in [
        "inbox_delivered", "junked", "quarantined",
        "retro_junk_to_inbox", "retro_inbox_purged",
        "retro_completed", "retro_pending",
        "whitelist_size", "blacklist_size", "hours", "since",
    ]:
        assert key in j, f"missing key {key}"
    assert j["hours"] == 24
    _cleanup()


def test_inbox_summary_counts_verdicts():
    _cleanup()
    baseline = _fetch_summary()
    _insert_event("clean")
    _insert_event("clean")
    _insert_event("spam")
    j = _fetch_summary()
    assert j["inbox_delivered"] >= baseline["inbox_delivered"] + 2
    assert j["junked"] >= baseline["junked"] + 1
    _cleanup()


def test_inbox_summary_counts_retro_actions():
    _cleanup()
    baseline = _fetch_summary()
    _insert_action("junk_to_inbox", completed=True)
    _insert_action("inbox_purge", completed=False)
    j = _fetch_summary()
    assert j["retro_junk_to_inbox"] >= baseline["retro_junk_to_inbox"] + 1
    assert j["retro_inbox_purged"] >= baseline["retro_inbox_purged"] + 1
    assert j["retro_pending"] >= baseline["retro_pending"] + 1
    assert j["retro_completed"] >= baseline["retro_completed"] + 1
    _cleanup()
