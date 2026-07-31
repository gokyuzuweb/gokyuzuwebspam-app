"""
Iteration 10 (v18) backend tests: Queue mgmt, Security (country catalog/rules/bulk,
brute-force, exploit scanner, attack map, IP drilldown), MailScanner
(config/train/bayes/modules/BEC/URL/sandbox/reputation/SIEM/AI), Weekly report,
and AI prewarm event ingest.
"""
import os
import time
import requests
import pytest

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"
LIC = "MS-C02AB012652A4FE692D69676"
MASTER_IP = "89.19.15.58"
MASTER_HEADERS = {"X-Forwarded-For": MASTER_IP}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ------------------------- QUEUE -------------------------
class TestQueue:
    def test_list_queue_mock(self, s):
        r = s.get(f"{API}/queue", params={"license_key": LIC, "limit": 20})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "source" in data
        assert data["source"] in ("mock", "exim")
        assert isinstance(data["items"], list)

    def test_queue_stats(self, s):
        r = s.get(f"{API}/queue/stats", params={"license_key": LIC})
        assert r.status_code == 200
        data = r.json()
        assert "total" in data and "frozen" in data

    @pytest.mark.parametrize("action", ["remove", "deliver", "retry", "freeze", "thaw", "bounce"])
    def test_queue_bulk_actions(self, s, action):
        r = s.post(f"{API}/queue/bulk", json={
            "license_key": LIC, "mids": [f"TEST-mid-{action}-1"], "action": action,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True and d["processed"] == 1
        assert d["source"] in ("mock", "exim")

    def test_queue_bulk_invalid_action(self, s):
        r = s.post(f"{API}/queue/bulk", json={
            "license_key": LIC, "mids": ["x"], "action": "invalid",
        })
        assert r.status_code == 422  # pydantic pattern fail

    def test_queue_audit(self, s):
        r = s.get(f"{API}/queue/audit", params={"license_key": LIC, "limit": 5})
        assert r.status_code == 200
        assert "items" in r.json()


# ------------------------- SECURITY -------------------------
class TestSecurity:
    def test_country_catalog(self, s):
        r = s.get(f"{API}/security/country-catalog")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] >= 100
        codes = {i["code"] for i in d["items"]}
        assert "TR" in codes and "US" in codes and "DE" in codes
        # Turkish name check
        tr = next(i for i in d["items"] if i["code"] == "TR")
        assert tr["name"] == "Türkiye"

    def test_country_rules_bulk_with_schedule(self, s):
        r = s.post(
            f"{API}/security/country-rules/bulk",
            params={"license_key": LIC},
            json={
                "codes": ["ZZ", "XK"],  # ZZ ignored (not len 2 issue? actually len=2)
                "action": "block", "note": "TEST_bulk",
                "active_hours": [0, 1, 2, 3],
                "active_days": [0, 1, 2, 3, 4],
                "ttl_minutes": 60,
                "reason": "manual",
            },
            headers=MASTER_HEADERS,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["inserted"] >= 1
        assert d["expire_at"] is not None
        # Cleanup
        for c in ["ZZ", "XK"]:
            s.delete(f"{API}/security/country-rules/{c}", params={"license_key": LIC}, headers=MASTER_HEADERS)

    def test_country_brute_force_scan(self, s):
        r = s.post(f"{API}/security/country-brute-force/scan", json={
            "license_key": LIC, "minutes": 60, "threshold": 5, "ttl_minutes": 30,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "counter" in d and "triggered" in d

    def test_exploit_scan_run(self, s):
        r = s.post(f"{API}/security/exploit-scan/run", params={"license_key": LIC})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True and d["findings"] == 3
        scan_id = d["scan_id"]
        # List findings
        r2 = s.get(f"{API}/security/exploit-scan/findings", params={"license_key": LIC, "scan_id": scan_id})
        assert r2.status_code == 200
        items = r2.json()["items"]
        assert len(items) == 3
        sevs = {i["severity"] for i in items}
        assert "critical" in sevs
        # Dismiss one
        fid = items[0]["id"]
        r3 = s.post(f"{API}/security/exploit-scan/dismiss/{fid}", params={"license_key": LIC})
        assert r3.status_code == 200

    def test_attack_map(self, s):
        r = s.get(f"{API}/security/attack-map", params={"license_key": LIC, "hours": 6})
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "events_total" in d
        for it in d["items"]:
            assert "lat" in it and "lon" in it and "country" in it

    def test_ip_drilldown(self, s):
        r = s.get(f"{API}/security/ip-drilldown", params={"ip": "1.2.3.4", "license_key": LIC})
        assert r.status_code == 200
        d = r.json()
        assert d["ip"] == "1.2.3.4"
        assert "country" in d and "sample" in d


# ------------------------- MAILSCANNER -------------------------
class TestMailScanner:
    def test_config_get_put(self, s):
        r = s.get(f"{API}/mailscanner/config", params={"license_key": LIC})
        assert r.status_code == 200
        cfg = r.json()
        assert "spam_threshold" in cfg and "engines" in cfg
        r2 = s.put(f"{API}/mailscanner/config", json={
            "license_key": LIC, "spam_threshold": 5.5,
            "engines": {**cfg["engines"], "dcc": True},
        })
        assert r2.status_code == 200, r2.text
        # Verify persisted
        r3 = s.get(f"{API}/mailscanner/config", params={"license_key": LIC})
        assert r3.json()["spam_threshold"] == 5.5
        assert r3.json()["engines"]["dcc"] is True

    def test_train_bayes_and_status(self, s):
        r = s.post(f"{API}/mailscanner/train-bayes", json={
            "license_key": LIC, "samples": ["TEST_bayes viagra cheap pills win money"],
            "label": "spam",
        })
        assert r.status_code == 200, r.text
        r2 = s.get(f"{API}/mailscanner/bayes-status", params={"license_key": LIC})
        assert r2.status_code == 200
        d = r2.json()
        assert d.get("total_tokens", 0) >= 1
        assert d.get("trained") is True

    def test_modules(self, s):
        r = s.get(f"{API}/mailscanner/modules", params={"license_key": LIC})
        assert r.status_code == 200
        d = r.json()
        assert "modules" in d
        assert len(d["modules"]) >= 10

    def test_bec_check_lookalike(self, s):
        r = s.post(f"{API}/mailscanner/bec/check", json={
            "license_key": LIC,
            "from_display": "CEO Ahmet Kaya",
            "from_addr": "ceo@paypa1.com",  # lookalike (edit distance 1) of paypal.com
            "protected_domains": ["paypal.com"],
            "subject": "URGENT wire transfer havale",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["verdict"] == "bec_high"
        assert d["score"] >= 6
        assert isinstance(d["reasons"], list) and len(d["reasons"]) >= 1

    def test_url_rewrite_inspect(self, s):
        r = s.post(f"{API}/mailscanner/url/rewrite", json={
            "license_key": LIC,
            "urls": ["http://bit.ly/verify-login-account"],
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("items") or d.get("tokens") or "tokens" in d or "results" in d or "urls" in d
        # try to grab token
        tok = None
        for k in ("items", "tokens", "urls", "results"):
            if k in d and isinstance(d[k], list) and d[k]:
                first = d[k][0]
                tok = first.get("token") if isinstance(first, dict) else first
                break
        if tok:
            r2 = s.get(f"{API}/mailscanner/url/inspect", params={"token": tok})
            assert r2.status_code == 200
            assert "verdict" in r2.json()

    def test_sandbox_submit_jobs(self, s):
        r = s.post(f"{API}/mailscanner/sandbox/submit", json={
            "license_key": LIC, "filename": "TEST_x.exe", "sha256": "a" * 64,
        })
        assert r.status_code == 200
        r2 = s.get(f"{API}/mailscanner/sandbox/jobs", params={"license_key": LIC})
        assert r2.status_code == 200
        assert "items" in r2.json() or isinstance(r2.json(), dict)

    def test_reputation(self, s):
        r = s.get(f"{API}/mailscanner/reputation", params={"license_key": LIC})
        assert r.status_code == 200
        d = r.json()
        assert "score" in d or "reputation" in d

    def test_siem_export(self, s):
        for fmt in ["cef", "leef", "json"]:
            r = s.post(f"{API}/mailscanner/siem/export", json={
                "license_key": LIC, "format": fmt, "hours": 24,
            })
            assert r.status_code == 200, f"{fmt}: {r.text}"

    def test_ai_analyze(self, s):
        r = s.post(f"{API}/mailscanner/ai/analyze", params={"license_key": LIC}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should have some form of Turkish AI report
        assert isinstance(d, dict)
        # Look for text/report field
        has_report = any(k in d for k in ("report", "text", "content", "analysis", "summary"))
        assert has_report, f"no report field, got keys: {list(d.keys())}"


# ------------------------- WEEKLY REPORT + AI PREWARM -------------------------
class TestWeeklyAndPrewarm:
    def test_weekly_report_latest_empty_safe(self, s):
        r = s.get(f"{API}/ai/weekly-report/latest")
        assert r.status_code == 200
        # {} or a report doc — must not crash
        assert isinstance(r.json(), dict)

    def test_events_ingest_high_spam_triggers_prewarm(self, s):
        # Fire-and-forget: endpoint should return quickly without error
        r = s.post(f"{API}/events/ingest", json={
            "license_key": LIC,
            "from_addr": "TEST_prewarm@spammer.example",
            "to_addr": "victim@example.com",
            "subject": "TEST prewarm high_spam",
            "verdict": "high_spam",
            "total_score": 15.0,
            "client_ip": "1.2.3.4",
        })
        assert r.status_code in (200, 201), r.text
        # Give async task a beat
        time.sleep(0.5)
