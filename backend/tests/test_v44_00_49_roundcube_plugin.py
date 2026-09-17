"""v44.00.49 — Roundcube plugin auto-deploy artefaktları + doc smoke tests."""
from pathlib import Path


PLUGIN_DIR = Path("/app/whm-plugin/scripts/roundcube-plugin/gokyuzuwebspam")
INSTALL_SH = Path("/app/whm-plugin/install.sh")
DOC = Path("/app/whm-plugin/docs/WEBMAIL_TOAST.md")


def test_plugin_php_exists_and_valid():
    php = PLUGIN_DIR / "gokyuzuwebspam.php"
    assert php.exists(), "gokyuzuwebspam.php eksik"
    content = php.read_text(encoding="utf-8")
    assert "class gokyuzuwebspam" in content
    assert "extends rcube_plugin" in content
    assert "include_script('webmail-toast.js')" in content
    assert "gws_panel_url" in content
    assert "gws_user_email" in content


def test_plugin_config_dist_exists():
    cfg = PLUGIN_DIR / "config.inc.php.dist"
    assert cfg.exists(), "config.inc.php.dist eksik"
    content = cfg.read_text(encoding="utf-8")
    assert "gws_panel_url" in content


def test_plugin_bundled_js():
    js = PLUGIN_DIR / "webmail-toast.js"
    assert js.exists(), "webmail-toast.js plugin dizininde yok"
    content = js.read_text(encoding="utf-8")
    assert "gws_user_email" in content
    assert "for-recipient" in content
    assert "gws_panel_url" in content


def test_install_sh_deploys_roundcube_plugin():
    src = INSTALL_SH.read_text(encoding="utf-8")
    assert "Roundcube toast plugin" in src or "gokyuzuwebspam" in src
    assert "RC_PLUGINS_DIR" in src
    assert "gokyuzuwebspam.php" in src
    assert "webmail-toast.js" in src
    # Roundcube config.inc.php'e plugin ekleme mantigi
    assert "$config['plugins']" in src or "\\$config['plugins']" in src


def test_documentation_exists_and_covers_install():
    assert DOC.exists(), "WEBMAIL_TOAST.md dokumani eksik"
    content = DOC.read_text(encoding="utf-8")
    assert "Otomatik Kurulum" in content
    assert "Manuel Kurulum" in content
    assert "gokyuzuwebspam" in content
    assert "for-recipient" in content
    assert "config.inc.php" in content
