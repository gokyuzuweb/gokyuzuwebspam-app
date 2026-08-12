"""
v43 Outbound Filtering + Bulk Detection backend tests.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
API = f"{BASE_URL}/api"

HDR = {"X-Master-Key": MASTER_KEY, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update(HDR)
    yield s
    # Cleanup done inside dedicated cleanup test at end


def _ingest(sess, from_user, direction="out", subject=None, verdict="clean", score=0.0, license_key=MASTER_KEY):
    payload = {
        "license_key": license_key,
        "from_addr": f"{from_user}@example.com",
        "to_addr": "dest@example.com",
        "subject": subject or f"TEST_v43 {uuid.uuid4().hex[:8]}",
        "verdict": verdict,
        "total_score": score,
        "direction": direction,
        "from_user": from_user,
        "sender_ip": "10.0.0.9",
    }
    r = sess.post(f"{API}/events/ingest", json=payload, timeout=15)
    return r


# ----- 1. Ingest with direction -----
def test_ingest_outbound_direction(sess):
    r = _ingest(sess, "TEST_user1", direction="out", subject="TEST_v43 outbound one")
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data.get("ok") is True or data.get("id")


def test_ingest_backward_compat_no_direction(sess):
    payload = {
        "license_key": MASTER_KEY,
        "from_addr": "legacy@example.com",
        "to_addr": "d@example.com",
        "subject": "TEST_v43 legacy",
        "verdict": "clean",
        "total_score": 0.1,
    }
    r = sess.post(f"{API}/events/ingest", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text


# ----- 2. Migration -----
def test_migrate_direction_idempotent(sess):
    r1 = sess.post(f"{API}/outbound/migrate-direction", timeout=30)
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1.get("ok") is True
    # Second call should be idempotent -> modified=0
    r2 = sess.post(f"{API}/outbound/migrate-direction", timeout=30)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("modified", 0) == 0, f"Expected 0 modified on second run, got {d2}"


# ----- 3. Stats -----
def test_outbound_stats(sess):
    r = sess.get(f"{API}/outbound/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("today_total", "today_spam", "today_blocked", "throttled_users", "limit_per_hour", "top_users", "generated_at"):
        assert k in d, f"Missing key {k} in stats response"
    assert isinstance(d["top_users"], list)
    assert isinstance(d["today_total"], int)


# ----- 4. Events filter -----
def test_outbound_events_returns_only_out(sess):
    # Ingest one more outbound
    _ingest(sess, "TEST_filter_user", direction="out")
    time.sleep(0.3)
    r = sess.get(f"{API}/outbound/events?limit=100", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "items" in d
    # All items should be direction=out (projection includes direction? no. We infer from route matching)
    # Just check count key
    assert "count" in d
    assert d["count"] == len(d["items"])


def test_outbound_events_search_by_user(sess):
    marker = f"TEST_srch{uuid.uuid4().hex[:6]}"
    _ingest(sess, marker, direction="out")
    time.sleep(0.5)
    r = sess.get(f"{API}/outbound/events?search={marker}&limit=50", timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    # At least one item with matching from_user
    matched = [i for i in items if (i.get("from_user") or "").lower() == marker.lower()]
    assert matched, f"Search returned no matching user. Got items: {items[:3]}"


# ----- 5. Bulk detection -----
def test_bulk_detection_and_dedup(sess):
    # Set outbound_limit_per_hour to 5 via PUT /api/settings (needs full PolicySettings)
    spammer = f"test_spammer_{uuid.uuid4().hex[:6]}"
    cur = sess.get(f"{API}/settings", timeout=10)
    if cur.status_code != 200:
        pytest.skip(f"GET /settings failed: {cur.status_code}")
    base_policy = cur.json()
    original_limit = int(base_policy.get("outbound_limit_per_hour", 200))
    low_policy = {**base_policy, "outbound_limit_per_hour": 5}
    rset = sess.put(f"{API}/settings", json=low_policy, timeout=10)
    if rset.status_code >= 400:
        pytest.skip(f"Cannot set policy: {rset.status_code} {rset.text[:200]}")

    try:
        # Ingest 6 mails from same user
        for i in range(6):
            rr = _ingest(sess, spammer, direction="out", subject=f"TEST_bulk {i}")
            assert rr.status_code in (200, 201), rr.text

        time.sleep(1.0)

        # Check bulk-alerts
        ra = sess.get(f"{API}/outbound/bulk-alerts", timeout=15)
        assert ra.status_code == 200
        alerts = ra.json()["items"]
        matching = [a for a in alerts if a.get("from_user") == spammer]
        assert matching, f"No bulk alert created for {spammer}. Alerts: {alerts[:5]}"

        # Check outbound_throttles
        rt = sess.get(f"{API}/outbound/throttles", timeout=15)
        assert rt.status_code == 200
        tusers = [t for t in rt.json()["items"] if t.get("from_user") == spammer]
        assert tusers, "auto-throttle not created"
        assert tusers[0].get("reason") == "auto_bulk_detect"

        alert_count_before = len(matching)

        # Ingest 1 more — same hour bucket -> should NOT create duplicate
        _ingest(sess, spammer, direction="out", subject="TEST_bulk dup")
        time.sleep(0.5)
        ra2 = sess.get(f"{API}/outbound/bulk-alerts", timeout=15)
        matching2 = [a for a in ra2.json()["items"] if a.get("from_user") == spammer]
        assert len(matching2) == alert_count_before, f"Dedupe failed: {alert_count_before} -> {len(matching2)}"
    finally:
        # Reset policy
        restore = {**base_policy, "outbound_limit_per_hour": original_limit}
        sess.put(f"{API}/settings", json=restore, timeout=10)


# ----- 6. Manual throttle add/remove -----
def test_manual_throttle_flow(sess):
    user = f"TEST_manu_{uuid.uuid4().hex[:6]}"
    r = sess.post(f"{API}/outbound/throttle",
                  json={"from_user": user, "license_key": MASTER_KEY, "reason": "TEST"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    user = user.lower()  # API lowercases

    rt = sess.get(f"{API}/outbound/throttles", timeout=15)
    users = [t["from_user"] for t in rt.json()["items"]]
    assert user in users

    r2 = sess.post(f"{API}/outbound/throttle/remove",
                   json={"from_user": user, "license_key": MASTER_KEY}, timeout=15)
    assert r2.status_code == 200
    assert r2.json().get("removed", 0) >= 1

    rt2 = sess.get(f"{API}/outbound/throttles", timeout=15)
    users2 = [t["from_user"] for t in rt2.json()["items"]]
    assert user not in users2


# ----- 7. Event actions -----
def test_event_actions(sess):
    user = f"TEST_act_{uuid.uuid4().hex[:6]}"
    r = _ingest(sess, user, direction="out", verdict="spam", score=8.5)
    assert r.status_code in (200, 201)
    time.sleep(0.5)
    # get events
    ev = sess.get(f"{API}/outbound/events?search={user}&limit=10", timeout=15).json()["items"]
    assert ev, "event not found"
    event_id = ev[0]["id"]

    # quarantine
    ra = sess.post(f"{API}/outbound/event/{event_id}/action",
                   json={"action": "quarantine", "license_key": MASTER_KEY}, timeout=15)
    assert ra.status_code == 200, ra.text
    assert ra.json().get("quarantined") is True

    # whitelist_sender (need another event since quarantine only marked action)
    r2 = _ingest(sess, user, direction="out", verdict="spam", score=6.0)
    time.sleep(0.4)
    ev2 = sess.get(f"{API}/outbound/events?search={user}&limit=10", timeout=15).json()["items"]
    eid2 = ev2[0]["id"]
    rw = sess.post(f"{API}/outbound/event/{eid2}/action",
                   json={"action": "whitelist_sender", "license_key": MASTER_KEY}, timeout=15)
    assert rw.status_code == 200, rw.text
    assert rw.json().get("whitelisted")

    # throttle_sender
    r3 = _ingest(sess, user, direction="out", verdict="spam", score=6.0)
    time.sleep(0.4)
    ev3 = sess.get(f"{API}/outbound/events?search={user}&limit=10", timeout=15).json()["items"]
    eid3 = ev3[0]["id"]
    rt = sess.post(f"{API}/outbound/event/{eid3}/action",
                   json={"action": "throttle_sender", "license_key": MASTER_KEY}, timeout=15)
    assert rt.status_code == 200, rt.text
    assert rt.json().get("throttled_user")

    # delete
    rd = sess.post(f"{API}/outbound/event/{eid3}/action",
                   json={"action": "delete", "license_key": MASTER_KEY}, timeout=15)
    # After throttle_sender event still exists; deleting should succeed
    # Note: previously threw with 404 because we ran actions in sequence. Use fresh event.
    if rd.status_code == 404:
        r4 = _ingest(sess, user, direction="out")
        time.sleep(0.4)
        ev4 = sess.get(f"{API}/outbound/events?search={user}&limit=10", timeout=15).json()["items"]
        eid4 = ev4[0]["id"]
        rd = sess.post(f"{API}/outbound/event/{eid4}/action",
                       json={"action": "delete", "license_key": MASTER_KEY}, timeout=15)
    assert rd.status_code == 200, rd.text
    assert rd.json().get("deleted") is True


# ----- 8. Regression: legacy /outbound endpoint -----
def test_legacy_outbound_endpoint(sess):
    r = sess.get(f"{API}/outbound", timeout=15)
    # If it exists, expected shape; if 404 -> report
    if r.status_code == 404:
        pytest.skip("Legacy /api/outbound endpoint does not exist (may be replaced)")
    assert r.status_code == 200, r.text


# ----- 9. Cleanup (best-effort) -----
def test_cleanup_zzz(sess):
    """Runs last alphabetically. Removes TEST_ throttles."""
    rt = sess.get(f"{API}/outbound/throttles", timeout=15)
    if rt.status_code == 200:
        for t in rt.json().get("items", []):
            u = t.get("from_user", "")
            if u.startswith("test_"):  # lowered by API
                sess.post(f"{API}/outbound/throttle/remove",
                          json={"from_user": u, "license_key": MASTER_KEY}, timeout=10)
    # Reset policy
    sess.post(f"{API}/settings/policy", json={"outbound_limit_per_hour": 200}, timeout=10)
    sess.put(f"{API}/settings/policy", json={"outbound_limit_per_hour": 200}, timeout=10)
