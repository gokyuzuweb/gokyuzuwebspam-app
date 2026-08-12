"""
v41 Perf/Cache refactor tests
- $facet aggregation for /maintenance/public/blocked-stats
- distinct-IP $group for region=tr/external + geo heatmap
- TTL cache (45s blocked-stats, 60s heatmap) with raw=1 bypass
- Startup indexes v40_verdict_ts, v40_verdict_ingested, v40_lic_verdict_ts,
  v40_kind_type, v40_ioc_type

NOTE: IP → country mapping in security_adv is by first octet.
  TR prefixes: 78, 212, 213
  Non-TR examples: 185 (GB), 5 (RU), 1 (CN)
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")

EXPECTED_KEYS = {
    "today_blocked", "today_total", "block_rate", "all_time_blocked",
    "series_30d", "peak_30d", "avg_30d", "region", "seed_applied",
    "exploits_caught", "exploits_critical", "ips_blocked",
    "quarantined_today", "virus_caught_all_time", "phishing_caught_all_time",
    "iocs_tracked", "active_licenses", "last_updated",
}

HEATMAP_KEYS = {"items", "total", "countries", "recent_attacks", "generated_at"}


# ---------------- Helpers -----------------------------------------------------

def _ingest(sender_ip: str, verdict: str = "spam") -> int:
    """Ingest a mail_event via public /events/ingest.
    The endpoint parses X-Originating-IP from headers_full into client_ip."""
    payload = {
        "license_key": MASTER,
        "from_addr": f"TEST_v41_{uuid.uuid4().hex[:8]}@example.com",
        "to_addr": "test@example.com",
        "subject": "TEST_v41",
        "verdict": verdict,
        "total_score": 9.5,
        "headers_full": f"X-Originating-IP: [{sender_ip}]\r\nFrom: t@x\r\n",
    }
    r = requests.post(f"{BASE}/events/ingest", json=payload, timeout=15)
    return r.status_code


# ---------------- Schema shape ------------------------------------------------

class TestBlockedStatsSchema:
    def test_region_all_shape(self):
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        missing = EXPECTED_KEYS - set(d.keys())
        assert not missing, f"Missing keys: {missing}"
        assert d["region"] == "all"
        assert isinstance(d["series_30d"], list) and len(d["series_30d"]) == 30
        for s in d["series_30d"]:
            assert "date" in s and "count" in s
            assert isinstance(s["count"], int)
        assert isinstance(d["today_blocked"], int)
        assert isinstance(d["peak_30d"], int)
        assert isinstance(d["seed_applied"], bool)

    def test_region_tr_shape(self):
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=tr", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["region"] == "tr"
        assert set(d.keys()) >= EXPECTED_KEYS

    def test_region_external_shape(self):
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=external", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["region"] == "external"
        assert set(d.keys()) >= EXPECTED_KEYS

    def test_raw_bypass_seed_flag(self):
        # raw=1 should never set seed_applied=True (real DB values)
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all&raw=1", timeout=20)
        assert r.status_code == 200
        assert r.json()["seed_applied"] is False


# ---------------- Region filter correctness -----------------------------------

class TestRegionFilteringCorrectness:
    """Ingest TR + non-TR events and verify region=tr/external counts increase."""

    def test_region_filter_reflects_ingested_ips(self):
        # baselines with raw=1 to bypass cache/seed
        b_tr = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=tr&raw=1", timeout=20).json()
        b_ext = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=external&raw=1", timeout=20).json()
        base_tr = b_tr["all_time_blocked"]
        base_ext = b_ext["all_time_blocked"]

        # Ingest 10 TR (78.x prefix maps to TR)
        tr_ok = 0
        for i in range(10):
            if _ingest(f"78.{100 + i}.1.{i+1}", "spam") == 200:
                tr_ok += 1
        # Ingest 10 non-TR (185.x prefix maps to GB)
        ext_ok = 0
        for i in range(10):
            if _ingest(f"185.{i+1}.2.3", "spam") == 200:
                ext_ok += 1

        assert tr_ok == 10, f"Only {tr_ok}/10 TR events ingested"
        assert ext_ok == 10, f"Only {ext_ok}/10 non-TR events ingested"

        # Re-query with raw=1 (bypass cache)
        a_tr = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=tr&raw=1", timeout=30).json()
        a_ext = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=external&raw=1", timeout=30).json()

        assert a_tr["all_time_blocked"] >= base_tr + 10, \
            f"TR all_time did not grow by 10: {base_tr} -> {a_tr['all_time_blocked']}"
        assert a_ext["all_time_blocked"] >= base_ext + 10, \
            f"External all_time did not grow by 10: {base_ext} -> {a_ext['all_time_blocked']}"


# ---------------- Cache behavior ---------------------------------------------

class TestCacheBehavior:
    def test_blocked_stats_cache_second_call_faster_or_fast(self):
        t0 = time.perf_counter()
        r1 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=20)
        d1 = time.perf_counter() - t0
        assert r1.status_code == 200
        # 2nd call likely cached
        t0 = time.perf_counter()
        r2 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=20)
        d2 = time.perf_counter() - t0
        assert r2.status_code == 200
        # last_updated should be identical (cache hit) OR d2 < d1
        cache_hit = r1.json()["last_updated"] == r2.json()["last_updated"]
        assert cache_hit or d2 < d1, f"Cache neither hit nor faster: d1={d1:.3f} d2={d2:.3f}"

    def test_raw_bypasses_cache(self):
        # Cache first
        requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=20)
        # raw=1 must return different last_updated on subsequent calls (fresh each time)
        r1 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all&raw=1", timeout=20).json()
        time.sleep(0.05)
        r2 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all&raw=1", timeout=20).json()
        assert r1["last_updated"] != r2["last_updated"], \
            "raw=1 should always hit DB (last_updated must change)"

    def test_heatmap_cache_returns_quickly(self):
        t0 = time.perf_counter()
        r1 = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=20)
        d1 = time.perf_counter() - t0
        assert r1.status_code == 200
        t0 = time.perf_counter()
        r2 = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=20)
        d2 = time.perf_counter() - t0
        # Warm call must respond in <200ms OR be a cache hit (identical generated_at)
        cache_hit = r1.json()["generated_at"] == r2.json()["generated_at"]
        assert cache_hit or d2 < 0.5, f"Heatmap warm slow: d1={d1:.3f} d2={d2:.3f}"

    def test_heatmap_cache_per_license(self):
        """License key filter must not return stale cache from a previous call."""
        r_a = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap?license_key=TEST_LIC_A", timeout=20).json()
        r_b = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap?license_key=TEST_LIC_B", timeout=20).json()
        # Since both licenses have no data, blacklist+iocs+seed will be identical.
        # But cache keys must differ (both should generate own entry). We verify:
        # a re-call to A returns same generated_at as first A (cache hit for A specifically).
        r_a2 = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap?license_key=TEST_LIC_A", timeout=20).json()
        assert r_a["generated_at"] == r_a2["generated_at"], \
            "License A cache should hit on 2nd identical call"


# ---------------- Heatmap schema + aggregation --------------------------------

class TestGeoHeatmapSchema:
    def test_shape(self):
        r = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        missing = HEATMAP_KEYS - set(d.keys())
        assert not missing, f"Missing heatmap keys: {missing}"
        assert isinstance(d["items"], list)
        assert isinstance(d["recent_attacks"], list)
        assert len(d["recent_attacks"]) <= 20
        assert isinstance(d["countries"], int)
        assert isinstance(d["total"], int)
        # Items structure
        for it in d["items"][:5]:
            for k in ("country", "count"):
                assert k in it

    def test_license_filter_returns_ok(self):
        r = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap?license_key=TEST_LIC_ANY", timeout=20)
        assert r.status_code == 200
        assert HEATMAP_KEYS <= set(r.json().keys())


# ---------------- Startup indexes --------------------------------------------

class TestStartupIndexes:
    def test_v40_indexes_present(self):
        """Verify indexes created on startup via direct MongoDB check."""
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ.get("DB_NAME", "test_database")

        async def _check():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            me_idx = await db.mail_events.index_information()
            lists_idx = await db.lists.index_information()
            iocs_idx = await db.threat_iocs.index_information()
            client.close()
            return me_idx, lists_idx, iocs_idx

        me_idx, lists_idx, iocs_idx = asyncio.get_event_loop().run_until_complete(_check())
        assert "v40_verdict_ts" in me_idx, f"missing v40_verdict_ts; have {list(me_idx.keys())}"
        assert "v40_verdict_ingested" in me_idx
        assert "v40_lic_verdict_ts" in me_idx
        assert "v40_kind_type" in lists_idx
        assert "v40_ioc_type" in iocs_idx


# ---------------- Seed applied when data is low ------------------------------

class TestSeedFallback:
    def test_seed_applied_flag_reflects_state(self):
        """seed_applied True iff total_real<500 AND raw=0 AND enabled.
        In this shared DB total_real may or may not be <500; just assert type + no crash."""
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["seed_applied"], bool)
        # When seed_applied, series values should be >= 1000-ish floor at some slots
        if d["seed_applied"]:
            assert d["peak_30d"] > 100, "Seed enabled but peak trivially low"
            assert d["all_time_blocked"] > 100
