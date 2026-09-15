"""v44.00.31 — Hosted Domains Push Integration Tests

Uses the LIVE running backend via requests. TestClient causes "Event loop is closed"
issues when motor is initialized in test collection.
"""
import os
import requests

BACKEND = "http://127.0.0.1:8001"
MASTER = "MS-C02AB012652A4FE692D69676"
TEST_LK = "MS-TEST-DOMAINS-PUSH-31"


def test_install_sh_integrates_domains_push():
    p = "/app/whm-plugin/install.sh"
    assert os.path.exists(p)
    txt = open(p, encoding="utf-8").read()
    assert "mailshield-domains-push" in txt
    assert "mailshield-domains-push.timer" in txt
    # Immediately triggers first push
    assert "systemctl start mailshield-domains-push.service" in txt


def test_systemd_units_exist():
    for name in ("mailshield-domains-push.service", "mailshield-domains-push.timer"):
        p = f"/app/whm-plugin/systemd/{name}"
        assert os.path.exists(p), f"missing systemd unit: {p}"
    svc = open("/app/whm-plugin/systemd/mailshield-domains-push.service").read()
    assert "ExecStart=/usr/local/mailshield/bin/mailshield-domains-push" in svc


def test_domains_push_script_valid():
    p = "/app/whm-plugin/scripts/mailshield-domains-push"
    assert os.path.exists(p)
    content = open(p, encoding="utf-8").read()
    assert content.startswith("#!"), "shebang missing"
    assert "LWP::UserAgent" in content
    assert "/etc/userdomains" in content
    assert "/api/threat-intel/plugin/hosted-domains" in content


def test_push_endpoint_persists_domains():
    payload = {
        "license_key": TEST_LK,
        "domains": ["Example.COM ", "sub.example.com", "foo.io", "example.com"],
        "source": "userdomains",
    }
    r = requests.post(f"{BACKEND}/api/threat-intel/plugin/hosted-domains", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    # Dedup + lowercase: example.com (also "Example.COM "), sub.example.com, foo.io = 3
    assert d.get("count") == 3, d


def test_get_hosted_domains_master_only():
    r = requests.get(
        f"{BACKEND}/api/threat-intel/plugin/hosted-domains/{TEST_LK}",
        headers={"X-Master-Key": MASTER}, timeout=10,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("count") == 3
    assert "example.com" in d.get("domains", [])


def test_get_hosted_domains_rejects_non_master():
    r = requests.get(
        f"{BACKEND}/api/threat-intel/plugin/hosted-domains/{TEST_LK}",
        timeout=10,
    )
    assert r.status_code == 403


def test_dmarc_summary_prefers_pushed_hosted_over_heuristic():
    r = requests.get(
        f"{BACKEND}/api/threat-intel/dmarc/summary",
        params={"license_key": TEST_LK, "only_hosted": "true", "days": 30},
        headers={"X-Master-Key": MASTER},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("hosted_source") == "userdomains", d
    assert d.get("hosted_count") == 3, d
    assert d.get("filtered") is True
