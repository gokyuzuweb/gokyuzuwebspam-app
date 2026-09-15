"""v44.00.28 — USOM UI license_key fix (UI 500 kayıt gösteriyordu 0 gösteriyordu, artık dolu)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_usom_tab_sends_license_key():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    # UsomTab tüm 4 endpoint çağrısında license_key gönderiyor
    assert "license_key: lk()" in src
    assert "usom/fetch?license_key=" in src
    assert "usom/cleanup?license_key=" in src
    assert "usom/delete?license_key=" in src


def test_usom_fetch_toast_uses_new_response_schema():
    src = (ROOT.parent / "frontend/src/pages/ThreatIntel.js").read_text()
    # Yeni response: total_fetched, added_urls/domains/ips, added_to_blacklist
    assert "d.total_fetched" in src
    assert "d.added_to_blacklist" in src
