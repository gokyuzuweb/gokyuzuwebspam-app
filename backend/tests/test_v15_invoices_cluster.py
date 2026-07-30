"""
Iteration 5 (v1.5) tests: Reseller invoices + PDF, License-server cluster v2 (redis + round-robin + failover).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
LS1 = "http://localhost:8002"
LS2 = "http://localhost:8003"
RESELLER_EMAIL = "reseller@test.com"
RESELLER_PASS = "strong123"


@pytest.fixture(scope="module")
def reseller_token():
    r = requests.post(f"{BASE_URL}/api/reseller/auth/login",
                      json={"email": RESELLER_EMAIL, "password": RESELLER_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(reseller_token):
    return {"Authorization": f"Bearer {reseller_token}"}


# --------------------------- Invoices ---------------------------
class TestInvoices:
    def test_list_invoices(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/invoices", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "invoices" in data and "total_paid" in data and "currency" in data and "count" in data
        assert data["count"] >= 3, f"expected >=3 seeded invoices, got {data['count']}"
        for inv in data["invoices"]:
            assert inv["invoice_number"].startswith("INV-")
            parts = inv["invoice_number"].split("-")
            assert len(parts) == 3 and len(parts[1]) == 6 and len(parts[2]) == 5
        # cache for later tests
        pytest.tx_id = data["invoices"][0]["id"]

    def test_get_single_invoice(self, auth_headers):
        tx_id = getattr(pytest, "tx_id", None)
        assert tx_id
        r = requests.get(f"{BASE_URL}/api/reseller/invoices/{tx_id}", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("id") == tx_id
        assert j.get("invoice_number", "").startswith("INV-")

    def test_pdf_download(self, auth_headers):
        tx_id = getattr(pytest, "tx_id", None)
        assert tx_id
        r = requests.get(f"{BASE_URL}/api/reseller/invoices/{tx_id}/pdf", headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert len(r.content) > 2048
        assert r.content[:4] == b"%PDF"

    def test_pdf_other_reseller_tx_returns_404(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/invoices/nonexistent-tx-id-xxx/pdf",
                         headers=auth_headers, timeout=15)
        assert r.status_code == 404

    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/reseller/invoices", timeout=10)
        assert r.status_code in (401, 403)


# --------------------------- License Server v2 ---------------------------
class TestLicenseServerV2:
    def test_primary_health(self):
        r = requests.get(f"{LS1}/v1/health", timeout=5)
        assert r.status_code == 200
        j = r.json()
        assert j["version"] == "2.0.0"
        assert j["replica_id"] == "license-primary-8002"
        assert j["redis"]["connected"] is True

    def test_secondary_health(self):
        r = requests.get(f"{LS2}/v1/health", timeout=5)
        assert r.status_code == 200
        j = r.json()
        assert j["version"] == "2.0.0"
        assert j["replica_id"] == "license-secondary-8003"
        assert j["redis"]["connected"] is True

    def test_cluster_view(self):
        r = requests.get(f"{LS1}/v2/cluster/health", timeout=5)
        assert r.status_code == 200
        j = r.json()
        ids = {rep["replica_id"] for rep in j.get("replicas", [])}
        assert "license-primary-8002" in ids
        assert "license-secondary-8003" in ids
        assert j.get("cluster_size", 0) >= 2

    def test_upstream_health_proxy(self):
        r = requests.get(f"{BASE_URL}/api/license-server/health", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["healthy_count"] == 2
        assert j["total_replicas"] == 2
        assert j.get("cluster") is not None

    def test_round_robin(self):
        # Force different server_ips to bypass cache
        seen = []
        for i in range(4):
            r = requests.post(f"{BASE_URL}/api/license-server/verify",
                              json={"license_key": "MS-435EA62E57A442BBB10985E9",
                                    "server_ip": f"203.0.113.{100+i}"}, timeout=10)
            assert r.status_code == 200, r.text
            j = r.json()
            seen.append(j.get("replica_id"))
        # Expect both replicas to appear across 4 calls
        assert "license-primary-8002" in seen and "license-secondary-8003" in seen, f"replicas seen: {seen}"

    def test_redis_cache_hit(self):
        payload = {"license_key": "MS-435EA62E57A442BBB10985E9", "server_ip": "198.51.100.42"}
        # 1st call (may or may not hit cache from earlier tests)
        requests.post(f"{BASE_URL}/api/license-server/verify", json=payload, timeout=10)
        # 2nd call
        r2 = requests.post(f"{BASE_URL}/api/license-server/verify", json=payload, timeout=10)
        assert r2.status_code == 200
        j2 = r2.json()
        assert "cache_hit" in j2, f"response missing cache_hit field: {j2}"
        assert j2["cache_hit"] is True

    def test_failover_primary_down(self):
        # Stop primary
        os.system("sudo supervisorctl stop license-server-1 > /dev/null 2>&1")
        try:
            time.sleep(1.5)
            # Try several times with varying IPs to bypass cache
            replica_ids = []
            for i in range(3):
                r = requests.post(f"{BASE_URL}/api/license-server/verify",
                                  json={"license_key": "MS-435EA62E57A442BBB10985E9",
                                        "server_ip": f"203.0.113.{50+i}"}, timeout=15)
                assert r.status_code == 200, r.text
                replica_ids.append(r.json().get("replica_id"))
            assert all(rid == "license-secondary-8003" for rid in replica_ids), replica_ids
        finally:
            os.system("sudo supervisorctl start license-server-1 > /dev/null 2>&1")
            time.sleep(2)

    def test_primary_back_online(self):
        # Wait for primary to be back
        for _ in range(10):
            try:
                if requests.get(f"{LS1}/v1/health", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(1)
        r = requests.get(f"{LS1}/v1/health", timeout=5)
        assert r.status_code == 200


# --------------------------- Regression ---------------------------
class TestRegression:
    def test_mrr(self):
        r = requests.get(f"{BASE_URL}/api/analytics/mrr", timeout=10)
        assert r.status_code == 200
        assert "mrr" in r.json()

    def test_plugin_install_info(self):
        r = requests.get(f"{BASE_URL}/api/plugin/install-info", timeout=10)
        assert r.status_code == 200

    def test_plugin_download(self):
        r = requests.get(f"{BASE_URL}/api/plugin/download", timeout=15)
        assert r.status_code == 200
        assert len(r.content) > 500

    def test_reseller_me(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/me", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("email") == RESELLER_EMAIL

    def test_reseller_subaccounts(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/subaccounts", headers=auth_headers, timeout=10)
        assert r.status_code == 200

    def test_reseller_quarantine(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/quarantine", headers=auth_headers, timeout=10)
        assert r.status_code == 200
