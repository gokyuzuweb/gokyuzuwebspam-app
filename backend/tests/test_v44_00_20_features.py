"""v44.00.20 — Feature additions: whitelist one-click, reason chips, daily digest.

Backend tests only (frontend chip parsing tested implicitly via component logic).
"""
from __future__ import annotations
import os
import sys
import pytest
import requests
from pathlib import Path

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
                break
    except Exception:
        pass


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_trusted_domains_endpoint_exists_and_requires_auth():
    """One-click whitelist endpoint must exist and reject non-master."""
    r = requests.post(f"{BASE}/api/plugin/trusted-domains",
                      json={"domain": "test-v20.example.com", "kind": "whitelist"},
                      timeout=10)
    assert r.status_code == 403, f"expected 403 auth-required, got {r.status_code}: {r.text}"
    # Ensure the error message identifies master-required
    assert "master" in r.text.lower() or "ana yonetici" in r.text.lower() or "ana yönetici" in r.text.lower()


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_daily_digest_endpoint_exists_and_requires_auth():
    """Daily digest manual trigger endpoint must exist under /api/ai/daily-digest/run."""
    r = requests.post(f"{BASE}/api/ai/daily-digest/run", timeout=10)
    assert r.status_code == 403


def test_daily_digest_task_scheduled():
    """Startup task list must include _daily_digest_task."""
    src = Path("/app/backend/server.py").read_text()
    assert "asyncio.create_task(_daily_digest_task())" in src, \
        "Daily digest task not scheduled at startup"
    assert "async def _daily_digest_task" in src
    assert "async def _run_daily_digest_once" in src


def test_send_email_html_param_added():
    """v44.00.20 — _send_email must accept html=True param for daily digest."""
    src = Path("/app/backend/server.py").read_text()
    assert "html: bool = False" in src, "_send_email missing html param"


def test_frontend_whitelist_button_exists():
    """MailEventDetail.js must contain the whitelist one-click button."""
    src = Path("/app/frontend/src/components/MailEventDetail.js").read_text()
    assert 'data-testid="tp-whitelist-btn"' in src, "Whitelist button testid missing"
    assert "/api/plugin/trusted-domains" in src, "Endpoint call missing"
    assert "showWhitelistBtn" in src


def test_frontend_reason_chips_exists():
    """LiveMailEvents.js must contain the ReasonChips component."""
    src = Path("/app/frontend/src/components/LiveMailEvents.js").read_text()
    assert "function ReasonChips" in src, "ReasonChips component missing"
    assert 'data-testid="live-event-reason-chips"' in src
    # Score-band inference labels
    assert "YÜKSEK RİSK" in src
    assert "ŞÜPHELİ" in src
    # SA rule regex present
    assert "ruleRegex" in src


def test_daily_digest_html_contains_whitelist_link():
    """Digest HTML must include whitelist deep-link for one-click add-to-whitelist."""
    src = Path("/app/backend/server.py").read_text()
    assert "panel.gokyuzuhosting.com/master/whitelist?domain=" in src
    assert "ÇELİŞKİ" in src  # user-facing label in digest
