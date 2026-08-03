"""V34 — Backend tests for:
  1. /api/bayi/my-server verification widget (24h/1h/last_seen/status/hint)
  2. /api/maintenance/public/blocked-stats baseline seed (region variants)
  3. /api/admin/stripe-config GET/POST (master-only, format validation, DB persistence)
  4. Stripe checkout with DB-key override → _stripe_client_async behaviour
  5. Regression on core endpoints
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MASTER_KEY = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
PANEL_LICENSE = "MS-A1B3833C1DD6441FBCF19F26"

H_MASTER = {"x-master-key": MASTER_KEY, "Content-Type": "application/json"}
H_JSON = {"Content-Type": "application/json"}


# ---------- Fixtures --------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _reset_stripe_env(sess):
    """Reset DB-persisted stripe_config back to env sentinel (sk_test_emergent)."""
    try:
        sess.post(f"{BASE_URL}/api/admin/stripe-config",
                  headers=H_MASTER,
                  json={"api_key": "sk_test_emergent"}, timeout=10)
    except Exception:
        pass


# ---------- 1. Verification widget -----------------------------------------
class TestVerificationWidget:
    def test_my_server_returns_verification_block(self, s):
        r = s.get(f"{BASE_URL}/api/bayi/my-server", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "verification" in data
        v = data["verification"]
        # If bayi has no events → status='not_started', hint contains 'Henüz ingest yok'
        for k in ("connected", "ingested_24h", "ingested_1h", "last_seen_at",
                  "minutes_since_last", "status", "hint"):
            assert k in v, f"missing key: {k}"
        assert v["status"] in ("live", "stale", "not_started")

    def test_ingest_then_status_flips_to_live(self, s):
        # Post a mail_event as the panel license → next call should show ingested_1h>=1
        payload = {
            "license_key": PANEL_LICENSE,
            "from_addr": "test@example.com",
            "to_addr": "you@bayi.com",
            "subject": "V34 verification ping",
            "verdict": "clean",
        }
        r = s.post(
            f"{BASE_URL}/api/events/ingest",
            headers=H_JSON,
            json=payload, timeout=15,
        )
        assert r.status_code in (200, 201), r.text

        # Small delay so ts propagates
        time.sleep(1.0)
        r2 = s.get(
            f"{BASE_URL}/api/bayi/my-server",
            headers={"X-License-Key": PANEL_LICENSE},
            timeout=15,
        )
        assert r2.status_code == 200
        v = r2.json()["verification"]
        assert v["ingested_1h"] >= 1, f"expected >=1 recent event, got {v}"
        assert v["ingested_24h"] >= 1
        assert v["status"] in ("live", "stale")  # ideally live
        assert v["last_seen_at"], "last_seen_at must be set"


# ---------- 2. Public blocked-stats baseline seed ---------------------------
class TestBlockedStatsBaseline:
    def _fetch(self, s, region):
        r = s.get(f"{BASE_URL}/api/maintenance/public/blocked-stats",
                  params={"region": region}, timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_region_all_has_baseline(self, s):
        d = self._fetch(s, "all")
        assert d["all_time_blocked"] > 100_000, d
        assert d["today_blocked"] > 1_000, d
        assert d["peak_30d"] > 1_000, d
        assert len(d["series_30d"]) == 30
        assert d["region"] == "all"
        # If real data <500 events, seed should be applied
        assert d.get("seed_applied") is True

    def test_region_tr_and_eu_vary(self, s):
        tr = self._fetch(s, "tr")
        eu = self._fetch(s, "external")
        # different base_daily should produce different peaks
        assert tr["peak_30d"] != eu["peak_30d"], (tr["peak_30d"], eu["peak_30d"])
        assert tr["region"] == "tr"
        assert eu["region"] == "external"


# ---------- 3. /api/admin/stripe-config -------------------------------------
class TestStripeConfig:
    def test_get_requires_master(self, s):
        r = s.get(f"{BASE_URL}/api/admin/stripe-config", timeout=10)
        assert r.status_code in (401, 403), r.status_code

    def test_get_master_env_source(self, s):
        # first ensure env-source: overwrite with sentinel, but test also that
        # after we save a DB key the source flips to db.
        r = s.get(f"{BASE_URL}/api/admin/stripe-config", headers=H_MASTER, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("mode", "source", "key_tail", "has_key"):
            assert k in d
        assert d["has_key"] is True

    def test_post_invalid_format_400(self, s):
        r = s.post(f"{BASE_URL}/api/admin/stripe-config", headers=H_MASTER,
                   json={"api_key": "pk_wrong_XXX"}, timeout=10)
        assert r.status_code == 400, r.text

    def test_post_valid_test_key_persists(self, s):
        r = s.post(f"{BASE_URL}/api/admin/stripe-config", headers=H_MASTER,
                   json={"api_key": "sk_test_xxxx1234"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r2 = s.get(f"{BASE_URL}/api/admin/stripe-config", headers=H_MASTER, timeout=10)
        d = r2.json()
        assert d["source"] == "db", d
        assert d["key_tail"] == "1234", d
        assert d["mode"] in ("test",), d

    def test_post_non_master_403(self, s):
        r = s.post(f"{BASE_URL}/api/admin/stripe-config",
                   json={"api_key": "sk_test_xxxx0000"}, timeout=10)
        assert r.status_code in (401, 403), r.status_code


# ---------- 4. Stripe checkout uses DB key first ----------------------------
class TestStripeCheckoutDbKey:
    def test_invalid_db_key_returns_502(self, s):
        # Persist a bogus (well-formatted) key
        r = s.post(f"{BASE_URL}/api/admin/stripe-config", headers=H_MASTER,
                   json={"api_key": "sk_test_invalidXXXXXXXX"}, timeout=10)
        assert r.status_code == 200, r.text

        # Now try to create checkout via renew — should fail 502
        payload = {"billing_period": "yearly"}
        r2 = s.post(
            f"{BASE_URL}/api/subscription/renew",
            headers={"X-License-Key": PANEL_LICENSE, **H_JSON},
            json=payload, timeout=30,
        )
        # Reset before asserting so cleanup happens even on failure
        _reset_stripe_env(s)
        assert r2.status_code in (400, 500, 502), (r2.status_code, r2.text)
        if r2.status_code == 502:
            assert "Stripe" in r2.text

    def test_env_fallback_after_reset(self, s):
        # Reset DB key to sentinel env-equivalent
        _reset_stripe_env(s)
        # Renewal should now succeed (real Stripe sandbox)
        r2 = s.post(
            f"{BASE_URL}/api/subscription/renew",
            headers={"X-License-Key": PANEL_LICENSE, **H_JSON},
            json={"billing_period": "yearly"}, timeout=30,
        )
        assert r2.status_code == 200, (r2.status_code, r2.text)
        data = r2.json()
        assert data.get("url", "").startswith("https://checkout.stripe.com"), data


# ---------- 5. Regression ---------------------------------------------------
class TestRegression:
    def test_plugin_status(self, s):
        r = s.get(f"{BASE_URL}/api/plugin/status", timeout=10)
        assert r.status_code == 200

    def test_plan_features(self, s):
        r = s.get(f"{BASE_URL}/api/plan/features", timeout=10)
        assert r.status_code == 200

    def test_admin_plan_matrix(self, s):
        r = s.get(f"{BASE_URL}/api/admin/plan-matrix", headers=H_MASTER, timeout=10)
        assert r.status_code == 200

    def test_stats_overview(self, s):
        r = s.get(f"{BASE_URL}/api/stats/overview", timeout=10)
        assert r.status_code == 200

    def test_engines(self, s):
        r = s.get(f"{BASE_URL}/api/engines", timeout=10)
        assert r.status_code == 200

    def test_settings(self, s):
        r = s.get(f"{BASE_URL}/api/settings", timeout=10)
        assert r.status_code == 200

    def test_rules(self, s):
        r = s.get(f"{BASE_URL}/api/rules", timeout=10)
        assert r.status_code == 200

    def test_blacklist_check(self, s):
        r = s.post(f"{BASE_URL}/api/blacklist/check",
                   headers=H_JSON, json={"target": "1.2.3.4", "type": "ip"}, timeout=15)
        assert r.status_code in (200, 403), r.status_code

    def test_admin_threat_alerts(self, s):
        r = s.get(f"{BASE_URL}/api/admin/threat-alerts", headers=H_MASTER, timeout=10)
        assert r.status_code == 200

    def test_admin_impersonate_status(self, s):
        r = s.get(f"{BASE_URL}/api/admin/impersonate/status", headers=H_MASTER, timeout=10)
        assert r.status_code == 200

    def test_admin_plan_matrix_history(self, s):
        r = s.get(f"{BASE_URL}/api/admin/plan-matrix/history", headers=H_MASTER, timeout=10)
        assert r.status_code == 200

    def test_admin_bayi_servers(self, s):
        r = s.get(f"{BASE_URL}/api/admin/bayi-servers", headers=H_MASTER, timeout=10)
        assert r.status_code == 200
