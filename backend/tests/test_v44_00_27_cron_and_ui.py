"""v44.00.27 — USOM cron new API + Rule auto-disable UI + DMARC alarm UI + GeoIP UI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_usom_cron_uses_new_api():
    src = (ROOT / "server.py").read_text()
    # Yeni cron _fetch_usom_iocs kullanıyor (eski _fetch_usom_urls DEĞİL, cron içinde)
    assert "from routes.usom import _fetch_usom_iocs" in src
    assert "usom-json-api" in src
    assert "added_to_blacklist" in src


def test_notifications_inbox_endpoints():
    src = (ROOT / "server.py").read_text()
    assert '@api.get("/notifications/inbox")' in src
    assert '@api.post("/notifications/inbox/{notif_id}/read")' in src
    assert '@api.post("/notifications/inbox/read-all")' in src


def test_rule_perf_auto_disable_endpoints():
    src = (ROOT / "routes/mailscanner.py").read_text()
    assert '@router.post("/ai/rule-performance/config")' in src
    assert '@router.post("/ai/rule-performance/enable/{rule_id}")' in src
    assert "RuleAutoDisableConfigIn" in src
    assert "rule_auto_disable_days" in src


def test_frontend_notifications_dmarc_ui():
    src = (ROOT.parent / "frontend/src/pages/Notifications.js").read_text()
    assert "NotificationInboxPanel" in src
    assert "notif-inbox-panel" in src
    assert 'kind === "dmarc_attack"' in src
    assert "Skull" in src
    assert "border-l-rose-500" in src


def test_frontend_rule_perf_auto_disable_ui():
    src = (ROOT.parent / "frontend/src/pages/MailScanner.js").read_text()
    assert "rule-perf-auto-toggle" in src
    assert "rule-perf-days" in src
    assert "rule-perf-config-save" in src
    assert "rule-perf-reenable-" in src
    assert "rule-perf-disabled" in src


def test_frontend_geoip_suggestions_ui():
    src = (ROOT.parent / "frontend/src/pages/ListsManager.js").read_text()
    assert "cb-suggest-bulk" in src
    assert "cb-suggestion-${s.code}" in src
    assert "Akıllı Öneri: En Çok Spam Aldığın Ülkeler" in src
    assert "geoip-suggestions" in src
