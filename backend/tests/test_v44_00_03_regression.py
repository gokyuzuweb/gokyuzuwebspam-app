"""v44.00.03 regression suite.

Covers:
  * Blacklist tenant leak fix — GET /api/blacklist/requests scoped by owner
  * Blacklist authorization — bayi cannot mutate master's request; master can mutate all
  * Engines master cascade — master toggle propagates to non-master resellers
  * Reseller engine toggle does NOT affect other tenants (master_cascaded_to=0)
  * Bounce digest export CSV (BOM + 8 columns) & XLSX (openpyxl binary)
  * verify-license bogus key short-circuit → 404 + key_not_found violation
"""
from __future__ import annotations
import os
import uuid
import pytest
import requests


def _load_backend_url() -> str:
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
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
RESELLER_STARTER = "MS-TESTBAYI-STARTER-V4371"
RESELLER_PRO = "MS-TESTBAYI-PRO-V4371"
H_MASTER = {"X-Master-Key": MASTER_KEY}


# ------------------------------------------------------------------
# 1) BLACKLIST TENANT LEAK FIX
# ------------------------------------------------------------------
class TestBlacklistTenantIsolation:
    def test_a_get_requests_bayi_scoped_empty_or_own_only(self):
        # bayi (no master hdr) — must only see own (may be empty)
        r = requests.get(f"{BASE}/blacklist/requests?license_key={RESELLER_STARTER}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        # Every row (if any) must belong to this reseller
        for row in body:
            assert row.get("owner_license_key") == RESELLER_STARTER, f"leak: {row}"

    def test_b_get_requests_master_sees_all(self):
        r = requests.get(f"{BASE}/blacklist/requests", headers=H_MASTER, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)

    def test_c_reseller_creates_request_scoped_to_owner(self):
        payload = {
            "target": f"test-{uuid.uuid4().hex[:8]}.example.com",
            "type": "domain",
            "provider_codes": ["spamhaus_dbl"],
            "contact_email": "abuse@example.com",
            "reason": "TEST_v44_00_03 tenant isolation",
        }
        r = requests.post(
            f"{BASE}/blacklist/delist?license_key={RESELLER_STARTER}",
            json=payload, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("created", 0) >= 1
        created = data["requests"][0]
        assert created.get("owner_license_key") == RESELLER_STARTER
        # Master should see this new record
        m = requests.get(f"{BASE}/blacklist/requests", headers=H_MASTER, timeout=15).json()
        ids = {row.get("id") for row in m}
        assert created["id"] in ids, "master list does not include the newly created bayi request"
        # And it must be in bayi's own list
        b = requests.get(f"{BASE}/blacklist/requests?license_key={RESELLER_STARTER}", timeout=15).json()
        assert created["id"] in {row.get("id") for row in b}
        # PRO reseller must NOT see this record
        p = requests.get(f"{BASE}/blacklist/requests?license_key={RESELLER_PRO}", timeout=15).json()
        assert created["id"] not in {row.get("id") for row in p}, "leak into another reseller"
        # Stash id via class variable
        TestBlacklistTenantIsolation._starter_req_id = created["id"]

    def test_d_master_creates_own_request(self):
        payload = {
            "target": f"master-{uuid.uuid4().hex[:8]}.example.com",
            "type": "domain",
            "provider_codes": ["spamhaus_dbl"],
            "contact_email": "abuse@example.com",
            "reason": "TEST_v44_00_03 master-owned",
        }
        r = requests.post(f"{BASE}/blacklist/delist", headers=H_MASTER, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("created", 0) >= 1
        TestBlacklistTenantIsolation._master_req_id = data["requests"][0]["id"]
        # bayi must NOT see master's record
        b = requests.get(f"{BASE}/blacklist/requests?license_key={RESELLER_STARTER}", timeout=15).json()
        assert TestBlacklistTenantIsolation._master_req_id not in {row.get("id") for row in b}

    def test_e_bayi_cannot_update_masters_request(self):
        mid = getattr(TestBlacklistTenantIsolation, "_master_req_id", None)
        assert mid, "prereq missing"
        upd = {"status": "resolved", "notes": "should be blocked"}
        r = requests.put(f"{BASE}/blacklist/requests/{mid}?license_key={RESELLER_STARTER}",
                         json=upd, timeout=15)
        assert r.status_code == 403, r.text
        # POST alt endpoint too
        r2 = requests.post(f"{BASE}/blacklist/requests/{mid}/update?license_key={RESELLER_STARTER}",
                           json=upd, timeout=15)
        assert r2.status_code == 403, r2.text

    def test_f_bayi_can_update_own_request(self):
        sid = getattr(TestBlacklistTenantIsolation, "_starter_req_id", None)
        assert sid, "prereq missing"
        upd = {"status": "resolved", "notes": "TEST_v44_00_03 own-update"}
        r = requests.put(f"{BASE}/blacklist/requests/{sid}?license_key={RESELLER_STARTER}",
                        json=upd, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("updated") is True

    def test_g_master_can_update_bayi_request(self):
        sid = getattr(TestBlacklistTenantIsolation, "_starter_req_id", None)
        assert sid, "prereq missing"
        upd = {"status": "submitted", "notes": "TEST_v44_00_03 master-override"}
        r = requests.put(f"{BASE}/blacklist/requests/{sid}", headers=H_MASTER, json=upd, timeout=15)
        assert r.status_code == 200, r.text


# ------------------------------------------------------------------
# 2) ENGINES MASTER CASCADE
# ------------------------------------------------------------------
class TestEnginesMasterCascade:
    ENGINE = "spamassassin"

    @classmethod
    def _master_engine_state(cls) -> bool:
        r = requests.get(f"{BASE}/engines", headers=H_MASTER, timeout=15)
        assert r.status_code == 200, r.text
        for e in r.json():
            if e.get("name") == cls.ENGINE:
                return bool(e.get("enabled"))
        raise AssertionError("master spamassassin engine not found")

    @classmethod
    def _reseller_engine_state(cls, lk: str) -> bool:
        r = requests.get(f"{BASE}/engines?license_key={lk}", timeout=15)
        assert r.status_code == 200, r.text
        for e in r.json():
            if e.get("name") == cls.ENGINE:
                return bool(e.get("enabled"))
        raise AssertionError(f"reseller {lk} spamassassin engine not found")

    def test_a_snapshot_original_state(self):
        # Ensure reseller row exists via bootstrap (GET triggers _engines_for)
        _ = self._reseller_engine_state(RESELLER_STARTER)
        TestEnginesMasterCascade._orig_master = self._master_engine_state()

    def test_b_master_toggle_cascades(self):
        r = requests.post(f"{BASE}/engines/{self.ENGINE}/toggle", headers=H_MASTER, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == self.ENGINE
        assert "master_cascaded_to" in data
        assert data["master_cascaded_to"] >= 1, f"expected cascade >=1, got {data}"
        new_master_val = data["enabled"]
        # Reseller must reflect new_master_val
        rs = self._reseller_engine_state(RESELLER_STARTER)
        assert rs == new_master_val, f"cascade broken: master={new_master_val} reseller={rs}"
        TestEnginesMasterCascade._after_first_toggle = new_master_val

    def test_c_master_toggle_back_cascades(self):
        r = requests.post(f"{BASE}/engines/{self.ENGINE}/toggle", headers=H_MASTER, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["master_cascaded_to"] >= 1
        rs = self._reseller_engine_state(RESELLER_STARTER)
        assert rs == data["enabled"]

    def test_d_reseller_toggle_does_not_cascade(self):
        """On master panel, bayi write is blocked (403 BAYI_ON_MASTER_PANEL).
        Either way, master + other resellers must not change state."""
        before_master = self._master_engine_state()
        before_pro = self._reseller_engine_state(RESELLER_PRO)
        r = requests.post(
            f"{BASE}/engines/{self.ENGINE}/toggle?license_key={RESELLER_STARTER}",
            timeout=15,
        )
        # Accept 403 (master-panel block) OR 200 (own panel path)
        assert r.status_code in (200, 403), r.text
        if r.status_code == 200:
            data = r.json()
            assert data.get("master_cascaded_to", 0) == 0, f"reseller toggle should not cascade: {data}"
            # Undo so we don't drift starter's state
            requests.post(
                f"{BASE}/engines/{self.ENGINE}/toggle?license_key={RESELLER_STARTER}",
                timeout=15,
            )
        # Master + PRO reseller unchanged in either case
        assert self._master_engine_state() == before_master
        assert self._reseller_engine_state(RESELLER_PRO) == before_pro

    def test_e_teardown_restore_master_state(self):
        cur = self._master_engine_state()
        orig = getattr(TestEnginesMasterCascade, "_orig_master", cur)
        if cur != orig:
            r = requests.post(f"{BASE}/engines/{self.ENGINE}/toggle", headers=H_MASTER, timeout=15)
            assert r.status_code == 200
        assert self._master_engine_state() == orig


# ------------------------------------------------------------------
# 3) BOUNCE DIGEST EXPORT
# ------------------------------------------------------------------
class TestBounceDigestExport:
    def test_a_csv_export_ok(self):
        r = requests.get(
            f"{BASE}/bounce-digest/export",
            params={"hours": 24, "fmt": "csv", "license_key": MASTER_KEY},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct, f"unexpected content-type: {ct}"
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and "bounce-digest-" in cd and ".csv" in cd, cd
        content = r.content
        # First bytes must be UTF-8 BOM
        assert content.startswith(b"\xef\xbb\xbf"), f"missing UTF-8 BOM, got {content[:8]!r}"
        # Header row check — decode after BOM
        text = content.decode("utf-8-sig")
        lines = [l for l in text.splitlines() if l.strip()]
        assert len(lines) >= 1
        header_cols = lines[0].split(",")
        expected = ["tarih", "alici", "gonderici", "kullanici", "sebep", "kod", "konu", "boyut_kb"]
        assert header_cols == expected, f"header cols mismatch: {header_cols}"

    def test_b_xlsx_export_ok(self):
        r = requests.get(
            f"{BASE}/bounce-digest/export",
            params={"hours": 24, "fmt": "xlsx", "license_key": MASTER_KEY},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml.sheet" in ct, ct
        # XLSX = ZIP → starts with PK
        assert r.content[:2] == b"PK", "not a valid xlsx (missing PK header)"
        assert len(r.content) > 100

    def test_c_missing_license_key_400(self):
        # no license_key + no master header → 400
        r = requests.get(
            f"{BASE}/bounce-digest/export",
            params={"hours": 24, "fmt": "csv"},
            timeout=15,
        )
        assert r.status_code == 400, r.text


# ------------------------------------------------------------------
# 4) VERIFY-LICENSE key_not_found SHORT-CIRCUIT
# ------------------------------------------------------------------
class TestVerifyLicenseShortCircuit:
    def test_a_bogus_key_returns_404_and_writes_violation(self):
        bogus_key = f"MS-BOGUS-KEY-{uuid.uuid4().hex[:6].upper()}"
        payload = {"license_key": bogus_key, "ip": "5.6.7.8", "hostname": "test.bogus"}
        r = requests.post(f"{BASE}/plugin/verify-license", json=payload, timeout=15)
        assert r.status_code == 404, r.text
        body = r.json()
        # detail is the Turkish msg
        detail = body.get("detail") or body.get("message") or ""
        assert "Lisans" in detail and ("geçersiz" in detail or "aktif" in detail), detail
        # Verify canonical violation row exists via master API
        v = requests.get(f"{BASE}/license/violations", headers=H_MASTER, timeout=15)
        assert v.status_code == 200, v.text
        rows = v.json() if isinstance(v.json(), list) else v.json().get("items", [])
        # Find our row by license_key
        matches = [x for x in rows if x.get("license_key") == bogus_key]
        assert matches, f"no violation row written for {bogus_key}"
        # reason must be key_not_found (no ambiguous_shared_ip)
        row = matches[0]
        assert row.get("reason") == "key_not_found", f"unexpected reason: {row.get('reason')}"
