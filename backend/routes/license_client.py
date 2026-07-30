"""
License-server client proxy — main backend calls the standalone license server
so the WHM plugin's 'Verify License' button reflects the authoritative status.
"""
from __future__ import annotations
import os
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/license-server", tags=["license-server"])

PUBLIC_LICENSE_SERVER_URL = os.environ.get("PUBLIC_LICENSE_SERVER_URL", "http://localhost:8002")
ADMIN_KEY = os.environ.get("LICENSE_SERVER_ADMIN_KEY", "gws-license-admin-key")


@router.get("/health")
async def upstream_health():
    """Return the reachability + version of the upstream license server."""
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{PUBLIC_LICENSE_SERVER_URL}/v1/health")
            r.raise_for_status()
            return {"reachable": True, "url": PUBLIC_LICENSE_SERVER_URL, **r.json()}
    except Exception as e:
        return {"reachable": False, "url": PUBLIC_LICENSE_SERVER_URL, "error": str(e)[:200]}


class VerifyReq(BaseModel):
    license_key: str
    server_ip: str


@router.post("/verify")
async def upstream_verify(payload: VerifyReq):
    """Proxy verify to the upstream license server (authoritative)."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(
                f"{PUBLIC_LICENSE_SERVER_URL}/v1/verify",
                params={"license_key": payload.license_key, "server_ip": payload.server_ip},
            )
            return r.json()
    except Exception as e:
        raise HTTPException(502, f"License server erişilemedi: {e}")


class RevokeReq(BaseModel):
    license_key: str
    reason: str = ""


@router.post("/revoke")
async def upstream_revoke(payload: RevokeReq):
    """Seller-side revocation: call upstream license server as admin."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(
                f"{PUBLIC_LICENSE_SERVER_URL}/v1/revoke",
                json=payload.model_dump(),
                headers={"X-Admin-Key": ADMIN_KEY},
            )
            if r.status_code != 200:
                raise HTTPException(r.status_code, r.text)
            return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"License server erişilemedi: {e}")


@router.get("/config")
async def config():
    """Frontend can read this to display upstream URL."""
    return {"url": PUBLIC_LICENSE_SERVER_URL}
