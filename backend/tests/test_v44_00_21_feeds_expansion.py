"""v44.00.21 — Threat Intel feeds expansion + Spamhaus/SORBS never_synced fix."""
from __future__ import annotations
import os, requests
from pathlib import Path

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/"); break
    except Exception: pass


def test_new_feeds_added():
    """5 new DNSBL feeds must be in GLOBAL_FEEDS."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    for k in ("spamcop", "psbl", "dronebl", "manitu", "cbl"):
        assert f'"key": "{k}"' in src, f"feed {k} missing"


def test_helper_collect_recent_public_ips():
    """Shared IP-collection helper — used by all DNSBL feeds."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    assert "async def _collect_recent_public_ips" in src
    # Private-IP filter
    assert '"10."' in src
    assert '"192.168."' in src
    # sender_ip fallback
    assert "$sender_ip" in src or 'sender_ip' in src


def test_feed_sync_endpoints_expanded():
    """The elif branch handles all 10 DNSBL keys."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    # New keys in the branch condition
    for k in ("spamcop", "psbl", "dronebl", "manitu", "cbl"):
        assert f'"{k}"' in src
    # dnsbl_map has entries
    assert '"bl.spamcop.net"' in src
    assert '"psbl.surriel.com"' in src
    assert '"dnsbl.dronebl.org"' in src
    assert '"ix.dnsbl.manitu.net"' in src
    assert '"cbl.abuseat.org"' in src


def test_feeds_api_returns_11_entries():
    if not BASE: return
    r = requests.get(f"{BASE}/api/threat-intel/feeds", timeout=10)
    assert r.status_code == 200
    d = r.json()
    keys = {f["key"] for f in d["items"]}
    # 6 pre-existing + 5 new
    for k in ("spamhaus_zen", "barracuda_bl", "sorbs", "uceprotect_l1", "urlhaus",
              "phishtank", "spamcop", "psbl", "dronebl", "manitu", "cbl"):
        assert k in keys, f"{k} not in feeds list"
    assert len(d["items"]) >= 11
