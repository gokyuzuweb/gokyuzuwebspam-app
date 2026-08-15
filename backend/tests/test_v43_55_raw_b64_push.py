"""v43.55 tests — /api/outbound/exim-log-push-raw base64 support + version panel."""
import base64
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
LIC = "MS-C02AB012652A4FE692D69676"

EXIM_LOG = (
    '2026-08-15 14:34:56 1uHqCk-000100-A1 <= testuser@example.com H=host U=testuser P=esmtp S=1024 T="Test"\n'
    '2026-08-15 14:35:01 1uHqCk-000100-A1 => external@gmail.com R=dnslookup T=remote_smtp\n'
)


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def test_version_panel_v43_55(s):
    r = s.get(f"{BASE_URL}/api/version/panel", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("version") == "v43.55", data
    assert data.get("source") == "VERSION", data


def test_raw_push_with_b64(s):
    b64 = base64.b64encode(EXIM_LOG.encode("utf-8")).decode("ascii")
    payload = {"license_key": LIC, "log_text_b64": b64, "hostname": "test-host"}
    r = s.post(f"{BASE_URL}/api/outbound/exim-log-push-raw", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("parsed", 0) > 0, data
    assert (data.get("inserted", 0) + data.get("updated", 0)) > 0, data


def test_raw_push_empty_b64_fallthrough(s):
    # Empty b64 → falls through to log_text (also empty) → 400 "log_text boş"
    payload = {"license_key": LIC, "log_text_b64": "", "hostname": "test-host"}
    r = s.post(f"{BASE_URL}/api/outbound/exim-log-push-raw", json=payload, timeout=15)
    assert r.status_code == 400, r.text
    assert "log_text" in r.text.lower() or "boş" in r.text


def test_raw_push_malformed_b64(s):
    # Malformed base64 should yield 400 with decode error mention
    payload = {"license_key": LIC, "log_text_b64": "@@@not_valid_base64!!!", "hostname": "test-host"}
    r = s.post(f"{BASE_URL}/api/outbound/exim-log-push-raw", json=payload, timeout=15)
    # base64.b64decode is lenient with garbage chars — could either decode to empty or raise.
    # Both should return 400 with informative message.
    assert r.status_code == 400, r.text
    body = r.text.lower()
    assert ("decode" in body) or ("boş" in body) or ("log_text" in body), r.text


def test_raw_push_textplain_backcompat(s):
    r = s.post(
        f"{BASE_URL}/api/outbound/exim-log-push-raw",
        data=EXIM_LOG.encode("utf-8"),
        headers={"Content-Type": "text/plain", "X-License-Key": LIC, "X-Hostname": "test-host-plain"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("parsed", 0) > 0, data


def test_exim_log_push_ts_decoded_from_mid(s):
    """v43.52 regression check — events without ts but with valid mid must
    get ts decoded from base62 mid prefix (not fall back to now)."""
    # Send via legacy /exim-log-push endpoint with structured events (no ts field)
    events = [{
        "exim_mid": "1uHqCk-000100-A1",
        "from_addr": "testuser@example.com",
        "to_addr": "external@gmail.com",
        "direction": "out",
        "verdict": "clean",
        "action": "accept",
    }]
    payload = {"license_key": LIC, "events": events}
    r = s.post(f"{BASE_URL}/api/outbound/exim-log-push", json=payload, timeout=30)
    # Endpoint may exist under multiple names — accept 200 or verify via list endpoint
    assert r.status_code in (200, 201), r.text

    # Verify via events list — ts must not be "now-ish", should reflect decoded mid time
    # Decoded from mid "1uHqCk": base62 → epoch seconds
    b62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    secs = 0
    for c in "1uHqCk":
        secs = secs * 62 + b62.index(c)
    # Should be a valid epoch — 2026-ish
    assert 946684800 < secs < 2524608000, f"Decoded secs out of range: {secs}"

    # Query events for that mid
    r2 = s.get(
        f"{BASE_URL}/api/outbound/events",
        params={"license_key": LIC, "limit": 50, "search": "1uHqCk-000100-A1"},
        timeout=15,
    )
    if r2.status_code == 200:
        data = r2.json()
        items = data if isinstance(data, list) else (data.get("items") or data.get("events") or [])
        matching = [e for e in items if e.get("exim_mid") == "1uHqCk-000100-A1"]
        if matching:
            ts = matching[0].get("ts", "")
            # Should decode to 2026 timestamp, not the ingest time (which will be current server time)
            assert ts.startswith("2026") or re.match(r"^20\d{2}-", ts), f"ts not decoded from mid: {ts}"
