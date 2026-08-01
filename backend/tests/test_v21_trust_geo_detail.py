"""v21 batch tests: trust-score/snapshot+history, geo/country-detail, auto-cleanup email body composition."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE}/api"


# ---- trust-score snapshot ----
def test_trust_snapshot_upsert():
    r = requests.post(f"{API}/maintenance/trust-score/snapshot",
                      params={"score": 78, "findings": 3, "rbl_listed": 1})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("score") == 78
    assert "date" in j


def test_trust_snapshot_upsert_idempotent_same_day():
    r1 = requests.post(f"{API}/maintenance/trust-score/snapshot",
                       params={"score": 80, "findings": 2, "rbl_listed": 0})
    r2 = requests.post(f"{API}/maintenance/trust-score/snapshot",
                       params={"score": 82, "findings": 2, "rbl_listed": 0})
    assert r1.status_code == 200 and r2.status_code == 200
    # after 2nd write same-day row should reflect latest score in history
    h = requests.get(f"{API}/maintenance/trust-score/history", params={"days": 1}).json()
    assert h["series"][-1]["score"] == 82


# ---- trust-score history ----
def test_trust_history_30_days():
    r = requests.get(f"{API}/maintenance/trust-score/history", params={"days": 30})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["days"] == 30
    assert isinstance(j["series"], list)
    assert len(j["series"]) == 30
    # avg/min/max/delta present (nullable if no data — but seeded per problem statement)
    assert "avg" in j and "min" in j and "max" in j and "delta" in j
    # per problem statement seeded delta=+47
    if j["delta"] is not None:
        assert isinstance(j["delta"], (int, float))


# ---- geo country-detail ----
def test_geo_country_detail_us():
    r = requests.get(f"{API}/maintenance/geo/country-detail",
                     params={"cc": "US", "limit": 10})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["country"] == "US"
    assert isinstance(j["items"], list)
    for it in j["items"]:
        assert "ip" in it and "created_at" in it and "source" in it and "reason" in it


def test_geo_country_detail_empty_country():
    r = requests.get(f"{API}/maintenance/geo/country-detail",
                     params={"cc": "ZZ", "limit": 10})
    assert r.status_code == 200
    j = r.json()
    assert j["country"] == "ZZ"
    assert j["items"] == []
    assert j["total"] == 0


# ---- auto-cleanup run-now with email body composition ----
def test_auto_cleanup_run_now_with_email():
    # Configure with email_to so email path is exercised
    cfg = {
        "enabled": True, "older_than_days": 90, "day_of_month": 1,
        "hour_utc": 3, "action": "archive", "email_to": "TEST_report@example.com",
    }
    r = requests.post(f"{API}/maintenance/auto-cleanup", json=cfg)
    assert r.status_code == 200

    r2 = requests.post(f"{API}/maintenance/auto-cleanup/run-now")
    assert r2.status_code == 200, r2.text
    j = r2.json()
    assert j.get("ok") is True
    assert "total" in j and "action" in j and "collections" in j

    # verify maintenance_log recorded
    log = requests.get(f"{API}/maintenance/cleanup-log", params={"limit": 5}).json()
    actions = [it.get("action", "") for it in log.get("items", [])]
    assert any("auto_cleanup" in a for a in actions)
