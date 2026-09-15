"""v44.00.22 — DMARC fetcher + NEVER_SYNCED HTTP fallback."""
from pathlib import Path


def test_dmarc_fetcher_script_created():
    p = Path("/app/whm-plugin/scripts/mailshield-dmarc-fetch")
    assert p.exists(), "dmarc fetcher script missing"
    src = p.read_text()
    # Key features
    assert "def list_domains" in src, "whmapi domain listing missing"
    assert "postmaster" in src, "postmaster mailbox scan missing"
    assert "extract_xml_bytes" in src, "XML extract missing"
    assert "parse_dmarc_xml" in src, "DMARC XML parser missing"
    assert "gzip.decompress" in src, "gz support missing"
    assert "zipfile.ZipFile" in src, "zip support missing"
    assert "/threat-intel/dmarc/ingest" in src, "ingest endpoint call missing"


def test_dmarc_systemd_units():
    svc = Path("/app/whm-plugin/systemd/mailshield-dmarc-fetch.service")
    tmr = Path("/app/whm-plugin/systemd/mailshield-dmarc-fetch.timer")
    assert svc.exists() and tmr.exists()
    assert "OnUnitActiveSec=6h" in tmr.read_text()


def test_spamhaus_drop_fallback():
    """Spamhaus feed HTTP DROP list fallback ekli."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    assert "spamhaus.org/drop/drop_v4.json" in src
    assert 'source": "spamhaus_zen"' in src


def test_blocklist_de_fallback_for_dnsbl_feeds():
    """SORBS/DroneBL/Manitu/CBL — traffic yoksa blocklist.de fallback."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    assert "lists.blocklist.de/lists/all.txt" in src
    assert "if len(top_ips) < 10:" in src
