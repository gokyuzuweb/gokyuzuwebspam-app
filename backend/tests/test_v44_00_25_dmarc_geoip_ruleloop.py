"""v44.00.25 — DMARC domain breakdown, GeoIP country enforce, AI rule performance loop."""
import asyncio
import base64
import gzip
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parents[1]
LK = "MS-C02AB012652A4FE692D69676"
MASTER_HDR = {"X-Forwarded-For": "89.19.15.58"}


def test_dmarc_domain_route():
    src = (ROOT / "routes/threat_intel.py").read_text()
    assert '@router.get("/dmarc/domain/{domain}")' in src
    assert "async def dmarc_domain_detail" in src
    assert "per_org" in src
    assert "per_day" in src
    assert "failing_ips" in src


def test_geoip_helper_and_country_enforce():
    src = (ROOT / "routes/events.py").read_text()
    assert "async def _geoip_lookup_country" in src
    assert "GeoLite2-Country.mmdb" in src
    assert "ip-api.com" in src
    assert "country_blocked" in src
    assert "country_hit" in src


def test_stats_includes_country_blocked():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert "country_blocked_24h" in src
    assert "top_blocked_countries" in src


def test_rule_performance_endpoints():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert '@router.post("/ai/rule-performance/scan")' in src
    assert '@router.get("/ai/rule-performance")' in src
    assert '@router.post("/ai/rule-performance/remove/{rule_id}")' in src
    assert "async def scan_rule_performance" in src
    assert "removal_suggestion" in src
    assert "zero_hit" in src


def test_frontend_dmarc_drill():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    assert "DmarcDomainDrill" in src
    assert "dmarc-drill" in src
    assert "/threat-intel/dmarc/domain/" in src


def test_frontend_rule_performance():
    src = (ROOT.parent / "frontend/src/pages/MailScanner.js").read_text()
    assert "RulePerformanceCard" in src
    assert "rule-perf-scan" in src
    assert "rule-perf-toggle" in src
    assert "Kural Performans Loop" in src


def test_frontend_country_kpi():
    src = (ROOT.parent / "frontend/src/pages/MailScanner.js").read_text()
    assert "Ülke Engelli" in src
    assert "top_blocked_countries" in src


def test_dmarc_fetch_script_parses_xml():
    """Mock XML üzerinden dmarc-fetch script'inin parse edebildiğini doğrula."""
    import shutil
    tdir = Path("/tmp/dmarctest-pytest")
    if tdir.exists():
        shutil.rmtree(tdir)
    maildir = tdir / "home/u/mail/example.com/postmaster/new"
    maildir.mkdir(parents=True)
    xml = b"""<?xml version="1.0"?>
<feedback>
  <report_metadata><org_name>google.com</org_name><report_id>pytest-1</report_id>
    <date_range><begin>1727740800</begin><end>1727827200</end></date_range></report_metadata>
  <policy_published><domain>example.com</domain></policy_published>
  <record><row><count>100</count><policy_evaluated><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row></record>
</feedback>"""
    gz = gzip.compress(xml)
    b64 = base64.b64encode(gz).decode()
    msg_txt = (
        "From: dmarc@google.com\nTo: postmaster@example.com\n"
        "Subject: Report Domain: example.com Submitter: google.com Report-ID: pytest-1\n"
        "Content-Type: multipart/mixed; boundary=B\n\n"
        "--B\nContent-Type: text/plain\n\nreport\n\n"
        "--B\nContent-Type: application/gzip\n"
        'Content-Disposition: attachment; filename="r.xml.gz"\n'
        f"Content-Transfer-Encoding: base64\n\n{b64}\n--B--\n"
    )
    (maildir / "msg1").write_text(msg_txt)
    # Import script
    import importlib.util
    script = ROOT.parent / "whm-plugin/scripts/mailshield-dmarc-fetch"
    # Copy with .py so importlib works
    py = Path("/tmp/dfetch_test.py")
    py.write_text(script.read_text())
    spec = importlib.util.spec_from_file_location("dfetch_test", py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.list_domains = lambda: ["example.com"]
    mod.maildir_paths_for = lambda d: [maildir]
    mod.STATE_FILE = "/tmp/dfetch-state.json"
    mod.save_state = lambda s: None
    mod.load_state = lambda: {"processed_ids": []}
    old_argv = sys.argv
    sys.argv = ["dfetch", "--license", "MS-TEST", "--dry-run", "--api", "http://localhost"]
    try:
        rc = mod.main()
        assert rc == 0
    finally:
        sys.argv = old_argv
        shutil.rmtree(tdir, ignore_errors=True)


# --- Integration ---

async def _integration():
    sys.path.insert(0, str(ROOT))
    from server import app     # noqa: E402
    from deps import db        # noqa: E402
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                            headers=MASTER_HDR) as ac:
        # 1) DMARC domain detail — example.com'a en az 1 rapor seed
        report_id = str(uuid.uuid4())
        await db.dmarc_reports.insert_one({
            "id": report_id, "domain": "pytest-example.com",
            "org_name": "TestOrg",
            "date_range_begin": datetime.now(timezone.utc).isoformat(),
            "date_range_end":   datetime.now(timezone.utc).isoformat(),
            "received_at":      datetime.now(timezone.utc).isoformat(),
            "total_msgs": 100, "dmarc_pass": 80, "spf_pass": 90, "dkim_pass": 75,
            "failures": [{"source_ip": "1.2.3.4"}, {"source_ip": "5.6.7.8"}],
        })
        r = await ac.get("/api/threat-intel/dmarc/domain/pytest-example.com?days=1")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == 1
        assert d["total_msgs"] == 100
        assert d["dmarc_pass_pct"] == 80.0
        assert len(d["per_org"]) == 1
        assert d["per_org"][0]["org"] == "TestOrg"
        assert len(d["failing_ips"]) == 2
        # cleanup
        await db.dmarc_reports.delete_one({"id": report_id})

        # 2) Rule performance scan — seed applied rule > 7d ago with 0 hits
        old = (datetime.now(timezone.utc).replace(microsecond=0)
                .replace(year=datetime.now(timezone.utc).year - 1)).isoformat()
        rid = str(uuid.uuid4())
        await db.mailscanner_rules.insert_one({
            "id": rid, "license_key": LK,
            "name": "pytest_zero_hit_rule",
            "pattern": "buythisimpossiblepattern12345",
            "target": "subject", "score": 3.0, "enabled": True,
            "created_at": old, "updated_at": old,
        })
        r = await ac.post(
            f"/api/mailscanner/ai/rule-performance/scan?license_key={LK}"
            "&min_age_days=7&window_days=7"
        )
        assert r.status_code == 200
        rp = r.json()
        assert rp["scanned"] >= 1
        assert rp["zero_hit"] >= 1
        # Removal suggestion oluştu mu?
        rs = await db.mailscanner_rule_suggestions.find_one({
            "target_rule_id": rid, "source": "removal_suggestion",
        })
        assert rs is not None
        # 3) rule-performance list — rules döner
        r = await ac.get(f"/api/mailscanner/ai/rule-performance?license_key={LK}")
        assert r.status_code == 200
        rl = r.json()
        assert any(x.get("id") == rid for x in rl.get("items", []))
        # 4) Removal onay endpoint'i — kuralı sil
        r = await ac.post(f"/api/mailscanner/ai/rule-performance/remove/{rid}?license_key={LK}")
        assert r.status_code == 200
        # Cleanup
        await db.mailscanner_rules.delete_one({"id": rid})
        await db.mailscanner_rule_suggestions.delete_many({"target_rule_id": rid})


def test_integration():
    asyncio.run(_integration())
