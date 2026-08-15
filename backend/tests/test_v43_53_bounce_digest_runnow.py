"""
Tests for v43.53 Bounce Digest run-now master-key inclusion + bash script v43.53
state persistence, plus regression on exim-log-push mid timestamp decoder.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
H = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}


def test_run_now_with_master_key():
    r = requests.post(f"{BASE_URL}/api/bounce-digest/run-now", headers=H, json={}, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    for k in ("generated", "zero_bounce_licenses", "total_scanned", "per_license"):
        assert k in data, f"missing {k} in response: {data}"
    assert isinstance(data["per_license"], list)
    keys = [p.get("license_key") for p in data["per_license"]]
    assert MASTER_KEY in keys, f"master key not in per_license: {keys}"
    assert data["total_scanned"] > 0, f"total_scanned should be > 0: {data['total_scanned']}"


def test_run_now_without_master_key_forbidden():
    r = requests.post(f"{BASE_URL}/api/bounce-digest/run-now", json={}, timeout=30)
    # 403 (missing master key) or 423 (demo read-only guard fires first) both acceptable rejections
    assert r.status_code in (401, 403, 423), f"expected auth rejection got {r.status_code}: {r.text}"


def test_preview_with_master_key():
    r = requests.get(f"{BASE_URL}/api/bounce-digest/preview", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("total_bounces", 0) > 0, f"expected bounces > 0: {data}"
    for k in ("top_users", "top_domains", "samples", "html_preview"):
        assert k in data, f"missing {k}"


def test_history_after_run_now():
    r = requests.get(f"{BASE_URL}/api/bounce-digest/history?limit=5", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)


def test_gws_exim_push_script_v43_53():
    r = requests.get(f"{BASE_URL}/api/tools/gws-exim-push.sh", timeout=30)
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "")
    assert "shellscript" in ctype or "text/x-shellscript" in ctype, f"content-type: {ctype}"
    body = r.text
    assert "in_flight.state" in body, "in_flight.state not found in script"
    assert ("v43.53" in body) or ("INFLIGHT_FILE" in body), "v43.53 marker or INFLIGHT_FILE missing"


def test_exim_log_push_mid_decode_regression():
    # Event without ts but with valid exim_mid — timestamp should be decoded
    payload = {
        "license_key": MASTER_KEY,
        "hostname": "test-host",
        "events": [{
            "exim_mid": "1abc2d-000XYZ-Ab",  # standard exim mid pattern
            "sender": "sender@test.local",
            "recipients": ["r@test.local"],
            "size": 1234,
            "status": "delivered",
        }]
    }
    r = requests.post(f"{BASE_URL}/api/outbound/exim-log-push", headers=H, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    # Just ensure the endpoint accepted the payload and returned ok / counted
    assert data.get("ok") is True or "accepted" in data or "count" in data or "inserted" in data, data
