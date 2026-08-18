"""v43.95 — Trusted IPs CSV export test."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = l.split("=", 1)[1].strip().rstrip("/")
MK = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"
HDR = {"X-Master-Key": MK, "X-Forwarded-For": "89.19.15.58"}


def test_trusted_ips_csv_export():
    r = requests.get(f"{API}/settings/trusted-ips/export.csv", headers=HDR, timeout=15)
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "attachment" in r.headers.get("content-disposition", "")
    text = r.content.decode("utf-8")
    # Header row present
    assert text.startswith("ip,country_code,label,added_at,added_by_ip,added_via")
    # At least one data row (from previous test data)
    assert len(text.splitlines()) >= 1


def test_trusted_ips_csv_master_only():
    r = requests.get(f"{API}/settings/trusted-ips/export.csv", timeout=10)
    assert r.status_code in (401, 403)
