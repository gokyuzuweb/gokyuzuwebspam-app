"""v44.00.37 — Refactor + DNS Cache + AI Email + Trend Chart tests"""
import os
import requests

BACKEND = "http://127.0.0.1:8001"
MASTER = "MS-C02AB012652A4FE692D69676"


def test_threatintel_refactor_shell_only():
    p = "/app/frontend/src/pages/ThreatIntel.js"
    assert os.path.exists(p)
    content = open(p).read()
    lines = content.count("\n")
    # Shell dosyası küçük olmalı
    assert lines < 100, f"ThreatIntel.js should be < 100 lines, got {lines}"
    # 5 alt tab import edilmeli
    for tab in ("IocTab", "DmarcTab", "FeedsTab", "UsomTab", "ComplianceTab"):
        assert f"./threat-intel/{tab}" in content or f'from "./threat-intel/{tab}"' in content


def test_threatintel_subtabs_exist():
    base = "/app/frontend/src/pages/threat-intel"
    for name in ("IocTab.js", "DmarcTab.js", "FeedsTab.js", "UsomTab.js", "ComplianceTab.js"):
        p = f"{base}/{name}"
        assert os.path.exists(p), f"missing {p}"
        content = open(p).read()
        # Named export bulunmalı
        expected = name.replace(".js", "")
        assert f"export function {expected}" in content, f"{name} missing 'export function {expected}'"


def test_dns_cache_hit():
    # First call → from_cache=false
    r1 = requests.get(f"{BACKEND}/api/ai/dmarc-verify",
                      params={"domain": "gokyuzuhosting.com"},
                      headers={"X-Master-Key": MASTER}, timeout=15)
    assert r1.status_code == 200
    # Second call within 60s → from_cache=true
    r2 = requests.get(f"{BACKEND}/api/ai/dmarc-verify",
                      params={"domain": "gokyuzuhosting.com"},
                      headers={"X-Master-Key": MASTER}, timeout=15)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("from_cache") is True


def test_ai_email_helper_in_cron():
    """Cron içinde _render_report_pdf + master email send akışı tanımlı."""
    src = open("/app/backend/routes/ai_analysis.py").read()
    assert "_render_report_pdf" in src
    assert "MASTER_ADMIN_EMAIL" in src
    assert "attachments=" in src


def test_send_email_supports_attachments():
    src = open("/app/backend/server.py").read()
    assert "attachments: Optional[list]" in src or "attachments=None" in src
    assert "MIMEApplication" in src


def test_ai_health_trend_chart_component():
    p = "/app/frontend/src/components/AiSystemAnalysisButton.js"
    src = open(p).read()
    assert "AiHealthTrend" in src
    assert "ai-health-trend" in src  # data-testid
    assert "LineChart" in src
    assert "system-analysis/history" in src  # trend data source
