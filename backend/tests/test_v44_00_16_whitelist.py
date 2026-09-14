"""v44.00.16 — Whitelist/Blacklist + Ham Patterns + Verdict Stats testleri."""
import os
import pytest
import requests

BASE = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")
MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")


def _scan(**kw):
    return requests.post(f"{BASE}/api/plugin/scan-verdict", json=kw, timeout=5).json()


def test_whitelist_via_db():
    """Master paneldeki whitelist DB'ye yazılınca scan-verdict onu kullansın."""
    # Ekle
    r = requests.post(f"{BASE}/api/plugin/trusted-domains?license_key={MASTER}",
                      json={"domain": "trusted-test.com", "kind": "whitelist"})
    assert r.status_code == 200
    # Bu domain'den spam içerikli mail → clean olmalı
    v = _scan(subject="[UYARI] Posta kutunuz dolu",
              from_addr="phisher@trusted-test.com", body="depolama alanınız %99")
    assert v["verdict"] == "clean", f"Whitelist etkisiz: {v}"
    assert "WHITELISTED" in v["reasons"]
    # Temizle
    requests.delete(f"{BASE}/api/plugin/trusted-domains/trusted-test.com?license_key={MASTER}")


def test_blacklist_via_db():
    r = requests.post(f"{BASE}/api/plugin/trusted-domains?license_key={MASTER}",
                      json={"domain": "black-test.com", "kind": "blacklist"})
    assert r.status_code == 200
    v = _scan(subject="hi", from_addr="user@black-test.com", body="hello")
    assert v["verdict"] == "high_spam", f"Blacklist etkisiz: {v}"
    assert "BLACKLISTED" in v["reasons"]
    requests.delete(f"{BASE}/api/plugin/trusted-domains/black-test.com?license_key={MASTER}")


def test_ham_pattern_downgrades_spam():
    """Ham pattern eşleşirse spam skoru clean seviyesine iner."""
    p = "yıllık genel kurul toplantısı özeti"
    requests.post(f"{BASE}/api/plugin/ham-pattern",
                  json={"pattern": p, "source": "manual"})
    # Bu pattern + biraz spam sinyali → clean olmalı
    v = _scan(subject="yıllık genel kurul toplantısı özeti",
              body="[UYARI] önemli notlar ve depolama alanınız %99 raporu")
    assert v["verdict"] == "clean", f"Ham pattern etkisiz: {v}"
    assert "HAM_PATTERN" in v["reasons"]
    requests.delete(f"{BASE}/api/plugin/ham-pattern/{p.replace(' ', '%20')}")


def test_verdict_stats_endpoint():
    r = requests.get(f"{BASE}/api/plugin/verdict-stats?license_key={MASTER}&hours=24").json()
    assert "clean" in r and "spam" in r and "high_spam" in r
    assert "clean_pct" in r
    assert r["total"] >= 0


def test_trusted_domains_master_only():
    r = requests.get(f"{BASE}/api/plugin/trusted-domains")
    assert r.status_code == 403


def test_verdict_stats_master_only():
    r = requests.get(f"{BASE}/api/plugin/verdict-stats")
    assert r.status_code == 403
