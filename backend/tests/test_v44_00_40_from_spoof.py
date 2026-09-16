"""v44.00.40 — From-header display-name spoofing detector tests

`From: handizayn.com <hacker@skyverticals.com>` gibi kimlik taklidi
mail'leri +5.5 puan alip SPAM/HIGH_SPAM'a yukselmeli.
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
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYSPOOF_"}})
    asyncio.get_event_loop().run_until_complete(go())


def _ingest(subject: str, from_addr: str, to_addr: str, headers: str,
            sa_score: float = 3.6, verdict: str = "clean") -> dict:
    body = {
        "license_key": MASTER,
        "server_hostname": "test.local",
        "exim_mid": f"1t{uuid.uuid4().hex[:10]}-000001",
        "from_addr": from_addr,
        "to_addr": to_addr,
        "subject": subject,
        "verdict": verdict,
        "total_score": sa_score,
        "scores": {"spamassassin": sa_score},
        "headers_full": headers,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{BACKEND}/api/events/ingest", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text

    async def _fetch():
        return await _db.mail_events.find_one({"subject": subject}, {"_id": 0})
    return asyncio.get_event_loop().run_until_complete(_fetch())


def test_a_recipient_domain_impersonation_detected():
    """Display=`handizayn.com`, envelope=miya@skyverticals.com, recipient=@handizayn.com
    → SPOOF, +5.5, total 3.6+5.5=9.1 → high_spam."""
    _cleanup()
    subj = f"PYSPOOF_RECIP_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f"From: handizayn.com <miya@skyverticals.com>\n"
        f"To: gamze@handizayn.com\n"
        f"Subject: {subj}\n"
        f"X-Spam-Status: No, score=3.6\n"
    )
    doc = _ingest(subj, "miya@skyverticals.com", "gamze@handizayn.com", hdrs)
    assert doc is not None
    assert doc.get("from_spoof"), "from_spoof yakalanmadi"
    assert doc["from_spoof"]["kind"] == "recipient_domain_impersonation"
    assert doc["total_score"] >= 9.0, doc["total_score"]
    assert doc["verdict"] in ("spam", "high_spam"), doc["verdict"]


def test_b_quoted_display_name_impersonation():
    """`From: "handizayn.com" <hacker@evil.com>` — tirnak icinde bile yakalanmali."""
    _cleanup()
    subj = f"PYSPOOF_QUOTED_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f'From: "handizayn.com" <hacker@evil.com>\n'
        f"To: user@handizayn.com\n"
        f"Subject: {subj}\n"
    )
    doc = _ingest(subj, "hacker@evil.com", "user@handizayn.com", hdrs)
    assert doc.get("from_spoof"), doc
    assert doc["from_spoof"]["kind"] == "recipient_domain_impersonation"


def test_c_legit_mail_not_flagged():
    """Legit: display=`John Doe`, envelope=john@company.com, recipient farkli
    → SPOOF olmamali."""
    _cleanup()
    subj = f"PYSPOOF_LEGIT_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f"From: John Doe <john@company.com>\n"
        f"To: gamze@handizayn.com\n"
        f"Subject: {subj}\n"
    )
    doc = _ingest(subj, "john@company.com", "gamze@handizayn.com", hdrs, sa_score=1.0)
    assert doc.get("from_spoof") is None, doc.get("from_spoof")
    assert doc["total_score"] < 3.0, doc["total_score"]
    assert doc["verdict"] == "clean"


def test_d_same_domain_legit():
    """Legit intra-domain: display=`Support`, envelope=support@handizayn.com,
    recipient=@handizayn.com → SPOOF DEGIL."""
    _cleanup()
    subj = f"PYSPOOF_SAMEDOM_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f"From: Handizayn Support <support@handizayn.com>\n"
        f"To: user@handizayn.com\n"
        f"Subject: {subj}\n"
    )
    doc = _ingest(subj, "support@handizayn.com", "user@handizayn.com", hdrs, sa_score=0.5)
    assert doc.get("from_spoof") is None, doc.get("from_spoof")


def test_e_display_is_foreign_domain():
    """Display=`some-brand.com`, envelope=random@evil.com, recipient farkli
    → CASE 2 (display_name_is_foreign_domain), +4.0."""
    _cleanup()
    subj = f"PYSPOOF_FRGN_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f"From: paypal.com <noreply@random-evil.net>\n"
        f"To: user@example.com\n"
        f"Subject: {subj}\n"
    )
    doc = _ingest(subj, "noreply@random-evil.net", "user@example.com", hdrs, sa_score=2.0)
    assert doc.get("from_spoof"), doc
    assert doc["from_spoof"]["kind"] == "display_name_is_foreign_domain"
    assert doc["total_score"] >= 6.0, doc["total_score"]


def test_f_whitelist_still_wins_over_spoof():
    """Whitelist eslesirse spoof olsa bile whitelisted olmali."""
    _cleanup()
    # Whitelist seed
    async def seed_wl():
        await _db.lists.update_one(
            {"list_type": "white", "entry_type": "domain", "value": "trusted-sender.com"},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "entry_type": "domain",
                "value": "trusted-sender.com", "list_type": "white",
                "scope": "global", "note": "pytest v44.00.40",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }}, upsert=True,
        )
    asyncio.get_event_loop().run_until_complete(seed_wl())

    subj = f"PYSPOOF_WL_{uuid.uuid4().hex[:6]}"
    hdrs = (
        f"From: recipient.com <user@trusted-sender.com>\n"
        f"To: someone@recipient.com\n"
        f"Subject: {subj}\n"
    )
    doc = _ingest(subj, "user@trusted-sender.com", "someone@recipient.com", hdrs, sa_score=1.0)
    assert doc["verdict"] == "whitelisted", doc["verdict"]

    async def cleanup_wl():
        await _db.lists.delete_many({"note": "pytest v44.00.40"})
    asyncio.get_event_loop().run_until_complete(cleanup_wl())
    _cleanup()
