"""
Iteration 6 (v1.6) — Region naming + multi-lang PDF + deploy artifact tests.
Covers:
  - Region-aware license-server proxy (URL leak prevention)
  - Invoice PDF ?lang=tr|en|de|fr|es (+fallback)
  - Regression on iteration 5 endpoints
  - Deploy files presence
"""
import io
import os
import re
import pytest
import requests
from pathlib import Path
from pypdf import PdfReader


def _pdf_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    return "\n".join((p.extract_text() or "") for p in reader.pages)

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if "REACT_APP_BACKEND_URL" in os.environ else None
# Fallback: read from frontend/.env
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

RESELLER_EMAIL = "reseller@test.com"
RESELLER_PWD = "strong123"


# ---------- fixtures --------------------------------------------------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(api):
    r = api.post(f"{BASE_URL}/api/reseller/auth/login",
                 json={"email": RESELLER_EMAIL, "password": RESELLER_PWD})
    if r.status_code != 200:
        pytest.skip(f"Reseller login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Region naming ---------------------------------------------------
class TestRegionNaming:
    def test_health_regions(self, api):
        r = api.get(f"{BASE_URL}/api/license-server/health")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "regions" in data and isinstance(data["regions"], list)
        assert data["total_regions"] == 2
        assert data["healthy_count"] >= 1
        labels = [x.get("region") for x in data["regions"]]
        assert "Primary EU-West" in labels
        assert "Secondary EU-Central" in labels
        # Verify NO url leakage in regions
        body_str = str(data["regions"])
        assert "localhost" not in body_str
        assert "http://" not in body_str
        assert "8002" not in body_str and "8003" not in body_str
        # Each region entry must have required keys
        for reg in data["regions"]:
            assert "region" in reg
            assert "reachable" in reg
            assert "version" in reg
            assert "redis_connected" in reg
            assert "last_seen" in reg

    def test_config_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/license-server/config")
        assert r.status_code == 200
        data = r.json()
        assert data["regions"] == ["Primary EU-West", "Secondary EU-Central"]
        assert data["total"] == 2
        # No url leakage
        assert "localhost" not in str(data)
        assert "http" not in str(data)

    def test_verify_served_by(self, api):
        r = api.post(f"{BASE_URL}/api/license-server/verify",
                     json={"license_key": "MS-435EA62E57A442BBB10985E9",
                           "server_ip": "1.2.3.4"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "served_by" in data
        assert data["served_by"] in ("Primary EU-West", "Secondary EU-Central", "Region")
        # replica_id must be masked out
        assert "replica_id" not in data


# ---------- Multi-lang PDF --------------------------------------------------
LANGS = {
    "tr": [b"FATURA", b"SATICI"],
    "en": [b"INVOICE", b"SELLER", b"BUYER", b"PAID"],
    "de": [b"RECHNUNG", b"VERK"],   # VERKÄUFER — check prefix
    "fr": [b"FACTURE", b"VENDEUR"],
    "es": [b"FACTURA"],
}


class TestInvoicePDFMultiLang:
    @pytest.fixture(scope="class")
    def tx_id(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/invoices", headers=auth_headers)
        assert r.status_code == 200
        invs = r.json().get("invoices", [])
        if not invs:
            pytest.skip("No invoices to test PDF against")
        return invs[0]["id"]

    @pytest.mark.parametrize("lang", ["tr", "en", "de", "fr", "es"])
    def test_pdf_langs(self, auth_headers, tx_id, lang):
        r = requests.get(
            f"{BASE_URL}/api/reseller/invoices/{tx_id}/pdf?lang={lang}",
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        # Content-Disposition filename includes lang suffix
        cd = r.headers.get("content-disposition", "")
        assert re.search(rf"INV-\d{{6}}-[A-F0-9]+-{lang}\.pdf", cd), cd
        # Content should contain lang-specific markers (best-effort)
        text = _pdf_text(r.content).upper()
        found = [n.decode() for n in LANGS[lang] if n.decode() in text]
        assert found, f"None of {LANGS[lang]} found in {lang} PDF text: {text[:400]!r}"

    def test_pdf_fallback_unsupported_lang(self, auth_headers, tx_id):
        r = requests.get(
            f"{BASE_URL}/api/reseller/invoices/{tx_id}/pdf?lang=jp",
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"
        # Falls back to EN body but filename still uses "jp"
        assert "INVOICE" in _pdf_text(r.content).upper()
        cd = r.headers.get("content-disposition", "")
        assert "-jp.pdf" in cd


# ---------- Regression ------------------------------------------------------
class TestRegression:
    def test_reseller_login(self, api):
        r = api.post(f"{BASE_URL}/api/reseller/auth/login",
                     json={"email": RESELLER_EMAIL, "password": RESELLER_PWD})
        assert r.status_code == 200

    def test_invoices_list(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reseller/invoices", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "invoices" in data and "count" in data
        assert data["count"] >= 1

    def test_analytics_mrr(self, api):
        r = api.get(f"{BASE_URL}/api/analytics/mrr")
        assert r.status_code == 200
        data = r.json()
        assert "mrr" in data or "MRR" in data or "arr" in data

    def test_plugin_install_info(self, api):
        r = api.get(f"{BASE_URL}/api/plugin/install-info")
        assert r.status_code == 200

    def test_license_verify(self, api):
        r = api.post(f"{BASE_URL}/api/license-server/verify",
                     json={"license_key": "MS-435EA62E57A442BBB10985E9",
                           "server_ip": "10.0.0.1"})
        assert r.status_code == 200


# ---------- Deploy artifacts ------------------------------------------------
class TestDeployArtifacts:
    def test_files_present(self):
        for p in ["/app/deploy/docker-compose.yml",
                  "/app/deploy/haproxy.cfg",
                  "/app/deploy/README.md"]:
            assert Path(p).exists(), f"{p} missing"
            assert Path(p).stat().st_size > 200, f"{p} too small"

    def test_readme_content(self):
        readme = Path("/app/deploy/README.md").read_text()
        # Should mention Redis, HAProxy, license
        low = readme.lower()
        for keyword in ["redis", "haproxy", "license"]:
            assert keyword in low, f"README missing '{keyword}'"

    def test_haproxy_healthcheck(self):
        cfg = Path("/app/deploy/haproxy.cfg").read_text().lower()
        assert "check" in cfg or "healthcheck" in cfg
