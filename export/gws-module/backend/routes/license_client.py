"""
License-server client proxy — main backend calls the standalone license server
so the WHM plugin's 'Verify License' button reflects the authoritative status.
v2.0: Round-robin across multiple replica URLs (comma-separated env).
v2.1: Friendly region labels via LICENSE_SERVER_REGIONS env
        (comma-separated, aligned with PUBLIC_LICENSE_SERVER_URL).
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

_urls_env = os.environ.get("PUBLIC_LICENSE_SERVER_URL", "http://localhost:8002")
REPLICA_URLS = [u.strip() for u in _urls_env.split(",") if u.strip()]
_regions_env = os.environ.get("LICENSE_SERVER_REGIONS",
                              "Primary EU-West,Secondary EU-Central")
REGION_LABELS = [r.strip() for r in _regions_env.split(",") if r.strip()]
# Align lengths (pad with generic names if mismatch)
while len(REGION_LABELS) < len(REPLICA_URLS):
    REGION_LABELS.append(f"Region-{len(REGION_LABELS) + 1}")
URL_TO_LABEL = dict(zip(REPLICA_URLS, REGION_LABELS))

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
    idx = REPLICA_URLS.index(start)
    order = REPLICA_URLS[idx:] + REPLICA_URLS[:idx]
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=6) as c:
        for url in order:
            try:
                r = await c.request(method, f"{url}{path}", **kw)
                if r.status_code < 500:
                    return r
                errors.append(f"{URL_TO_LABEL.get(url, url)} → {r.status_code}")
            except Exception as e:
                errors.append(f"{URL_TO_LABEL.get(url, url)} → {type(e).__name__}: {e}")
    raise HTTPException(502, f"Tüm license-server replica'ları başarısız: {' | '.join(errors)}")


def _mask_replica(url: str, payload: dict) -> dict:
    """Return a customer-safe representation — swap raw URL for region label,
    hide replica_id/redis details behind clear labels."""
    label = URL_TO_LABEL.get(url, "Region")
    is_reachable = payload.get("reachable", False)
    return {
        "region": label,
        "reachable": is_reachable,
        "version": payload.get("version"),
        "redis_connected": (payload.get("redis") or {}).get("connected") if isinstance(payload.get("redis"), dict) else None,
        "last_seen": payload.get("time"),
        "error": payload.get("error") if not is_reachable else None,
    }


@router.get("/health")
async def upstream_health():
    """Health of each replica, masked with friendly region labels."""
    raw = []
    async with httpx.AsyncClient(timeout=3) as c:
        for url in REPLICA_URLS:
            entry = {"url": url}
            try:
                r = await c.get(f"{url}/v1/health")
                r.raise_for_status()
                entry.update({"reachable": True, **r.json()})
            except Exception as e:
                entry.update({"reachable": False, "error": str(e)[:200]})
            raw.append(entry)

    healthy = sum(1 for r in raw if r.get("reachable"))
    # Cluster peer view — but we mask replica_ids for display
    cluster_view = None
    for r in raw:
        if r.get("reachable"):
            try:
                async with httpx.AsyncClient(timeout=3) as c:
                    cv = await c.get(f"{r['url']}/v2/cluster/health")
                    cluster_view = cv.json()
                    break
            except Exception:
                continue

    regions = [_mask_replica(r["url"], r) for r in raw]
    primary = regions[0] if regions else {}
    return {
        "reachable": healthy > 0,
        "region": primary.get("region"),
        "version": primary.get("version"),
        "last_seen": primary.get("last_seen"),
        "error": primary.get("error"),
        "regions": regions,
        "healthy_count": healthy,
        "total_regions": len(REPLICA_URLS),
        "cluster_size": (cluster_view or {}).get("cluster_size") if cluster_view else None,
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
    data = r.json()
    # Mask replica_id → region label
    rid = data.pop("replica_id", None)
    # Find URL that owns this replica_id (best effort via last request path)
    served_by = str(r.request.url).split("/v1/")[0] if r.request else None
    data["served_by"] = URL_TO_LABEL.get(served_by, "Region")
    return data


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
    d = r.json()
    d.pop("replica_id", None)
    return d


@router.get("/config")
async def config():
    return {"regions": REGION_LABELS, "total": len(REPLICA_URLS)}
