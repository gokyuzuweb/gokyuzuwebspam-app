"""v44.00.17 — Mailbox purge endpoint testleri."""
import os
import requests

BASE = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")
MASTER = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")


def test_purge_master_only():
    r = requests.post(f"{BASE}/api/plugin/mailbox-purge",
                      json={"subject_contains": "x", "dry_run": True})
    assert r.status_code == 403


def test_purge_requires_criteria():
    r = requests.post(f"{BASE}/api/plugin/mailbox-purge?license_key=" + MASTER,
                      json={"dry_run": True})
    assert r.status_code == 400


def test_purge_dry_run_never_deletes():
    """dry_run=true olduğunda deleted alanı 0 olmalı."""
    r = requests.post(f"{BASE}/api/plugin/mailbox-purge?license_key=" + MASTER,
                      json={"subject_contains": "impossibleXYZ_test",
                            "dry_run": True}).json()
    assert r["dry_run"] is True
    assert r["deleted"] == 0
    assert isinstance(r["matched_count"], int)
    assert isinstance(r["sample"], list)


def test_purge_response_shape():
    r = requests.post(f"{BASE}/api/plugin/mailbox-purge?license_key=" + MASTER,
                      json={"from_contains": "nonexistent_sender_xyz",
                            "dry_run": True, "scan_folders": "junk"}).json()
    for key in ("dry_run", "scanned", "matched_count", "deleted", "errors", "sample", "truncated"):
        assert key in r, f"missing key: {key}"
