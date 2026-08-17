"""v43.76 backend tests:
1) Pending Approvals Dashboard Widget + auto master_alert on havale/create
2) Slack IP change flood grouping (5-min window, 3+ grouped)
3) Marketplace signature list adds publisher_tier and removes publisher_license
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
MASTER_IP = "89.19.15.58"
BAYI_KEY = "MS-TESTBAYI-STARTER-V4371"


def h_master(with_ip=True):
    h = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}
    if with_ip:
        h["X-Forwarded-For"] = MASTER_IP
    return h


# ---------- Feature 1: Havale create → master_alert + Pending Approvals widget ----------

class TestPendingApprovals:
    def test_havale_create_inserts_master_alert(self):
        payload = {
            "email": "test_v4376@example.com",
            "user_name": "TEST v4376 User",
            "amount": 249.90,
            "plan": "starter",
            "note": "v43.76 auto-test",
        }
        r = requests.post(f"{BASE_URL}/api/payments/havale/create", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("status") == "awaiting_transfer"
        merchant_oid = body["merchant_oid"]
        assert merchant_oid and merchant_oid.startswith("TRF")

        # Give a moment for DB write
        time.sleep(0.5)

        # Fetch master alerts – newest first
        r2 = requests.get(f"{BASE_URL}/api/admin/threat-alerts?limit=200", headers=h_master(), timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        alerts = data if isinstance(data, list) else data.get("alerts") or data.get("items") or []
        assert alerts, f"No alerts returned: {data}"

        # Find matching pending_approval alert with this merchant_oid
        match = None
        for a in alerts:
            if a.get("type") == "pending_approval" and \
               (a.get("details") or {}).get("merchant_oid") == merchant_oid:
                match = a
                break
        assert match, f"No pending_approval alert with merchant_oid={merchant_oid}"
        assert match.get("sub_type") == "havale_new"
        assert match.get("severity") == "info"
        assert "Yeni sipariş onay bekliyor" in (match.get("message") or "")
        # Store for next test
        pytest.MERCHANT_OID_V4376 = merchant_oid

    def test_pending_approvals_summary(self):
        r = requests.get(f"{BASE_URL}/api/payments/pending-approvals",
                         headers=h_master(), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_pending", "by_provider", "last_24h", "latest", "generated_at"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["by_provider"], dict)
        assert "havale" in d["by_provider"] and "paytr" in d["by_provider"]
        assert isinstance(d["latest"], list)
        assert d["total_pending"] >= 1
        # sanity: latest items should not include _id
        for it in d["latest"]:
            assert "_id" not in it

    def test_pending_approvals_forbidden_without_ip(self):
        h = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}
        r = requests.get(f"{BASE_URL}/api/payments/pending-approvals",
                         headers=h, timeout=15)
        # Guard: master IP env is set → non-master IP → 403
        assert r.status_code == 403, r.text

    def test_pending_approvals_forbidden_without_key(self):
        h = {"X-Forwarded-For": MASTER_IP, "Content-Type": "application/json"}
        r = requests.get(f"{BASE_URL}/api/payments/pending-approvals",
                         headers=h, timeout=15)
        assert r.status_code == 403, r.text


# ---------- Feature 2: IP change flood grouping ----------

class TestIpChangeFlood:
    def test_ip_change_flood_grouping(self):
        # Use a fresh unique license so we control the count from 0
        lk = f"MS-TEST-FLOOD-{uuid.uuid4().hex[:8].upper()}"
        events = [
            ("1.1.1.1", "2.2.2.2"),
            ("2.2.2.2", "3.3.3.3"),
            ("3.3.3.3", "4.4.4.4"),
            ("4.4.4.4", "5.5.5.5"),
        ]
        # 4 sequential POSTs
        for prev, cur in events:
            body = {
                "event": "unlock",
                "idle_seconds": 900,
                "ip_changed": True,
                "previous_ip": prev,
                "current_ip": cur,
                "license_key": lk,
            }
            r = requests.post(f"{BASE_URL}/api/audit/idle-lock-event",
                              json=body, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True

        # Wait for DB
        time.sleep(0.5)

        # Fetch master_alerts filtered by this license via master alerts endpoint
        r2 = requests.get(f"{BASE_URL}/api/admin/threat-alerts?limit=200",
                          headers=h_master(), timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        alerts = data if isinstance(data, list) else data.get("alerts") or data.get("items") or []
        # Filter matching ones for our license
        mine = [a for a in alerts
                if a.get("type") == "idle_lock_ip_change" and a.get("license_key") == lk]
        assert len(mine) == 4, f"expected 4 alerts, got {len(mine)}: {mine}"
        # Sort by created_at ASC to inspect grouped_from_5min progression
        mine.sort(key=lambda a: a.get("created_at") or "")
        grouped_vals = [(a.get("details") or {}).get("grouped_from_5min") for a in mine]
        # Expected: 0, 1, 2, 3 (count BEFORE insert)
        assert grouped_vals == [0, 1, 2, 3], f"grouped_from_5min progression wrong: {grouped_vals}"


# ---------- Feature 3: Marketplace signature list — publisher_tier ----------

class TestMarketplaceTier:
    def test_signatures_list_publisher_tier(self):
        # Search seed signatures — the ones created for MS-TESTBAYI-STARTER-V4371
        r = requests.get(f"{BASE_URL}/api/marketplace/signatures",
                         params={"q": "seed_sig", "limit": 10}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("items", [])
        assert items, "no seed_sig items returned"
        # None should leak publisher_license
        for it in items:
            assert "publisher_license" not in it, f"publisher_license leaked: {it}"
        # At least one item should have publisher_tier=Trusted (bayi has 6+ sigs)
        trusted = [it for it in items if it.get("publisher_tier")]
        assert trusted, f"no publisher_tier attached: {items}"
        for it in trusted:
            t = it["publisher_tier"]
            assert t.get("label") in ("Trusted Publisher", "Expert Publisher", "Elite Publisher")
            assert t.get("badge_color") in ("emerald", "violet", "amber")
            assert isinstance(t.get("signatures"), int) and t["signatures"] >= 5

    def test_signatures_list_default_no_publisher_license(self):
        r = requests.get(f"{BASE_URL}/api/marketplace/signatures",
                         params={"limit": 10}, timeout=15)
        assert r.status_code == 200, r.text
        for it in r.json().get("items", []):
            assert "publisher_license" not in it
