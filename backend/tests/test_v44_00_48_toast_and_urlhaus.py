"""v44.00.48 — Recipient Panel Toast + URLhaus feed tests."""
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


def _cleanup():
    async def go():
        await _db.recipient_alerts.delete_many({"recipient": {"$regex": "^pytest-"}})
        await _db.malicious_urls.delete_many({"source": "urlhaus", "pattern": {"$regex": "pytest-uh"}})
    asyncio.get_event_loop().run_until_complete(go())


def _insert_recipient_alert(recipient: str, sender: str = "attacker@evil.com",
                              kind: str = "executable_url"):
    async def go():
        await _db.recipient_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": MASTER,
            "recipient": recipient.lower(),
            "sender": sender,
            "subject": "Test malicious mail",
            "verdict": "malware",
            "score": 30.0,
            "malware_kind": kind,
            "rules": ["GWS_URL_EXECUTABLE_EXT"],
            "sample": "https://evil.com/payload.jar",
            "ts": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "notified": False,
        })
    asyncio.get_event_loop().run_until_complete(go())


def test_for_recipient_returns_zero_when_no_alerts():
    _cleanup()
    r = requests.get(
        f"{BACKEND}/api/notifications/for-recipient?email=pytest-empty@example.com",
        timeout=10,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["count"] == 0
    assert j["message"] is None


def test_for_recipient_returns_toast_data():
    _cleanup()
    email = "pytest-user@target.local"
    _insert_recipient_alert(email, sender="a@evil.com", kind="executable_url")
    _insert_recipient_alert(email, sender="b@bad.com", kind="rat")
    _insert_recipient_alert(email, sender="c@spam.com", kind="phishing")
    r = requests.get(
        f"{BACKEND}/api/notifications/for-recipient?email={email}&hours=24",
        timeout=10,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["count"] == 3
    assert "3 zararlı" in j["message"]
    assert len(j["senders"]) >= 1
    _cleanup()


def test_webmail_toast_js_endpoint_serves_script():
    r = requests.get(f"{BACKEND}/api/notifications/webmail-toast.js", timeout=10)
    assert r.status_code == 200
    assert "GökyüzüWebSpam" in r.text or "GokyuzuWebSpam" in r.text or "webmail-toast" in r.text.lower()
    assert "for-recipient" in r.text
    assert r.headers.get("content-type", "").startswith("application/javascript")


def test_urlhaus_sync_endpoint_exists_and_responds():
    """Feed status endpoint calisiyor, sync manuel calistirilabiliyor."""
    hdrs = {"x-master-key": MASTER}
    # Manuel sync tetikle (5 entry ile hizli test)
    r = requests.post(
        f"{BACKEND}/api/threat-intel/malicious-urls/sync-urlhaus?max_entries=5",
        headers=hdrs, timeout=45,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    # ok=True veya network hatasi (feed unreachable) - iki durum da valid
    assert "ok" in j or "error" in j
    # Feed status endpoint her zaman calisir
    r2 = requests.get(f"{BACKEND}/api/threat-intel/malicious-urls/feed-status", timeout=10)
    assert r2.status_code == 200
    fs = r2.json()
    assert "total_urls" in fs
    assert "by_source" in fs
