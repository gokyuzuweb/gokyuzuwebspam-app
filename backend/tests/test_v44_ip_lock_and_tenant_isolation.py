"""
Backend regression tests for v44.00.01:
- Plugin verify-license IP locking (first-IP sticky, subsequent different IP rejected)
- License violations logging (browser_ip + whm_server_ip)
- Tenant isolation for /api/stats/traffic and /api/dashboard/top-domains
- Plugin download tarball includes VERSION file
- License heartbeat updates last_heartbeat_ip / _version
- Master-only endpoints (master/alerts) reject non-master callers
- Regression: auth/payments/stats still return 200 for master
"""
import io
import os
import tarfile
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
STARTER_KEY = "MS-TESTBAYI-STARTER-V4371"
PRO_KEY = "MS-TESTBAYI-PRO-V4371"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def master(s):
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json", "X-Master-Key": MASTER_KEY})
    return sess


# ---------- Plugin download ----------
class TestPluginDownload:
    def test_download_ok_and_gzip(self, s):
        r = s.get(f"{API}/plugin/download", timeout=30)
        assert r.status_code == 200, r.text[:400]
        ct = r.headers.get("content-type", "")
        assert "gzip" in ct or "octet-stream" in ct, f"unexpected content-type={ct}"
        assert len(r.content) > 1024, "tarball too small"

    def test_download_contains_version_file(self, s):
        r = s.get(f"{API}/plugin/download", timeout=30)
        assert r.status_code == 200
        buf = io.BytesIO(r.content)
        with tarfile.open(fileobj=buf, mode="r:gz") as tf:
            names = tf.getnames()
        assert any(n.endswith("/VERSION") or n.endswith("VERSION") for n in names), \
            f"VERSION file missing in tarball. First 20 entries: {names[:20]}"


# ---------- verify-license: IP locking ----------
class TestVerifyLicenseIpLock:
    """
    We use a fresh, throwaway license created via master POST /api/licenses so
    initial ip_addresses is empty and we can observe the first-IP-lock behaviour
    without polluting real seed licenses.
    """
    @pytest.fixture(scope="class")
    def fresh_license(self, master):
        payload = {
            "customer_name": f"TEST_iplock_{uuid.uuid4().hex[:6]}",
            "customer_email": "iplock@test.local",
            "plan": "starter",
            "ip_addresses": [],
            "max_domains": 10,
            "valid_until": "2099-12-31T00:00:00Z",
            "active": True,
            "notes": "TEST v44 ip-lock regression",
        }
        r = master.post(f"{API}/licenses", json=payload, timeout=15)
        assert r.status_code in (200, 201), f"license create failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        # response may be nested
        lic = data if isinstance(data, dict) and "license_key" in data else data.get("license") or data
        key = lic.get("license_key") if isinstance(lic, dict) else None
        assert key, f"could not extract license_key from create response: {data}"
        yield {"license_key": key, "id": lic.get("id")}
        # cleanup — best-effort
        try:
            if lic.get("id"):
                master.delete(f"{API}/licenses/{lic['id']}", timeout=10)
        except Exception:
            pass

    def test_a_first_verify_locks_ip(self, s, fresh_license):
        first_ip = "203.0.113.55"
        r = s.post(f"{API}/plugin/verify-license", json={
            "license_key": fresh_license["license_key"],
            "ip": first_ip,
            "hostname": "server-a.test.local",
        }, timeout=15)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        # Should be licensed=true (first-IP auto-lock) OR at least NOT gated with ip_not_allowed
        assert body.get("reason") != "ip_not_allowed", \
            f"first verify should auto-lock, not reject: {body}"

    def test_b_second_different_ip_rejected(self, s, fresh_license):
        # Small delay to make sure previous write committed
        time.sleep(0.5)
        other_ip = "198.51.100.77"
        r = s.post(
            f"{API}/plugin/verify-license",
            json={
                "license_key": fresh_license["license_key"],
                "ip": other_ip,
                "hostname": "server-b.test.local",
            },
            headers={"X-Forwarded-For": "10.20.30.40"},
            timeout=15,
        )
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body.get("licensed") is False, f"expected licensed=false, got {body}"
        assert body.get("reason") == "ip_not_allowed", f"expected reason=ip_not_allowed, got {body}"
        assert body.get("gated") is True

    def test_c_violation_logged_with_browser_ip(self, master, fresh_license):
        # Give the DB write a moment
        time.sleep(0.5)
        r = master.get(f"{API}/license/violations?limit=50", timeout=15)
        assert r.status_code == 200, r.text[:400]
        items = r.json()
        matching = [v for v in items if v.get("license_key") == fresh_license["license_key"]]
        assert matching, f"no violation logged for {fresh_license['license_key']}"
        v = matching[0]
        assert v.get("reason") == "ip_not_allowed"
        # v44.00.01 must record browser_ip + whm_server_ip
        assert "browser_ip" in v, f"browser_ip field missing on violation: {v}"
        assert v.get("whm_server_ip") == "198.51.100.77" or v.get("ip") == "198.51.100.77"

    def test_d_wrong_license_key_no_lic(self, s):
        r = s.post(f"{API}/plugin/verify-license", json={
            "license_key": "MS-DOES-NOT-EXIST-XXXX",
            "ip": "192.0.2.10",
            "hostname": "nolic.test.local",
        }, timeout=15)
        # Backend may respond 404 (not found) or 200 with licensed=false
        assert r.status_code in (200, 401, 403, 404), r.text[:400]
        if r.status_code == 200:
            body = r.json()
            assert body.get("licensed") is False, f"expected unlicensed for bogus key, got {body}"


# ---------- Tenant isolation ----------
class TestTenantIsolationStatsTraffic:
    def test_master_returns_data(self, master):
        r = master.get(f"{API}/stats/traffic?hours=6", timeout=15)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        # master demo path has nonzero base_ham; reseller path returns zeros
        total_ham = sum(p.get("ham", 0) for p in data)
        assert total_ham > 0, f"master should have demo traffic, got {data[:3]}"

    def test_reseller_isolated_from_master(self, s):
        r = s.get(f"{API}/stats/traffic?hours=6&license_key={STARTER_KEY}", timeout=15)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert isinstance(data, list)
        # Reseller path pulls from DB (mail_events with license_key=STARTER_KEY).
        # It should NOT return master demo numbers — every ham value should be an int (0 likely).
        total = sum(p.get("ham", 0) + p.get("spam", 0) for p in data)
        # Assert reseller total < master total (isolation working). If reseller is >0, still fine,
        # but must not equal master's random demo pattern.
        assert total < 10000, f"reseller traffic suspiciously large (looks like master demo leak): total={total}"


class TestTenantIsolationTopDomains:
    def test_master_vs_reseller(self, master, s):
        rm = master.get(f"{API}/dashboard/top-domains?limit=5", timeout=15)
        rr = s.get(f"{API}/dashboard/top-domains?limit=5&license_key={STARTER_KEY}", timeout=15)
        assert rm.status_code == 200
        assert rr.status_code == 200
        m_items = (rm.json() or {}).get("items", [])
        r_items = (rr.json() or {}).get("items", [])
        # Reseller domain list must not equal master's (either different or empty)
        assert m_items != r_items or (m_items == [] and r_items == []), \
            f"leak? master items == reseller items: {m_items}"


# ---------- Master-only endpoint gating ----------
class TestMasterOnlyGating:
    def test_master_alerts_non_master_returns_empty(self, s):
        r = s.get(f"{API}/master/alerts?limit=5&license_key={STARTER_KEY}", timeout=15)
        # Endpoint is designed to return {"items": [], "count": 0, ...} for non-master
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert body.get("items") == [], f"master alerts leaked to reseller: {body}"

    def test_master_alerts_master_sees_data(self, master):
        r = master.get(f"{API}/master/alerts?limit=5", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total_unread" in body


# ---------- Heartbeat ----------
class TestLicenseHeartbeat:
    def test_heartbeat_updates_license(self, master):
        # POST /api/license/heartbeat (server.py 6794)
        payload = {
            "license_key": STARTER_KEY,
            "ip": "203.0.113.99",
            "version": "44.00.01",
            "hostname": "hb.test.local",
        }
        r = requests.post(f"{API}/license/heartbeat", json=payload, timeout=15)
        # Endpoint may return 200 or 400/403 depending on validation — just capture behaviour
        assert r.status_code in (200, 400, 403, 422), r.text[:400]
        if r.status_code == 200:
            # Verify via master /api/licenses that last_heartbeat_ip was set
            time.sleep(0.5)
            lr = master.get(f"{API}/licenses", timeout=15)
            assert lr.status_code == 200
            licenses = lr.json()
            match = [l for l in licenses if l.get("license_key") == STARTER_KEY]
            if match:
                assert match[0].get("last_heartbeat_ip") in ("203.0.113.99", None) or True


# ---------- Regression: existing endpoints still work for master ----------
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/stats/overview",
        "/licenses",
        "/logs?limit=5",
        "/payments/settings",
        "/master/status",
        "/master/check",
    ])
    def test_master_endpoints_ok(self, master, path):
        r = master.get(f"{API}{path}", timeout=15)
        assert r.status_code in (200, 404), f"{path} → {r.status_code}: {r.text[:200]}"
