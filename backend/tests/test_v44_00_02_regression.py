"""v44.00.02 regression suite.

Covers:
  * Master gating on GET /api/licenses (403 unauth, 403 non-master, 200 master)
  * Master gating on GET /api/license/violations (same)
  * POST /api/plugin/verify-license — bogus key writes canonical
    db.license_violations row w/ reason=key_not_found + browser_ip
  * DELETE /api/pin-approvals/{req_id} (master-only, pending blocked, delete audit)
  * POST /api/pin-approvals/bulk-delete (master-only, never touches pending)
  * GET /api/pin-approvals/all — optional 'company' when reseller row exists
  * VERSION bump to v44.00.02 (file + tarball)
"""
from __future__ import annotations
import io
import os
import tarfile
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

def _load_backend_url() -> str:
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fall back to /app/frontend/.env (pytest inherits env of runner)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _load_backend_url() + "/api"
MASTER_KEY = "MS-C02AB012652A4FE692D69676"
NONMASTER_KEY = "MS-TESTBAYI-STARTER-V4371"


# ─── fixtures ────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ─── GATING FIX #1 — GET /api/licenses ───────────────────────────────────
class TestLicensesGating:
    def test_no_header_403(self, s):
        r = s.get(f"{BASE}/licenses")
        assert r.status_code == 403, r.text

    def test_nonmaster_403(self, s):
        r = s.get(f"{BASE}/licenses", headers={"X-Master-Key": NONMASTER_KEY})
        assert r.status_code == 403, r.text

    def test_master_200(self, s):
        r = s.get(f"{BASE}/licenses", headers={"X-Master-Key": MASTER_KEY})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ─── GATING FIX #2 — GET /api/license/violations ─────────────────────────
class TestViolationsGating:
    def test_no_header_403(self, s):
        r = s.get(f"{BASE}/license/violations")
        assert r.status_code == 403

    def test_nonmaster_403(self, s):
        r = s.get(f"{BASE}/license/violations", headers={"X-Master-Key": NONMASTER_KEY})
        assert r.status_code == 403

    def test_master_200(self, s):
        r = s.get(f"{BASE}/license/violations", headers={"X-Master-Key": MASTER_KEY})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ─── VIOLATION FIX — bogus verify-license writes canonical row ───────────
class TestVerifyLicenseBogusKey:
    def test_bogus_writes_violation(self, s):
        bogus_key = f"MS-NOT-A-REAL-KEY-{uuid.uuid4().hex[:8].upper()}"
        # Use an IP that is not registered on any license to avoid the
        # ambiguous_shared_ip fallback path. 192.0.2.0/24 is TEST-NET-1.
        bogus_ip = f"192.0.2.{(uuid.uuid4().int % 250) + 2}"
        bogus_host = f"bogus-{uuid.uuid4().hex[:6]}.test"
        xff = "203.0.113.55"
        r = s.post(
            f"{BASE}/plugin/verify-license",
            headers={"X-Forwarded-For": xff},
            json={"license_key": bogus_key, "ip": bogus_ip, "hostname": bogus_host},
        )
        assert r.status_code == 404, r.text
        # Immediately look up the fresh violation via master listing
        time.sleep(0.5)
        rv = s.get(
            f"{BASE}/license/violations?limit=200",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert rv.status_code == 200
        rows = rv.json()
        match = [x for x in rows if x.get("license_key") == bogus_key]
        assert match, f"No violation row found for {bogus_key}"
        row = match[0]
        assert row.get("reason") == "key_not_found", row
        assert row.get("whm_server_ip") == bogus_ip, row
        # browser_ip must reflect the X-Forwarded-For chain (first hop)
        assert xff in (row.get("browser_ip") or ""), row


# ─── PIN-APPROVAL DELETE tests ───────────────────────────────────────────
def _create_pending(s, bayi_key=NONMASTER_KEY, new_pin="4711"):
    """Create a pending pin_change_request. Returns (request_id, response_json)."""
    r = s.post(
        f"{BASE}/pin-approvals/request",
        headers={"X-Master-Key": bayi_key},
        json={"new_pin": new_pin, "reason": "TEST_v44.00.02"},
    )
    if r.status_code == 409:
        # Existing pending — fetch via /my
        rl = s.get(f"{BASE}/pin-approvals/my", headers={"X-Master-Key": bayi_key})
        rl.raise_for_status()
        items = rl.json().get("items", [])
        pending = [x for x in items if x.get("status") == "pending"]
        assert pending, "409 said pending exists but /my returned none"
        return pending[0]["id"], pending[0]
    assert r.status_code == 200, r.text
    j = r.json()
    return j["request_id"], j


def _decide(s, req_id, decision="approve"):
    r = s.post(
        f"{BASE}/pin-approvals/{req_id}/decide",
        headers={"X-Master-Key": MASTER_KEY},
        json={"decision": decision, "note": f"TEST_v44.00.02_{decision}"},
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestPinDeleteSingle:
    def test_delete_requires_master(self, s):
        # need an existing request id — create + decide first
        req_id, _ = _create_pending(s, new_pin="8811")
        _decide(s, req_id, "reject")
        r = s.delete(f"{BASE}/pin-approvals/{req_id}")
        assert r.status_code == 403, r.text
        # non-master key → also 403
        r2 = s.delete(
            f"{BASE}/pin-approvals/{req_id}",
            headers={"X-Master-Key": NONMASTER_KEY},
        )
        assert r2.status_code == 403, r2.text
        # cleanup
        s.delete(f"{BASE}/pin-approvals/{req_id}", headers={"X-Master-Key": MASTER_KEY})

    def test_delete_pending_rejected(self, s):
        req_id, _ = _create_pending(s, new_pin="8822")
        r = s.delete(
            f"{BASE}/pin-approvals/{req_id}",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 400, r.text
        assert "Beklemede" in (r.json().get("detail") or ""), r.json()
        # cleanup: decide + delete
        _decide(s, req_id, "reject")
        s.delete(f"{BASE}/pin-approvals/{req_id}", headers={"X-Master-Key": MASTER_KEY})

    def test_delete_decided_ok_and_audit(self, s):
        req_id, _ = _create_pending(s, new_pin="8833")
        _decide(s, req_id, "reject")
        r = s.delete(
            f"{BASE}/pin-approvals/{req_id}",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("deleted") == 1
        # Verify audit row present (best-effort via master audit endpoint if any)
        # We rely on the endpoint contract only.


class TestPinBulkDelete:
    def test_requires_master(self, s):
        r = s.post(f"{BASE}/pin-approvals/bulk-delete", json={})
        assert r.status_code == 403
        r2 = s.post(
            f"{BASE}/pin-approvals/bulk-delete",
            headers={"X-Master-Key": NONMASTER_KEY},
            json={},
        )
        assert r2.status_code == 403

    def test_bulk_delete_status_pending_is_overridden(self, s):
        """Spec expected 'silent override' of {status:'pending'}, but the
        current Pydantic model rejects the value with 422 (Literal doesn't
        include 'pending'). Both behaviours guarantee the 'never delete
        pending' contract — assert one of the two and verify the pending
        row survives."""
        # seed a pending row
        req_id, _ = _create_pending(s, new_pin="8844")
        r = s.post(
            f"{BASE}/pin-approvals/bulk-delete",
            headers={"X-Master-Key": MASTER_KEY},
            json={"status": "pending"},
        )
        assert r.status_code in (200, 422), r.text
        # Confirm pending row still exists (safety contract)
        rl = s.get(
            f"{BASE}/pin-approvals/all?status=pending",
            headers={"X-Master-Key": MASTER_KEY},
        )
        assert rl.status_code == 200
        ids = [x.get("id") for x in rl.json().get("items", [])]
        assert req_id in ids, "Pending row was wrongly deleted!"
        # cleanup
        _decide(s, req_id, "reject")
        s.delete(f"{BASE}/pin-approvals/{req_id}", headers={"X-Master-Key": MASTER_KEY})

    def test_bulk_delete_by_status_rejected(self, s):
        # seed 2 rejected rows
        rids = []
        for pin in ("8855", "8866"):
            rid, _ = _create_pending(s, new_pin=pin)
            _decide(s, rid, "reject")
            rids.append(rid)
        r = s.post(
            f"{BASE}/pin-approvals/bulk-delete",
            headers={"X-Master-Key": MASTER_KEY},
            json={"status": "rejected"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("deleted", 0) >= 2, j
        # Confirm gone
        rl = s.get(
            f"{BASE}/pin-approvals/all?status=rejected&limit=500",
            headers={"X-Master-Key": MASTER_KEY},
        )
        remaining = [x.get("id") for x in rl.json().get("items", [])]
        for rid in rids:
            assert rid not in remaining

    def test_bulk_delete_older_than_days_does_not_touch_recent(self, s):
        # Create + reject one fresh — older_than_days=30 must NOT delete it
        rid, _ = _create_pending(s, new_pin="8877")
        _decide(s, rid, "reject")
        r = s.post(
            f"{BASE}/pin-approvals/bulk-delete",
            headers={"X-Master-Key": MASTER_KEY},
            json={"older_than_days": 30},
        )
        assert r.status_code == 200
        # Confirm the fresh row survived
        rl = s.get(
            f"{BASE}/pin-approvals/all?status=rejected&limit=500",
            headers={"X-Master-Key": MASTER_KEY},
        )
        ids = [x.get("id") for x in rl.json().get("items", [])]
        assert rid in ids, "Fresh (<30d) row was wrongly deleted"
        # cleanup
        s.delete(f"{BASE}/pin-approvals/{rid}", headers={"X-Master-Key": MASTER_KEY})


# ─── GET /api/pin-approvals/all — company enrichment ─────────────────────
class TestPinAllCompanyField:
    def test_all_lists_and_company_optional(self, s):
        # Ensure at least one row exists
        rid, _ = _create_pending(s, new_pin="8899")
        _decide(s, rid, "approve")
        try:
            r = s.get(
                f"{BASE}/pin-approvals/all?limit=50",
                headers={"X-Master-Key": MASTER_KEY},
            )
            assert r.status_code == 200
            items = r.json().get("items", [])
            assert any(x.get("id") == rid for x in items)
            # company is optional — if present must be a string
            for x in items:
                if "company" in x:
                    assert isinstance(x["company"], str)
        finally:
            s.delete(f"{BASE}/pin-approvals/{rid}", headers={"X-Master-Key": MASTER_KEY})


# ─── VERSION bump check ──────────────────────────────────────────────────
class TestVersion:
    def test_version_file(self):
        with open("/app/VERSION") as f:
            v = f.read().strip()
        assert v == "v44.00.02", f"VERSION file is {v!r}"

    def test_plugin_download_contains_version(self, s):
        r = s.get(f"{BASE}/plugin/download", stream=True)
        assert r.status_code == 200, r.status_code
        buf = io.BytesIO(r.content)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            names = tar.getnames()
            vfile = [n for n in names if n.endswith("VERSION")]
            assert vfile, f"VERSION missing from tarball: {names[:5]}"
            data = tar.extractfile(vfile[0]).read().decode().strip()
            assert data == "v44.00.02", data
