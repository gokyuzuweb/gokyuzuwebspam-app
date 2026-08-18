"""v43.93 — Trusted IPs bulk import parser tests."""
import os
import pytest
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


def _cleanup(prefix="99.99.99."):
    L = requests.get(f"{API}/settings/trusted-ips", headers=HDR, timeout=10).json()
    for i in L["items"]:
        if i["ip"].startswith(prefix):
            requests.delete(f"{API}/settings/trusted-ips/{i['ip']}", headers=HDR, timeout=10)


def test_bulk_add_with_labels_containing_spaces():
    _cleanup()
    payload_text = "99.99.99.1=Datacenter A\n99.99.99.2|Ofis Merkez\n99.99.99.3"
    r = requests.post(f"{API}/settings/trusted-ips/bulk", headers=HDR,
                      json={"text": payload_text, "label": "Bulk Test"}, timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j["counts"]["added"] == 3
    assert j["counts"]["errors"] == 0
    assert "99.99.99.1" in j["added"]
    _cleanup()


def test_bulk_add_multi_ips_per_line():
    _cleanup()
    payload_text = "99.99.99.10 99.99.99.11 99.99.99.12\n99.99.99.13,99.99.99.14"
    r = requests.post(f"{API}/settings/trusted-ips/bulk", headers=HDR,
                      json={"text": payload_text, "label": "Grup"}, timeout=10)
    j = r.json()
    assert j["counts"]["added"] == 5
    _cleanup()


def test_bulk_add_invalid_entries_flagged():
    _cleanup()
    payload_text = "99.99.99.20\ninvalid_ip@here\nfoo"
    r = requests.post(f"{API}/settings/trusted-ips/bulk", headers=HDR,
                      json={"text": payload_text, "label": ""}, timeout=10)
    j = r.json()
    assert j["counts"]["added"] == 1
    assert j["counts"]["errors"] >= 2
    _cleanup()


def test_bulk_add_dedupe_skipped():
    _cleanup()
    # Önce ekle
    requests.post(f"{API}/settings/trusted-ips", headers=HDR,
                  json={"ip": "99.99.99.99", "label": "existing"}, timeout=10)
    # Bulk aynı IP + yenisi
    r = requests.post(f"{API}/settings/trusted-ips/bulk", headers=HDR,
                      json={"text": "99.99.99.99\n99.99.99.100", "label": "T"}, timeout=10)
    j = r.json()
    assert "99.99.99.99" in j["skipped"]
    assert "99.99.99.100" in j["added"]
    _cleanup()


def test_bulk_master_only():
    r = requests.post(f"{API}/settings/trusted-ips/bulk",
                      json={"text": "1.2.3.4"},
                      headers={"Content-Type": "application/json"}, timeout=10)
    assert r.status_code in (401, 403)
