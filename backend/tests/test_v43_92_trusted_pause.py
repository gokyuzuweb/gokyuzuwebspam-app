"""v43.92 — Trusted IPs + Schedule pause/resume + PIN pending badge sanity."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = l.split("=", 1)[1].strip().rstrip("/")
MK = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"
HDR = {"X-Master-Key": MK, "X-Forwarded-For": "89.19.15.58", "Content-Type": "application/json"}


def test_trusted_ips_add_and_remove():
    ip = "77.77.77.77"
    # Add
    r = requests.post(f"{API}/settings/trusted-ips", headers=HDR,
                      json={"ip": ip, "label": "pytest office"}, timeout=10)
    assert r.status_code == 200
    assert r.json()["ip"] == ip

    # List includes it
    L = requests.get(f"{API}/settings/trusted-ips", headers=HDR, timeout=10).json()
    ips = [x["ip"] for x in L["items"]]
    assert ip in ips

    # Remove
    d = requests.delete(f"{API}/settings/trusted-ips/{ip}", headers=HDR, timeout=10)
    assert d.status_code == 200
    assert d.json()["removed"] == ip

    # Not in list any more (soft-deleted, active=false → hidden)
    L2 = requests.get(f"{API}/settings/trusted-ips", headers=HDR, timeout=10).json()
    ips2 = [x["ip"] for x in L2["items"]]
    assert ip not in ips2


def test_trusted_ips_master_only():
    r = requests.get(f"{API}/settings/trusted-ips", timeout=10)
    assert r.status_code in (401, 403)


def test_schedule_toggle_pause_resume():
    # Create
    r = requests.post(f"{API}/report-schedules/", headers=HDR,
                      json={"email": "t@e.com", "recipient": "a@b.com",
                            "direction": "both", "days": 30, "format": "pdf",
                            "day_of_week": 3, "hour": 9}, timeout=10)
    assert r.status_code == 200
    sid = r.json()["schedule"]["id"]
    assert r.json()["schedule"]["active"] is True

    # Toggle → paused
    t1 = requests.post(f"{API}/report-schedules/{sid}/toggle", headers=HDR, timeout=10)
    assert t1.status_code == 200 and t1.json()["active"] is False

    # Toggle → resumed (next_run_at should be recomputed)
    t2 = requests.post(f"{API}/report-schedules/{sid}/toggle", headers=HDR, timeout=10)
    assert t2.status_code == 200 and t2.json()["active"] is True

    # Cleanup
    requests.delete(f"{API}/report-schedules/{sid}", headers=HDR, timeout=10)


def test_schedule_toggle_unknown_id():
    r = requests.post(f"{API}/report-schedules/nonexistent/toggle", headers=HDR, timeout=10)
    assert r.status_code == 404
