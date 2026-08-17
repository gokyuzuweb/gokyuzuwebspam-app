"""v43.74 retest — 2 fixes from iteration_48"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
VALID_LICENSE = "MS-TESTBAYI-STARTER-V4371"
BOGUS_LICENSE = "MS-BOGUS-KEY-NOT-EXIST"


def test_idle_lock_unlock_with_ip_changed_persists_details_and_warning_severity():
    payload = {
        "event": "unlock",
        "license_key": VALID_LICENSE,
        "ip_changed": True,
        "previous_ip": "1.2.3.4",
        "current_ip": "5.6.7.8",
    }
    r = requests.post(f"{BASE_URL}/api/audit/idle-lock-event", json=payload, timeout=15)
    assert r.status_code == 200, f"POST failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True, f"expected ok:true, got {body}"

    # GET audit logs via master license
    r2 = requests.get(
        f"{BASE_URL}/api/audit/logs",
        headers={"X-Master-Key": MASTER_KEY},
        params={"limit": 20, "action": "idle_lock_unlock"},
        timeout=15,
    )
    assert r2.status_code == 200, f"logs fetch failed: {r2.status_code} {r2.text}"
    data = r2.json()
    logs = data if isinstance(data, list) else data.get("logs") or data.get("items") or data.get("data") or []
    assert logs, f"no logs returned: {data}"

    # find newest idle_lock_unlock entry
    entry = None
    for L in logs:
        if L.get("action") == "idle_lock_unlock":
            entry = L
            break
    assert entry is not None, f"no idle_lock_unlock entry found in first logs: {logs[:3]}"
    assert entry.get("severity") == "warning", f"expected severity=warning, got {entry.get('severity')} entry={entry}"
    details = entry.get("details") or {}
    assert details.get("ip_changed") is True, f"details.ip_changed not True: {details}"
    assert details.get("previous_ip") == "1.2.3.4", f"previous_ip mismatch: {details}"
    assert details.get("current_ip") == "5.6.7.8", f"current_ip mismatch: {details}"


def test_idle_lock_lock_no_ip_change_is_info_severity():
    payload = {"event": "lock", "license_key": VALID_LICENSE, "idle_seconds": 900}
    r = requests.post(f"{BASE_URL}/api/audit/idle-lock-event", json=payload, timeout=15)
    assert r.status_code == 200, f"POST failed: {r.status_code} {r.text}"
    assert r.json().get("ok") is True

    r2 = requests.get(
        f"{BASE_URL}/api/audit/logs",
        headers={"X-Master-Key": MASTER_KEY},
        params={"limit": 20, "action": "idle_lock_lock"},
        timeout=15,
    )
    assert r2.status_code == 200
    data = r2.json()
    logs = data if isinstance(data, list) else data.get("logs") or data.get("items") or data.get("data") or []
    entry = None
    for L in logs:
        if L.get("action") == "idle_lock_lock":
            entry = L
            break
    assert entry is not None, f"no idle_lock_lock entry found: {logs[:3]}"
    assert entry.get("severity") == "info", f"expected severity=info, got {entry.get('severity')}"


def test_publisher_stats_bogus_license_returns_404():
    r = requests.get(
        f"{BASE_URL}/api/marketplace/publisher/stats",
        params={"license_key": BOGUS_LICENSE},
        timeout=15,
    )
    assert r.status_code == 404, f"expected 404 for bogus license, got {r.status_code}: {r.text}"
    body = r.json()
    detail = body.get("detail") or body.get("message") or ""
    assert "Lisans bulunamadı" in detail or "bulunamadı" in detail.lower() or "aktif" in detail.lower(), \
        f"unexpected error message: {body}"


def test_publisher_stats_valid_license_returns_200():
    r = requests.get(
        f"{BASE_URL}/api/marketplace/publisher/stats",
        params={"license_key": VALID_LICENSE},
        timeout=15,
    )
    assert r.status_code == 200, f"expected 200 for valid license, got {r.status_code}: {r.text}"
    body = r.json()
    assert isinstance(body, dict), f"expected dict, got {type(body)}"
