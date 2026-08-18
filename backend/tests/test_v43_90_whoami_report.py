"""v43.90 — Header personalize (whoami customer_name + last login) + Advanced
Mail Activity Report round-trip smoke tests.
"""
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
MASTER_IP = "89.19.15.58"
API = f"{BASE_URL}/api"

HDR_MASTER = {"X-Master-Key": MK, "X-Forwarded-For": MASTER_IP, "Content-Type": "application/json"}


def test_whoami_returns_customer_name_and_plan():
    r = requests.get(f"{API}/admin/whoami", params={"license_key": MK},
                     headers={"X-Forwarded-For": MASTER_IP}, timeout=10)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["is_master"] is True
    assert j.get("customer_name"), "customer_name eksik"
    assert j.get("plan") in ("enterprise", "pro", "starter")
    assert "master_key" in j


def test_whoami_records_login_history():
    """Two whoami calls; second must at minimum still be master + shape OK."""
    requests.get(f"{API}/admin/whoami", params={"license_key": MK},
                 headers={"X-Forwarded-For": MASTER_IP}, timeout=10)
    time.sleep(0.3)
    r2 = requests.get(f"{API}/admin/whoami", params={"license_key": MK},
                      headers={"X-Forwarded-For": f"{MASTER_IP}, 5.6.7.8"}, timeout=10)
    j = r2.json()
    assert j["is_master"] is True
    assert j.get("customer_name")


def test_mail_activity_json():
    r = requests.post(f"{API}/reports/mail-activity", headers=HDR_MASTER,
                      json={"email": "test@example.com", "direction": "both",
                            "days": 30, "format": "json", "limit": 100}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["email"] == "test@example.com"
    assert "sent" in j and "received" in j
    assert "summary" in j["sent"] and "summary" in j["received"]


def test_mail_activity_pdf():
    r = requests.post(f"{API}/reports/mail-activity", headers=HDR_MASTER,
                      json={"email": "test@example.com", "direction": "sent",
                            "days": 30, "format": "pdf"}, timeout=20)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"


def test_mail_activity_xlsx():
    r = requests.post(f"{API}/reports/mail-activity", headers=HDR_MASTER,
                      json={"email": "test@example.com", "direction": "received",
                            "days": 30, "format": "xlsx"}, timeout=20)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    assert r.content[:2] == b"PK"


def test_mail_activity_requires_auth():
    r = requests.post(f"{API}/reports/mail-activity",
                      json={"email": "test@example.com"},
                      headers={"Content-Type": "application/json"}, timeout=10)
    # 401 (endpoint check) or 403 (demo_write_guard middleware) — either blocks unauth writes
    assert r.status_code in (401, 403), r.text
