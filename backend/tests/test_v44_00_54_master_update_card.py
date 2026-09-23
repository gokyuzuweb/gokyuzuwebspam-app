"""v44.00.54 — Master Update Card + bump-version.sh testleri."""
import os
from pathlib import Path

import requests

BACKEND = "http://127.0.0.1:8001"


def test_version_bundle_endpoint_returns_plugin_version():
    r = requests.get(f"{BACKEND}/api/version/bundle", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert "version" in j
    # v prefix normalize
    assert j["version"].startswith("v")
    # Plugin VERSION dosyasi ile eslesmeli
    plugin_v = Path("/app/whm-plugin/VERSION").read_text().strip()
    if not plugin_v.startswith("v"):
        plugin_v = f"v{plugin_v}"
    assert j["version"] == plugin_v


def test_version_panel_endpoint_still_works():
    r = requests.get(f"{BACKEND}/api/version/panel", timeout=10)
    assert r.status_code == 200
    assert "version" in r.json()


def test_deploy_trigger_endpoint_exists():
    """Webhook yoksa emergent_url ile fallback donmeli."""
    r = requests.post(f"{BACKEND}/api/version/deploy-trigger", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert "ok" in j
    # Webhook tanimli degilse emergent_url donmeli
    if not j.get("triggered"):
        assert "emergent_url" in j
        assert j["emergent_url"].startswith("http")


def test_bump_version_script_exists_and_executable():
    p = Path("/app/scripts/bump-version.sh")
    assert p.exists(), "bump-version.sh eksik"
    assert os.access(p, os.X_OK), "bump-version.sh executable degil"
    src = p.read_text()
    # 4 bump noktasini icermeli
    assert "/app/VERSION" in src
    assert "/app/backend/VERSION" in src
    assert "/app/whm-plugin/VERSION" in src
    assert "_PACKAGE_VERSION" in src
    # Kullanici rehberi
    assert "Save to Github" in src
    assert "Deploy" in src


def test_master_update_card_component_exists():
    p = Path("/app/frontend/src/components/MasterUpdateCard.js")
    assert p.exists()
    src = p.read_text()
    assert "MasterUpdateCard" in src
    assert "/version/bundle" in src or "version-panel-bundle" in src
    assert "deploy-trigger" in src
    assert "master-update-card-available" in src  # data-testid
    assert "master-update-deploy-btn" in src


def test_dashboard_renders_master_update_card():
    src = Path("/app/frontend/src/pages/Dashboard.js").read_text()
    assert "MasterUpdateCard" in src
    assert 'import MasterUpdateCard' in src
