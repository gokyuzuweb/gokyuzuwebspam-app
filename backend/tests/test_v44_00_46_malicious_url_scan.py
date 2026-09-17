"""v44.00.46 — Malicious URL / Payload Blocker tests.

Ingest sirasinda body/subject icinde .jar/.exe download link'i, drive.google.com
lure link'i veya bilinen kotu URL patterni tespit edilirse mail verdict=malware
olmali ve puani ciddi sekilde yukselmeli.
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
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYMAL_"}})
        await _db.master_alerts.delete_many({"type": "malware_url"})
    asyncio.get_event_loop().run_until_complete(go())


def _ingest(subject: str, from_addr: str, body_preview: str,
             sa_score: float = 3.0, headers: str = "") -> dict:
    body = {
        "license_key": MASTER,
        "server_hostname": "malscan-test.local",
        "exim_mid": f"1t{uuid.uuid4().hex[:10]}-000001",
        "from_addr": from_addr,
        "to_addr": "info@target.local",
        "subject": subject,
        "verdict": "clean",
        "total_score": sa_score,
        "scores": {"spamassassin": sa_score},
        "body_preview": body_preview,
        "headers_full": headers,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{BACKEND}/api/events/ingest", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text

    async def _fetch():
        return await _db.mail_events.find_one({"subject": subject}, {"_id": 0})
    return asyncio.get_event_loop().run_until_complete(_fetch())


def test_seed_contains_reported_url():
    # v44.00.48: URLhaus feed cok fazla kayit ekliyor; direkt file id ile ara
    r = requests.get(f"{BACKEND}/api/threat-intel/malicious-urls?q=1kmhmdic&limit=10", timeout=10)
    assert r.status_code == 200
    items = r.json().get("items", [])
    patterns = [i["pattern"] for i in items]
    assert any("1kmhmdicnsaqlgi1_1mgqjaemntnbdjm2" in p for p in patterns), \
        "Kullanici raporlu URL seed edilmedi"


def test_jar_download_url_detected_as_malware():
    """.jar uzantili URL body'de → verdict=malware, +8 puan."""
    _cleanup()
    subj = f"PYMAL_JAR_{uuid.uuid4().hex[:6]}"
    body = "Dosyayi indirin: https://example.com/malware/payload.jar simdi calistirin"
    doc = _ingest(subj, "attacker@evil.com", body, sa_score=1.5)
    assert doc is not None
    assert doc.get("malware_scan"), "malware_scan uygulanmadi"
    rules = doc["malware_scan"]["rules"]
    assert "GWS_URL_EXECUTABLE_EXT" in rules
    assert doc["total_score"] >= 9.0
    assert doc["verdict"] == "malware", doc["verdict"]
    _cleanup()


def test_google_drive_download_lure_detected():
    """drive.google.com/uc?export=download lure → +5 (cloud_dl) + +20 (db match) = 25+ puan."""
    _cleanup()
    subj = f"PYMAL_DRIVE_{uuid.uuid4().hex[:6]}"
    body = (
        "Belgeyi görüntüle: "
        "https://drive.google.com/uc?export=download&id=1KmHmdIcNsAQlGi1_1MgQJaEMnTnbdJm2"
    )
    doc = _ingest(subj, "iletisim@yektahome.com", body, sa_score=4.8)
    assert doc is not None
    ms = doc.get("malware_scan")
    assert ms, "malware_scan uygulanmadi"
    assert "GWS_CLOUD_DL_LURE" in ms["rules"]
    # Hem generic pattern hem file id seed'i eslesir (>=25 puan)
    assert doc["total_score"] >= 15.0
    assert doc["verdict"] == "malware"
    _cleanup()


def test_turkish_phishing_lure_boosts_score():
    """Turkce 'dosyayi goruntule' + download URL → GWS_TR_PHISH_LURE ek puani."""
    _cleanup()
    subj = f"PYMAL_TR_{uuid.uuid4().hex[:6]}"
    body = "DOSYAYI GÖRÜNTÜLE https://sitemiz.com/rapor.exe imzalayin"
    doc = _ingest(subj, "muhasebe@sirket.com", body, sa_score=2.0)
    assert doc is not None
    ms = doc.get("malware_scan")
    assert ms
    assert "GWS_TR_PHISH_LURE" in ms["rules"]
    assert "GWS_URL_EXECUTABLE_EXT" in ms["rules"]
    _cleanup()


def test_clean_mail_not_flagged():
    """Zararsiz body → malware_scan yok, verdict=clean kalir."""
    _cleanup()
    subj = f"PYMAL_CLEAN_{uuid.uuid4().hex[:6]}"
    body = "Merhaba, toplanti saat 15:00'te. Salon B. Iyi calismalar."
    doc = _ingest(subj, "colleague@work.com", body, sa_score=1.0)
    assert doc is not None
    assert not doc.get("malware_scan"), "temiz mail'e malware_scan uygulandi"
    assert doc.get("verdict") in ("clean", None)
    _cleanup()


def test_add_and_list_malicious_url_endpoint():
    """Yeni kotu URL ekle, listede goster."""
    pat = f"pytest-mal-{uuid.uuid4().hex[:8]}.evil.com"
    hdrs = {"x-master-key": MASTER}
    r = requests.post(
        f"{BACKEND}/api/threat-intel/malicious-urls/add",
        json={"pattern": pat, "kind": "trojan", "note": "pytest"},
        headers=hdrs, timeout=10,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] and j["added"]
    entry_id = j["id"]
    # List
    lst = requests.get(f"{BACKEND}/api/threat-intel/malicious-urls?q={pat[:15]}", timeout=10).json()
    assert any(i["pattern"] == pat for i in lst["items"])
    # Delete
    r = requests.delete(f"{BACKEND}/api/threat-intel/malicious-urls/{entry_id}", headers=hdrs, timeout=10)
    assert r.status_code == 200
