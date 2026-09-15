"""v44.00.26 — USOM yeni JSON API + Auto Blacklist + Case-insensitive delete fix."""
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parents[1]
LK = "MS-C02AB012652A4FE692D69676"
MASTER_HDR = {"X-Forwarded-For": "89.19.15.58"}


def test_usom_new_api_endpoint():
    src = (ROOT / "routes/usom.py").read_text()
    assert "https://siberguvenlik.gov.tr/api/address/index" in src
    assert "USOM_MAX_PAGES" in src
    assert "USOM_DESC_MAP" in src
    assert '"PH": "phishing"' in src


def test_usom_auto_blacklist():
    src = (ROOT / "routes/usom.py").read_text()
    # Domain'ler otomatik kara listeye ekleniyor
    assert '"source": "usom_auto"' in src
    assert '"list_type": "black"' in src
    # IP'ler için de auto blacklist
    assert 'added_ips' in src
    assert 'added_to_blacklist' in src


def test_lists_delete_case_insensitive():
    src = (ROOT / "server.py").read_text()
    # Yeni fix: regex ile case-insensitive silme
    assert '"$regex": "^" + _re.escape(val_raw) + "$"' in src
    assert '"$options": "i"' in src


async def _integration():
    sys.path.insert(0, str(ROOT))
    from server import app  # noqa: E402
    from deps import db     # noqa: E402
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                            headers=MASTER_HDR) as ac:
        # 1) Silme fix: mixed case değeri sil
        test_val = f"TEST_UPPER_{uuid.uuid4().hex[:6]}@example.com"
        await db.lists.insert_one({
            "id": str(uuid.uuid4()), "type": "email", "value": test_val,
            "kind": "whitelist", "license_key": LK,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Delete with lowercase → case-insensitive match → should remove
        r = await ac.post(f"/api/lists-manager/delete?license_key={LK}",
                          json={"kind": "whitelist", "entry_type": "email",
                                "value": test_val.lower()})
        assert r.status_code == 200
        data = r.json()
        assert data["removed"] == 1

        # 2) Auto blacklist: usom_auto source kaydı unified endpoint'te görünmeli
        test_dom = f"pytest-usom-{uuid.uuid4().hex[:6]}.example"
        await db.lists.insert_one({
            "id": str(uuid.uuid4()), "list_type": "black", "entry_type": "domain",
            "value": test_dom, "scope": "global", "user": None,
            "note": "USOM otomatik ekleme · phishing",
            "source": "usom_auto",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = await ac.get(f"/api/lists-manager/unified?license_key={LK}&kind=blacklist&q={test_dom[:15]}")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["value"] == test_dom for i in items)
        # cleanup
        await db.lists.delete_many({"value": test_dom})


def test_integration():
    asyncio.run(_integration())
