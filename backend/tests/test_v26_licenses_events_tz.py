"""
Backend tests for License CRUD + Events (MIME decode, TZ auto-correct,
logtail heartbeat/status, admin migrate-ts-tz) — iteration 18.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def master(s):
    m = requests.Session()
    m.headers.update({"Content-Type": "application/json", "X-Master-Key": MASTER_KEY})
    return m


# -------------------- whoami --------------------
class TestWhoami:
    def test_whoami_master(self, s):
        r = s.get(f"{BASE_URL}/api/admin/whoami", params={"license_key": MASTER_KEY})
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_master") is True
        assert data.get("master_key") == MASTER_KEY


# -------------------- Demo guard --------------------
class TestDemoGuard:
    def test_put_without_master_returns_423(self, s):
        # First create a license using master
        # But without master header, PUT should get 423
        r = s.put(f"{BASE_URL}/api/licenses/nonexistent-id", json={
            "customer_name": "x", "customer_email": "x@x.com",
            "plan": "starter", "ip_addresses": [],
            "valid_until": "2026-12-31", "active": True, "notes": ""
        })
        assert r.status_code == 423, f"Expected 423 got {r.status_code}: {r.text[:200]}"
        assert r.json().get("code") == "DEMO_READ_ONLY"

    def test_delete_without_master_returns_423(self, s):
        r = s.delete(f"{BASE_URL}/api/licenses/nonexistent-id")
        assert r.status_code == 423
        assert r.json().get("code") == "DEMO_READ_ONLY"


# -------------------- License CRUD --------------------
class TestLicenseCRUD:
    lic_id = None
    lic_key = None

    def test_create_license(self, master):
        payload = {
            "customer_name": "TEST_Customer",
            "customer_email": "test@example.com",
            "plan": "pro",
            "ip_addresses": ["1.2.3.4"],
            "valid_until": "2027-01-01",
            "active": True,
            "notes": "TEST_iteration_18"
        }
        r = master.post(f"{BASE_URL}/api/licenses", json=payload)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data["plan"] == "pro"
        assert "id" in data
        assert data["license_key"].startswith("MS-")
        TestLicenseCRUD.lic_id = data["id"]
        TestLicenseCRUD.lic_key = data["license_key"]

    def test_update_license_toggle_active(self, master):
        assert TestLicenseCRUD.lic_id
        payload = {
            "customer_name": "TEST_Customer_Updated",
            "customer_email": "test@example.com",
            "plan": "enterprise",
            "ip_addresses": ["1.2.3.4"],
            "valid_until": "2027-01-01",
            "active": False,
            "notes": "updated"
        }
        r = master.put(f"{BASE_URL}/api/licenses/{TestLicenseCRUD.lic_id}", json=payload)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json().get("updated") is True

        # Verify persisted via GET listing
        g = master.get(f"{BASE_URL}/api/licenses")
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        found = next((i for i in items if i.get("id") == TestLicenseCRUD.lic_id), None)
        assert found is not None, "Updated license not returned by GET"
        assert found["active"] is False
        assert found["plan"] == "enterprise"
        assert found["customer_name"] == "TEST_Customer_Updated"

    def test_bulk_suspend_and_activate(self, master):
        # Create 2 more
        keys = []
        ids = []
        for i in range(2):
            r = master.post(f"{BASE_URL}/api/licenses", json={
                "customer_name": f"TEST_bulk_{i}", "customer_email": "b@b.com",
                "plan": "starter", "ip_addresses": [],
                "valid_until": "2027-01-01", "active": True, "notes": ""
            })
            assert r.status_code == 200
            ids.append(r.json()["id"])
            keys.append(r.json()["license_key"])

        r = master.post(f"{BASE_URL}/api/licenses/bulk-action", json={"ids": ids, "action": "suspend"})
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("affected") == 2

        r = master.post(f"{BASE_URL}/api/licenses/bulk-action", json={"ids": ids, "action": "activate"})
        assert r.status_code == 200
        assert r.json().get("affected") == 2

        # Cleanup
        r = master.post(f"{BASE_URL}/api/licenses/bulk-action", json={"ids": ids, "action": "delete"})
        assert r.status_code == 200
        assert r.json().get("affected") == 2

    def test_delete_license(self, master):
        assert TestLicenseCRUD.lic_id
        r = master.delete(f"{BASE_URL}/api/licenses/{TestLicenseCRUD.lic_id}")
        assert r.status_code == 200
        assert r.json().get("deleted") is True


# -------------------- Events: MIME + TZ correction --------------------
class TestEventIngest:
    def test_ingest_mime_decoded_subject(self, s):
        mime_subj = "=?UTF-8?B?SGFmdGFsxLFrIGluZGlyaW0gYsO8bHRlbmk=?="
        payload = {
            "license_key": MASTER_KEY,
            "from_addr": "sender@test.com",
            "to_addr": "recv@test.com",
            "subject": mime_subj,
            "verdict": "clean",
            "total_score": 0.0,
        }
        r = s.post(f"{BASE_URL}/api/events/ingest", json=payload)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        # Retrieve via GET events
        g = s.get(f"{BASE_URL}/api/events", params={"license_key": MASTER_KEY, "limit": 20})
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        subjects = [i.get("subject") for i in items]
        assert "Haftalık indirim bülteni" in subjects, f"Decoded subject not found in {subjects[:5]}"

    def test_ingest_auto_tz_correction(self, s):
        # ts 3 hours ahead of UTC
        future_ts = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        payload = {
            "license_key": MASTER_KEY,
            "from_addr": "tz@test.com",
            "to_addr": "recv@test.com",
            "subject": f"TEST_TZ_{uuid.uuid4().hex[:8]}",
            "verdict": "clean",
            "total_score": 0.0,
            "ts": future_ts,
        }
        r = s.post(f"{BASE_URL}/api/events/ingest", json=payload)
        assert r.status_code == 200
        # Fetch and find our event
        g = s.get(f"{BASE_URL}/api/events", params={"license_key": MASTER_KEY, "limit": 50})
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        ours = next((i for i in items if i.get("subject") == payload["subject"]), None)
        assert ours is not None, "TZ test event not found"
        assert ours.get("ts_auto_corrected"), f"ts_auto_corrected missing on {ours}"
        # ts should now be close to now_utc (within 5 min)
        ts_stored = datetime.fromisoformat(str(ours["ts"]).replace("Z", "+00:00"))
        diff_min = abs((ts_stored - datetime.now(timezone.utc)).total_seconds()) / 60.0
        assert diff_min < 10, f"After TZ correction ts should be near now; diff={diff_min}min"

    def test_events_sorted_desc(self, s):
        g = s.get(f"{BASE_URL}/api/events", params={"license_key": MASTER_KEY, "limit": 10})
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        if len(items) >= 2:
            ts0 = items[0].get("ts", "")
            ts1 = items[1].get("ts", "")
            assert ts0 >= ts1, f"Not sorted DESC: {ts0} < {ts1}"


# -------------------- Logtail heartbeat + status --------------------
class TestLogtail:
    def test_heartbeat_and_status(self, s):
        hostname = f"TEST-host-{uuid.uuid4().hex[:6]}"
        payload = {
            "license_key": MASTER_KEY,
            "hostname": hostname,
            "kind": "alive",
            "processed": 100,
            "matched": 5,
            "uptime_sec": 300,
            "offset": 12345,
            "exim_log": "/var/log/exim_mainlog",
            "server_url": "https://test.gokyuzuhosting.com",
        }
        r = s.post(f"{BASE_URL}/api/events/logtail-heartbeat", json=payload)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

        # Status
        r = s.get(f"{BASE_URL}/api/events/logtail-status", params={"license_key": MASTER_KEY})
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "alive_count" in data
        assert "healthy" in data
        # our host should be present with status alive
        ours = next((i for i in data["items"] if i.get("hostname") == hostname), None)
        assert ours is not None, f"host {hostname} not in status"
        assert ours.get("status") == "alive"
        assert data["alive_count"] >= 1
        assert data["healthy"] is True


# -------------------- Admin migrate TS TZ --------------------
class TestMigrate:
    def test_migrate_dry_run(self, s):
        r = s.post(f"{BASE_URL}/api/events/admin/migrate-ts-tz", json={
            "license_key": MASTER_KEY,
            "from_offset": "+00:00",
            "to_offset": "+03:00",
            "dry_run": True,
            "limit": 100,
        })
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        # Expect a count field
        assert any(k in data for k in ("would_migrate", "matched", "affected", "count")), f"Unexpected shape: {data}"

    def test_migrate_forbidden_without_master(self, s):
        r = s.post(f"{BASE_URL}/api/events/admin/migrate-ts-tz", json={
            "license_key": "not-master",
            "dry_run": True,
        })
        # Either 403 (route check) or 423 (demo guard fires first for POST without master)
        assert r.status_code in (403, 423), f"got {r.status_code}: {r.text[:200]}"
