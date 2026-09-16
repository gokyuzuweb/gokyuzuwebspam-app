"""v44.00.39b — Rescore + whitelist backfill + SA override on historical events."""
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


HEADERS = """X-Spam-Status: Yes, score=6.0 tests=MISSING_MID,DOS_BODY_HIGH_NO_MID
X-Spam-Report:
 *  1.4 MISSING_MID Missing Message-Id: header
 *  2.8 DOS_BODY_HIGH_NO_MID High-bit body & no MID
"""


def _seed_wl(email: str):
    async def go():
        await _db.lists.update_one(
            {"list_type": "white", "entry_type": "email", "value": email},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "entry_type": "email", "value": email,
                "list_type": "white", "scope": "global", "note": "pytest v44.00.39b",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }}, upsert=True,
        )
    asyncio.get_event_loop().run_until_complete(go())


def _insert_legacy_spam(subject: str, email: str) -> str:
    """Inserts a mail_event WITHOUT going through ingest → simulates pre-fix data."""
    _id = str(uuid.uuid4())
    async def go():
        await _db.mail_events.insert_one({
            "id": _id,
            "license_key": MASTER,
            "from_addr": email,
            "to_addr": "user@example.net",
            "subject": subject,
            "verdict": "spam",
            "total_score": 6.0,
            "scores": {"spamassassin": 6.0},
            "headers_full": HEADERS,
            "ts": datetime.now(timezone.utc).isoformat(),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        })
    asyncio.get_event_loop().run_until_complete(go())
    return _id


def _cleanup():
    async def go():
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYRSC_"}})
        await _db.lists.delete_many({"note": "pytest v44.00.39b"})
    asyncio.get_event_loop().run_until_complete(go())


def test_backfill_flips_legacy_spam_to_whitelisted():
    """Legacy spam event (whitelist eklenmeden ingest edilmis) → rescore
    sonrasi whitelist match verdict = whitelisted olmali."""
    _cleanup()
    email = f"backfill_{uuid.uuid4().hex[:6]}@corp-test.tr"
    _seed_wl(email)
    _id = _insert_legacy_spam(f"PYRSC_LEGACY_{uuid.uuid4().hex[:6]}", email)

    r = requests.post(
        f"{BACKEND}/api/events/rescore",
        headers={"x-master-key": MASTER},
        params={"license_key": MASTER, "apply_whitelist": "true",
                "apply_sa_overrides": "false"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["whitelisted"] >= 1, data

    async def _fetch():
        return await _db.mail_events.find_one({"id": _id}, {"_id": 0})
    doc = asyncio.get_event_loop().run_until_complete(_fetch())
    assert doc["verdict"] == "whitelisted", doc
    assert doc.get("whitelist_hit"), doc
    _cleanup()


def test_rescore_preserves_whitelisted_when_sa_high():
    """SA skoru 6.0 olsa bile mevcut verdict=whitelisted degistirilmemeli."""
    _cleanup()
    email = f"preserve_{uuid.uuid4().hex[:6]}@corp-test.tr"
    _id = str(uuid.uuid4())

    async def seed():
        await _db.mail_events.insert_one({
            "id": _id,
            "license_key": MASTER,
            "from_addr": email,
            "subject": f"PYRSC_KEEP_{uuid.uuid4().hex[:6]}",
            "verdict": "whitelisted",
            "verdict_original": "spam",
            "whitelist_hit": {"entry_type": "email", "value": email},
            "total_score": 6.0,
            "scores": {"spamassassin": 6.0},
            "headers_full": HEADERS,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    asyncio.get_event_loop().run_until_complete(seed())

    r = requests.post(
        f"{BACKEND}/api/events/rescore",
        headers={"x-master-key": MASTER},
        params={"license_key": MASTER},
        timeout=30,
    )
    assert r.status_code == 200, r.text

    async def _fetch():
        return await _db.mail_events.find_one({"id": _id}, {"_id": 0})
    doc = asyncio.get_event_loop().run_until_complete(_fetch())
    assert doc["verdict"] == "whitelisted", doc
    _cleanup()


def test_sa_override_applied_on_history():
    """Turkish-corp preset varsa, gecmis kayitlarin SA skoru rescore ile duser."""
    _cleanup()
    email = f"sa_ov_{uuid.uuid4().hex[:6]}@none-wl.tr"
    _id = _insert_legacy_spam(f"PYRSC_SAOV_{uuid.uuid4().hex[:6]}", email)

    # Turkish-corp preset ac
    r = requests.post(
        f"{BACKEND}/api/mailscanner/sa-overrides/preset/turkish-corp",
        headers={"x-master-key": MASTER},
        params={"license_key": MASTER, "merge": "false"},
        timeout=15,
    )
    assert r.status_code == 200, r.text

    r = requests.post(
        f"{BACKEND}/api/events/rescore",
        headers={"x-master-key": MASTER},
        params={"license_key": MASTER, "apply_sa_overrides": "true",
                "apply_whitelist": "false"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["sa_override_applied"] >= 1, data

    async def _fetch():
        return await _db.mail_events.find_one({"id": _id}, {"_id": 0})
    doc = asyncio.get_event_loop().run_until_complete(_fetch())
    # 6.0 - 1.4 - 2.3 = 2.3 → verdict clean
    assert doc["total_score"] < 3.0, doc
    assert doc["verdict"] == "clean", doc
    assert doc.get("sa_overrides_applied") is True

    # Preset kapat
    requests.post(f"{BACKEND}/api/mailscanner/sa-overrides/preset/off",
                  headers={"x-master-key": MASTER},
                  params={"license_key": MASTER}, timeout=15)
    _cleanup()
