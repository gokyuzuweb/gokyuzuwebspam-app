"""v20 tests: Havale notify/inbox admin flow, Auto-cleanup cron config + run, Geo blocked heatmap."""
import os, pytest, requests, time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Havale notify → admin inbox → approve chain ---
class TestHavaleAdminFlow:
    def test_full_flow(self, session):
        # 1. Create havale order
        r = session.post(f"{API}/payments/havale/create", json={
            "email": "test_v20@example.com", "user_name": "TEST V20", "amount": 42.5,
            "plan": "starter", "note": "v20 test"
        })
        assert r.status_code == 200, r.text
        oid = r.json()["merchant_oid"]
        assert oid.startswith("TRF")

        # 2. User notifies
        r = session.post(f"{API}/payments/havale/notify", json={
            "merchant_oid": oid, "transaction_ref": "BANKREF-V20-01",
            "sender_name": "Ali V20", "note": "yaptım"
        })
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "notified_by_user"

        # 3. Admin pending shows it
        r = session.get(f"{API}/payments/admin/pending")
        assert r.status_code == 200
        data = r.json()
        oids = [i["merchant_oid"] for i in data["items"]]
        assert oid in oids
        assert data["notified_count"] >= 1

        # 4. Admin inbox has unread entry
        r = session.get(f"{API}/payments/admin/inbox")
        assert r.status_code == 200
        idata = r.json()
        assert idata["unread"] >= 1
        entry = next((i for i in idata["items"] if i.get("merchant_oid") == oid), None)
        assert entry is not None
        assert entry["read"] is False
        assert entry["amount"] == 42.5
        assert entry["transaction_ref"] == "BANKREF-V20-01"
        nid = entry["id"]

        # 5. Mark read
        r = session.post(f"{API}/payments/admin/inbox/{nid}/read")
        assert r.status_code == 200

        # 6. Approve
        r = session.post(f"{API}/payments/havale/approve", json={
            "merchant_oid": oid, "admin_note": "ok"
        })
        assert r.status_code == 200
        assert r.json()["status"] == "paid"

        # 7. Verify order status
        r = session.get(f"{API}/payments/order/{oid}")
        assert r.status_code == 200
        assert r.json()["status"] == "paid"

    def test_reject_flow(self, session):
        r = session.post(f"{API}/payments/havale/create", json={
            "email": "test_v20b@example.com", "user_name": "TEST V20B", "amount": 10
        })
        oid = r.json()["merchant_oid"]
        session.post(f"{API}/payments/havale/notify", json={
            "merchant_oid": oid, "transaction_ref": "REF-B", "sender_name": "B"
        })
        r = session.post(f"{API}/payments/havale/reject", json={
            "merchant_oid": oid, "reason": "referans eşleşmiyor"
        })
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        r = session.get(f"{API}/payments/order/{oid}")
        assert r.json()["reject_reason"] == "referans eşleşmiyor"


# --- Auto-cleanup config ---
class TestAutoCleanup:
    def test_get_default(self, session):
        r = session.get(f"{API}/maintenance/auto-cleanup")
        assert r.status_code == 200
        d = r.json()
        assert d.get("enabled") is True
        assert d.get("older_than_days") == 90
        assert d.get("day_of_month") == 1
        assert d.get("action") == "archive"

    def test_set_and_get(self, session):
        payload = {"enabled": True, "older_than_days": 60, "day_of_month": 5,
                   "hour_utc": 4, "action": "archive", "email_to": "admin@example.com"}
        r = session.post(f"{API}/maintenance/auto-cleanup", json=payload)
        assert r.status_code == 200
        r = session.get(f"{API}/maintenance/auto-cleanup")
        d = r.json()
        assert d["older_than_days"] == 60
        assert d["day_of_month"] == 5
        assert d["email_to"] == "admin@example.com"
        assert d["action"] == "archive"

    def test_run_now_archive(self, session):
        session.post(f"{API}/maintenance/auto-cleanup", json={
            "enabled": True, "older_than_days": 0, "day_of_month": 1,
            "hour_utc": 3, "action": "archive"
        })
        r = session.post(f"{API}/maintenance/auto-cleanup/run-now")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["action"] == "archive"
        assert "total" in d


# --- Geo heatmap ---
class TestGeoHeatmap:
    def test_heatmap_returns_items(self, session):
        r = session.get(f"{API}/maintenance/geo/blocked-heatmap")
        assert r.status_code == 200
        d = r.json()
        assert "items" in d
        assert "total" in d
        # Structure check when there are items
        for it in d["items"]:
            assert "country" in it and "name" in it and "count" in it
            assert "lat" in it and "lon" in it
