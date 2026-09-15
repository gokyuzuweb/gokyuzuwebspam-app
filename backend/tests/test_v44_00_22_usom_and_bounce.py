"""v44.00.22 — USOM integration + Bounce Digest UX improvements."""
from pathlib import Path
import os, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    try:
        for l in open("/app/frontend/.env"):
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE = l.split("=", 1)[1].strip().rstrip("/"); break
    except Exception: pass


def test_usom_route_file_exists():
    p = Path("/app/backend/routes/usom.py")
    assert p.exists()
    src = p.read_text()
    assert "https://www.usom.gov.tr/url-list.txt" in src
    assert 'router = APIRouter(prefix="/threat-intel/usom"' in src


def test_usom_router_included_in_server():
    src = Path("/app/backend/server.py").read_text()
    assert "from routes.usom import router as _usom_router" in src
    assert "app.include_router(_usom_router" in src


def test_usom_daily_cron_scheduled():
    src = Path("/app/backend/server.py").read_text()
    assert "asyncio.create_task(_daily_usom_fetch_task())" in src
    assert "async def _daily_usom_fetch_task" in src


def test_usom_endpoints_require_auth():
    if not BASE: return
    r1 = requests.get(f"{BASE}/api/threat-intel/usom/list", timeout=8)
    r2 = requests.post(f"{BASE}/api/threat-intel/usom/fetch", timeout=8)
    r3 = requests.post(f"{BASE}/api/threat-intel/usom/delete", json={"value": "x.com"}, timeout=8)
    assert r1.status_code == 403 and r2.status_code == 403 and r3.status_code == 403


def test_frontend_usom_tab_exists():
    src = Path("/app/frontend/src/pages/ThreatIntel.js").read_text()
    assert 'k: "usom"' in src
    assert "function UsomTab" in src
    assert 'data-testid="usom-tab"' in src
    assert 'data-testid="usom-fetch-btn"' in src
    assert "USOM Zararlı Bağlantı" in src
    assert "usom.gov.tr" in src.lower()


def test_bounce_digest_shows_email():
    src = Path("/app/frontend/src/pages/BounceDigest.js").read_text()
    # Uses from_addr fallback logic
    assert "Etkilenen Kullanıcı Adresleri" in src
    assert "Gönderen (E-posta)" in src
    # Guessing email from top domain when @ missing
    assert "topDom" in src or "top_domains" in src
    # Module explanation section
    assert "Bu modül ne işe yarar?" in src
    assert "Bounce Digest" in src
