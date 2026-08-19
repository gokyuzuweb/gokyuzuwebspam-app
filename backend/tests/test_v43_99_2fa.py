"""v43.99 — Master 2FA (TOTP) end-to-end test."""
import os
import pyotp
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = l.split("=", 1)[1].strip().rstrip("/")
MK = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"
HDR = {"X-Master-Key": MK, "X-Forwarded-For": "89.19.15.58", "Content-Type": "application/json"}


def test_2fa_end_to_end():
    # 1. Setup init
    r = requests.post(f"{API}/master/2fa/setup-init", headers=HDR, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "secret" in d and len(d["secret"]) >= 16
    assert "qr_png_base64" in d and len(d["qr_png_base64"]) > 100
    secret = d["secret"]

    # 2. Enable with valid TOTP
    code = pyotp.TOTP(secret).now()
    r = requests.post(f"{API}/master/2fa/enable", headers=HDR,
                      json={"secret": secret, "code": code}, timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert len(j["backup_codes"]) == 10

    # 3. Verify with fresh TOTP code
    code2 = pyotp.TOTP(secret).now()
    r = requests.post(f"{API}/master/2fa/verify", headers=HDR,
                      json={"code": code2}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("used_backup_code") is False

    # 4. Verify with backup code
    backup = j["backup_codes"][0]
    r = requests.post(f"{API}/master/2fa/verify", headers=HDR,
                      json={"code": backup}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("used_backup_code") is True

    # 5. Status
    r = requests.get(f"{API}/master/2fa/status", headers=HDR, timeout=10)
    assert r.status_code == 200
    st = r.json()
    assert st["enabled"] is True
    assert st["backup_codes_remaining"] == 9   # 1 consumed

    # 6. Invalid code rejected
    r = requests.post(f"{API}/master/2fa/verify", headers=HDR,
                      json={"code": "000000"}, timeout=10)
    assert r.status_code == 401

    # 7. Disable with valid TOTP
    code3 = pyotp.TOTP(secret).now()
    r = requests.post(f"{API}/master/2fa/disable", headers=HDR,
                      json={"code": code3}, timeout=10)
    assert r.status_code == 200


def test_2fa_master_only():
    r = requests.get(f"{API}/master/2fa/status",
                     headers={"X-Forwarded-For": "99.99.99.99"}, timeout=10)
    assert r.status_code == 403
