"""
License-server client proxy — main backend calls the standalone license server
so the WHM plugin's 'Verify License' button reflects the authoritative status.
v2.0: Round-robin across multiple replica URLs (comma-separated env).
"""
from __future__ import annotations
import os
import itertools
import threading
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/license-server", tags=["license-server"])

# Comma-separated list, first URL used for single-replica back-compat
_urls_env = os.environ.get("PUBLIC_LICENSE_SERVER_URL", "http://localhost:8002")
REPLICA_URLS = [u.strip() for u in _urls_env.split(",") if u.strip()]
ADMIN_KEY = os.environ.get("LICENSE_SERVER_ADMIN_KEY", "gws-license-admin-key")

_rr_lock = threading.Lock()
_rr_cycle = itertools.cycle(REPLICA_URLS)


def _next_url() -> str:
    with _rr_lock:
        return next(_rr_cycle)


async def _try_all(method: str, path: str, **kw):
    """Try replicas in round-robin order (starting position advances each call)
    until one succeeds. Fallback to remaining replicas on 5xx / network errors."""
    if not REPLICA_URLS:
        raise HTTPException(500, "License server URL yapılandırılmamış")
    start = _next_url()
    # Build attempt order starting from `start`, then the rest as fallback
    idx = REPLICA_URLS.index(start)
    order = REPLICA_URLS[idx:] + REPLICA_URLS[:idx]
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=6) as c:
        for url in order:
            try:
                r = await c.request(method, f"{url}{path}", **kw)
                if r.status_code < 500:
                    return r
                errors.append(f"{url} → {r.status_code}")
            except Exception as e:
                errors.append(f"{url} → {type(e).__name__}: {e}")
    raise HTTPException(502, f"Tüm license-server replica'ları başarısız: {' | '.join(errors)}")


@router.get("/health")
async def upstream_health():
    """Health of each replica + Redis-backed cluster view from primary."""
    results = []
    async with httpx.AsyncClient(timeout=3) as c:
        for url in REPLICA_URLS:
            try:
                r = await c.get(f"{url}/v1/health")
                r.raise_for_status()
                results.append({"url": url, "reachable": True, **r.json()})
            except Exception as e:
                results.append({"url": url, "reachable": False, "error": str(e)[:200]})
    healthy = sum(1 for r in results if r.get("reachable"))
    # Also fetch cluster view from first reachable replica
    cluster_view = None
    for r in results:
        if r.get("reachable"):
            try:
                async with httpx.AsyncClient(timeout=3) as c:
                    cv = await c.get(f"{r['url']}/v2/cluster/health")
                    cluster_view = cv.json()
                    break
            except Exception:
                continue
    # Primary-shaped legacy fields
    primary = results[0] if results else {}
    return {
        "reachable": healthy > 0,
        "url": primary.get("url"),
        "service": primary.get("service"),
        "version": primary.get("version"),
        "time": primary.get("time"),
        "error": primary.get("error"),
        "replicas": results,
        "healthy_count": healthy,
        "total_replicas": len(REPLICA_URLS),
        "cluster": cluster_view,
    }


class VerifyReq(BaseModel):
    license_key: str
    server_ip: str


@router.post("/verify")
async def upstream_verify(payload: VerifyReq):
    r = await _try_all("GET", "/v1/verify", params={
        "license_key": payload.license_key,
        "server_ip": payload.server_ip,
    })
    return r.json()


class RevokeReq(BaseModel):
    license_key: str
    reason: str = ""


@router.post("/revoke")
async def upstream_revoke(payload: RevokeReq):
    r = await _try_all("POST", "/v1/revoke",
                       json=payload.model_dump(),
                       headers={"X-Admin-Key": ADMIN_KEY})
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@router.get("/config")
async def config():
    return {"urls": REPLICA_URLS, "primary": REPLICA_URLS[0]}
