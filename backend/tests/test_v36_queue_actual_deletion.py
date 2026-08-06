"""v36 — Queue actual deletion bug fix tests.

User complaint: 'kuyruk yonetimi silmiyor halen — silme başarılı diyor ama silmiyor.'

Root cause: routes/queue.py _has_exim() branch called `exim -Mrm <mid>` on
synthetic mids that don't exist in the container's exim spool → non-zero rc
→ nothing deleted, but UI toasted success.

Fix: bulk_action now ALWAYS operates on mail_events (MongoDB), regardless of
whether real Exim binary exists. USE_REAL_EXIM=1 additionally invokes exim.
_mock_queue now uses mail_events.id (or exim_mid) as `mid` instead of the
synthetic '1t{id}-XXX' string.
"""
import os
import uuid
import time
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


def _ingest_spam(license_key: str = MASTER_KEY) -> str:
    """Ingest a fresh spam event and return its subject (for later lookup)."""
    subj = f"TEST_v36_{uuid.uuid4().hex[:10]}"
    payload = {
        "license_key": license_key,
        "from_addr": f"spammer-{uuid.uuid4().hex[:6]}@evil.example",
        "to_addr": "victim@example.com",
        "subject": subj,
        "verdict": "spam",
        "total_score": 12.5,
        "scores": {"size": 4096},
    }
    r = requests.post(f"{BASE_URL}/api/events/ingest", json=payload, timeout=10)
    assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text[:200]}"
    return subj


# ---------------- BUG FIX #3: source is 'mock' (not 'exim') by default -----
class TestV36DefaultSourceMock:
    def test_queue_list_default_source_mock(self, master):
        r = master.get(f"{BASE_URL}/api/queue?limit=5")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["source"] == "mock", f"expected source=mock, got {d.get('source')}. USE_REAL_EXIM should not be set in preview."

    def test_queue_stats_default_source_mock(self, master):
        r = master.get(f"{BASE_URL}/api/queue/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["source"] == "mock", f"expected source=mock, got {d.get('source')}"


# ---------------- BUG FIX #2: mid = mail_events.id (UUID) -----------------
class TestV36MidFormat:
    def test_mid_matches_mail_events_id(self, master):
        _ingest_spam()
        time.sleep(0.5)
        r = master.get(f"{BASE_URL}/api/queue?limit=10")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) > 0, "queue should have items after ingest"
        # First item's mid should NOT be the synthetic '1t{id}-XXX' pattern
        for it in items:
            mid = it["mid"]
            assert mid, "mid must not be empty"
            # legacy synthetic form was '1t{prefix}-XXX'
            assert not (mid.startswith("1t") and mid.endswith("-XXX")), \
                f"mid still uses synthetic pattern: {mid}"


# ---------------- BUG FIX #1 (CRITICAL): remove ACTUALLY deletes ----------
class TestV36QueueActualDeletion:
    def test_bulk_remove_actually_deletes_record(self, master):
        # (a) ingest a fresh spam event
        subj = _ingest_spam()
        time.sleep(0.5)
        # (b) fetch queue and find our record
        r = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1, f"our TEST_v36 event should be in queue (subject={subj})"
        target_mid = items[0]["mid"]
        # (c) POST bulk remove
        rb = master.post(f"{BASE_URL}/api/queue/bulk",
                         json={"action": "remove", "mids": [target_mid]})
        assert rb.status_code == 200, rb.text
        d = rb.json()
        # (d) verify db_deleted >= 1 and source contains 'db'
        assert d["source"] in ("db", "exim+db"), f"source should be db-based, got {d['source']}"
        assert d["success"] >= 1, f"success count should be >=1: {d}"
        assert d["failed"] == 0, f"no failures expected: {d}"
        assert d["results"][0]["db_deleted"] >= 1, f"db_deleted must be >=1: {d['results']}"
        assert d["results"][0]["ok"] is True
        # (e) re-fetch queue and confirm it is GONE
        r2 = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        assert r2.status_code == 200
        items2 = r2.json()["items"]
        mids_after = [i["mid"] for i in items2]
        assert target_mid not in mids_after, \
            f"mid {target_mid} still in queue after remove! Items: {mids_after[:5]}"

    def test_bulk_remove_via_xff_master_ip(self, anon):
        """Legacy WHM plugin path: X-Forwarded-For=MASTER_IP + license_key query."""
        subj = _ingest_spam()
        time.sleep(0.5)
        headers = {"X-Forwarded-For": "89.19.15.58", "Content-Type": "application/json"}
        r = requests.get(f"{BASE_URL}/api/queue?license_key={MASTER_KEY}&limit=200&search={subj}",
                         headers=headers)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        target_mid = items[0]["mid"]
        rb = requests.post(f"{BASE_URL}/api/queue/bulk",
                           json={"license_key": MASTER_KEY, "action": "remove", "mids": [target_mid]},
                           headers=headers)
        assert rb.status_code == 200
        d = rb.json()
        assert d["scope"]["is_master"] is True, f"XFF+key should grant master: {d['scope']}"
        assert d["success"] >= 1
        assert d["results"][0]["db_deleted"] >= 1

    def test_bulk_remove_unknown_mid_reports_failed(self, master):
        rb = master.post(f"{BASE_URL}/api/queue/bulk",
                         json={"action": "remove", "mids": ["nonexistent-mid-xyz-123"]})
        assert rb.status_code == 200
        d = rb.json()
        assert d["failed"] == 1
        assert d["success"] == 0
        assert d["results"][0]["ok"] is False
        assert d["results"][0]["db_deleted"] == 0


# ---------------- BUG FIX #4: deliver sets delivered=True ------------------
class TestV36DeliverMarksRecord:
    def test_deliver_with_forward_to_updates_mail_event(self, master):
        subj = _ingest_spam()
        time.sleep(0.5)
        r = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        items = r.json()["items"]
        assert len(items) >= 1
        target_mid = items[0]["mid"]
        fwd = "audit@example.com"
        rb = master.post(f"{BASE_URL}/api/queue/bulk",
                         json={"action": "deliver", "mids": [target_mid], "forward_to": fwd})
        assert rb.status_code == 200
        d = rb.json()
        assert d["success"] >= 1
        assert d["results"][0]["ok"] is True
        # Verify via GET /api/queue that delivered=True in that mail_event
        r2 = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        found = [i for i in r2.json()["items"] if i["mid"] == target_mid]
        assert len(found) == 1
        assert found[0]["delivered"] is True, "delivered flag should be set after deliver action"
        # cleanup
        master.post(f"{BASE_URL}/api/queue/bulk",
                    json={"action": "remove", "mids": [target_mid]})


# ---------------- REGRESSION: tenant scope + audit -------------------------
class TestV36Regression:
    def test_anon_query_master_key_not_master_scope(self, anon):
        """?license_key=MASTER_KEY with no header/cookie/IP → is_master must be False."""
        r = anon.get(f"{BASE_URL}/api/queue?license_key={MASTER_KEY}&limit=5")
        assert r.status_code == 200
        d = r.json()
        assert d["scope"]["is_master"] is False, \
            f"anon w/ query license_key must NOT grant master: {d['scope']}"

    def test_master_via_header_is_master(self, master):
        r = master.get(f"{BASE_URL}/api/queue?limit=5")
        assert r.status_code == 200
        d = r.json()
        assert d["scope"]["is_master"] is True

    def test_queue_audit_records_action(self, master):
        # perform some action to be sure audit gets a row
        subj = _ingest_spam()
        time.sleep(0.4)
        r = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        items = r.json()["items"]
        if not items:
            pytest.skip("no items to test audit against")
        mid = items[0]["mid"]
        master.post(f"{BASE_URL}/api/queue/bulk",
                    json={"action": "remove", "mids": [mid]})
        # fetch audit
        ra = master.get(f"{BASE_URL}/api/queue/audit?limit=20")
        assert ra.status_code == 200
        rows = ra.json()["items"]
        matching = [x for x in rows if x.get("mid") == mid and x.get("action") == "remove"]
        assert len(matching) >= 1, f"audit should have our remove entry for {mid}"
        entry = matching[0]
        for k in ("license_key", "actor_scope", "mid", "action", "ok", "output"):
            assert k in entry, f"audit entry missing field {k}: {entry}"
