"""v44.00.51 — Proaktif Junk-Move Kuyruklama Testleri

Panel verdict=spam/high_spam/malware olan gelen mail icin otomatik
`pending_quarantine_actions` uretmeli. Perl daemon 2 dk icinde bu mail'i
INBOX'tan Junk'a tasir.
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


def _cleanup():
    async def go():
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYJUNK_"}})
        await _db.pending_quarantine_actions.delete_many(
            {"reason": {"$regex": "^auto_move_verdict"}}
        )
    asyncio.get_event_loop().run_until_complete(go())


def _ingest(subject: str, from_addr: str, verdict: str, sa_score: float = 8.0,
             message_id: str = "", extra_body: str = "") -> dict:
    headers = f"From: {from_addr}\nTo: info@seridokum.local\nSubject: {subject}\n"
    if message_id:
        headers += f"Message-Id: <{message_id}>\n"
    body = {
        "license_key": MASTER,
        "server_hostname": "junk-move-test.local",
        "exim_mid": f"1x{uuid.uuid4().hex[:10]}-000001",
        "from_addr": from_addr,
        "to_addr": "info@seridokum.local",
        "subject": subject,
        "verdict": verdict,
        "total_score": sa_score,
        "scores": {"spamassassin": sa_score},
        "headers_full": headers,
        "body_preview": extra_body,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{BACKEND}/api/events/ingest", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text

    async def _fetch_action():
        return await _db.pending_quarantine_actions.find_one(
            {"reason": {"$regex": "^auto_move_verdict"},
             "match.subject": subject}, {"_id": 0}
        )
    return asyncio.get_event_loop().run_until_complete(_fetch_action())


def test_spam_verdict_queues_move_to_junk():
    _cleanup()
    subj = f"PYJUNK_SPAM_{uuid.uuid4().hex[:6]}"
    action = _ingest(subj, "spammer@evil.com", verdict="spam", sa_score=8.1)
    assert action is not None, "spam mail icin move_to_junk queue'lanmadi"
    assert action["action"] == "move_to_junk"
    assert action["match"]["recipient"] == "info@seridokum.local"
    assert action["match"]["subject"] == subj
    assert "spam" in action["reason"]
    _cleanup()


def test_high_spam_verdict_queues_move():
    _cleanup()
    subj = f"PYJUNK_HIGH_{uuid.uuid4().hex[:6]}"
    action = _ingest(subj, "phish@bad.tr", verdict="high_spam", sa_score=15.0)
    assert action is not None
    assert action["action"] == "move_to_junk"
    _cleanup()


def test_malware_verdict_queues_move():
    _cleanup()
    subj = f"PYJUNK_MAL_{uuid.uuid4().hex[:6]}"
    # Malware verdict icin body'de kötü URL koyarak scan tetikle
    action = _ingest(subj, "attacker@evil.com",
                     verdict="clean",  # ingest hook malware'e cevirir
                     sa_score=2.0,
                     extra_body="Dosyayi indir https://malicious.com/payload.jar")
    assert action is not None, "malware verdict'inden move_to_junk queue'lanmadi"
    assert action["action"] == "move_to_junk"
    _cleanup()


def test_clean_verdict_does_not_queue_move():
    _cleanup()
    subj = f"PYJUNK_CLEAN_{uuid.uuid4().hex[:6]}"
    action = _ingest(subj, "friend@partner.com", verdict="clean", sa_score=1.0)
    assert action is None, "temiz mail icin move_to_junk queue'landi! (FALSE POSITIVE)"
    _cleanup()


def test_message_id_captured_from_headers():
    """Message-Id header'i doveadm HEADER match icin action'a kaydedilmeli."""
    _cleanup()
    subj = f"PYJUNK_MID_{uuid.uuid4().hex[:6]}"
    mid = f"20260917-{uuid.uuid4().hex[:8]}@yandex.net"
    action = _ingest(subj, "fake@yandex.net", verdict="spam", sa_score=8.1, message_id=mid)
    assert action is not None
    assert action["match"]["message_id"] == mid, \
        f"Message-Id yakalanmadi: {action['match']}"
    _cleanup()


def test_display_name_spoofing_scenario():
    """Ekran goruntusundeki gercek senaryo:
    From: seridokum.com <encoded@garbage.example> → high spam verdict → junk move."""
    _cleanup()
    subj = "URGENT: Your mailbox info@seridokum.local has restrictions"
    action = _ingest(
        subj,
        from_addr="fake@garbage.example",
        verdict="spam",  # panel spoof detector zaten yukseltmis
        sa_score=8.1,
    )
    assert action is not None, "gercek phishing senaryosunda move_to_junk queue'lanmadi"
    assert action["action"] == "move_to_junk"
    assert action["match"]["recipient"] == "info@seridokum.local"
    _cleanup()
