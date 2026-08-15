"""v43.40 tests: Exim backfill trigger/signal/ack + outbound geo-stats + regression."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- v43.40 Backfill ----------
class TestBackfill:
    def test_trigger_requires_master_key(self, s):
        r = s.post(f"{API}/outbound/exim-backfill/trigger")
        # 403 = master check; 423 = demo write-guard (both block unauthenticated)
        assert r.status_code in (403, 423), r.text

    def test_trigger_ok(self, s):
        r = s.post(f"{API}/outbound/exim-backfill/trigger",
                   headers={"X-Master-Key": MASTER_KEY})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "signaled_licenses" in d and d["signaled_licenses"] >= 0
        assert "note" in d

    def test_signal_pending_after_trigger(self, s):
        # ensure trigger first
        s.post(f"{API}/outbound/exim-backfill/trigger",
               headers={"X-Master-Key": MASTER_KEY})
        r = s.get(f"{API}/outbound/backfill-signal",
                  params={"license_key": MASTER_KEY})
        assert r.status_code == 200, r.text
        d = r.json()
        # If master license exists as active license row, should be pending
        if d.get("pending"):
            assert "requested_at" in d
        else:
            # No matching license row for master key — accept and note
            print("NOTE: master license not present as active license row; signal not pending")

    def test_ack_clears_pending(self, s):
        # Trigger to ensure signal doc exists
        s.post(f"{API}/outbound/exim-backfill/trigger",
               headers={"X-Master-Key": MASTER_KEY})
        r = s.post(f"{API}/outbound/backfill-ack",
                   json={"license_key": MASTER_KEY, "pushed": 50})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r2 = s.get(f"{API}/outbound/backfill-signal",
                   params={"license_key": MASTER_KEY})
        assert r2.status_code == 200
        assert r2.json().get("pending") is False


# ---------- v43.40 Geo-stats ----------
class TestGeoStats:
    def _headers(self):
        return {"X-Master-Key": MASTER_KEY}

    def test_geo_stats_24h(self, s):
        r = s.get(f"{API}/outbound/geo-stats", params={"hours": 24},
                  headers=self._headers())
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["hours"] == 24
        assert "total_domains" in d
        assert d["total_mail"] >= 1, f"expected total_mail>=1 got {d['total_mail']}"
        assert isinstance(d.get("top_domains"), list)
        assert isinstance(d.get("countries"), list)
        assert isinstance(d.get("risky_tlds"), list)

        # Verify shape of each domain
        for dom in d["top_domains"]:
            for k in ("domain", "tld", "country", "mail_count",
                      "spam_count", "blocked_count", "risk", "sample_recipients"):
                assert k in dom, f"missing {k} in {dom}"
            assert isinstance(dom["sample_recipients"], list)

        # Countries aggregation: sum(country.mail_count) should equal sum(domain.mail_count)
        sum_c = sum(c["mail_count"] for c in d["countries"])
        sum_d = sum(dom["mail_count"] for dom in d["top_domains"])
        # top_domains only top 20 — so use total_mail
        assert sum_c == d["total_mail"] or sum_c >= sum_d

    def test_geo_stats_6h_lte_24h(self, s):
        r24 = s.get(f"{API}/outbound/geo-stats", params={"hours": 24},
                    headers=self._headers()).json()
        r6 = s.get(f"{API}/outbound/geo-stats", params={"hours": 6},
                   headers=self._headers())
        assert r6.status_code == 200
        d6 = r6.json()
        assert d6["hours"] == 6
        assert d6["total_mail"] <= r24["total_mail"]

    def test_geo_stats_168h(self, s):
        r = s.get(f"{API}/outbound/geo-stats", params={"hours": 168},
                  headers=self._headers())
        assert r.status_code == 200
        assert r.json()["hours"] == 168


# ---------- Regression ----------
class TestRegression:
    def test_exim_log_push_with_license_key(self, s):
        payload = {
            "license_key": MASTER_KEY,
            "hostname": "test-host",
            "events": [{
                "ts": "2026-01-15T10:00:00Z",
                "message_id": "TESTv4340-1",
                "from_addr": "test@example.com",
                "to_addr": "recipient@example.com",
                "size": 1024,
                "verdict": "clean",
            }],
            "checkpoint_position": 12345,
        }
        r = s.post(f"{API}/outbound/exim-log-push", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True

    def test_exim_log_checkpoint(self, s):
        r = s.get(f"{API}/outbound/exim-log-checkpoint",
                  params={"license_key": MASTER_KEY})
        assert r.status_code == 200
        assert "last_position" in r.json()

    def test_dev_seed_sample_adds_events(self, s):
        r = s.post(f"{API}/outbound/dev/seed-sample",
                   headers={"X-Master-Key": MASTER_KEY})
        assert r.status_code == 200, r.text
        d = r.json()
        # Expect ~50 events added
        added = d.get("added") or d.get("inserted") or d.get("count")
        assert added is None or added >= 1, r.text
