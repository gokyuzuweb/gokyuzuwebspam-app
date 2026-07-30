"""
GökyüzüWebSpam backend tests for iteration 3 review:
- BUG FIX: Blacklist Delist endpoint (ObjectId serialization)
- BUG FIX: AI Rule Generator (90s timeout / LLM)
- NEW: Pricing GET/PUT
- Customer-mode gate simulation (demo_active / demo_over / licensed)
- verify-license IP flow with seed license 203.0.113.10
- System mode = seller
"""
import os
import time
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
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- basic health / mode ----------
def test_system_mode_is_seller(s):
    r = s.get(f"{API}/system/mode", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "seller"
    assert isinstance(data["demo_days"], int)


# ---------- Pricing (new feature) ----------
def test_pricing_get_public(s):
    r = s.get(f"{API}/pricing", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "plans" in data
    plans = data["plans"]
    assert len(plans) >= 3
    codes = {p.get("code") for p in plans}
    assert {"starter", "pro", "enterprise"}.issubset(codes)
    for p in plans:
        assert "monthly_price" in p
        assert "yearly_price" in p


def test_pricing_put_seller(s):
    # get current
    r = s.get(f"{API}/pricing", timeout=15)
    assert r.status_code == 200
    current = r.json()
    plans = current["plans"]
    original = None
    for p in plans:
        if p.get("code") == "starter":
            original = p["monthly_price"]
            p["monthly_price"] = float(p["monthly_price"]) + 1
    payload = {**current, "plans": plans}
    r2 = s.put(f"{API}/pricing", json=payload, timeout=15)
    assert r2.status_code == 200, r2.text
    r3 = s.get(f"{API}/pricing", timeout=15)
    updated = r3.json()
    starter = [p for p in updated["plans"] if p["code"] == "starter"][0]
    assert float(starter["monthly_price"]) == float(original) + 1
    # restore
    starter["monthly_price"] = float(original)
    s.put(f"{API}/pricing", json={**updated, "plans": updated["plans"]}, timeout=15)


# ---------- Plugin state gate simulate ----------
@pytest.mark.parametrize("state,expected_reason", [
    ("demo_active", "demo_active"),
    # In seller mode gated=False always, so gate_reason becomes 'ok' when demo_over
    ("demo_over", "ok"),
    ("licensed", "ok"),
])
def test_simulate_state_and_status(s, state, expected_reason):
    r = s.post(f"{API}/plugin/simulate-state", json={"state": state}, timeout=15)
    assert r.status_code == 200, r.text
    st = s.get(f"{API}/plugin/status", timeout=15).json()
    assert st["mode"] == "seller"
    assert st["gate_reason"] == expected_reason
    assert st["gated"] is False  # seller mode never gates


# ---------- verify-license by seeded IP ----------
def test_verify_license_by_ip(s):
    r = s.post(f"{API}/plugin/verify-license", json={"ip": "203.0.113.10"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data.get("customer")
    assert data.get("license_key")


def test_verify_license_bad_ip(s):
    r = s.post(f"{API}/plugin/verify-license", json={"ip": "10.99.99.99"}, timeout=15)
    assert r.status_code == 404


# ---------- Blacklist Delist bug fix (ObjectId) ----------
def test_blacklist_check_and_delist(s):
    # check first (to get providers)
    r = s.post(f"{API}/blacklist/check", json={"target": "185.220.101.42", "type": "ip"}, timeout=60)
    assert r.status_code == 200, r.text
    checks = r.json()
    # pick first 3 providers regardless of listed status
    providers_list = checks.get("results") or checks.get("providers") or []
    codes = []
    for c in providers_list[:3]:
        code = c.get("provider_code") or c.get("code")
        if code:
            codes.append(code)
    if not codes:
        # fallback to /blacklist/providers
        pr = s.get(f"{API}/blacklist/providers", timeout=15).json()
        codes = [p["code"] for p in pr[:2]]

    payload = {
        "target": "185.220.101.42",
        "type": "ip",
        "provider_codes": codes,
        "contact_email": "admin@sunucunuz.com",
        "reason": "Test delisting request from backend_test.py",
    }
    r2 = s.post(f"{API}/blacklist/delist", json=payload, timeout=30)
    assert r2.status_code == 200, f"delist failed: {r2.status_code} {r2.text}"
    body = r2.json()
    assert body["created"] == len(codes)
    assert isinstance(body["requests"], list)
    # verify no ObjectId leaked
    for req in body["requests"]:
        assert "_id" not in req
        assert "id" in req
    # verify persisted
    r3 = s.get(f"{API}/blacklist/requests", timeout=15)
    assert r3.status_code == 200
    all_reqs = r3.json()
    assert any(rq["target"] == "185.220.101.42" for rq in all_reqs)


# ---------- AI Rule Generator (LLM) ----------
def test_rules_generate_tr(s):
    payload = {"prompt": "türkçe eczane spam", "language": "tr"}
    r = s.post(f"{API}/rules/generate", json=payload, timeout=90)
    assert r.status_code == 200, f"rules/generate failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["count"] >= 1
    assert data["language"] == "tr"
    assert len(data["proposals"]) >= 1
    p0 = data["proposals"][0]
    for k in ("name", "pattern", "score", "target"):
        assert k in p0


def test_rules_generate_en(s):
    payload = {"prompt": "fake lottery scam", "language": "en"}
    r = s.post(f"{API}/rules/generate", json=payload, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["language"] == "en"
    assert data["count"] >= 1


# ---------- Stripe Checkout (v1.2) ----------
def test_checkout_create_session_pro_yearly(s):
    payload = {
        "plan_code": "pro",
        "billing_period": "yearly",
        "customer_email": "test@buyer.com",
        "customer_name": "Test",
        "origin_url": BASE_URL,
    }
    r = s.post(f"{API}/checkout/create-session", json=payload, timeout=30)
    assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_id" in data
    assert "url" in data
    assert "checkout.stripe.com" in data["url"] or "stripe.com" in data["url"]


def test_checkout_create_session_starter_monthly(s):
    payload = {
        "plan_code": "starter",
        "billing_period": "monthly",
        "customer_email": "starter@buyer.com",
        "customer_name": "Starter",
        "origin_url": BASE_URL,
    }
    r = s.post(f"{API}/checkout/create-session", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("session_id")
    assert data.get("url", "").startswith("http")


def test_checkout_create_session_invalid_plan(s):
    payload = {
        "plan_code": "invalid_plan",
        "billing_period": "yearly",
        "customer_email": "x@x.com",
        "origin_url": BASE_URL,
    }
    r = s.post(f"{API}/checkout/create-session", json=payload, timeout=15)
    # Pydantic Literal validation → 422
    assert r.status_code in (400, 404, 422)


def test_checkout_transactions_list(s):
    r = s.get(f"{API}/checkout/transactions", timeout=15)
    assert r.status_code == 200
    body = r.json()
    # ensure no ObjectId leaking
    txs = body if isinstance(body, list) else body.get("transactions", [])
    for tx in txs[:5]:
        assert "_id" not in tx


# ---------- Version Manifest & Upgrade (v1.2) ----------
def test_version_current_endpoint(s):
    r = s.get(f"{API}/version/current", timeout=15)
    assert r.status_code == 200
    assert "version" in r.json()


def test_version_manifest_put_and_upgrade_flow(s):
    # Set current version to 1.1.0 baseline via upgrade downgrade impossible; ensure manifest new.
    # 1) set manifest to 1.2.0
    manifest_payload = {
        "latest_version": "1.2.0",
        "download_url": "https://mailshield.example.com/dist/mailshield-1.2.0.tar.gz",
        "sha256": "",
        "changelog": "test release",
        "min_supported": "1.0.0",
    }
    r = s.put(f"{API}/version/manifest", json=manifest_payload, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["latest_version"] == "1.2.0"

    # 2) check-update should indicate available (unless current already >= 1.2.0)
    r2 = s.get(f"{API}/version/check-update", timeout=15)
    assert r2.status_code == 200
    chk = r2.json()
    assert chk["latest"] == "1.2.0"

    # 3) trigger upgrade (simulated in preview)
    r3 = s.post(f"{API}/plugin/upgrade", timeout=30)
    assert r3.status_code == 200, r3.text
    up = r3.json()
    # Either ok (upgraded) or already-up-to-date
    assert "message" in up
    if up["ok"]:
        assert up["new_version"] == "1.2.0"

    # 4) current should now be 1.2.0
    r4 = s.get(f"{API}/version/current", timeout=15)
    assert r4.status_code == 200
    assert r4.json()["version"] == "1.2.0"

    # 5) idempotent — upgrade again should say already up to date
    r5 = s.post(f"{API}/plugin/upgrade", timeout=30)
    assert r5.status_code == 200
    up5 = r5.json()
    assert up5["ok"] is False
    assert "güncel" in up5["message"].lower() or "up" in up5["message"].lower()
