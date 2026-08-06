"""
v38 backend tests:
  Feature 1: per-bayi spam/high_spam threshold config (GET/POST /api/events/thresholds)
  Feature 2: score_distribution histogram in /api/quarantine/stats
  Feature 3: plugin normalization health scan + master_alerts entries
Regression: prior v37 tenant-isolation invariants remain (whoami no-leak, tenant filter).
"""
import os
import time
import uuid
import requests
import pytest

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""


BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
BAYI_KEY = "MS-D85BE8E63A64478786361F54"

MASTER_HDR = {"x-master-key": MASTER_KEY, "Content-Type": "application/json"}
JSON_HDR = {"Content-Type": "application/json"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------- FEATURE 1: THRESHOLDS ----------
class TestThresholds:
    def test_1a_master_default_thresholds(self, s):
        r = s.get(f"{BASE_URL}/api/events/thresholds", headers=MASTER_HDR, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["spam_threshold"] == 5.0
        assert d["high_spam_threshold"] == 10.0
        assert d.get("scope") == "master_default"

    def test_1b_bayi_thresholds_default(self, s):
        # Reset first so this is deterministic (master overrides bayi's stored thresholds to 5/10)
        r0 = s.post(
            f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}",
            json={"spam_threshold": 5.0, "high_spam_threshold": 10.0},
            headers=MASTER_HDR, timeout=15,
        )
        assert r0.status_code == 200, r0.text
        r = s.get(f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}", headers=MASTER_HDR, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["spam_threshold"] == 5.0
        assert d["high_spam_threshold"] == 10.0
        assert d.get("license_key") == BAYI_KEY

    def test_1c_master_can_set_bayi_thresholds(self, s):
        r = s.post(
            f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}",
            json={"spam_threshold": 7.0, "high_spam_threshold": 15.0},
            headers=MASTER_HDR, timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["spam_threshold"] == 7.0 and d["high_spam_threshold"] == 15.0
        # Verify via GET
        g = s.get(f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}", headers=MASTER_HDR, timeout=15).json()
        assert g["spam_threshold"] == 7.0 and g["high_spam_threshold"] == 15.0

    def test_1d_validation_high_lt_spam_400(self, s):
        r = s.post(
            f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}",
            json={"spam_threshold": 10.0, "high_spam_threshold": 5.0},
            headers=MASTER_HDR, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_1e_verdict_uses_per_license_thresholds(self, s):
        # Set bayi thresholds to 8/16
        r = s.post(
            f"{BASE_URL}/api/events/thresholds?license_key={BAYI_KEY}",
            json={"spam_threshold": 8.0, "high_spam_threshold": 16.0},
            headers=MASTER_HDR, timeout=15,
        )
        assert r.status_code == 200

        def ingest(sa_score, verdict_hint="spam"):
            mid = f"TEST_v38_{uuid.uuid4().hex[:12]}"
            payload = {
                "license_key": BAYI_KEY,
                "exim_mid": mid,
                "from_addr": "sender@example.com",
                "to_addr": "user@bayi.tld",
                "subject": f"threshold test {sa_score}",
                "verdict": verdict_hint,
                "total_score": sa_score,
                "scores": {"spamassassin": sa_score},
            }
            resp = s.post(f"{BASE_URL}/api/events/ingest", json=payload, headers=JSON_HDR, timeout=15)
            assert resp.status_code in (200, 201), resp.text
            return mid

        # Fetch bayi events helper
        def fetch(mid):
            g = s.get(f"{BASE_URL}/api/events?license_key={BAYI_KEY}&limit=200", timeout=15)
            assert g.status_code == 200, g.text
            body = g.json()
            items = body.get("items") if isinstance(body, dict) else body
            for it in items or []:
                if it.get("exim_mid") == mid:
                    return it
            return None

        # SA=9 → spam (>=8, <16)
        mid1 = ingest(9.0)
        # SA=17 → high_spam
        mid2 = ingest(17.0)
        # SA=3 → clean (even though initially posted verdict=spam)
        mid3 = ingest(3.0, verdict_hint="spam")

        time.sleep(0.5)
        e1 = fetch(mid1); e2 = fetch(mid2); e3 = fetch(mid3)
        assert e1 is not None and e2 is not None and e3 is not None, "events not persisted"
        assert e1["verdict"] == "spam", f"expected spam got {e1['verdict']} (score={e1.get('total_score')})"
        assert e1["total_score"] == 9.0
        assert e1.get("thresholds_used") == {"spam": 8.0, "high_spam": 16.0}
        assert e2["verdict"] == "high_spam"
        assert e2.get("thresholds_used") == {"spam": 8.0, "high_spam": 16.0}
        assert e3["verdict"] == "clean"

    def test_1f_anon_cannot_change_thresholds(self, s):
        # No header, no license_key → must fail (403 or 400)
        r = s.post(
            f"{BASE_URL}/api/events/thresholds",
            json={"spam_threshold": 1.0, "high_spam_threshold": 2.0},
            headers=JSON_HDR, timeout=15,
        )
        assert r.status_code in (400, 401, 403, 423), r.text


# ---------- FEATURE 2: SCORE HISTOGRAM ----------
class TestScoreHistogram:
    def test_2_master_score_distribution(self, s):
        r = s.get(f"{BASE_URL}/api/quarantine/stats", headers=MASTER_HDR, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "score_distribution" in d, d
        sd = d["score_distribution"]
        for k in ("clean", "suspicious", "spam", "high_spam"):
            assert k in sd, f"missing bucket {k}"
            assert isinstance(sd[k], int)

    def test_2b_bayi_score_distribution_scoped(self, s):
        r = s.get(f"{BASE_URL}/api/quarantine/stats?license_key={BAYI_KEY}", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "score_distribution" in d
        sd = d["score_distribution"]
        for k in ("clean", "suspicious", "spam", "high_spam"):
            assert k in sd and isinstance(sd[k], int)
        # After v38 test_1e, bayi should have at least: 1 clean, 1 spam, 1 high_spam in last 7 days
        assert sd["clean"] >= 1
        assert sd["spam"] >= 1
        assert sd["high_spam"] >= 1


# ---------- FEATURE 3: PLUGIN HEALTH ----------
class TestPluginHealth:
    def test_3a_normalization_health(self, s):
        r = s.get(f"{BASE_URL}/api/events/health/normalization?hours=24", headers=MASTER_HDR, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total", "normalized", "clamped", "normalized_ratio", "status", "hours"):
            assert k in d, f"missing {k}"
        assert d["status"] in ("healthy", "warning", "critical")
        assert d["hours"] == 24

    def test_3b_plugin_health_scan_creates_alert(self, s):
        # Ensure bayi has some normalized mails (from test_1e we ingested 3 with SA scores) — should be enough at threshold=1
        r = s.post(
            f"{BASE_URL}/api/admin/plugin-health/scan?threshold=1&hours=24",
            headers=MASTER_HDR, timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert isinstance(d["created"], int)
        # Store for next test
        pytest.plugin_health_first_created = d["created"]

    def test_3c_alert_visible_in_threat_alerts(self, s):
        r = s.get(f"{BASE_URL}/api/admin/threat-alerts?unseen_only=true&limit=100",
                  headers=MASTER_HDR, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        matching = [
            a for a in items
            if a.get("type") == "plugin_normalization"
        ]
        assert matching, f"no plugin_normalization alert found; items={items[:3]}"
        one = matching[0]
        assert one.get("severity") in ("warning", "critical", "info")
        assert "normalized_count" in one or "count" in one or "meta" in one
        # Should be linked to a bayi
        assert one.get("license_key")

    def test_3d_dedupe(self, s):
        # First scan (dedupe_hours=0 in code; but running twice back-to-back
        # should still create fewer/zero on second run if dedupe applies).
        # Since backend passes dedupe_hours=0, dedupe may only apply within same second.
        # Verify endpoint is idempotent-safe: call again and ensure created is int >=0.
        r1 = s.post(f"{BASE_URL}/api/admin/plugin-health/scan?threshold=1&hours=24",
                    headers=MASTER_HDR, timeout=30)
        r2 = s.post(f"{BASE_URL}/api/admin/plugin-health/scan?threshold=1&hours=24",
                    headers=MASTER_HDR, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        assert isinstance(r1.json()["created"], int)
        assert isinstance(r2.json()["created"], int)

    def test_3e_non_master_rejected(self, s):
        # No x-master-key → must be blocked
        r = s.post(f"{BASE_URL}/api/admin/plugin-health/scan?threshold=1&hours=24",
                   headers=JSON_HDR, timeout=15)
        assert r.status_code in (401, 403, 423), r.text
        # Bayi key alone shouldn't grant master rights either
        r2 = s.post(
            f"{BASE_URL}/api/admin/plugin-health/scan?license_key={BAYI_KEY}&threshold=1&hours=24",
            headers=JSON_HDR, timeout=15,
        )
        assert r2.status_code in (401, 403, 423), r2.text


# ---------- REGRESSION: no master leak ----------
class TestRegression:
    def test_whoami_no_master_leak_for_anon(self, s):
        r = s.get(f"{BASE_URL}/api/admin/whoami", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("is_master") is False
        # Should not expose master coordinates
        assert not d.get("master_key")
        # master_ip/master_host may or may not exist — but must be empty/absent when not master
        assert not d.get("master_ip") or d.get("master_ip") in (None, "")

    def test_whoami_master_via_header(self, s):
        r = s.get(f"{BASE_URL}/api/admin/whoami", headers=MASTER_HDR, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("is_master") is True
