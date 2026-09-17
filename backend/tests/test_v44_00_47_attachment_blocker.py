"""v44.00.47 — Attachment executable blocker + recipient alerts tests."""
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
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYATT_"}})
        await _db.recipient_alerts.delete_many({"subject": {"$regex": "^PYATT_"}})
    asyncio.get_event_loop().run_until_complete(go())


def _ingest_with_att(subject: str, attachments: list, sa_score: float = 2.0) -> dict:
    body = {
        "license_key": MASTER,
        "server_hostname": "att-test.local",
        "exim_mid": f"1t{uuid.uuid4().hex[:10]}-000001",
        "from_addr": "attacker@evil.com",
        "to_addr": "victim@company.local",
        "subject": subject,
        "verdict": "clean",
        "total_score": sa_score,
        "scores": {"spamassassin": sa_score},
        "body_preview": "Ekli dosyayi kontrol edin",
        "attachments": attachments,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{BACKEND}/api/events/ingest", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    async def _fetch():
        return await _db.mail_events.find_one({"subject": subject}, {"_id": 0})
    return asyncio.get_event_loop().run_until_complete(_fetch())


def test_jar_attachment_flagged_as_malware():
    _cleanup()
    subj = f"PYATT_JAR_{uuid.uuid4().hex[:6]}"
    doc = _ingest_with_att(subj, [
        {"filename": "invoice.jar", "content_type": "application/java-archive", "size": 45000},
    ])
    assert doc is not None
    ms = doc.get("malware_scan")
    assert ms, "malware_scan yok"
    assert "GWS_ATTACHMENT_EXECUTABLE" in ms["rules"]
    assert doc["total_score"] >= 30.0
    assert doc["verdict"] == "malware"
    _cleanup()


def test_double_extension_attachment_flagged():
    _cleanup()
    subj = f"PYATT_DBLEXT_{uuid.uuid4().hex[:6]}"
    doc = _ingest_with_att(subj, [
        {"filename": "Fatura_2026.pdf.exe", "content_type": "application/octet-stream", "size": 12000},
    ])
    assert doc is not None
    ms = doc.get("malware_scan")
    assert ms
    assert "GWS_ATTACHMENT_EXECUTABLE" in ms["rules"]
    assert ms["hit"]["kind"] == "executable_attachment"
    assert doc["verdict"] == "malware"
    _cleanup()


def test_mime_hint_attachment_flagged():
    _cleanup()
    subj = f"PYATT_MIME_{uuid.uuid4().hex[:6]}"
    # Filename normal ama MIME executable
    doc = _ingest_with_att(subj, [
        {"filename": "belge", "content_type": "application/x-msdownload", "size": 88000},
    ])
    assert doc is not None
    ms = doc.get("malware_scan")
    assert ms, "MIME tabanli tespit calismadi"
    assert "GWS_ATTACHMENT_EXECUTABLE" in ms["rules"]
    _cleanup()


def test_pdf_attachment_not_flagged():
    _cleanup()
    subj = f"PYATT_PDF_{uuid.uuid4().hex[:6]}"
    doc = _ingest_with_att(subj, [
        {"filename": "rapor.pdf", "content_type": "application/pdf", "size": 45000},
    ])
    assert doc is not None
    # Body'de "goruntule" gecmiyor (sadece "kontrol edin"), URL yok — temiz
    assert not doc.get("malware_scan"), "false positive!"
    _cleanup()


def test_recipient_alert_created_on_malware():
    _cleanup()
    subj = f"PYATT_RECIP_{uuid.uuid4().hex[:6]}"
    _ingest_with_att(subj, [
        {"filename": "payload.scr", "content_type": "application/x-msdownload"},
    ])
    async def go():
        return await _db.recipient_alerts.find_one({"subject": subj}, {"_id": 0})
    row = asyncio.get_event_loop().run_until_complete(go())
    assert row is not None, "recipient_alerts kaydi olusmadi"
    assert row["recipient"] == "victim@company.local"
    assert row["malware_kind"] == "executable_attachment"
    _cleanup()


def test_recipient_alerts_endpoints():
    _cleanup()
    subj = f"PYATT_EP_{uuid.uuid4().hex[:6]}"
    _ingest_with_att(subj, [{"filename": "x.jar", "content_type": "application/java-archive"}])
    # List
    r = requests.get(f"{BACKEND}/api/notifications/recipient-alerts?license_key={MASTER}&hours=1", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j["total"] >= 1
    # Digest
    r = requests.get(f"{BACKEND}/api/notifications/recipient-alerts/digest?license_key={MASTER}&hours=1", timeout=10)
    assert r.status_code == 200
    dg = r.json()
    assert dg["total_blocked"] >= 1
    assert dg["affected_recipients"] >= 1
    assert any(t["recipient"] == "victim@company.local" for t in dg["top_recipients"])
    _cleanup()
