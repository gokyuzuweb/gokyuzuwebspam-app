"""
Plugin distribution routes (tarball download + install info).
Extracted from server.py in v1.4 modularization pass.
"""
from __future__ import annotations
import io
import tarfile
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from deps import db

router = APIRouter(prefix="/plugin", tags=["plugin"])


@router.get("/download")
async def plugin_download():
    """Stream WHM plugin as gzipped tarball, built on-the-fly from disk."""
    plugin_dir = Path("/app/whm-plugin")
    if not plugin_dir.exists():
        raise HTTPException(404, "Plugin dizini bulunamadı")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(str(plugin_dir), arcname="gokyuzuwebspam")
    buf.seek(0)
    manifest = await db.version_manifest.find_one({}, {"_id": 0}) or {}
    version = (manifest.get("latest_version") or "1.1.0").strip()
    filename = f"gokyuzuwebspam-{version}.tar.gz"
    return StreamingResponse(
        buf,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-GWS-Version": version,
        },
    )


@router.get("/install-info")
async def plugin_install_info(request: Request, license_key: Optional[str] = None):
    """Return wget/curl one-liner + step-by-step install for the current server.
    Honors X-Forwarded-Proto/Host so public URL is used behind ingress.
    """
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_host:
        origin = f"{fwd_proto or 'https'}://{fwd_host}"
    else:
        origin = str(request.base_url).rstrip("/")
    download_url = f"{origin}/api/plugin/download"

    lic_suffix = f" --license={license_key}" if license_key else ""
    wget_one_liner = (
        f'wget -O gws.tar.gz "{download_url}" && '
        f'mkdir -p /opt/gokyuzuwebspam && '
        f'tar -xzf gws.tar.gz -C /opt/gokyuzuwebspam --strip-components=1 && '
        f'cd /opt/gokyuzuwebspam && chmod +x install.sh && ./install.sh{lic_suffix}'
    )
    curl_one_liner = (
        f'curl -fsSL "{download_url}" -o gws.tar.gz && '
        f'mkdir -p /opt/gokyuzuwebspam && '
        f'tar -xzf gws.tar.gz -C /opt/gokyuzuwebspam --strip-components=1 && '
        f'cd /opt/gokyuzuwebspam && chmod +x install.sh && ./install.sh{lic_suffix}'
    )
    steps = [
        f'wget -O gws.tar.gz "{download_url}"',
        "tar -xzf gws.tar.gz && cd gokyuzuwebspam",
        "chmod +x install.sh",
        f"./install.sh{lic_suffix}",
        "/usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf",
        "systemctl enable --now mailshield-api mailshield-milter mailshield-heartbeat.timer",
    ]
    return {
        "download_url": download_url,
        "wget_one_liner": wget_one_liner,
        "curl_one_liner": curl_one_liner,
        "steps": steps,
        "requires_root_ssh": True,
    }
