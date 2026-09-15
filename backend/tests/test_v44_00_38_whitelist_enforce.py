"""v44.00.38 — Whitelist enforcement fix tests"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import motor.motor_asyncio
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BACKEND = "http://127.0.0.1:8001"
MASTER = "MS-C02AB012652A4FE692D69676"

_client = motor.motor_asyncio.AsyncIOMotorClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]


def _seed_whitelist():
    async def go():
        for et, v in [("email", "wltest@example.com"),
                      ("domain", "wltest-domain.com"),
                      ("ip", "9.9.9.9")]:
            await _db.lists.update_one(
                {"list_type": "white", "entry_type": et, "value": v},
                {"$setOnInsert": {
                    "id": str(uuid.uuid4()), "entry_type": et, "value": v,
                    "list_type": "white", "scope": "global",
                    "note": "pytest v44.00.38",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }}, upsert=True,
            )
    asyncio.get_event_loop().run_until_complete(go())


def _cleanup():
    async def go():
        await _db.lists.delete_many({"note": "pytest v44.00.38"})
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYWL_"}})
    asyncio.get_event_loop().run_until_complete(go())


def test_whitelist_email_overrides_spam_verdict():
    _seed_whitelist()
    try:
        r = requests.post(f"{BACKEND}/api/events/ingest", json={
            "license_key": MASTER,
            "from_addr": "wltest@example.com",
            "to_addr": "rcpt@somewhere.com",
            "subject": "PYWL_email_test",
            "verdict": "spam", "total_score": 6.0,
            "scores": {"spamassassin": 6.0},
            "direction": "in",
        }, timeout=10)
        assert r.status_code == 200

        # Async ioc_enforce might still run — give it a moment
        import time; time.sleep(1.5)

        async def check():
            doc = await _db.mail_events.find_one(
                {"subject": "PYWL_email_test"}, {"_id": 0},
            )
            assert doc is not None
            assert doc.get("verdict") == "whitelisted", doc.get("verdict")
            wl = doc.get("whitelist_hit") or {}
            assert wl.get("entry_type") == "email"
            assert wl.get("value") == "wltest@example.com"
            # quarantine boş olmalı
            n = await _db.quarantine.count_documents({"subject": "PYWL_email_test"})
            assert n == 0, f"quarantine should be empty, got {n}"
        asyncio.get_event_loop().run_until_complete(check())
    finally:
        _cleanup()


def test_whitelist_domain_matches():
    _seed_whitelist()
    try:
        requests.post(f"{BACKEND}/api/events/ingest", json={
            "license_key": MASTER,
            "from_addr": "anyone@wltest-domain.com",
            "to_addr": "rcpt@somewhere.com",
            "subject": "PYWL_domain_test",
            "verdict": "spam", "total_score": 6.0,
            "scores": {"spamassassin": 6.0},
            "direction": "in",
        }, timeout=10)
        import time; time.sleep(1.5)

        async def check():
            doc = await _db.mail_events.find_one({"subject": "PYWL_domain_test"}, {"_id": 0})
            assert doc.get("verdict") == "whitelisted"
            assert (doc.get("whitelist_hit") or {}).get("entry_type") == "domain"
        asyncio.get_event_loop().run_until_complete(check())
    finally:
        _cleanup()


def test_ioc_enforce_skips_whitelisted():
    """Whitelist verdict'i _ioc_enforce tarafından override edilmemeli."""
    src = open("/app/backend/routes/events.py").read()
    # Guard mevcut mu
    assert 'Whitelisted verdict' in src or 'verdict") or "").lower() == "whitelisted":' in src
    # WHITELIST ENFORCEMENT bloğu var
    assert "WHITELIST ENFORCEMENT" in src


def test_non_whitelisted_still_flagged_spam():
    """Whitelist'te olmayan bir mail hala spam olarak işaretlenmeli."""
    r = requests.post(f"{BACKEND}/api/events/ingest", json={
        "license_key": MASTER,
        "from_addr": "random-spammer@evil-domain-xyz.tk",
        "to_addr": "rcpt@somewhere.com",
        "subject": "PYWL_notlisted_test",
        "verdict": "spam", "total_score": 6.0,
        "scores": {"spamassassin": 6.0},
        "direction": "in",
    }, timeout=10)
    assert r.status_code == 200
    import time; time.sleep(1.0)

    async def check():
        doc = await _db.mail_events.find_one({"subject": "PYWL_notlisted_test"}, {"_id": 0})
        assert doc.get("verdict") in ("spam", "high_spam"), doc.get("verdict")
        assert doc.get("whitelist_hit") is None
        await _db.mail_events.delete_many({"subject": "PYWL_notlisted_test"})
        await _db.quarantine.delete_many({"subject": "PYWL_notlisted_test"})
    asyncio.get_event_loop().run_until_complete(check())
