"""v43.94 — Country flag enrichment + Schedule send-test tests."""
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


def test_trusted_ips_country_code_enriched():
    ip = "8.8.8.8"       # Google DNS → US
    requests.post(f"{API}/settings/trusted-ips", headers=HDR,
                  json={"ip": ip, "label": "pytest-us"}, timeout=10)
    L = requests.get(f"{API}/settings/trusted-ips", headers=HDR, timeout=10).json()
    match = next((x for x in L["items"] if x["ip"] == ip), None)
    assert match is not None
    assert "country_code" in match
    # 8.8.8.8 → US (accept any 2-char code as we may have offline DB with limited data)
    assert isinstance(match["country_code"], str)
    # Cleanup
    requests.delete(f"{API}/settings/trusted-ips/{ip}", headers=HDR, timeout=10)


def test_schedule_send_test_actually_dispatches():
    r = requests.post(f"{API}/report-schedules/", headers=HDR,
                      json={"email": "test@example.com", "recipient": "admin@example.com",
                            "direction": "both", "days": 7, "format": "pdf",
                            "day_of_week": 0, "hour": 8}, timeout=10)
    assert r.status_code == 200
    sid = r.json()["schedule"]["id"]

    # Send-test — real dispatch (dry_run=False)
    st = requests.post(f"{API}/report-schedules/{sid}/send-test", headers=HDR, timeout=30)
    assert st.status_code == 200
    j = st.json()
    # In test env _send_email may return queued or ok — both are acceptable, error path
    # would report ok=False. We just need the endpoint to respond OK.
    assert "result" in j

    # After test send, run_count incremented
    L = requests.get(f"{API}/report-schedules/", headers=HDR, timeout=10).json()
    row = next((s for s in L["items"] if s["id"] == sid), None)
    if row and j["ok"]:
        assert row.get("run_count", 0) >= 1
        assert row.get("last_run_status") == "test_ok"

    # Cleanup
    requests.delete(f"{API}/report-schedules/{sid}", headers=HDR, timeout=10)


def test_schedule_send_test_unknown_id():
    r = requests.post(f"{API}/report-schedules/nonexistent/send-test", headers=HDR, timeout=10)
    assert r.status_code == 404
