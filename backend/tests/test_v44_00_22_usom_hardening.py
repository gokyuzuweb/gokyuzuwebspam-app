"""v44.00.22 (part 4) — USOM validation + cleanup + multi-URL fallback."""
from pathlib import Path


def test_multi_url_candidates_defined():
    src = Path("/app/backend/routes/usom.py").read_text()
    assert "USOM_FEED_CANDIDATES" in src
    # At least 2 candidates
    assert src.count("usom.gov.tr") >= 2


def test_html_content_sniff():
    src = Path("/app/backend/routes/usom.py").read_text()
    assert "def _is_html_content" in src
    assert "<!doctype" in src.lower() or "!doctype" in src.lower()


def test_url_line_validator_regex():
    src = Path("/app/backend/routes/usom.py").read_text()
    assert "_VALID_LINE_RE" in src
    # Rejects HTML garbage chars
    assert '"<"' in src and '">"' in src


def test_cleanup_endpoint_exists():
    src = Path("/app/backend/routes/usom.py").read_text()
    assert '@router.post("/cleanup")' in src
    assert "async def cleanup_usom" in src
    # Regex-based bad data query
    assert "DOCTYPE|<html" in src or "DOCTYPE" in src


def test_frontend_cleanup_button():
    src = Path("/app/frontend/src/pages/ThreatIntel.js").read_text()
    assert 'data-testid="usom-cleanup-btn"' in src
    assert "Kirli Verileri Temizle" in src
    assert "/threat-intel/usom/cleanup" in src


def test_source_url_returned():
    src = Path("/app/backend/routes/usom.py").read_text()
    # fetch endpoint returns source_url
    assert '"source_url": source_url' in src
    # tuple unpack
    assert "urls, source_url = await _fetch_usom_urls" in src
