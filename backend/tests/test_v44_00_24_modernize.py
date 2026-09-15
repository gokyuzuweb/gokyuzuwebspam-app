"""v44.00.24 — Toplu işlemler + Ülke Engelleme + MailScanner enrichment.

Tests:
 1. lists-manager/bulk-delete endpoint
 2. lists-manager/country-block add/remove/list
 3. country-catalog return şeması
 4. MailScanner stats zenginleştirmesi (hourly_trend, top_senders, top_sender_domains, actions)
 5. Bayes-status top_spam_tokens/balance
 6. Rule suggestions pattern_value/sample_senders enrichment
 7. Bounce Digest display_from fallback
 8. Cluster badge CGI iyileştirmesi (static)
 9. ListsManager frontend country tab
"""
import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path

from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parents[1]
LK = "MS-C02AB012652A4FE692D69676"     # master license
MASTER_HDR = {"X-Forwarded-For": "89.19.15.58"}


def test_bulk_delete_endpoint_exists():
    src = (ROOT / "server.py").read_text()
    assert '@api.post("/lists-manager/bulk-delete")' in src
    assert "UnifiedListBulkDeleteIn" in src
    assert "async def lists_unified_bulk_delete" in src


def test_country_block_endpoints():
    src = (ROOT / "server.py").read_text()
    assert '@api.get("/lists-manager/country-blocks")' in src
    assert '@api.post("/lists-manager/country-block")' in src
    assert '@api.delete("/lists-manager/country-block/{country_code}")' in src
    assert '@api.get("/lists-manager/country-catalog")' in src
    assert "COUNTRY_NAMES_TR" in src
    # ISO alpha-2 doğrulama var mı
    assert 'ISO-3166-1 alpha-2' in src


def test_bayes_status_enrichment():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert "top_spam_tokens" in src
    assert "top_ham_tokens" in src
    assert '"balance"' in src


def test_stats_hourly_and_top_lists():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert "hourly_trend" in src
    assert "top_senders" in src
    assert "top_sender_domains" in src
    assert "virus_24h" in src
    assert '"actions"' in src


def test_ioc_hits_route():
    src = (ROOT / "routes/threat_intel.py").read_text()
    assert '@router.get("/ioc/{ioc_id}/hits")' in src
    assert "async def ioc_hits" in src


def test_rule_suggestion_enrichment():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert '"pattern_value"' in src
    assert '"sample_senders"' in src


def test_bounce_display_from():
    src = (ROOT / "routes/bounce_digest.py").read_text()
    assert "display_from" in src
    assert '"<>"' in src


def test_cluster_badge_improved():
    src = (ROOT.parent / "whm-plugin/whm/mailshield.cgi").read_text()
    assert "Standalone Master" in src
    assert "Master'a Erişilemiyor" in src
    # fallback endpoint eklendi
    assert "/api/version" in src


def test_frontend_country_tab():
    src = (ROOT.parent / "frontend/src/pages/ListsManager.js").read_text()
    # Tab template literal `lm-tab-${t.k}` → country id "country" listede
    assert 'lm-tab-${t.k}' in src
    assert '{ k: "country"' in src
    assert 'CountryBlockPane' in src
    assert 'cb-quick-${code}' in src
    # Toplu silme UI'ı
    assert 'lm-bulk-delete-selected' in src
    assert 'lm-bulk-delete-filtered' in src
    assert 'lm-clean-all' in src


def test_frontend_mailscanner_modernized():
    src = (ROOT.parent / "frontend/src/pages/MailScanner.js").read_text()
    assert "Saatlik Trafik Trendi" in src
    assert "top_senders" in src
    assert "TopList" in src
    assert "TokenList" in src
    assert "pattern_value" in src
    assert "Örnek Göndericiler" in src


# ---------- Integration ----------

async def _integration():
    import sys
    sys.path.insert(0, str(ROOT))
    from server import app  # noqa: E402
    from deps import db     # noqa: E402
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                            headers=MASTER_HDR) as ac:
        # 1) Country catalog
        r = await ac.get(f"/api/lists-manager/country-catalog?license_key={LK}")
        assert r.status_code == 200
        cat = r.json()
        assert cat["count"] >= 50
        assert any(c["code"] == "TR" for c in cat["items"])

        # 2) Add country block
        r = await ac.post(f"/api/lists-manager/country-block?license_key={LK}",
                          json={"country_code": "ZZ", "country_name": "TestLand"})
        # ZZ ISO değil ama uzunluk uyar — 2 harf → geçer
        assert r.status_code == 200
        assert r.json()["country_code"] == "ZZ"

        # 3) List blocks
        r = await ac.get(f"/api/lists-manager/country-blocks?license_key={LK}")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["value"] == "ZZ" for i in items)

        # 4) Remove
        r = await ac.delete(f"/api/lists-manager/country-block/ZZ?license_key={LK}")
        assert r.status_code == 200
        assert r.json()["removed"] >= 1

        # 5) Bulk delete via ids — seed 2 kayıt, sonra sil
        ids = []
        for v in ("test-bulk-a.example.com", "test-bulk-b.example.com"):
            r = await ac.post(f"/api/lists-manager/add?license_key={LK}",
                              json={"kind": "blacklist", "entry_type": "domain", "value": v})
            assert r.status_code == 200
        # ids'i bulmak için unified endpoint
        r = await ac.get(f"/api/lists-manager/unified?license_key={LK}&q=test-bulk-")
        rows = r.json()["items"]
        ids = [x["id"] for x in rows if x.get("id")]
        assert len(ids) >= 2
        r = await ac.post(f"/api/lists-manager/bulk-delete?license_key={LK}",
                          json={"ids": ids})
        assert r.status_code == 200
        assert r.json()["removed"] >= 2

        # 6) Mailscanner stats zenginleştirmesi
        r = await ac.get(f"/api/mailscanner/stats?license_key={LK}&hours=6")
        assert r.status_code == 200
        s = r.json()
        for k in ("hourly_trend", "top_senders", "top_sender_domains",
                  "top_recipients", "actions", "virus_24h"):
            assert k in s, f"missing stats key: {k}"

        # 7) Bayes-status enrichment
        r = await ac.get(f"/api/mailscanner/bayes-status?license_key={LK}")
        assert r.status_code == 200
        b = r.json()
        for k in ("top_spam_tokens", "top_ham_tokens", "balance"):
            assert k in b


def test_integration():
    asyncio.run(_integration())
