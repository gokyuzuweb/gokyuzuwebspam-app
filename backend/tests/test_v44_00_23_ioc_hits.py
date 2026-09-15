"""v44.00.23 — IOC → Mail Event correlation.

Tehdit Göstergeleri sayfasında her IOC satırının altında "neden karalistede?"
sorusuna cevap olarak son eşleşen mail'leri (gönderici / konu / verdict) döner.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from httpx import ASGITransport, AsyncClient


ROOT = Path(__file__).resolve().parents[1]


def test_route_defined():
    src = (ROOT / "routes/threat_intel.py").read_text()
    assert '@router.get("/ioc/{ioc_id}/hits")' in src
    assert "async def ioc_hits" in src
    for tag in ("t == \"ip\"", "t == \"email\"", "t == \"domain\"", "t == \"url\"", "t == \"hash\""):
        assert tag in src, f"missing match branch: {tag}"


def test_frontend_expandable_row():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    assert "function IocRow" in src
    assert "ti-ioc-hits" in src
    assert "/threat-intel/ioc/${it.id}/hits" in src
    assert "data-testid={`ioc-toggle-" in src


async def _integration():
    sys.path.insert(0, str(ROOT))
    from server import app  # noqa: E402
    from deps import db     # noqa: E402
    transport = ASGITransport(app=app)
    now = datetime.now(timezone.utc).isoformat()

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1) IP hit
        ip = "203.0.113.99"
        ev_id = str(uuid.uuid4())
        await db.mail_events.insert_one({
            "id": ev_id, "ts": now,
            "from_addr": "bad@spammer.tk", "to_addr": "victim@example.com",
            "subject": "buy now!!!", "verdict": "spam", "action": "reject",
            "sender_ip": ip, "license_key": "MS-TEST",
        })
        ip_ioc = str(uuid.uuid4())
        await db.threat_iocs.update_one(
            {"type": "ip", "value": ip},
            {"$set": {"id": ip_ioc, "type": "ip", "value": ip, "tag": "spam",
                      "confidence": 80, "source": "pytest", "created_at": now}},
            upsert=True,
        )
        r = await ac.get(f"/api/threat-intel/ioc/{ip_ioc}/hits?limit=5")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["hit_count"] >= 1
        assert data["hits"][0]["from_addr"] == "bad@spammer.tk"
        assert data["hits"][0]["subject"].startswith("buy now")

        # 2) Domain hit
        dom_ev = str(uuid.uuid4())
        await db.mail_events.insert_one({
            "id": dom_ev, "ts": now,
            "from_addr": "someone@evil.example.com", "to_addr": "a@b.com",
            "subject": "phish", "verdict": "phishing", "sender_ip": "1.2.3.4",
        })
        dom_ioc = str(uuid.uuid4())
        await db.threat_iocs.update_one(
            {"type": "domain", "value": "evil.example.com"},
            {"$set": {"id": dom_ioc, "type": "domain", "value": "evil.example.com",
                      "tag": "phishing", "confidence": 90, "source": "pytest",
                      "created_at": now}},
            upsert=True,
        )
        r = await ac.get(f"/api/threat-intel/ioc/{dom_ioc}/hits?limit=5")
        assert r.status_code == 200
        d = r.json()
        assert d["hit_count"] >= 1
        assert d["hits"][0]["from_addr"].endswith("@evil.example.com")

        # 3) Hash → note
        hash_ioc = str(uuid.uuid4())
        await db.threat_iocs.update_one(
            {"type": "hash", "value": "deadbeef" * 8},
            {"$set": {"id": hash_ioc, "type": "hash", "value": "deadbeef" * 8,
                      "tag": "malware", "confidence": 95, "source": "pytest",
                      "created_at": now}},
            upsert=True,
        )
        r = await ac.get(f"/api/threat-intel/ioc/{hash_ioc}/hits")
        assert r.status_code == 200
        h = r.json()
        assert h["hits"] == []
        assert "note" in h

        # 4) Unknown 404
        r = await ac.get("/api/threat-intel/ioc/does-not-exist/hits")
        assert r.status_code == 404

        # cleanup
        await db.mail_events.delete_many({"id": {"$in": [ev_id, dom_ev]}})
        await db.threat_iocs.delete_many({"id": {"$in": [ip_ioc, dom_ioc, hash_ioc]}})


def test_ioc_hits_integration():
    asyncio.run(_integration())

