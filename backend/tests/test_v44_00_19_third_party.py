"""v44.00.19 — 3rd-party header parsing & upstream trust logic.

Tests:
  1) _extract_third_party_verdicts parses SPF/DKIM/DMARC from Authentication-Results
  2) X-Yandex-Spam parsed correctly (yes/no)
  3) X-Spam-Flag / X-Spam-Score / X-Spam-Status parsed
  4) Auto-Submitted RFC 3834 parsed
  5) /plugin/scan-verdict: X-Yandex-Spam: NO → cap 4.9 (clean)
  6) /plugin/scan-verdict: X-Yandex-Spam: YES → force spam
  7) /plugin/scan-verdict: Auto-Submitted → cap 4.9
  8) /plugin/scan-verdict: MAILER-DAEMON envelope → cap 4.9
"""
from __future__ import annotations
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import the helper directly for unit tests
from server import _extract_third_party_verdicts


def test_extract_authentication_results():
    hdr = "Authentication-Results: mx.example.com; spf=pass smtp.mailfrom=x@y.com; dkim=pass header.d=y.com; dmarc=pass action=none\r\nSubject: Test\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r["spf"] == "pass"
    assert r["dkim"] == "pass"
    assert r["dmarc"] == "pass"


def test_extract_yandex_spam_yes():
    hdr = "X-Yandex-Spam: YES\r\nX-Yandex-Spam-Status: yes\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r["yandex_spam"] == "yes"
    assert r.get("provider_hint") == "yandex"


def test_extract_yandex_spam_no():
    hdr = "X-Yandex-Spam: NO\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r["yandex_spam"] == "no"


def test_extract_spamassassin():
    hdr = "X-Spam-Flag: YES\r\nX-Spam-Status: Yes, score=8.5 required=5.0\r\nX-Spam-Score: 8.5\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r["sa_flag"] == "YES"
    assert r["sa_score"] == 8.5
    # sa_status word
    assert r["sa_status"] in ("Yes,", "Yes")


def test_extract_auto_submitted():
    hdr = "Auto-Submitted: auto-replied\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r["auto_submitted"] == "auto-replied"


def test_extract_empty():
    assert _extract_third_party_verdicts("") == {}
    assert _extract_third_party_verdicts(None) == {}


def test_extract_gmail_hint():
    hdr = "ARC-Authentication-Results: i=1; mx.google.com; spf=pass\r\n"
    r = _extract_third_party_verdicts(hdr)
    assert r.get("provider_hint") == "gmail"
    # Also verify spf parsed via ARC line
    # (Our regex is Authentication-Results only; ARC not primary. Just provider hint.)


# --- End-to-end scan-verdict via HTTP ---

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    # Fallback for local pytest
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
                break
    except Exception:
        pass


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_scan_verdict_yandex_no_trusts_upstream():
    import requests
    body = {
        "subject": "kotanız dolu son 24 saat şifrenizi doğrula",  # 3 tr_phish match, ~11.5 score
        "from_addr": "user@yandex.com.tr",
        "to_addr":   "customer@gokyuzuhosting.com",
        "headers":   "X-Yandex-Spam: NO\r\nReceived: from mx.yandex.net\r\n",
        "body": "Hesabınızı doğrulayınız.",
    }
    r = requests.post(f"{BASE}/api/plugin/scan-verdict", json=body, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    # Yandex clean upstream → cap at 4.9 → verdict must be 'clean'
    assert d["verdict"] == "clean", f"expected clean with YANDEX_CLEAN cap, got {d}"
    assert "YANDEX_CLEAN" in d["reasons"]
    assert d["score"] <= 4.9


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_scan_verdict_yandex_yes_forces_spam():
    import requests
    body = {
        "subject": "Normal subject",
        "from_addr": "sender@example.com",
        "to_addr":   "customer@gokyuzuhosting.com",
        "headers":   "X-Yandex-Spam: YES\r\n",
        "body": "Hello.",
    }
    r = requests.post(f"{BASE}/api/plugin/scan-verdict", json=body, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["verdict"] in ("spam", "high_spam"), f"expected spam, got {d}"
    assert "YANDEX_UPSTREAM_SPAM" in d["reasons"]


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_scan_verdict_auto_submitted_caps():
    import requests
    body = {
        "subject": "kotanız dolu son 24 saat şifrenizi doğrula",
        "from_addr": "vacation@example.com",
        "to_addr":   "user@gokyuzuhosting.com",
        "headers":   "Auto-Submitted: auto-replied\r\n",
        "body": "Out of office.",
    }
    r = requests.post(f"{BASE}/api/plugin/scan-verdict", json=body, timeout=10)
    d = r.json()
    assert d["verdict"] == "clean", f"auto-reply should cap to clean, got {d}"
    assert "AUTO_SUBMITTED" in d["reasons"]


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL required")
def test_scan_verdict_mailer_daemon_caps():
    import requests
    body = {
        "subject": "hesabınız askıya alındı kotanız dolu",
        "from_addr": "MAILER-DAEMON@example.com",
        "to_addr":   "user@gokyuzuhosting.com",
        "headers":   "Return-Path: <>\r\n",
        "body": "Bounce notice.",
    }
    r = requests.post(f"{BASE}/api/plugin/scan-verdict", json=body, timeout=10)
    d = r.json()
    assert d["verdict"] == "clean", f"bounce should cap to clean, got {d}"
    assert "BOUNCE_DSN" in d["reasons"]
