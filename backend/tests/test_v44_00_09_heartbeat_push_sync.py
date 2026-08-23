"""v44.00.09 — Heartbeat writes exim_logtail_pos.last_push_at so PushHealthWidget goes green.

Bug: gws-simple-push kuruluyken widget "PUSH YOK" gösteriyordu çünkü heartbeat
sadece licenses.last_heartbeat_at yazıyordu, exim_logtail_pos.last_push_at değil.
Fix: heartbeat handler artık exim_logtail_pos:{license_key}.last_push_at yazar.
"""
from __future__ import annotations
import io
import os
import re
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

# ---------- Config ----------
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
BAYI_KEY = "MS-TESTBAYI-STARTER-V4371"
TEST_IP = "203.0.113.42"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module", autouse=True)
def ensure_ip_allowed(db):
    """Add TEST_IP to bayi's ip_addresses before running tests, restore after."""
    lic = db.licenses.find_one({"license_key": BAYI_KEY}) or {}
    original_ips = list(lic.get("ip_addresses") or [])
    new_ips = list(set(original_ips + [TEST_IP]))
    db.licenses.update_one(
        {"license_key": BAYI_KEY},
        {"$set": {"ip_addresses": new_ips, "active": True}},
    )
    yield
    # Teardown: restore original IP list, remove test exim_logtail_pos doc
    db.licenses.update_one(
        {"license_key": BAYI_KEY},
        {"$set": {"ip_addresses": original_ips}},
    )
    db.settings.delete_one({"_key": f"exim_logtail_pos:{BAYI_KEY}",
                             "last_push_source": "heartbeat"})


# ---------- 1. Heartbeat → exim_logtail_pos sync (core fix) ----------
class TestHeartbeatWritesLastPushAt:
    def test_heartbeat_success_and_writes_last_push_at(self, db):
        # Clear any prior doc to make the assertion crisp
        db.settings.delete_one({"_key": f"exim_logtail_pos:{BAYI_KEY}"})

        r = requests.post(
            f"{BASE_URL}/api/plugin/heartbeat",
            json={
                "license_key": BAYI_KEY,
                "ip": TEST_IP,
                "hostname": "test-v44009.local",
                "plugin_version": "44.00.09",
                "active_domains": 0,
            },
            timeout=15,
        )
        assert r.status_code == 200, f"Heartbeat should be 200, got {r.status_code}: {r.text[:300]}"

        # Query MongoDB for the exim_logtail_pos doc
        doc = db.settings.find_one({"_key": f"exim_logtail_pos:{BAYI_KEY}"})
        assert doc is not None, "exim_logtail_pos doc should be created by heartbeat"
        assert doc.get("last_push_at"), "last_push_at must be set"
        assert doc.get("last_push_source") == "heartbeat", \
            f"last_push_source should be 'heartbeat', got {doc.get('last_push_source')}"
        # last_push_at within last 10 seconds
        ts_str = doc["last_push_at"]
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        delta = (datetime.now(timezone.utc) - ts).total_seconds()
        assert 0 <= delta <= 10, f"last_push_at should be within last 10s, delta={delta}s"

    def test_outbound_stats_returns_last_push_at(self):
        # Fire another heartbeat, then check /api/outbound/stats
        requests.post(
            f"{BASE_URL}/api/plugin/heartbeat",
            json={
                "license_key": BAYI_KEY,
                "ip": TEST_IP,
                "hostname": "test-v44009.local",
                "plugin_version": "44.00.09",
                "active_domains": 0,
            },
            timeout=15,
        )
        time.sleep(0.3)
        r = requests.get(
            f"{BASE_URL}/api/outbound/stats",
            headers={"X-Master-Key": BAYI_KEY},
            timeout=15,
        )
        assert r.status_code == 200, f"outbound/stats should be 200, got {r.status_code}"
        body = r.json()
        assert "last_push_at" in body, f"outbound/stats must include last_push_at: {body}"
        assert body["last_push_at"] is not None, \
            "last_push_at should NOT be null after heartbeat — this is the whole bug fix!"
        # sanity: ISO string
        assert isinstance(body["last_push_at"], str)
        ts = datetime.fromisoformat(body["last_push_at"].replace("Z", "+00:00"))
        delta = (datetime.now(timezone.utc) - ts).total_seconds()
        assert delta < 30, f"last_push_at should be fresh, delta={delta}s"


# ---------- 2. signal-log tenant regression ----------
class TestSignalLogRegression:
    def test_bayi_forbidden(self):
        r = requests.get(
            f"{BASE_URL}/api/plugin/signal-log",
            headers={"X-Master-Key": BAYI_KEY},
            timeout=15,
        )
        assert r.status_code == 403, f"Bayi should get 403, got {r.status_code}"

    def test_master_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/plugin/signal-log",
            headers={"X-Master-Key": MASTER_KEY},
            timeout=15,
        )
        assert r.status_code == 200


# ---------- 3. offline-resellers master-only ----------
class TestOfflineResellersRegression:
    def test_master_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/master/offline-resellers",
            headers={"X-Master-Key": MASTER_KEY},
            timeout=15,
        )
        assert r.status_code == 200
        b = r.json()
        assert "threshold_minutes" in b and "count" in b and "offline" in b

    def test_bayi_forbidden(self):
        r = requests.get(
            f"{BASE_URL}/api/master/offline-resellers",
            headers={"X-Master-Key": BAYI_KEY},
            timeout=15,
        )
        assert r.status_code == 403


# ---------- 4. SMTP tenant scope regression ----------
class TestSmtpTenantScope:
    def test_master_and_bayi_both_200(self):
        rm = requests.get(f"{BASE_URL}/api/settings/smtp",
                          headers={"X-Master-Key": MASTER_KEY}, timeout=15)
        rb = requests.get(f"{BASE_URL}/api/settings/smtp",
                          headers={"X-Master-Key": BAYI_KEY}, timeout=15)
        assert rm.status_code == 200
        assert rb.status_code == 200
        assert isinstance(rm.json(), dict) and isinstance(rb.json(), dict)


# ---------- 5. pin-approvals/export master-only + BOM ----------
class TestPinApprovalsExport:
    def test_bayi_forbidden(self):
        r = requests.get(
            f"{BASE_URL}/api/pin-approvals/export",
            headers={"X-Master-Key": BAYI_KEY},
            timeout=15,
        )
        assert r.status_code == 403, f"Bayi should get 403, got {r.status_code}"

    def test_master_csv_utf8_bom(self):
        r = requests.get(
            f"{BASE_URL}/api/pin-approvals/export",
            headers={"X-Master-Key": MASTER_KEY},
            timeout=15,
        )
        assert r.status_code == 200
        # UTF-8 BOM = b'\xef\xbb\xbf'
        assert r.content.startswith(b"\xef\xbb\xbf"), "CSV must start with UTF-8 BOM"


# ---------- 6. Tarball download + install.sh contents + VERSION ----------
class TestTarballDownload:
    @pytest.fixture(scope="class")
    def tarball(self):
        r = requests.get(f"{BASE_URL}/api/plugin/download", timeout=60, stream=True)
        assert r.status_code == 200, f"download failed: {r.status_code}"
        content = r.content
        assert len(content) > 1000, "tarball too small"
        return content

    def test_is_valid_tar_gz(self, tarball):
        buf = io.BytesIO(tarball)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            names = tar.getnames()
        assert any(n.endswith("install.sh") for n in names), \
            f"install.sh not in tarball. names sample: {names[:10]}"

    def test_install_sh_content(self, tarball):
        buf = io.BytesIO(tarball)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            member = next(m for m in tar.getmembers()
                          if m.name.endswith("gokyuzuwebspam/install.sh"))
            f = tar.extractfile(member)
            content = f.read().decode("utf-8", errors="replace")
        # gws-simple-push mentioned >= 5 times
        count = content.count("gws-simple-push")
        assert count >= 5, f"gws-simple-push should appear >=5 times, got {count}"
        assert "systemctl enable --now gws-simple-push.timer" in content
        assert "gws-exim-push.timer" in content

    def test_version_file(self, tarball):
        buf = io.BytesIO(tarball)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            member = next((m for m in tar.getmembers()
                           if m.name.endswith("gokyuzuwebspam/VERSION")), None)
            assert member, "VERSION file missing"
            ver = tar.extractfile(member).read().decode().strip()
        # Accept either raw "44.00.09" or "v44.00.09"
        assert "44.00.09" in ver, f"VERSION should be v44.00.09, got: {ver}"


# ---------- 7. Widget help text updated ----------
class TestWidgetHelpText:
    def test_help_text_no_longer_says_gws_simple_push(self):
        f = Path("/app/frontend/src/components/PushHealthWidget.js").read_text(encoding="utf-8")
        # New helpful text
        assert "Push servisleri henüz kurulmadı" in f, \
            "Widget help must show 'Push servisleri henüz kurulmadı — Onar butonuna basın'"
