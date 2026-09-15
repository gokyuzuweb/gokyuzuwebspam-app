"""v44.00.39 — SpamAssassin rule score overrides tests

Kotu yapilandirilmis Turkce kurumsal Postfix'lerden gelen MISSING_MID /
DOS_BODY_HIGH_NO_MID gibi kural cezalarini license bazinda azaltip
ingestion sirasinda skorun yeniden hesaplandigini dogrular.
"""
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
MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")

_client = motor.motor_asyncio.AsyncIOMotorClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]


HEADERS_TR_CORP = """Return-Path: <ihale@sirket-ornek.com.tr>
Received: from mail.sirket-ornek.com.tr (mail.sirket-ornek.com.tr [212.174.55.11])
    by mx.example.net (Postfix) with ESMTP id ABC123
From: ihale@sirket-ornek.com.tr
To: user@example.net
Subject: Test Ihale Duyurusu Turkce karakterler cccc oooo
Date: Mon, 15 Feb 2026 10:00:00 +0300
X-Spam-Flag: YES
X-Spam-Score: 6.0
X-Spam-Status: Yes, score=6.0 required=5.0 tests=MISSING_MID,DOS_BODY_HIGH_NO_MID,BAYES_50
X-Spam-Report:
 *  1.4 MISSING_MID Missing Message-Id: header
 *  2.8 DOS_BODY_HIGH_NO_MID High-bit body & no Message-Id
 *  0.8 BAYES_50 Bayes classifier says spam probability 40-60%
 *  1.0 RDNS_NONE Delivered to internal network by a host with no rDNS
"""


def _cleanup():
    async def go():
        await _db.mail_events.delete_many({"subject": {"$regex": "^PYSA_"}})
        await _db.mailscanner_config.delete_many(
            {"license_key": MASTER, "sa_score_overrides.MISSING_MID": {"$exists": True}}
        )
    asyncio.get_event_loop().run_until_complete(go())


def _post_event(subject: str, sa_score: float = 6.0) -> dict:
    """Ingest bir olay ve DB'den geri oku."""
    body = {
        "license_key": MASTER,
        "server_ip": "1.2.3.4",
        "server_hostname": "test-node.local",
        "exim_mid": f"1t{uuid.uuid4().hex[:10]}-000001",
        "from_addr": "ihale@sirket-ornek.com.tr",
        "to_addr": "user@example.net",
        "subject": subject,
        "verdict": "spam",
        "total_score": sa_score,
        "scores": {"spamassassin": sa_score, "clamav": 0, "bayes": 0},
        "headers_full": HEADERS_TR_CORP,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{BACKEND}/api/events/ingest", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    # DB'den oku
    async def _fetch():
        return await _db.mail_events.find_one({"subject": subject}, {"_id": 0})
    return asyncio.get_event_loop().run_until_complete(_fetch())


def test_a_parse_baseline_no_overrides():
    """Override YOK — SA skoru degismez ama sa_rules parse edilir."""
    _cleanup()
    subj = f"PYSA_NOOVR_{uuid.uuid4().hex[:6]}"
    doc = _post_event(subj)
    assert doc is not None
    assert "sa_rules" in doc, "sa_rules parse edilmedi"
    names = {r["name"] for r in doc["sa_rules"]}
    assert "MISSING_MID" in names
    assert "DOS_BODY_HIGH_NO_MID" in names
    assert "BAYES_50" in names
    # Override yoktu → adjust yapilmadi
    assert doc.get("sa_overrides_applied") is not True
    assert abs(doc["total_score"] - 6.0) < 0.01


def test_b_preset_turkish_corp_reduces_score():
    """Turkish-corp preset uygula → MISSING_MID=0, DOS_BODY_HIGH_NO_MID=0.5.
    6.0 - 1.4 - (2.8-0.5) - (1.0-0.5) = 6.0 - 1.4 - 2.3 - 0.5 = 1.8
    """
    _cleanup()
    r = requests.post(
        f"{BACKEND}/api/mailscanner/sa-overrides/preset/turkish-corp",
        params={"license_key": MASTER, "merge": False},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["preset"] == "turkish-corp"
    assert "MISSING_MID" in data["overrides"]

    subj = f"PYSA_PRESET_{uuid.uuid4().hex[:6]}"
    doc = _post_event(subj)
    assert doc is not None
    assert doc.get("sa_overrides_applied") is True
    assert doc.get("total_score_pre_override") == 6.0
    # Adjusted skor 6'dan belirgin sekilde dusuk olmali
    assert doc["total_score"] < 3.0, f"beklenen <3, aldi {doc['total_score']}"
    # Verdict clean/suspicious'a dusmeli (threshold 5 varsayilan)
    assert doc["verdict"] in ("clean", "spam"), doc["verdict"]
    assert doc["verdict"] != "high_spam"


def test_c_get_sa_overrides_returns_seen_rules():
    """GET endpoint aktif override ve son 7 gunde gorulen kurallari doner."""
    r = requests.get(
        f"{BACKEND}/api/mailscanner/sa-overrides",
        params={"license_key": MASTER},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "overrides" in data
    assert "seen_rules_7d" in data
    assert "presets" in data
    assert "turkish-corp" in data["presets"]
    seen = {r["name"] for r in data["seen_rules_7d"]}
    # test_b'den sonra kurallari gormeliyiz
    assert "MISSING_MID" in seen or "DOS_BODY_HIGH_NO_MID" in seen


def test_d_put_custom_overrides_and_apply():
    """PUT ile manuel override — MISSING_MID'yi 0.2'ye ceker."""
    _cleanup()
    r = requests.put(
        f"{BACKEND}/api/mailscanner/sa-overrides",
        headers={"x-master-key": MASTER},
        json={"license_key": MASTER,
              "overrides": {"MISSING_MID": 0.2, "DOS_BODY_HIGH_NO_MID": None}},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["overrides"]["MISSING_MID"] == 0.2
    # None -> null olarak saklanmali
    assert data["overrides"]["DOS_BODY_HIGH_NO_MID"] is None

    subj = f"PYSA_CUSTOM_{uuid.uuid4().hex[:6]}"
    doc = _post_event(subj)
    # 6.0 - (1.4-0.2) - (2.8-0.0) = 6.0 - 1.2 - 2.8 = 2.0
    assert doc.get("sa_overrides_applied") is True
    assert abs(doc["total_score"] - 2.0) < 0.5, doc["total_score"]


def test_e_preset_off_clears_overrides():
    """Preset `off` tum override'lari temizler → skor tekrar orjinal."""
    r = requests.post(
        f"{BACKEND}/api/mailscanner/sa-overrides/preset/off",
        params={"license_key": MASTER, "merge": False},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["overrides"] == {}

    subj = f"PYSA_OFF_{uuid.uuid4().hex[:6]}"
    doc = _post_event(subj)
    assert doc.get("sa_overrides_applied") is not True
    assert abs(doc["total_score"] - 6.0) < 0.01
    _cleanup()


def test_f_invalid_rule_name_rejected():
    """Kural adi format kontrolu: kucuk harf / bosluk / kisa → reddedilir."""
    r = requests.put(
        f"{BACKEND}/api/mailscanner/sa-overrides",
        headers={"x-master-key": MASTER},
        json={"license_key": MASTER,
              "overrides": {"bad rule": 0.5, "ok": 0.1, "GOOD_RULE": 0.5}},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # Yalnizca GOOD_RULE kalmali
    assert "GOOD_RULE" in data["overrides"]
    assert "bad rule" not in data["overrides"]
    assert "ok" not in data["overrides"]
    _cleanup()
