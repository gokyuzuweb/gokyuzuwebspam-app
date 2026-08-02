"""
v19 backlog tests:
 1) Cookie-based master session (POST /api/admin/master-unlock)
    - cookie bypasses demo_write_guard for PUT/DELETE /api/licenses/{id}
 2) Log source selector (GET/POST /api/plugin/log-source)
 3) Turkish mojibake auto-fix on POST /api/events/ingest
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -------- 1) Master unlock cookie flow --------
class TestMasterUnlockCookie:
    def test_unlock_sets_cookie(self, sess):
        r = sess.post(f"{BASE_URL}/api/admin/master-unlock",
                      json={"license_key": MASTER_KEY})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "token" in data and len(data["token"]) > 10
        assert "valid_until" in data
        # cookie stored in session
        assert "gws_master_session" in sess.cookies.get_dict()
        # valid_until is future
        vu = datetime.fromisoformat(data["valid_until"])
        assert vu > datetime.now(timezone.utc) + timedelta(days=29)

    def test_whoami_via_cookie(self, sess):
        # Use a fresh client with only the cookie (no key param) to check bypass
        r = sess.get(f"{BASE_URL}/api/admin/whoami")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("is_master") is True
        assert j.get("via_cookie") is True

    def test_put_license_via_cookie_only(self, sess):
        # Create license via master key header (POST /api/licenses NOT in allow-list,
        # so must have master auth — cookie should also suffice).
        payload = {
            "customer_name": "TEST_cookie_lic",
            "customer_email": "test@example.com",
            "plan": "pro",
            "ip_addresses": ["1.2.3.4"],
            "max_domains": 10,
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            "active": True,
            "notes": "cookie test",
        }
        # NO X-Master-Key header — only the cookie in sess.
        r = sess.post(f"{BASE_URL}/api/licenses", json=payload)
        assert r.status_code == 200, f"POST failed via cookie: {r.status_code} {r.text}"
        lic = r.json()
        lid = lic["id"]

        # PUT without X-Master-Key
        payload["notes"] = "cookie updated"
        r2 = sess.put(f"{BASE_URL}/api/licenses/{lid}", json=payload)
        assert r2.status_code == 200, f"PUT failed via cookie: {r2.status_code} {r2.text}"
        assert r2.json().get("updated") is True

        # Verify persisted
        r3 = sess.get(f"{BASE_URL}/api/licenses")
        assert r3.status_code == 200
        found = [x for x in r3.json() if x.get("id") == lid]
        assert len(found) == 1
        assert found[0]["notes"] == "cookie updated"

        # DELETE via cookie
        r4 = sess.delete(f"{BASE_URL}/api/licenses/{lid}")
        assert r4.status_code == 200, f"DELETE failed via cookie: {r4.status_code} {r4.text}"
        assert r4.json().get("deleted") is True

    def test_write_blocked_without_cookie(self):
        # Bare session — no cookie, no key — write must be blocked
        bare = requests.Session()
        payload = {
            "customer_name": "TEST_should_fail",
            "customer_email": "x@x.com",
            "plan": "pro",
            "ip_addresses": [],
            "max_domains": 1,
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "active": True,
            "notes": "",
        }
        r = bare.post(f"{BASE_URL}/api/licenses", json=payload)
        # demo_write_guard should block (403) OR route requires master (403/401)
        assert r.status_code in (401, 403, 423), f"Expected block, got {r.status_code}: {r.text}"


# -------- 2) Log source selector --------
class TestLogSource:
    def test_get_default(self):
        r = requests.get(f"{BASE_URL}/api/plugin/log-source")
        assert r.status_code == 200
        j = r.json()
        assert j.get("mode") in ("auto", "exim", "mailscanner")
        assert isinstance(j.get("description"), dict)
        for k in ("exim", "mailscanner", "auto"):
            assert k in j["description"]

    def test_post_requires_master(self):
        r = requests.post(f"{BASE_URL}/api/plugin/log-source",
                          json={"mode": "exim"})
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_post_invalid_mode(self):
        r = requests.post(
            f"{BASE_URL}/api/plugin/log-source",
            json={"mode": "foo", "license_key": MASTER_KEY},
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 422, f"Expected 422 for invalid mode, got {r.status_code}: {r.text}"

    def test_post_sets_mode_exim(self):
        r = requests.post(
            f"{BASE_URL}/api/plugin/log-source",
            json={"mode": "exim", "license_key": MASTER_KEY},
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("mode") == "exim"

        # verify persisted via GET
        r2 = requests.get(f"{BASE_URL}/api/plugin/log-source")
        assert r2.status_code == 200
        assert r2.json().get("mode") == "exim"

        # cleanup — reset to auto
        r3 = requests.post(
            f"{BASE_URL}/api/plugin/log-source",
            json={"mode": "auto", "license_key": MASTER_KEY},
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r3.status_code == 200
        assert r3.json().get("mode") == "auto"


# -------- 3) Mojibake fix on events ingest --------
class TestMojibakeFix:
    def test_ingest_double_decoded(self):
        # Subject with double-encoded UTF-8 ("için" -> "iÃ§in")
        mid = f"TEST-{uuid.uuid4().hex[:8]}"
        payload = {
            "license_key": MASTER_KEY,
            "exim_mid": mid,
            "from_addr": "sender@example.com",
            "to_addr": "dest@example.com",
            "subject": "HAZAL AMBALAJ iÃ§in fiyat teklifi",
            "verdict": "clean",
            "total_score": 0.0,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        r = requests.post(f"{BASE_URL}/api/events/ingest", json=payload)
        assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text}"

        # Now list events and find ours
        r2 = requests.get(f"{BASE_URL}/api/events",
                          params={"license_key": MASTER_KEY, "limit": 50})
        assert r2.status_code == 200, r2.text
        body = r2.json()
        # events could be a list or {items:[]}
        items = body if isinstance(body, list) else body.get("items", [])
        assert len(items) > 0
        # find our event by exim_mid
        ours = [x for x in items if x.get("exim_mid") == mid]
        assert len(ours) == 1, f"could not find ingested event {mid}"
        evt = ours[0]
        assert evt.get("subject") == "HAZAL AMBALAJ için fiyat teklifi", \
            f"subject not corrected: {evt.get('subject')!r}"
        assert evt.get("subject_double_decoded") is True

    def test_events_sort_desc(self):
        r = requests.get(f"{BASE_URL}/api/events",
                         params={"license_key": MASTER_KEY, "limit": 20})
        assert r.status_code == 200
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        if len(items) < 2:
            pytest.skip("not enough events to check sort order")
        ts_list = [x.get("ts") or x.get("ingested_at") for x in items if (x.get("ts") or x.get("ingested_at"))]
        # Ensure sorted descending
        for a, b in zip(ts_list, ts_list[1:]):
            assert a >= b, f"events not sorted desc: {a} < {b}"
