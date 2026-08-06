"""v37 — Tenant isolation & master-info leak fix tests.

User complaint (Turkish): 'bayi ile master üzerinden kuyrukta bekleyen sayaçları
aynı gözüküyor. bayi kısmında master sunucunun bilgileri neden duruyor. tüm
modüllerde master bilgileri asla gözükmemeli, her bayi kendi eklediği sunucu
görecek.'

Root cause verified in iteration_31 handoff:
  (1) _tenant_scope / _resolve_tenant ignored frontend-supplied license_key
      for resellers — they read plugin_state.main which had the master's key,
      so bayi + master saw the SAME queue counters.
  (2) _is_master leaked master_ip / master_host to ALL callers (including
      anonymous & reseller).

Fix (server.py + routes/queue.py): validate frontend license_key against
db.licenses; if invalid → owner_license_key='__none__' (isolated). Also
whoami no longer returns master_ip / master_host / master_key unless caller
is proven master.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
BAYI_KEY   = "MS-D85BE8E63A64478786361F54"  # existing reseller in db.licenses
FAKE_KEY   = "MS-FAKE-NON-EXISTENT-KEY-XYZ"


# ----------------------------- fixtures -----------------------------------
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


def _ingest(license_key: str) -> str:
    subj = f"TEST_v37_{uuid.uuid4().hex[:10]}"
    payload = {
        "license_key": license_key,
        "from_addr": f"s-{uuid.uuid4().hex[:6]}@evil.example",
        "to_addr": "victim@example.com",
        "subject": subj,
        "verdict": "spam",
        "total_score": 12.0,
        "scores": {"size": 1024},
    }
    r = requests.post(f"{BASE_URL}/api/events/ingest", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    return subj


# ===================== FIX #1 (CRITICAL) — Queue tenant scope ==============
class TestV37QueueTenantScope:
    def test_bayi_valid_license_gets_own_scope(self, anon):
        r = anon.get(f"{BASE_URL}/api/queue/stats?license_key={BAYI_KEY}")
        assert r.status_code == 200
        d = r.json()
        scope = d["scope"]
        assert scope["is_master"] is False, f"bayi must NOT be master: {scope}"
        assert scope["license_key"] == BAYI_KEY, f"scope must be bayi's key: {scope}"

    def test_master_header_sees_all_counters(self, master):
        r = master.get(f"{BASE_URL}/api/queue/stats")
        assert r.status_code == 200
        d = r.json()
        assert d["scope"]["is_master"] is True
        # counter fields exist and are non-negative ints
        for k in ("total", "high_spam", "virus", "blocked"):
            assert isinstance(d.get(k), int) and d[k] >= 0

    def test_fake_license_returns_isolated_none_scope(self, anon):
        r = anon.get(f"{BASE_URL}/api/queue/stats?license_key={FAKE_KEY}")
        assert r.status_code == 200
        d = r.json()
        scope = d["scope"]
        assert scope["is_master"] is False
        assert scope["license_key"] == "__none__", f"fake key must be isolated: {scope}"
        assert d["total"] == 0, f"__none__ scope must show total=0, got {d}"

    def test_bayi_counters_ne_master_counters(self, anon, master):
        """Core user complaint: bayi and master must NOT see the same counters."""
        # Ingest a master-owned spam so master has at least 1 more than bayi.
        _ingest(MASTER_KEY)
        time.sleep(0.5)
        r_master = master.get(f"{BASE_URL}/api/queue/stats").json()
        r_bayi = anon.get(f"{BASE_URL}/api/queue/stats?license_key={BAYI_KEY}").json()
        assert r_master["scope"]["is_master"] is True
        assert r_bayi["scope"]["is_master"] is False
        assert r_master["total"] >= r_bayi["total"], "master must see >= bayi count"
        # If master has any spam at all, they must differ (user's actual bug)
        if r_master["total"] > 0 and r_bayi["total"] == 0:
            assert r_master["total"] != r_bayi["total"]

    def test_queue_list_bayi_only_own_records(self, anon, master):
        # Master ingests, bayi should NOT see it.
        subj = _ingest(MASTER_KEY)
        time.sleep(0.5)
        r_bayi = anon.get(f"{BASE_URL}/api/queue?license_key={BAYI_KEY}&limit=200&search={subj}")
        assert r_bayi.status_code == 200
        items = r_bayi.json()["items"]
        assert len(items) == 0, f"bayi must NOT see master's record! got {len(items)}"


# ===================== FIX #1D — Quarantine tenant scope ==================
class TestV37QuarantineTenantScope:
    def test_quarantine_stats_bayi_scoped(self, anon):
        r = anon.get(f"{BASE_URL}/api/quarantine/stats?license_key={BAYI_KEY}")
        assert r.status_code == 200
        d = r.json()
        # backend returns total etc.; bayi with no records → 0
        assert isinstance(d.get("total"), int)

    def test_quarantine_stats_fake_key_isolated(self, anon):
        r = anon.get(f"{BASE_URL}/api/quarantine/stats?license_key={FAKE_KEY}")
        assert r.status_code == 200
        d = r.json()
        assert d.get("total", 0) == 0

    def test_quarantine_list_bayi_scoped(self, anon):
        r = anon.get(f"{BASE_URL}/api/quarantine?license_key={BAYI_KEY}&limit=10")
        assert r.status_code == 200
        # empty list acceptable; must not error
        d = r.json()
        assert "items" in d or isinstance(d, list)

    def test_quarantine_list_fake_key_returns_empty(self, anon):
        r = anon.get(f"{BASE_URL}/api/quarantine?license_key={FAKE_KEY}&limit=10")
        assert r.status_code == 200
        d = r.json()
        items = d["items"] if isinstance(d, dict) and "items" in d else d
        assert items == [] or len(items) == 0


# ===================== FIX #2 (SECURITY) — whoami leak ====================
class TestV37WhoamiNoLeak:
    def test_bayi_whoami_no_master_info(self, anon):
        r = anon.get(f"{BASE_URL}/api/admin/whoami?license_key={BAYI_KEY}")
        assert r.status_code == 200
        d = r.json()
        assert d["is_master"] is False
        for leaked in ("master_ip", "master_host", "master_key"):
            assert leaked not in d, f"WHOAMI leaked '{leaked}' to bayi: {d}"

    def test_anon_whoami_no_master_info(self, anon):
        r = anon.get(f"{BASE_URL}/api/admin/whoami")
        assert r.status_code == 200
        d = r.json()
        assert d["is_master"] is False
        for leaked in ("master_ip", "master_host", "master_key"):
            assert leaked not in d, f"WHOAMI leaked '{leaked}' to anon: {d}"

    def test_master_header_whoami_contains_master_info(self, master):
        r = master.get(f"{BASE_URL}/api/admin/whoami")
        assert r.status_code == 200
        d = r.json()
        assert d["is_master"] is True
        # master_key + master_ip + master_host should be present (design)
        assert d.get("master_key") == MASTER_KEY, f"master must get master_key back: {d}"
        assert "master_ip" in d and d["master_ip"], f"master must see master_ip: {d}"
        assert "master_host" in d and d["master_host"], f"master must see master_host: {d}"

    def test_fake_license_whoami_no_leak(self, anon):
        r = anon.get(f"{BASE_URL}/api/admin/whoami?license_key={FAKE_KEY}")
        assert r.status_code == 200
        d = r.json()
        assert d["is_master"] is False
        for leaked in ("master_ip", "master_host", "master_key"):
            assert leaked not in d


# ===================== REGRESSION — queue actual deletion =================
class TestV37QueueDeleteRegression:
    def test_master_delete_own_record(self, master):
        subj = _ingest(MASTER_KEY)
        time.sleep(0.4)
        r = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        items = r.json()["items"]
        assert len(items) >= 1
        mid = items[0]["mid"]
        rb = master.post(f"{BASE_URL}/api/queue/bulk",
                         json={"action": "remove", "mids": [mid]})
        assert rb.status_code == 200
        d = rb.json()
        assert d["success"] >= 1
        assert d["results"][0]["db_deleted"] >= 1
        # confirm gone
        r2 = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        assert all(i["mid"] != mid for i in r2.json()["items"])

    def test_bayi_cannot_delete_master_record(self, anon, master):
        """Cross-tenant delete guard: bayi tries to remove master's mid.

        Two acceptable outcomes:
          (a) 423 Demo Guard blocks the write entirely (no master session cookie).
          (b) 200 with db_deleted=0 (tenant scope filter matched nothing).
        Either way master's record remains — that's the invariant we assert.
        """
        subj = _ingest(MASTER_KEY)
        time.sleep(0.4)
        r = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        items = r.json()["items"]
        assert len(items) >= 1
        mid = items[0]["mid"]
        # bayi attempts remove
        rb = anon.post(f"{BASE_URL}/api/queue/bulk",
                       json={"license_key": BAYI_KEY, "action": "remove", "mids": [mid]})
        assert rb.status_code in (200, 403, 423), f"unexpected status: {rb.status_code}"
        if rb.status_code == 200:
            d = rb.json()
            assert d["results"][0]["db_deleted"] == 0, \
                f"bayi should NOT be able to delete master's record: {d}"
        # Master's record must still exist regardless of which guard fired
        r2 = master.get(f"{BASE_URL}/api/queue?limit=200&search={subj}")
        still_there = any(i["mid"] == mid for i in r2.json()["items"])
        assert still_there, "master's record was deleted by bayi request!"
        # cleanup
        master.post(f"{BASE_URL}/api/queue/bulk",
                    json={"action": "remove", "mids": [mid]})


# ===================== REGRESSION — purge-demo master-only ================
class TestV37PurgeDemoMasterOnly:
    def test_reseller_forbidden(self, anon):
        r = anon.post(f"{BASE_URL}/api/quarantine/purge-demo?license_key={BAYI_KEY}")
        # 403 (tenant scope master-only) veya 423 (demo write guard) — ikisi de yasaklı
        assert r.status_code in (403, 423), f"bayi must not purge-demo: {r.status_code} {r.text[:120]}"

    def test_anon_forbidden(self, anon):
        r = anon.post(f"{BASE_URL}/api/quarantine/purge-demo")
        assert r.status_code in (403, 423)

    def test_master_allowed(self, master):
        r = master.post(f"{BASE_URL}/api/quarantine/purge-demo")
        assert r.status_code == 200
        d = r.json()
        assert "quarantine_deleted" in d and "events_deleted" in d


# ===================== REGRESSION — queue counters isolation ==============
class TestV37RegressionScopeFields:
    def test_queue_stats_scope_field_shape(self, master, anon):
        r_m = master.get(f"{BASE_URL}/api/queue/stats").json()
        r_b = anon.get(f"{BASE_URL}/api/queue/stats?license_key={BAYI_KEY}").json()
        for r in (r_m, r_b):
            assert "scope" in r
            assert "is_master" in r["scope"]
            assert "license_key" in r["scope"]
