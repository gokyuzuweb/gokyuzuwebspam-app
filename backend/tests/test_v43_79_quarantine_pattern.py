"""v43.79 — Karantina Kalıp Taraması (AI Rule Recommendations from quarantine).

Endpoint: POST /api/mailscanner/ai/quarantine-recommend/run
Function: routes.mailscanner.run_quarantine_pattern_scan

Covers:
- 0 quarantine → scanned=0, suggested=0 (graceful)
- Seed 20 quarantine docs from evil.example → domain suggestion generated
- Suggestion contains hit_count, sample_subjects, source=quarantine_pattern
- Idempotency: re-run produces 0 new suggestions (skipped_existing incremented)
- Tenant isolation: license_A quarantine does not surface in license_B scan
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

if not os.environ.get("MONGO_URL") or not os.environ.get("DB_NAME"):
    with open("/app/backend/.env") as f:
        for l in f:
            if l.startswith("MONGO_URL=") and not os.environ.get("MONGO_URL"):
                os.environ["MONGO_URL"] = l.split("=", 1)[1].strip().strip('"')
            if l.startswith("DB_NAME=") and not os.environ.get("DB_NAME"):
                os.environ["DB_NAME"] = l.split("=", 1)[1].strip().strip('"')

MASTER_KEY = os.environ.get("MASTER_LICENSE_KEY", "MS-C02AB012652A4FE692D69676")
API = f"{BASE_URL}/api"

# License keys used ONLY for this test — cleaned up after
LIC_A = f"MS-TEST-QUA-A-{uuid.uuid4().hex[:8].upper()}"
LIC_B = f"MS-TEST-QUA-B-{uuid.uuid4().hex[:8].upper()}"


def _hdrs():
    return {
        "X-Master-Key": MASTER_KEY,
        "X-Forwarded-For": os.environ.get("MASTER_IP", "89.19.15.58"),
    }


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    yield d
    client.close()


@pytest.fixture(scope="module", autouse=True)
def _cleanup(db):
    async def _clean():
        for lic in (LIC_A, LIC_B):
            await db.quarantine.delete_many({"owner_license_key": lic})
            await db.mailscanner_rule_suggestions.delete_many({"license_key": lic})
            await db.mailscanner_rules.delete_many({"license_key": lic})
            await db.ai_training_log.delete_many({"license_key": lic})
    asyncio.get_event_loop().run_until_complete(_clean())
    yield
    asyncio.get_event_loop().run_until_complete(_clean())


def _seed_qua(db, license_key, count, sender="evil@evil.example", subject="ucuz kredi kazanc"):
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for i in range(count):
        docs.append({
            "id": f"qua-{license_key}-{i}-{uuid.uuid4().hex[:6]}",
            "owner_license_key": license_key,
            "license_key": license_key,
            "sender": sender,
            "recipient": f"user{i}@local.tld",
            "subject": f"{subject} {i}",
            "verdict": "high_spam",
            "engine": "spamassassin",
            "received_at": now,
        })
    async def _ins():
        if docs:
            await db.quarantine.insert_many(docs)
    asyncio.get_event_loop().run_until_complete(_ins())


class TestQuarantinePatternScan:
    def test_01_empty_scan(self, db):
        """0 quarantine → graceful zero response."""
        r = requests.post(
            f"{API}/mailscanner/ai/quarantine-recommend/run",
            params={"license_key": LIC_A, "days": 7, "min_hits": 3},
            headers=_hdrs(),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["scanned"] == 0
        assert d["suggested"] == 0
        assert d["patterns_found"] == 0

    def test_02_seed_and_scan_produces_suggestion(self, db):
        """20 docs from evil.example → domain suggestion with hit_count=20."""
        _seed_qua(db, LIC_A, 20, sender="badguy@evil.example", subject="acil kredi teklifi")
        r = requests.post(
            f"{API}/mailscanner/ai/quarantine-recommend/run",
            params={"license_key": LIC_A, "days": 7, "min_hits": 3},
            headers=_hdrs(),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["scanned"] == 20
        assert d["suggested"] >= 1
        assert d["skipped_existing"] == 0

        # Fetch suggestions list and validate structure
        r2 = requests.get(
            f"{API}/mailscanner/ai/self-train/suggestions",
            params={"license_key": LIC_A, "applied": "false"},
            headers=_hdrs(),
            timeout=10,
        )
        assert r2.status_code == 200
        items = r2.json().get("items", [])
        qua_items = [i for i in items if i.get("source") == "quarantine_pattern"]
        assert len(qua_items) >= 1
        dom_sugg = next(
            (i for i in qua_items if i.get("sub_source") == "sender_domain"),
            None,
        )
        assert dom_sugg is not None, "sender_domain suggestion expected"
        assert dom_sugg["hit_count"] == 20
        assert "evil" in dom_sugg["pattern"] and "example" in dom_sugg["pattern"]
        assert dom_sugg["target"] == "sender"
        assert dom_sugg["score"] >= 3.5
        assert isinstance(dom_sugg.get("sample_subjects"), list)

    def test_03_idempotency_rerun_skips_existing(self, db):
        """Re-running the scan produces 0 new but increments skipped_existing."""
        r = requests.post(
            f"{API}/mailscanner/ai/quarantine-recommend/run",
            params={"license_key": LIC_A, "days": 7, "min_hits": 3},
            headers=_hdrs(),
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["suggested"] == 0, f"Expected 0 new suggestions, got {d['suggested']}"
        assert d["skipped_existing"] >= 1

    def test_04_tenant_isolation(self, db):
        """LIC_B has NO quarantine → scanning LIC_B does not pull LIC_A's."""
        r = requests.post(
            f"{API}/mailscanner/ai/quarantine-recommend/run",
            params={"license_key": LIC_B, "days": 7, "min_hits": 3},
            headers=_hdrs(),
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["scanned"] == 0, f"Cross-tenant leak: LIC_B saw {d['scanned']} docs"
        assert d["suggested"] == 0

    def test_05_apply_suggestion_promotes_to_rule(self, db):
        """Onayla → mailscanner_rules'a taşınır, suggestion applied=True olur."""
        r = requests.get(
            f"{API}/mailscanner/ai/self-train/suggestions",
            params={"license_key": LIC_A, "applied": "false"},
            headers=_hdrs(),
            timeout=10,
        )
        items = r.json().get("items", [])
        qua = next((i for i in items if i.get("source") == "quarantine_pattern"), None)
        assert qua is not None, "should have at least one open quarantine suggestion"

        r2 = requests.post(
            f"{API}/mailscanner/ai/self-train/apply/{qua['id']}",
            params={"license_key": LIC_A},
            headers=_hdrs(),
            timeout=10,
        )
        assert r2.status_code == 200, r2.text
        j = r2.json()
        assert j["ok"] is True
        rule = j["rule"]
        assert rule["pattern"] == qua["pattern"]
        assert rule["target"] == qua["target"]
        assert rule["enabled"] is True

    def test_06_min_hits_filter(self, db):
        """min_hits=50 filter → yeterli hit yok, öneri üretilmez (mevcut LIC_A 20 hit)."""
        # Yeni bir lisans kullan, mevcut önerilerle karışmasın
        LIC_C = f"MS-TEST-QUA-C-{uuid.uuid4().hex[:8].upper()}"
        _seed_qua(db, LIC_C, 5, sender="a@low.tld", subject="düşük hit")
        try:
            r = requests.post(
                f"{API}/mailscanner/ai/quarantine-recommend/run",
                params={"license_key": LIC_C, "days": 7, "min_hits": 50},
                headers=_hdrs(),
                timeout=15,
            )
            assert r.status_code == 200
            d = r.json()
            assert d["scanned"] == 5
            assert d["suggested"] == 0, "min_hits=50 shouldn't produce any suggestion for 5 docs"
        finally:
            async def _c():
                await db.quarantine.delete_many({"owner_license_key": LIC_C})
                await db.mailscanner_rule_suggestions.delete_many({"license_key": LIC_C})
                await db.ai_training_log.delete_many({"license_key": LIC_C})
            asyncio.get_event_loop().run_until_complete(_c())
