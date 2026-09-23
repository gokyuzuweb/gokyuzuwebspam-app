"""v44.00.53 — Exim system_filter + cPanel SpamBox auto-enable

install.sh'a X-Spam-Flag: YES olan mail'i Junk klasorune otomatik yonlendiren
Exim system_filter yazilmali; ayrica WHM API1 ile TUM cPanel hesaplarinda
SpamBox aktive edilmeli.
"""
from pathlib import Path

INSTALL_SH = Path("/app/whm-plugin/install.sh").read_text(encoding="utf-8")


def test_install_sh_writes_system_filter():
    assert "gws-spam-system-filter.exim" in INSTALL_SH
    assert 'if $h_X-Spam-Flag: matches "YES"' in INSTALL_SH
    assert "save $home/mail/.spam/new" in INSTALL_SH
    assert "finish" in INSTALL_SH


def test_install_sh_updates_exim_localopts():
    assert "exim.conf.localopts" in INSTALL_SH
    assert "system_filter=" in INSTALL_SH
    assert "buildeximconf" in INSTALL_SH
    assert "restartsrv_exim" in INSTALL_SH


def test_install_sh_enables_cpanel_spam_box():
    assert "whmapi1 save_spamassassin_config" in INSTALL_SH
    assert "enable_spam_box=1" in INSTALL_SH
    assert "default_spam_box=1" in INSTALL_SH
    assert "update_spam_options" in INSTALL_SH
    assert "spam_box=1" in INSTALL_SH


def test_install_sh_bulk_migrates_existing_accounts():
    """Mevcut hesaplar da migrate edilmeli, sadece yeni degil."""
    assert "listaccts" in INSTALL_SH
    assert "spam-box-migration.log" in INSTALL_SH
