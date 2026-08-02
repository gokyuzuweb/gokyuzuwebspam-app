"""v19 tests: payments (PayTR mock / Havale), maintenance (db-usage, cleanup, ip block/status),
Turkish characters in test-ingest, RBL providers list + check, mail health-check, update/check."""
import os, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE}/api"
LIC = ""

s = requests.Session()
s.headers.update({"Content-Type": "application/json"})


# ---------------- payments ----------------
def test_payment_config():
    r = s.get(f"{API}/payments/config")
    assert r.status_code == 200
    d = r.json()
    assert "paytr_configured" in d
    assert "bank_iban" in d and "bank_name" in d and "bank_beneficiary" in d


def test_paytr_create_mock():
    r = s.post(f"{API}/payments/paytr/create", json={
        "email": "test@example.com", "user_name": "TEST User",
        "items": [{"name": "Plan Pro", "price": 199.0, "qty": 1}],
        "plan": "pro", "currency": "TL", "test_mode": 1,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert d.get("mock") is True
    assert "iframe_src" in d and d["iframe_src"].startswith("http")
    assert d["merchant_oid"].startswith("ORD")


def test_havale_create_and_approve():
    r = s.post(f"{API}/payments/havale/create", json={
        "email": "test@example.com", "user_name": "TEST User",
        "amount": 499.0, "plan": "pro",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["merchant_oid"].startswith("TRF")
    assert "iban" in d and "reference" in d and "instructions" in d
    assert d["status"] == "awaiting_transfer"

    r2 = s.post(f"{API}/payments/havale/approve", json={
        "merchant_oid": d["merchant_oid"], "admin_note": "test approve",
    })
    assert r2.status_code == 200
    assert r2.json()["status"] == "paid"


# ---------------- maintenance ----------------
def test_db_usage():
    r = s.get(f"{API}/maintenance/db-usage")
    assert r.status_code == 200
    d = r.json()
    assert "collections" in d and "items" in d
    assert "will_delete" in d and "will_preserve" in d
    assert isinstance(d["will_delete"], list) and len(d["will_delete"]) > 5
    assert "mail_events" in d["will_delete"]
    assert "licenses" in d["will_preserve"]
    assert "settings" in d["will_preserve"]
    assert "totals" in d
    assert "data_docs" in d["totals"]
    assert "settings_docs" in d["totals"]


def test_cleanup_requires_confirm():
    r = s.post(f"{API}/maintenance/cleanup", json={"confirm": "wrong", "older_than_days": 30})
    assert r.status_code == 400


def test_cleanup_preserves_settings():
    # Baseline settings counts
    before = s.get(f"{API}/maintenance/db-usage").json()
    settings_before = before["totals"]["settings_docs"]

    r = s.post(f"{API}/maintenance/cleanup", json={
        "confirm": "DELETE_DATA", "older_than_days": 30,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert "collections_affected" in d
    # Settings should still be there
    after = s.get(f"{API}/maintenance/db-usage").json()
    assert after["totals"]["settings_docs"] == settings_before, \
        f"Settings docs changed: {settings_before} -> {after['totals']['settings_docs']}"


# ---------------- IP block/status/unblock ----------------
def test_ip_block_status_unblock():
    ip = "45.32.11.7"
    # ensure clean
    s.post(f"{API}/maintenance/ip/unblock", json={"ip": ip})

    r = s.post(f"{API}/maintenance/ip/block", json={"ip": ip, "reason": "TEST"})
    assert r.status_code == 200
    assert r.json()["blocked"] is True

    r2 = s.get(f"{API}/maintenance/ip/status", params={"ip": ip})
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["blocked"] is True
    # country resolution should give US for 45.x (best-effort — allow None only if lookup fails)
    if d.get("country") is not None:
        assert isinstance(d["country"], str) and len(d["country"]) == 2

    r3 = s.post(f"{API}/maintenance/ip/unblock", json={"ip": ip})
    assert r3.status_code == 200
    r4 = s.get(f"{API}/maintenance/ip/status", params={"ip": ip})
    assert r4.json()["blocked"] is False


# ---------------- Turkish characters in test-ingest ----------------
def test_test_ingest_turkish():
    r = s.post(f"{API}/events/test-ingest", params={"license_key": LIC})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("inserted", 0) >= 1

    r2 = s.get(f"{API}/events", params={"license_key": LIC, "limit": 20})
    assert r2.status_code == 200
    items = r2.json().get("items", [])
    subjects = " | ".join([(it.get("subject") or "") for it in items])
    # Ensure Turkish diacritics preserved (should find at least a couple)
    diacritics = ["ç", "ğ", "ı", "ö", "ş", "ü", "İ", "Ç", "Ö"]
    hits = sum(1 for c in diacritics if c in subjects)
    assert hits >= 2, f"Turkish diacritics missing in subjects: {subjects!r}"
    # sender_ip populated on at least some events
    with_ip = [it for it in items if it.get("sender_ip") or it.get("client_ip")]
    assert len(with_ip) >= 1


# ---------------- RBL / Mail health / Update ----------------
def test_rbl_providers():
    r = s.get(f"{API}/threat-intel/rbl/providers")
    assert r.status_code == 200
    items = r.json().get("items") or r.json().get("providers") or r.json()
    if isinstance(items, dict):
        items = items.get("items", [])
    assert isinstance(items, list)
    assert len(items) >= 12, f"expected >=12 providers, got {len(items)}"


def test_rbl_check():
    r = s.post(f"{API}/threat-intel/rbl/check", json={"ip": "127.0.0.2"})
    assert r.status_code == 200, r.text
    d = r.json()
    results = d.get("results") or d.get("items") or []
    assert isinstance(results, list) and len(results) >= 1
    sample = results[0]
    assert "provider" in sample or "name" in sample
    assert "listed" in sample


def test_mail_health_check():
    r = s.post(f"{API}/threat-intel/mail/health-check", json={"domain": "google.com"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "checks" in d or "mx" in d
    assert "score" in d and "max_score" in d


def test_update_check():
    r = s.get(f"{API}/threat-intel/update/check", params={"version": "1.0.0"})
    assert r.status_code == 200
    d = r.json()
    assert "latest" in d
    assert d.get("outdated") is True
    assert "download_url" in d
