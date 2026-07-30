"""
Iteration 4 (v1.4) tests:
- License Server (standalone port 8002) - direct + proxy
- Reseller JWT auth + subaccounts
- Reseller scoped data
- Regression on modularized routes (analytics/plugin)
"""
import os
import uuid
import requests
import pytest


def _read_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for ln in open(p):
            if ln.startswith("REACT_APP_BACKEND_URL="):
                return ln.split("=", 1)[1].strip().strip('"')
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
API = f"{BASE_URL}/api"
LICENSE_LOCAL = "http://localhost:8002"
ADMIN_KEY = "gws-license-admin-key"
SEED_LICENSE = "MS-435EA62E57A442BBB10985E9"
SEED_LICENSE_IP = "198.51.100.42"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ==================== License Server (direct on :8002) =====================
def test_ls_health():
    r = requests.get(f"{LICENSE_LOCAL}/v1/health", timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["service"] == "gws-license-server"


def test_ls_heartbeat_authorized_ip():
    payload = {"license_key": SEED_LICENSE, "server_ip": SEED_LICENSE_IP, "hostname": "test.host"}
    r = requests.post(f"{LICENSE_LOCAL}/v1/heartbeat", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert d["status"] == "active"


def test_ls_heartbeat_unauthorized_ip():
    payload = {"license_key": SEED_LICENSE, "server_ip": "192.0.2.99", "hostname": "rogue.host"}
    r = requests.post(f"{LICENSE_LOCAL}/v1/heartbeat", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is False
    assert d["status"] == "violation"


def test_ls_heartbeat_unknown_key():
    payload = {"license_key": "MS-DOES-NOT-EXIST-XXX", "server_ip": "192.0.2.1"}
    r = requests.post(f"{LICENSE_LOCAL}/v1/heartbeat", json=payload, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is False
    assert d["status"] == "unknown"


def test_ls_verify_idempotent():
    for _ in range(2):
        r = requests.get(f"{LICENSE_LOCAL}/v1/verify",
                         params={"license_key": SEED_LICENSE, "server_ip": SEED_LICENSE_IP},
                         timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True


def test_ls_verify_ip_mismatch():
    r = requests.get(f"{LICENSE_LOCAL}/v1/verify",
                     params={"license_key": SEED_LICENSE, "server_ip": "10.10.10.10"},
                     timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["valid"] is False
    assert d["reason"] == "ip_mismatch"


def test_ls_revoke_requires_admin_key():
    r = requests.post(f"{LICENSE_LOCAL}/v1/revoke",
                      json={"license_key": SEED_LICENSE, "reason": "test"},
                      timeout=10)
    assert r.status_code == 401


# ==================== License Server proxy (via /api) =====================
def test_proxy_health(s):
    r = s.get(f"{API}/license-server/health", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["reachable"] is True
    assert d.get("service") == "gws-license-server"


def test_proxy_verify(s):
    r = s.post(f"{API}/license-server/verify",
               json={"license_key": SEED_LICENSE, "server_ip": SEED_LICENSE_IP},
               timeout=15)
    assert r.status_code == 200
    assert r.json()["valid"] is True


# ==================== Reseller auth =====================
_test_email = f"reseller-test-{uuid.uuid4().hex[:8]}@example.com"
_test_pw = "strong-passwd-123"
_token_holder = {"token": None, "reseller_id": None, "email": _test_email}


def test_reseller_register_fake_license_404(s):
    r = s.post(f"{API}/reseller/auth/register", json={
        "license_key": "MS-FAKE-DOES-NOT-EXIST", "email": _test_email,
        "password": _test_pw, "company": "Test"
    }, timeout=15)
    assert r.status_code == 404


def test_reseller_register_success_or_duplicate(s):
    r = s.post(f"{API}/reseller/auth/register", json={
        "license_key": SEED_LICENSE, "email": _test_email,
        "password": _test_pw, "company": "Test Reseller Inc."
    }, timeout=15)
    # 200 if new, 409 if seed license already has reseller (per spec: expected)
    assert r.status_code in (200, 409), r.text
    if r.status_code == 200:
        d = r.json()
        assert d.get("token")
        _token_holder["token"] = d["token"]
        _token_holder["reseller_id"] = d["reseller_id"]


def test_reseller_login_existing(s):
    """If seed license already has reseller (reseller@test.com / strong123), login with that."""
    if _token_holder["token"]:
        return  # already have token from registration
    # Try previously seeded creds
    r = s.post(f"{API}/reseller/auth/login",
               json={"email": "reseller@test.com", "password": "strong123"}, timeout=15)
    if r.status_code == 200:
        _token_holder["token"] = r.json()["token"]
        _token_holder["email"] = "reseller@test.com"
    else:
        pytest.skip(f"Could not login as pre-existing reseller: {r.status_code} {r.text}")


def test_reseller_register_duplicate_email(s):
    if not _token_holder["email"]:
        pytest.skip("no reseller email")
    r = s.post(f"{API}/reseller/auth/register", json={
        "license_key": SEED_LICENSE, "email": _token_holder["email"],
        "password": _test_pw, "company": "Dup"
    }, timeout=15)
    assert r.status_code == 409


def test_reseller_login_bad_password(s):
    r = s.post(f"{API}/reseller/auth/login",
               json={"email": _token_holder["email"], "password": "wrongpw999"}, timeout=15)
    assert r.status_code == 401


def _auth_headers():
    assert _token_holder["token"], "no token available"
    return {"Authorization": f"Bearer {_token_holder['token']}", "Content-Type": "application/json"}


def test_reseller_me(s):
    r = s.get(f"{API}/reseller/me", headers=_auth_headers(), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "reseller" in d and "subaccounts" in d and "quota" in d
    assert d["reseller"]["license_key"] == SEED_LICENSE


def test_reseller_me_requires_bearer(s):
    r = s.get(f"{API}/reseller/me", timeout=10)
    assert r.status_code == 401


def test_reseller_me_bad_token(s):
    r = s.get(f"{API}/reseller/me",
              headers={"Authorization": "Bearer garbage.jwt.token"}, timeout=10)
    assert r.status_code == 401


# ==================== Reseller subaccounts CRUD =====================
_sub_holder = {"id": None}


def test_reseller_create_subaccount(s):
    uname = f"testsub{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/reseller/subaccounts", headers=_auth_headers(),
               json={"username": uname, "email": f"{uname}@ex.com", "domain": "ex.com",
                     "quota_daily": 1000}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["username"] == uname
    assert d["reseller_id"]
    _sub_holder["id"] = d["id"]
    _sub_holder["username"] = uname


def test_reseller_create_duplicate_username_409(s):
    uname = _sub_holder.get("username")
    if not uname:
        pytest.skip("no sub created")
    r = s.post(f"{API}/reseller/subaccounts", headers=_auth_headers(),
               json={"username": uname, "email": "dup@ex.com"}, timeout=15)
    assert r.status_code == 409


def test_reseller_list_subaccounts(s):
    r = s.get(f"{API}/reseller/subaccounts", headers=_auth_headers(), timeout=15)
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list)
    if _sub_holder["id"]:
        assert any(x["id"] == _sub_holder["id"] for x in lst)


def test_reseller_scoped_quarantine(s):
    r = s.get(f"{API}/reseller/quarantine", headers=_auth_headers(), timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_reseller_scoped_lists(s):
    r = s.get(f"{API}/reseller/lists", headers=_auth_headers(), timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_reseller_add_list_entry(s):
    r = s.post(f"{API}/reseller/lists", headers=_auth_headers(),
               json={"type": "whitelist", "value": f"test-{uuid.uuid4().hex[:6]}@ok.com"},
               timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "id" in d
    lid = d["id"]
    # delete it
    r2 = s.delete(f"{API}/reseller/lists/{lid}", headers=_auth_headers(), timeout=15)
    assert r2.status_code == 200


def test_reseller_delete_subaccount(s):
    if not _sub_holder["id"]:
        pytest.skip("no sub")
    r = s.delete(f"{API}/reseller/subaccounts/{_sub_holder['id']}",
                 headers=_auth_headers(), timeout=15)
    assert r.status_code == 200
    assert r.json()["deleted"] is True


# ==================== Regression on modularized routes =====================
def test_regression_analytics_mrr(s):
    r = s.get(f"{API}/analytics/mrr", timeout=15)
    assert r.status_code == 200
    assert "mrr" in r.json()


def test_regression_plugin_install_info(s):
    r = s.get(f"{API}/plugin/install-info", timeout=15)
    assert r.status_code == 200
    assert "wget_one_liner" in r.json()


def test_regression_plugin_download(s):
    r = s.get(f"{API}/plugin/download", timeout=30)
    assert r.status_code == 200
    assert "gzip" in r.headers.get("content-type", "").lower()


def test_regression_core_endpoints(s):
    for path in ["/stats/overview", "/quarantine", "/licenses", "/settings",
                 "/notifications", "/rules", "/i18n/languages"]:
        r = s.get(f"{API}{path}", timeout=20)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
