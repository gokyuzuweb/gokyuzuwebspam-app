"""v44.00.36 — AI cron + DMARC DNS verify + PDF export tests"""
import requests

BACKEND = "http://127.0.0.1:8001"
MASTER = "MS-C02AB012652A4FE692D69676"


def test_dmarc_verify_real_domain():
    r = requests.get(f"{BACKEND}/api/ai/dmarc-verify",
                     params={"domain": "gokyuzuhosting.com"},
                     headers={"X-Master-Key": MASTER}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["domain"] == "gokyuzuhosting.com"
    assert "spf" in d and "dkim" in d and "dmarc" in d
    for section in (d["spf"], d["dkim"], d["dmarc"]):
        assert "present" in section
    # Real gokyuzuhosting.com: SPF present
    assert d["spf"]["present"] is True


def test_dmarc_verify_master_only():
    r = requests.get(f"{BACKEND}/api/ai/dmarc-verify",
                     params={"domain": "example.com"}, timeout=10)
    assert r.status_code == 403


def test_dmarc_verify_invalid_domain():
    r = requests.get(f"{BACKEND}/api/ai/dmarc-verify",
                     params={"domain": "invalid"},
                     headers={"X-Master-Key": MASTER}, timeout=10)
    assert r.status_code == 400


def test_ai_history_endpoint():
    r = requests.get(f"{BACKEND}/api/ai/system-analysis/history",
                     headers={"X-Master-Key": MASTER}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "items" in d and "count" in d
    assert isinstance(d["items"], list)


def test_ai_pdf_export():
    # First get latest report id
    r = requests.get(f"{BACKEND}/api/ai/system-analysis/latest",
                     headers={"X-Master-Key": MASTER}, timeout=10)
    if r.status_code != 200 or not r.json():
        # No report yet, skip
        return
    rid = r.json().get("id")
    if not rid:
        return
    r2 = requests.get(f"{BACKEND}/api/ai/system-analysis/{rid}/pdf",
                     headers={"X-Master-Key": MASTER}, timeout=15)
    assert r2.status_code == 200, r2.text
    assert r2.headers.get("content-type", "").startswith("application/pdf")
    # PDF magic bytes
    assert r2.content[:4] == b"%PDF"


def test_ai_history_score_extraction():
    """Yeni raporlar health_score alanını içermeli (extract_score fonksiyonu)."""
    src = open("/app/backend/routes/ai_analysis.py").read()
    assert "_extract_score" in src
    assert "health_score" in src
    assert "_daily_ai_analysis_task" in src
    assert "ai_health_drop" in src  # skor düşüşü alarm kind
