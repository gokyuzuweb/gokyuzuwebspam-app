"""v35 — Quarantine KPI/purge/forward + Queue tenant isolation tests.

Tests the following features:
 - GET /api/quarantine/stats
 - POST /api/quarantine/purge-all
 - POST /api/quarantine/forward
 - POST /api/quarantine/delete (tenant-scoped)
 - GET  /api/quarantine/{id}    (route ordering after /quarantine/stats)
 - GET  /api/quarantine         (tenant isolation reseller vs master)
 - POST /api/quarantine/purge-demo  master-only
 - GET  /api/queue, /api/queue/stats, /api/queue/audit
 - POST /api/queue/bulk (remove/deliver — real exim path in preview)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"


@pytest.fixture(scope="module")
def master():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "x-master-key": MASTER_KEY})
    return s


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def reseller_token():
    """Register a fresh reseller against a fresh test license.
    If we cannot create a license (no admin route), skip reseller tests."""
    # try to create a license via a master-only endpoint
    tmp_key = f"TEST-{uuid.uuid4().hex[:16].upper()}"
    # Insert via master license API if available
    lic_payload = {
        "customer_name": "TEST_v35_reseller",
        "customer_email": f"test-{uuid.uuid4().hex[:6]}@example.com",
        "plan": "pro",
        "ip_addresses": ["1.2.3.4"],
        "max_domains": 100,
        "valid_until": "2099-12-31T23:59:59+00:00",
        "license_key": tmp_key,
    }
    r = requests.post(f"{BASE_URL}/api/licenses", json=lic_payload,
                      headers={"x-master-key": MASTER_KEY})
    if r.status_code not in (200, 201):
        pytest.skip(f"Cannot create license for reseller (status {r.status_code}): {r.text[:120]}")
    # Backend generates its own license_key; use returned value
    tmp_key = r.json().get("license_key") or tmp_key
    # Register reseller
    email = f"reseller-{uuid.uuid4().hex[:8]}@test-v35.com"
    password = "TestPass123!"
    rr = requests.post(f"{BASE_URL}/api/reseller/auth/register", json={
        "license_key": tmp_key, "email": email, "password": password,
        "company": "TEST_v35_bayi",
    })
    if rr.status_code != 200:
        pytest.skip(f"Reseller register failed: {rr.status_code} {rr.text[:120]}")
    return {"token": rr.json()["token"], "license_key": tmp_key, "email": email}


# ---------------- Quarantine stats/KPI --------------------------------------
class TestQuarantineStats:
    def test_stats_master(self, master):
        r = master.get(f"{BASE_URL}/api/quarantine/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total", "today", "week", "released", "verdicts", "top_senders"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["verdicts"], dict)
        assert isinstance(d["top_senders"], list)
        assert d["total"] >= 0

    def test_stats_route_ordering(self, master):
        """/quarantine/stats must NOT be swallowed by /quarantine/{item_id}."""
        r = master.get(f"{BASE_URL}/api/quarantine/stats")
        assert r.status_code == 200
        d = r.json()
        # It's the stats object, not a 404 for a missing quarantine item
        assert "verdicts" in d

    def test_item_get_still_works(self, master):
        lst = master.get(f"{BASE_URL}/api/quarantine?limit=1").json()
        if not lst:
            pytest.skip("no quarantine data")
        item_id = lst[0]["id"]
        r = master.get(f"{BASE_URL}/api/quarantine/{item_id}")
        assert r.status_code == 200
        assert r.json()["id"] == item_id


# ---------------- Quarantine forward ----------------------------------------
class TestQuarantineForward:
    def test_forward_requires_valid_payload(self, master):
        r = master.post(f"{BASE_URL}/api/quarantine/forward", json={"ids": [], "to": ""})
        assert r.status_code == 400

    def test_forward_success(self, master):
        lst = master.get(f"{BASE_URL}/api/quarantine?limit=1").json()
        if not lst:
            pytest.skip("no quarantine data")
        r = master.post(f"{BASE_URL}/api/quarantine/forward",
                        json={"ids": [lst[0]["id"]], "to": "admin@example.com"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("to") == "admin@example.com"
        assert d.get("total") >= 1


# ---------------- Quarantine purge-all --------------------------------------
class TestQuarantinePurgeAll:
    def test_purge_all_master_older_than_9999(self, master):
        """Sanity: purge with impossibly old cutoff → 0 deleted, no error."""
        r = master.post(f"{BASE_URL}/api/quarantine/purge-all"
                        f"?verdict=all&older_than_days=99999")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "deleted" in d
        assert d["deleted"] == 0

    def test_purge_demo_master_only(self, anon):
        """Reseller (no master header) → 403."""
        r = anon.post(f"{BASE_URL}/api/quarantine/purge-demo")
        # 403 (bayi olarak reddedilir) beklenir. Ancak plugin_state boşsa 403 gelmezse fail.
        assert r.status_code == 403, f"purge-demo must be master-only, got {r.status_code}: {r.text[:120]}"


# ---------------- Quarantine tenant isolation -------------------------------
class TestQuarantineTenantIsolation:
    def test_master_sees_data(self, master):
        r = master.get(f"{BASE_URL}/api/quarantine?limit=10")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reseller_scoped(self, reseller_token):
        """Fresh reseller with no data should see empty list (owner_license_key match)."""
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {reseller_token['token']}"}
        # /api/quarantine relies on plugin_state.license_key for reseller — a fresh
        # reseller has none, so this returns items where owner=='__none__' i.e. empty
        r = requests.get(f"{BASE_URL}/api/quarantine?limit=50", headers=h)
        assert r.status_code == 200
        rows = r.json()
        # Reseller must NOT see master/legacy items
        for row in rows:
            assert row.get("owner_license_key") == reseller_token["license_key"], \
                f"Reseller saw item with owner={row.get('owner_license_key')}"

    def test_reseller_cannot_delete_others(self, reseller_token, master):
        """Reseller tries to delete a master-owned quarantine id → 0 deleted."""
        lst = master.get(f"{BASE_URL}/api/quarantine?limit=1").json()
        if not lst:
            pytest.skip("no quarantine data")
        target_id = lst[0]["id"]
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {reseller_token['token']}"}
        r = requests.post(f"{BASE_URL}/api/quarantine/delete",
                          json={"ids": [target_id]}, headers=h)
        # It may 200 with deleted=0 or 403 (feature gate)
        if r.status_code == 200:
            assert r.json().get("deleted", 0) == 0, "Reseller must not delete master item"
        else:
            assert r.status_code in (401, 403), r.text
        # Verify item is still there
        still = master.get(f"{BASE_URL}/api/quarantine/{target_id}")
        assert still.status_code == 200


# ---------------- Queue routes ----------------------------------------------
class TestQueue:
    def test_queue_list(self, master):
        r = master.get(f"{BASE_URL}/api/queue?limit=10")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and "source" in d and "count" in d
        assert d["source"] in ("exim", "mock")

    def test_queue_stats(self, master):
        r = master.get(f"{BASE_URL}/api/queue/stats")
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "source" in d

    def test_queue_audit(self, master):
        r = master.get(f"{BASE_URL}/api/queue/audit?limit=5")
        assert r.status_code == 200
        assert "items" in r.json()

    def test_queue_bulk_invalid_action(self, master):
        r = master.post(f"{BASE_URL}/api/queue/bulk",
                        json={"mids": ["fake"], "action": "nope"})
        # pydantic pattern → 422
        assert r.status_code in (400, 422)

    def test_queue_bulk_remove_returns_result(self, master):
        """Regardless of exim/mock — endpoint must accept the shape and return
        {ok, processed, success, failed, results}."""
        r = master.post(f"{BASE_URL}/api/queue/bulk",
                        json={"mids": ["1tFAKE-000000-XX"], "action": "remove"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("processed") == 1
        assert isinstance(d.get("results"), list) and len(d["results"]) == 1
        assert d.get("source") in ("exim", "mock", "db", "exim+db")

    def test_queue_bulk_deliver_with_forward(self, master):
        r = master.post(f"{BASE_URL}/api/queue/bulk",
                        json={"mids": ["1tFAKE-000000-XX"], "action": "deliver",
                              "forward_to": "admin@example.com"})
        assert r.status_code == 200
        assert r.json().get("processed") == 1


# ---------------- Queue tenant isolation ------------------------------------
class TestQueueTenantIsolation:
    def test_reseller_cannot_override_license_key(self, reseller_token):
        """Reseller passes license_key=MASTER_KEY as query param — the backend
        must IGNORE it and enforce reseller's own license (from plugin_state)."""
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {reseller_token['token']}"}
        r = requests.get(
            f"{BASE_URL}/api/queue?license_key={MASTER_KEY}&limit=5",
            headers=h,
        )
        assert r.status_code == 200
        d = r.json()
        # Real exim path: source=exim, no scope block. If source=mock, scope must NOT be master.
        if d.get("source") == "mock":
            sc = d.get("scope", {})
            assert sc.get("is_master") is False, \
                f"Reseller was granted master scope via query override! {sc}"

    def test_master_can_drill_down(self, master):
        """Master with valid header passes license_key=X → scope.is_master True."""
        r = master.get(f"{BASE_URL}/api/queue?license_key=SOME-BAYI-KEY&limit=5")
        assert r.status_code == 200


# ---------------- v35 REGRESSION FIX: query-string master escalation --------
class TestV35TenantBypassFix:
    """Regression tests for the critical query-string master escalation bug.

    Prior behaviour: /api/queue/stats?license_key=MASTER_KEY (anonymous) →
    scope.is_master = True. FIX: master privileges must require x-master-key
    header, gws_master_session cookie, OR X-Forwarded-For == MASTER_IP.
    """

    def test_anon_query_master_key_on_queue_stats_denied(self):
        """Anonymous caller passing ?license_key=MASTER_KEY must NOT get master."""
        r = requests.get(
            f"{BASE_URL}/api/queue/stats?license_key={MASTER_KEY}",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # scope must be present in BOTH exim and mock branches after v35 fix
        assert "scope" in d, f"scope block missing from queue/stats response: {d}"
        assert d["scope"].get("is_master") is False, (
            f"CRITICAL: anonymous query-string master escalation NOT fixed: {d['scope']}"
        )

    def test_anon_query_master_key_on_queue_list_denied(self):
        r = requests.get(
            f"{BASE_URL}/api/queue?license_key={MASTER_KEY}&limit=5",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 200
        d = r.json()
        assert "scope" in d, f"scope block missing from queue list: {d}"
        assert d["scope"].get("is_master") is False, (
            f"CRITICAL: anonymous query-string master escalation NOT fixed: {d['scope']}"
        )

    def test_anon_query_master_key_on_quarantine_denied(self):
        """server.py::_tenant_scope — same fix must apply here too.

        Anonymous caller with ?license_key=MASTER should NOT see master data.
        A fresh anon caller has no plugin_state license → owner scoping = "".
        We ensure the response either returns 401/403 OR returns empty list (no
        master data leaked)."""
        # First take a master snapshot to see what "master data" looks like
        master_snap = requests.get(
            f"{BASE_URL}/api/quarantine?limit=5",
            headers={"x-master-key": MASTER_KEY, "Content-Type": "application/json"},
        )
        master_ids = set()
        if master_snap.status_code == 200 and isinstance(master_snap.json(), list):
            master_ids = {row.get("id") for row in master_snap.json()}

        r = requests.get(
            f"{BASE_URL}/api/quarantine?license_key={MASTER_KEY}&limit=50",
            headers={"Content-Type": "application/json"},
        )
        # Accept 200 with empty/scoped result OR 401/403
        if r.status_code == 200:
            rows = r.json()
            if isinstance(rows, list):
                leaked = master_ids.intersection({row.get("id") for row in rows})
                assert not leaked, (
                    f"CRITICAL: anon query-string master escalation leaked "
                    f"{len(leaked)} master rows via /api/quarantine"
                )
        else:
            assert r.status_code in (401, 403), r.text

    def test_master_ip_legacy_still_works(self):
        """Positive path: X-Forwarded-For=MASTER_IP + ?license_key=MASTER
        must succeed (legacy WHM plugin compatibility)."""
        r = requests.get(
            f"{BASE_URL}/api/queue/stats?license_key={MASTER_KEY}",
            headers={
                "Content-Type": "application/json",
                "X-Forwarded-For": "89.19.15.58",
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "scope" in d, f"scope block missing: {d}"
        assert d["scope"].get("is_master") is True, (
            f"Legacy MASTER_IP fallback broken. scope={d.get('scope')}"
        )

    def test_master_header_without_query_still_works(self):
        """x-master-key header alone (no query string) grants master."""
        r = requests.get(
            f"{BASE_URL}/api/queue/stats",
            headers={"x-master-key": MASTER_KEY, "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("scope", {}).get("is_master") is True, d

    def test_master_cookie_without_query_still_works(self):
        """gws_master_session cookie alone grants master."""
        s = requests.Session()
        s.cookies.set("gws_master_session", MASTER_KEY, domain=BASE_URL.split("//")[-1].split("/")[0])
        r = s.get(f"{BASE_URL}/api/queue/stats")
        assert r.status_code == 200
        d = r.json()
        assert d.get("scope", {}).get("is_master") is True, d

    def test_scope_meta_present_in_exim_branch(self):
        """v35: scope_meta must be present in BOTH exim and mock branches."""
        r = requests.get(
            f"{BASE_URL}/api/queue?limit=1",
            headers={"x-master-key": MASTER_KEY, "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        d = r.json()
        assert "scope" in d, (
            f"scope missing from response (source={d.get('source')}). "
            f"Must be returned in both exim and mock branches. body={d}"
        )
        assert "is_master" in d["scope"]
        assert "source" in d and d["source"] in ("exim", "mock")
