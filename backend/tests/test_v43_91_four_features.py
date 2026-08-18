"""v43.91 — 4 yeni özellik: Bayi IP Enforce + PIN Approval + UI Theme + Report Schedules."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = l.split("=", 1)[1].strip().rstrip("/")
MK = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
BAYI = "MS-TESTBAYI-PRO-V4371"
API = f"{BASE_URL}/api"

HDR_MASTER = {"X-Master-Key": MK, "X-Forwarded-For": "89.19.15.58", "Content-Type": "application/json"}
HDR_BAYI = {"X-Master-Key": BAYI, "X-Forwarded-For": "10.0.0.1", "Content-Type": "application/json"}


# --- UI Theme ----------------------------------------------------------------
def test_ui_theme_default():
    r = requests.get(f"{API}/settings/ui-theme/me", headers=HDR_MASTER, timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert "accent_color" in j
    assert j["accent_color"] in ("indigo", "fuchsia", "emerald", "cyan", "rose")


def test_ui_theme_put_valid():
    r = requests.put(f"{API}/settings/ui-theme/me", headers=HDR_MASTER,
                     json={"accent_color": "emerald"}, timeout=10)
    assert r.status_code == 200
    assert r.json()["accent_color"] == "emerald"


def test_ui_theme_put_invalid():
    r = requests.put(f"{API}/settings/ui-theme/me", headers=HDR_MASTER,
                     json={"accent_color": "rainbow"}, timeout=10)
    assert r.status_code == 422


# --- Bayi IP Enforce ---------------------------------------------------------
def test_bayi_ip_enforce_master_only():
    # Bayi (not master) → 403
    r = requests.get(f"{API}/settings/bayi-ip-enforce", headers=HDR_BAYI, timeout=10)
    assert r.status_code == 403


def test_bayi_ip_enforce_toggle():
    r = requests.put(f"{API}/settings/bayi-ip-enforce", headers=HDR_MASTER,
                     json={"enabled": True}, timeout=10)
    assert r.status_code == 200 and r.json()["enabled"] is True
    # Reset to disabled
    r2 = requests.put(f"{API}/settings/bayi-ip-enforce", headers=HDR_MASTER,
                      json={"enabled": False}, timeout=10)
    assert r2.status_code == 200 and r2.json()["enabled"] is False


# --- PIN Approval ------------------------------------------------------------
def test_pin_approval_flow():
    # 0) Clean any pending for BAYI
    # Bayi submits new pin request
    r = requests.post(f"{API}/pin-approvals/request", headers=HDR_BAYI,
                      json={"new_pin": "9876", "reason": "pytest"}, timeout=10)
    # Either created (201/200) or 409 if already pending — accept both then cleanup
    if r.status_code == 409:
        # find pending
        pend = requests.get(f"{API}/pin-approvals/pending", headers=HDR_MASTER, timeout=10).json()
        for i in pend["items"]:
            if i["bayi_license_key"] == BAYI:
                requests.post(f"{API}/pin-approvals/{i['id']}/decide", headers=HDR_MASTER,
                              json={"decision": "reject", "note": "cleanup"}, timeout=10)
        r = requests.post(f"{API}/pin-approvals/request", headers=HDR_BAYI,
                          json={"new_pin": "9876", "reason": "pytest"}, timeout=10)
    assert r.status_code == 200
    rid = r.json()["request_id"]

    # Master sees pending
    p = requests.get(f"{API}/pin-approvals/pending", headers=HDR_MASTER, timeout=10)
    assert p.status_code == 200
    ids = [i["id"] for i in p.json()["items"]]
    assert rid in ids

    # Master approves
    d = requests.post(f"{API}/pin-approvals/{rid}/decide", headers=HDR_MASTER,
                      json={"decision": "approve", "note": "test approved"}, timeout=10)
    assert d.status_code == 200
    assert d.json()["status"] == "approved"

    # Second decide should fail
    d2 = requests.post(f"{API}/pin-approvals/{rid}/decide", headers=HDR_MASTER,
                       json={"decision": "reject"}, timeout=10)
    assert d2.status_code == 400


def test_pin_approval_bayi_cannot_decide():
    r = requests.post(f"{API}/pin-approvals/foo/decide", headers=HDR_BAYI,
                      json={"decision": "approve"}, timeout=10)
    assert r.status_code == 403


# --- Report Schedules --------------------------------------------------------
def test_schedules_crud():
    # Create
    r = requests.post(f"{API}/report-schedules/", headers=HDR_MASTER,
                      json={"email": "test@example.com", "recipient": "admin@example.com",
                            "direction": "both", "days": 7, "format": "pdf",
                            "day_of_week": 0, "hour": 8}, timeout=15)
    assert r.status_code == 200
    sid = r.json()["schedule"]["id"]

    # List
    L = requests.get(f"{API}/report-schedules/", headers=HDR_MASTER, timeout=10)
    ids = [s["id"] for s in L.json()["items"]]
    assert sid in ids

    # Run-now (dry-run)
    rn = requests.post(f"{API}/report-schedules/{sid}/run-now", headers=HDR_MASTER, timeout=25)
    assert rn.status_code == 200
    res = rn.json()["result"]
    assert res.get("ok") is True
    assert res.get("sent_via") == "dry_run"

    # Delete
    d = requests.delete(f"{API}/report-schedules/{sid}", headers=HDR_MASTER, timeout=10)
    assert d.status_code == 200
    assert d.json()["deleted"] == sid


def test_schedules_validation():
    # Invalid direction → 422
    r = requests.post(f"{API}/report-schedules/", headers=HDR_MASTER,
                      json={"email": "x@y.com", "recipient": "a@b.com",
                            "direction": "backwards", "days": 30}, timeout=10)
    assert r.status_code == 422

    # Invalid days (out of range) → 422
    r2 = requests.post(f"{API}/report-schedules/", headers=HDR_MASTER,
                       json={"email": "x@y.com", "recipient": "a@b.com",
                             "direction": "both", "days": 999}, timeout=10)
    assert r2.status_code == 422
