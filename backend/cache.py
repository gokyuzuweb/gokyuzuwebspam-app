"""
Redis-backed TTL cache with in-memory fallback + hit/miss metrics.

Kullanım:
    from cache import cache
    await cache.set("mykey", {"foo": 1}, ttl_sec=45)
    val = await cache.get("mykey")   # dict veya None
    await cache.delete("mykey")
    stats = cache.stats()             # {"hits": .., "misses": .., "backend": ..}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict
from typing import Any, Optional

log = logging.getLogger("gws.cache")

_NAMESPACE = "gws:cache:"
_HEALTH_RETRY_SEC = 30.0
_LOCAL_MAX = 500

# v43.4 Cache hit/miss metrikleri — endpoint bazında istatistik
# Key: "cache_key_prefix" (örn "blocked_stats", "live_ticker") → {hits, misses}
_METRICS: dict[str, dict[str, int]] = defaultdict(lambda: {"hits": 0, "misses": 0})

def _record_hit(key: str):
    prefix = key.split(":", 1)[0] if ":" in key else key
    _METRICS[prefix]["hits"] += 1

def _record_miss(key: str):
    prefix = key.split(":", 1)[0] if ":" in key else key
    _METRICS[prefix]["misses"] += 1


class _InMemory:
    """Fallback: dict + expiry timestamps. Thread-safe değil ama asyncio single-thread."""

    def __init__(self) -> None:
        self._d: dict[str, tuple[float, str]] = {}

    async def get(self, key: str) -> Optional[Any]:
        hit = self._d.get(key)
        if not hit:
            _record_miss(key)
            return None
        exp, raw = hit
        if time.time() > exp:
            self._d.pop(key, None)
            _record_miss(key)
            return None
        try:
            _record_hit(key)
            return json.loads(raw)
        except Exception:
            _record_miss(key)
            return None

    async def set(self, key: str, val: Any, ttl_sec: float) -> None:
        try:
            raw = json.dumps(val, default=str)
        except Exception:
            return
        self._d[key] = (time.time() + ttl_sec, raw)
        if len(self._d) > _LOCAL_MAX:
            now = time.time()
            for k in [k for k, (exp, _) in self._d.items() if exp < now]:
                self._d.pop(k, None)

    async def delete(self, key: str) -> None:
        self._d.pop(key, None)

    async def ping(self) -> bool:
        return True

    @property
    def backend(self) -> str:
        return "memory"

    def stats(self) -> dict:
        by_prefix = {}
        total_hits = 0
        total_misses = 0
        for prefix, m in _METRICS.items():
            h, ms = m["hits"], m["misses"]
            total = h + ms
            by_prefix[prefix] = {"hits": h, "misses": ms, "total": total,
                                 "hit_rate_pct": round(h * 100 / max(1, total), 1)}
            total_hits += h
            total_misses += ms
        return {
            "backend": self.backend,
            "total": {"hits": total_hits, "misses": total_misses,
                      "total": total_hits + total_misses,
                      "hit_rate_pct": round(total_hits * 100 / max(1, total_hits + total_misses), 1)},
            "by_prefix": by_prefix,
        }

    def reset_stats(self) -> None:
        _METRICS.clear()


class _RedisBackend:
    """redis.asyncio ile TTL cache. Bağlantı hatalarında in-memory'ye fallback."""

    def __init__(self, url: str) -> None:
        self._url = url
        self._client = None
        self._fallback = _InMemory()
        self._alive = False
        self._last_check = 0.0

    async def _ensure(self) -> bool:
        # Zaten hayat/ölü ise health-check interval boyunca tekrar deneme.
        now = time.time()
        if self._client is not None and self._alive:
            return True
        if now - self._last_check < _HEALTH_RETRY_SEC and not self._alive:
            return False
        self._last_check = now
        try:
            # Import here so import-time REDIS_URL boşsa hiç import olmaz
            import redis.asyncio as _redis  # type: ignore
            if self._client is None:
                self._client = _redis.from_url(
                    self._url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=2.0,
                    socket_timeout=2.0,
                )
            await self._client.ping()
            if not self._alive:
                log.info("Redis cache backend connected: %s", self._url)
            self._alive = True
            return True
        except Exception as ex:
            if self._alive:
                log.warning("Redis cache backend degraded (%s); using in-memory", ex)
            self._alive = False
            return False

    async def get(self, key: str) -> Optional[Any]:
        if await self._ensure():
            try:
                raw = await self._client.get(_NAMESPACE + key)
                if raw is None:
                    _record_miss(key)
                    return None
                _record_hit(key)
                return json.loads(raw)
            except Exception:
                self._alive = False
                # Bu isteği fallback ile servisle (fallback kendi metric'ini kaydeder)
        return await self._fallback.get(key)

    async def set(self, key: str, val: Any, ttl_sec: float) -> None:
        try:
            raw = json.dumps(val, default=str)
        except Exception:
            return
        # Her iki katmana da yaz — Redis düşerse fallback verisi aynı olsun
        await self._fallback.set(key, val, ttl_sec)
        if await self._ensure():
            try:
                await self._client.set(_NAMESPACE + key, raw, ex=max(1, int(ttl_sec)))
            except Exception:
                self._alive = False

    async def delete(self, key: str) -> None:
        await self._fallback.delete(key)
        if await self._ensure():
            try:
                await self._client.delete(_NAMESPACE + key)
            except Exception:
                self._alive = False

    async def ping(self) -> bool:
        return await self._ensure()

    @property
    def backend(self) -> str:
        return "redis" if self._alive else "memory-fallback"

    def stats(self) -> dict:
        """v43.4 — Endpoint bazında hit/miss + toplam. Master dashboard için."""
        by_prefix = {}
        total_hits = 0
        total_misses = 0
        for prefix, m in _METRICS.items():
            h, ms = m["hits"], m["misses"]
            total = h + ms
            by_prefix[prefix] = {
                "hits": h,
                "misses": ms,
                "total": total,
                "hit_rate_pct": round(h * 100 / max(1, total), 1),
            }
            total_hits += h
            total_misses += ms
        return {
            "backend": self.backend,
            "total": {
                "hits": total_hits,
                "misses": total_misses,
                "total": total_hits + total_misses,
                "hit_rate_pct": round(total_hits * 100 / max(1, total_hits + total_misses), 1),
            },
            "by_prefix": by_prefix,
        }

    def reset_stats(self) -> None:
        _METRICS.clear()


def _build() -> _InMemory | _RedisBackend:
    url = (os.environ.get("REDIS_URL") or "").strip()
    if url:
        return _RedisBackend(url)
    return _InMemory()


# Global singleton — modül seviyesi importa güvenli
cache = _build()


# ----- Sync köprü (mevcut sync callsite'ları için) -----
# maintenance.py `_cache_get`/`_cache_set` çağrılarını `await cache.get/set`'e
# migrate ederken bu köprü kaldırılır. Şimdilik geriye dönük uyum için sabit
# tutulur — çağıran asyncio event loop içindeyken güvenli değildir.
