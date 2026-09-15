"""v44.00.30 — Global Feed status enrichment + DMARC dashboard + hosted domain filter."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_feeds_status_extended():
    src = (ROOT / "routes/threat_intel.py").read_text()
    for st in ("never_synced", '"clean"', '"stale"', '"error"', '"ok"'):
        assert st in src, f"missing status: {st}"
    assert "threat_intel_feeds" in src
    assert "last_sync_status" in src


def test_dmarc_summary_hosted_filter():
    src = (ROOT / "routes/threat_intel.py").read_text()
    assert 'only_hosted: bool = Query(True)' in src
    assert "hosted_without_reports" in src
    assert "common_free" in src  # gmail/yahoo filter


def test_frontend_dmarc_dashboard():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    assert "DmarcDashboard" in src
    assert "dmarc-dashboard" in src
    assert "DMARC Kapsam Oranı" in src
    assert "En Riskli Domain" in src
    assert "En Sağlıklı Domain" in src


def test_frontend_feed_status_labels():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    for lbl in ('"AKTİF"', '"TEMİZ"', '"GÜNCEL DEĞİL"', '"HATA"', '"SYNC BEKLEMEDE"'):
        assert lbl in src, f"missing label: {lbl}"
