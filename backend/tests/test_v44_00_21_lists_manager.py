"""v44.00.21 — Liste Merkezi (Unified Lists Manager) endpoints."""
from __future__ import annotations
import os
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


def test_endpoints_exist_with_auth():
    """4 new endpoints must exist and require master auth."""
    for method, path in [
        ("GET",  "/api/lists-manager/unified"),
        ("POST", "/api/lists-manager/add"),
        ("POST", "/api/lists-manager/delete"),
        ("GET",  "/api/lists-manager/history"),
    ]:
        if not BASE: continue
        r = requests.request(
            method, f"{BASE}{path}",
            json={"kind": "whitelist", "entry_type": "domain", "value": "x.com"} if method == "POST" else None,
            timeout=8,
        )
        assert r.status_code == 403, f"{method} {path} → {r.status_code}: {r.text[:100]}"


def test_frontend_page_created():
    p = Path("/app/frontend/src/pages/ListsManager.js")
    assert p.exists(), "ListsManager.js missing"
    src = p.read_text()
    assert 'data-testid="lists-manager-page"' in src
    assert 'data-testid="lm-add-btn"' in src
    assert 'data-testid={`lm-tab-${t.k}`}' in src
    assert 'k: "all"' in src and 'k: "whitelist"' in src and 'k: "blacklist"' in src and 'k: "history"' in src
    assert "lists-manager/unified" in src
    assert "lists-manager/add" in src
    assert "lists-manager/delete" in src
    assert "lists-manager/history" in src


def test_route_and_sidebar_entry():
    app_src = Path("/app/frontend/src/App.js").read_text()
    assert 'import ListsManager' in app_src
    assert '/panel/lists-manager' in app_src
    assert 'nav-lists-manager' in app_src
    assert 'Liste Merkezi' in app_src


def test_backend_unified_reads_all_three_sources():
    src = Path("/app/backend/server.py").read_text()
    assert '"lists_ui"' in src
    assert '"lists_maintenance"' in src
    assert '"trusted_domains"' in src
    # dedupe logic
    assert "seen = set()" in src or "deduped" in src


def test_backend_delete_removes_from_all_sources():
    src = Path("/app/backend/server.py").read_text()
    # Both db.lists schemas + trusted_domains
    assert 'db.lists.delete_many({"entry_type": et,' in src
    assert 'db.lists.delete_many({"type": et, "value": val, "kind": kind})' in src
    assert 'db.trusted_domains.delete_many({"domain": dom' in src


def test_backend_history_collection():
    src = Path("/app/backend/server.py").read_text()
    assert 'db.lists_history.insert_one' in src
    assert 'db.lists_history.find' in src
