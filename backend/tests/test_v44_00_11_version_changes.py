"""
v44.00.11 — /api/admin/version-changes endpoint + version_changes collection
regression tests. Uses live backend via supervisord + direct Mongo.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
MASTER_KEY = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def seeded_lic(db):
    key = f"MS-TEST{uuid.uuid4().hex[:20].upper()}"
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "license_key": key,
        "customer_name": "VC Test",
        "customer_email": "vc@example.com",
        "plan": "pro",
        "ip_addresses": ["203.0.113.77"],
        "max_domains": 100,
        "valid_until": (now + timedelta(days=365)).isoformat(),
        "active": True,
        "created_at": now.isoformat(),
    }
    db.licenses.insert_one(doc)
    yield key
    db.licenses.delete_one({"license_key": key})
    db.version_changes.delete_many({"license_key": key})


def _hb(key, ip, version):
    return requests.post(f"{BASE_URL}/api/plugin/heartbeat", json={
        "license_key": key, "ip": ip, "hostname": "vc.example.com",
        "plugin_version": version,
    }, timeout=5)


# ---- version_changes writes ----

def test_version_change_recorded_on_upgrade(db, seeded_lic):
    _hb(seeded_lic, "203.0.113.77", "44.00.10")
    _hb(seeded_lic, "203.0.113.77", "44.00.11")
    changes = list(db.version_changes.find({"license_key": seeded_lic}))
    # Two writes expected: initial (old=None -> 44.00.10) and upgrade (44.00.10 -> 44.00.11)
    assert len(changes) == 2, f"Expected 2 change entries, got {len(changes)}"
    latest = sorted(changes, key=lambda c: c["changed_at"])[-1]
    assert latest["new_version"] == "44.00.11"
    assert latest["old_version"] == "44.00.10"


def test_no_duplicate_when_same_version(db, seeded_lic):
    """REGRESSION: aynı versiyonun tekrarı yeni kayıt açmamalı."""
    _hb(seeded_lic, "203.0.113.77", "44.00.11")
    count1 = db.version_changes.count_documents({"license_key": seeded_lic})
    # Same version 3 more times
    for _ in range(3):
        _hb(seeded_lic, "203.0.113.77", "44.00.11")
    count2 = db.version_changes.count_documents({"license_key": seeded_lic})
    assert count1 == count2, (
        f"Same-version heartbeats added new rows! before={count1} after={count2}"
    )


def test_version_change_recorded_even_on_ip_mismatch(db, seeded_lic):
    """IP mismatch (403) durumunda BILE version_changes kaydı düşmeli."""
    _hb(seeded_lic, "203.0.113.77", "44.00.10")  # baseline 200
    r = _hb(seeded_lic, "10.9.9.9", "44.00.11")  # wrong IP
    assert r.status_code == 403
    changes = list(db.version_changes.find({"license_key": seeded_lic}))
    assert any(c["new_version"] == "44.00.11" for c in changes), \
        "IP mismatch heartbeat did not record version_changes row"


# ---- admin/version-changes endpoint ----

def test_admin_version_changes_master_ok(db, seeded_lic):
    _hb(seeded_lic, "203.0.113.77", "44.00.11")
    r = requests.get(
        f"{BASE_URL}/api/admin/version-changes",
        params={"license_key": MASTER_KEY, "hours": 24},
        timeout=5,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for field in ("hours", "latest_version", "total_changes", "updated_to_latest", "changes"):
        assert field in data, f"missing field: {field}"
    assert data["hours"] == 24
    assert isinstance(data["changes"], list)
    # Our seeded lic should appear
    found = [c for c in data["changes"] if c["license_key"] == seeded_lic]
    assert found, "seeded license not in changes list"
    row = found[0]
    for f in ("license_key", "customer_name", "previous_version", "new_version",
              "changed_at", "is_latest", "minutes_ago"):
        assert f in row, f"row missing field: {f}"
    assert row["new_version"] == "44.00.11"
    assert isinstance(row["minutes_ago"], int)


def test_admin_version_changes_bayi_forbidden(seeded_lic):
    """Bayı license_key ile çağrılırsa 403 dönmeli (master-only)."""
    r = requests.get(
        f"{BASE_URL}/api/admin/version-changes",
        params={"license_key": seeded_lic, "hours": 24},
        timeout=5,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_admin_version_changes_hours_bounds():
    """hours parametresi 1-168 arası clamp edilmeli."""
    # hours=500 -> clamped to 168
    r = requests.get(
        f"{BASE_URL}/api/admin/version-changes",
        params={"license_key": MASTER_KEY, "hours": 500},
        timeout=5,
    )
    assert r.status_code == 200
    assert r.json()["hours"] == 168
    # hours=0 -> clamped to 1
    r = requests.get(
        f"{BASE_URL}/api/admin/version-changes",
        params={"license_key": MASTER_KEY, "hours": 0},
        timeout=5,
    )
    assert r.status_code == 200
    assert r.json()["hours"] == 1
