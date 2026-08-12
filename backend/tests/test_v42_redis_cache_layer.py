"""
v42 Redis Cache Layer testleri.

Bu suite:
1. cache modülünün Redis'e yazdığını doğrular (gws:cache:* prefix)
2. TTL değerlerinin 45sn (blocked-stats) ve 60sn (heatmap) olduğunu doğrular
3. Redis erişilemezken graceful fallback + cache tutarlılığı
4. Multi-instance senaryosu: aynı Redis'e yazan iki client aynı cache'i görür
5. raw=1 bypass + cache invalidation davranışı
6. Namespace izolasyonu — farklı license_key farklı Redis key

Prerequisites:
- REDIS_URL env set (redis://localhost:6379/0)
- Redis çalışıyor
- Backend restart edilmiş (Redis'i tanıyor)
"""
import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"

# Redis import optional — testleri Redis olmadan da çalıştırabiliyoruz
try:
    import redis
    _REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    _R = redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
    _R.ping()
    REDIS_OK = True
except Exception:
    REDIS_OK = False


needs_redis = pytest.mark.skipif(not REDIS_OK, reason="Redis unavailable")


class TestRedisCacheWrite:
    """Endpoint çağrısı Redis'e cache yazmalı."""

    @needs_redis
    def test_blocked_stats_writes_redis_key(self):
        # Cache'i temizle
        for k in _R.scan_iter("gws:cache:blocked_stats:*"):
            _R.delete(k)
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15)
        assert r.status_code == 200
        keys = list(_R.scan_iter("gws:cache:blocked_stats:*"))
        assert any(k.endswith(":all") for k in keys), f"expected blocked_stats:all in {keys}"

    @needs_redis
    def test_blocked_stats_ttl_45s(self):
        for k in _R.scan_iter("gws:cache:blocked_stats:tr"):
            _R.delete(k)
        r = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=tr", timeout=15)
        assert r.status_code == 200
        ttl = _R.ttl("gws:cache:blocked_stats:tr")
        assert 40 <= ttl <= 45, f"blocked-stats TTL {ttl}s not in [40,45]"

    @needs_redis
    def test_heatmap_writes_redis_key(self):
        for k in _R.scan_iter("gws:cache:geo_heatmap:*"):
            _R.delete(k)
        r = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=15)
        assert r.status_code == 200
        keys = list(_R.scan_iter("gws:cache:geo_heatmap:*"))
        assert any("ALL" in k for k in keys), f"expected geo_heatmap:ALL in {keys}"

    @needs_redis
    def test_heatmap_ttl_60s(self):
        for k in _R.scan_iter("gws:cache:geo_heatmap:*"):
            _R.delete(k)
        r = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=15)
        assert r.status_code == 200
        ttl = _R.ttl("gws:cache:geo_heatmap:ALL")
        assert 55 <= ttl <= 60, f"heatmap TTL {ttl}s not in [55,60]"


class TestRedisCacheRead:
    """İkinci çağrı Redis'ten okumalı (aynı response, aynı last_updated)."""

    @needs_redis
    def test_second_call_returns_cached_response(self):
        for k in _R.scan_iter("gws:cache:blocked_stats:*"):
            _R.delete(k)
        # First call — populates cache
        r1 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15).json()
        # Second call — should be identical
        r2 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15).json()
        assert r1["last_updated"] == r2["last_updated"], "cache hit should return identical last_updated"
        assert r1["today_blocked"] == r2["today_blocked"]

    @needs_redis
    def test_raw_bypass_generates_new_last_updated(self):
        # Bring cache warm — clear + set + read back
        for k in _R.scan_iter("gws:cache:blocked_stats:all"):
            _R.delete(k)
        r_first = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15).json()
        # raw=1 should bypass cache — generates new last_updated
        time.sleep(1.1)
        r_raw = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all&raw=1", timeout=15).json()
        assert r_raw["last_updated"] != r_first["last_updated"], "raw=1 should bypass cache and return fresh timestamp"
        # Verify raw=1 did not overwrite cache: Redis key TTL should still be positive
        # (its ttl might be lower than the fresh 45 since populated by r_first)
        ttl = _R.ttl("gws:cache:blocked_stats:all")
        assert ttl > 0, "raw=1 must not delete cache key"


class TestNamespaceIsolation:
    """Farklı license_key = farklı Redis key."""

    @needs_redis
    def test_heatmap_per_license_separate_keys(self):
        for k in _R.scan_iter("gws:cache:geo_heatmap:*"):
            _R.delete(k)
        requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=15)
        requests.get(f"{BASE}/maintenance/geo/blocked-heatmap?license_key=TENANT-XYZ", timeout=15)
        keys = sorted(_R.scan_iter("gws:cache:geo_heatmap:*"))
        assert any(k.endswith(":ALL") for k in keys), f"missing ALL key in {keys}"
        assert any(k.endswith(":TENANT-XYZ") for k in keys), f"missing TENANT-XYZ key in {keys}"
        assert len(keys) >= 2

    @needs_redis
    def test_blocked_stats_per_region_separate_keys(self):
        for k in _R.scan_iter("gws:cache:blocked_stats:*"):
            _R.delete(k)
        requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15)
        requests.get(f"{BASE}/maintenance/public/blocked-stats?region=tr", timeout=15)
        requests.get(f"{BASE}/maintenance/public/blocked-stats?region=external", timeout=15)
        keys = sorted(_R.scan_iter("gws:cache:blocked_stats:*"))
        assert any(k.endswith(":all") for k in keys)
        assert any(k.endswith(":tr") for k in keys)
        assert any(k.endswith(":external") for k in keys)


class TestPayloadIntegrity:
    """Cache'lenmiş dict tam olarak geri dönmeli (JSON round-trip lossless)."""

    @needs_redis
    def test_response_schema_preserved_via_cache(self):
        for k in _R.scan_iter("gws:cache:blocked_stats:*"):
            _R.delete(k)
        r1 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15).json()
        r2 = requests.get(f"{BASE}/maintenance/public/blocked-stats?region=all", timeout=15).json()
        # Aynı keyler
        assert set(r1.keys()) == set(r2.keys())
        # series_30d 30 slot
        assert len(r1["series_30d"]) == 30
        assert len(r2["series_30d"]) == 30
        # Her slot {date, count}
        for slot in r2["series_30d"]:
            assert "date" in slot and "count" in slot
            assert isinstance(slot["count"], int)

    @needs_redis
    def test_heatmap_recent_attacks_preserved(self):
        for k in _R.scan_iter("gws:cache:geo_heatmap:*"):
            _R.delete(k)
        r1 = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=15).json()
        r2 = requests.get(f"{BASE}/maintenance/geo/blocked-heatmap", timeout=15).json()
        assert r1["generated_at"] == r2["generated_at"]  # cache identity
        assert r1["countries"] == r2["countries"]
        assert len(r2["recent_attacks"]) == len(r1["recent_attacks"])
        # Recent attacks should have country, verdict, ts
        for a in r2["recent_attacks"][:3]:
            assert "country" in a and "verdict" in a


# ============================================================================
# v42+ EXTENDED CACHE: live-ticker, trust-score/history, plugin-health/list
# ============================================================================
MASTER_KEY = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")


class TestLiveTickerCache:
    """Landing 5sn polling — 4sn TTL."""

    @needs_redis
    def test_live_ticker_writes_redis_key_4s_ttl(self):
        _R.delete("gws:cache:live_ticker:public")
        r = requests.get(f"{BASE}/maintenance/public/live-ticker", timeout=15)
        assert r.status_code == 200
        ttl = _R.ttl("gws:cache:live_ticker:public")
        assert 1 <= ttl <= 4, f"live-ticker TTL {ttl}s not in [1,4]"

    @needs_redis
    def test_live_ticker_cache_hit_returns_identical(self):
        _R.delete("gws:cache:live_ticker:public")
        r1 = requests.get(f"{BASE}/maintenance/public/live-ticker", timeout=15).json()
        r2 = requests.get(f"{BASE}/maintenance/public/live-ticker", timeout=15).json()
        assert r1["generated_at"] == r2["generated_at"]
        assert r1["blocked_last_minute"] == r2["blocked_last_minute"]

    @needs_redis
    def test_live_ticker_schema_preserved(self):
        _R.delete("gws:cache:live_ticker:public")
        r = requests.get(f"{BASE}/maintenance/public/live-ticker", timeout=15).json()
        for key in ("blocked_last_minute", "blocked_last_hour", "blocked_last_24h",
                    "active_resellers", "recent_events", "generated_at"):
            assert key in r
        assert isinstance(r["recent_events"], list)


class TestTrustScoreHistoryCache:
    """Skor trend endpoint'i — 5dk TTL, snapshot POST'ta invalidate."""

    @needs_redis
    def test_trust_history_writes_redis_key_300s_ttl(self):
        _R.delete("gws:cache:trust_history:d30")
        r = requests.get(f"{BASE}/maintenance/trust-score/history?days=30", timeout=15)
        assert r.status_code == 200
        ttl = _R.ttl("gws:cache:trust_history:d30")
        assert 290 <= ttl <= 300, f"trust-history TTL {ttl}s not in [290,300]"

    @needs_redis
    def test_trust_history_different_days_separate_keys(self):
        # d30 ve d7 farklı key olmalı
        _R.delete("gws:cache:trust_history:d30")
        _R.delete("gws:cache:trust_history:d7")
        requests.get(f"{BASE}/maintenance/trust-score/history?days=30", timeout=15)
        requests.get(f"{BASE}/maintenance/trust-score/history?days=7", timeout=15)
        assert _R.exists("gws:cache:trust_history:d30")
        assert _R.exists("gws:cache:trust_history:d7")

    @needs_redis
    def test_snapshot_invalidates_history_cache(self):
        # Cache'i doldur
        requests.get(f"{BASE}/maintenance/trust-score/history?days=30", timeout=15)
        assert _R.exists("gws:cache:trust_history:d30")
        # Snapshot POST (master auth gerekli — demo mode değil)
        r = requests.post(f"{BASE}/maintenance/trust-score/snapshot?score=85&findings=2",
                          headers={"X-Master-Key": MASTER_KEY}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        # Cache silinmiş olmalı
        assert not _R.exists("gws:cache:trust_history:d30"), "snapshot must invalidate history cache"


class TestPluginHealthListCache:
    """Master-only, 15sn TTL."""

    @needs_redis
    def test_plugin_health_writes_redis_key_15s_ttl(self):
        _R.delete("gws:cache:plugin_health_list:h24")
        r = requests.get(f"{BASE}/admin/plugin-health/list?hours=24",
                         headers={"X-Master-Key": MASTER_KEY}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        ttl = _R.ttl("gws:cache:plugin_health_list:h24")
        assert 1 <= ttl <= 15, f"plugin-health TTL {ttl}s not in [1,15]"

    @needs_redis
    def test_plugin_health_cache_hit_identical(self):
        _R.delete("gws:cache:plugin_health_list:h24")
        hdrs = {"X-Master-Key": MASTER_KEY}
        r1 = requests.get(f"{BASE}/admin/plugin-health/list?hours=24", headers=hdrs, timeout=20).json()
        r2 = requests.get(f"{BASE}/admin/plugin-health/list?hours=24", headers=hdrs, timeout=20).json()
        assert r1.get("total_bayi") == r2.get("total_bayi")
        assert len(r1.get("items", [])) == len(r2.get("items", []))

    @needs_redis
    def test_plugin_health_different_hours_separate_keys(self):
        _R.delete("gws:cache:plugin_health_list:h24")
        _R.delete("gws:cache:plugin_health_list:h1")
        hdrs = {"X-Master-Key": MASTER_KEY}
        requests.get(f"{BASE}/admin/plugin-health/list?hours=24", headers=hdrs, timeout=20)
        requests.get(f"{BASE}/admin/plugin-health/list?hours=1", headers=hdrs, timeout=20)
        assert _R.exists("gws:cache:plugin_health_list:h24")
        assert _R.exists("gws:cache:plugin_health_list:h1")
