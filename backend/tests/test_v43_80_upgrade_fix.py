"""v43.80 — Havale + Stripe auto-upgrade fix.

Bug: v43.78 auto-upgrade queried `licenses.email` but the schema field is
`customer_email` → license never found → upgrade silently skipped.

Also: Stripe checkout `_finalize_purchase` created a brand-new license
instead of upgrading an existing bayi's license.

Tests:
- 01 havale approve upgrades starter → pro (customer_email schema, active=True)
- 02 havale approve upgrades legacy license (active field missing)
- 03 havale approve doesn't upgrade if no matching email
- 04 mid-cycle keeps remaining days (max(now, cur_exp) + days)
- 05 case-insensitive email match
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

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


def _hdrs():
    return {
        "X-Master-Key": MASTER_KEY,
        "X-Forwarded-For": os.environ.get("MASTER_IP", "89.19.15.58"),
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    yield d
    client.close()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class TestHavaleAutoUpgrade:
    """Bug fix regression: havale approve auto-upgrades existing license."""

    def _seed_and_approve(self, db, *, email_field="customer_email", active=True,
                          plan="starter", cur_exp=None, target_plan="pro",
                          cycle="monthly", email_case_variation=None):
        email = f"upg-{uuid.uuid4().hex[:8]}@example.tld"
        lic_key = f"MS-UPGRT-{uuid.uuid4().hex[:12].upper()}"
        mo = f"TRF-UPGRT-{uuid.uuid4().hex[:10].upper()}"
        lic_doc = {
            "id": lic_key, "license_key": lic_key,
            "customer_name": "Test",
            email_field: email, "plan": plan, "ip_addresses": [], "max_domains": 10,
            "notes": "test", "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if active is not None:
            lic_doc["active"] = active
        if cur_exp:
            lic_doc["valid_until"] = cur_exp
            lic_doc["subscription_expires_at"] = cur_exp
        _run(db.licenses.insert_one(lic_doc))
        pay_email = email_case_variation or email
        _run(db.payments.insert_one({
            "id": mo, "merchant_oid": mo, "provider": "havale",
            "status": "awaiting_transfer", "email": pay_email, "user_name": "T",
            "amount": 599.0, "currency": "TL", "plan": target_plan, "cycle": cycle,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        r = requests.post(
            f"{API}/payments/havale/approve",
            headers=_hdrs(),
            json={"merchant_oid": mo, "admin_note": "test"},
            timeout=15,
        )
        return r, lic_key, mo, email

    def _cleanup(self, db, lic_key, mo):
        _run(db.licenses.delete_many({"license_key": lic_key}))
        _run(db.payments.delete_many({"merchant_oid": mo}))
        _run(db.master_alerts.delete_many({"license_key": lic_key}))
        _run(db.notifications_inbox.delete_many({"license_key": lic_key}))

    def test_01_upgrade_starter_to_pro(self, db):
        r, lic_key, mo, email = self._seed_and_approve(db, plan="starter", target_plan="pro")
        try:
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["ok"] is True
            assert j["upgrade"]["upgraded"] is True
            assert j["upgrade"]["from_plan"] == "starter"
            assert j["upgrade"]["to_plan"] == "pro"
            lic = _run(db.licenses.find_one({"license_key": lic_key}, {"_id": 0}))
            assert lic["plan"] == "pro"
            assert lic["valid_until"] == lic["subscription_expires_at"]
            assert lic["license_version"] == 1
            assert lic["active"] is True
        finally:
            self._cleanup(db, lic_key, mo)

    def test_02_upgrade_legacy_license_missing_active_field(self, db):
        """Eski lisanslarda 'active' alanı yok — filter yine bulmalı ve active=True set etmeli."""
        r, lic_key, mo, email = self._seed_and_approve(db, active=None, plan="starter", target_plan="pro")
        try:
            assert r.status_code == 200
            j = r.json()
            assert j["upgrade"]["upgraded"] is True
            lic = _run(db.licenses.find_one({"license_key": lic_key}, {"_id": 0}))
            assert lic["plan"] == "pro"
            assert lic["active"] is True
        finally:
            self._cleanup(db, lic_key, mo)

    def test_03_no_matching_email_returns_upgraded_false(self, db):
        """Payment email lisansta olmayan bir email → upgraded=false, reason döner."""
        # Seed a lic with email_A but payment with email_B
        email_lic = f"lic-{uuid.uuid4().hex[:8]}@a.tld"
        email_pay = f"pay-{uuid.uuid4().hex[:8]}@b.tld"
        lic_key = f"MS-NOMATCH-{uuid.uuid4().hex[:10].upper()}"
        mo = f"TRF-NOMATCH-{uuid.uuid4().hex[:10].upper()}"
        _run(db.licenses.insert_one({
            "id": lic_key, "license_key": lic_key, "customer_email": email_lic,
            "plan": "starter", "active": True, "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        _run(db.payments.insert_one({
            "id": mo, "merchant_oid": mo, "provider": "havale", "status": "awaiting_transfer",
            "email": email_pay, "plan": "pro", "amount": 599.0, "currency": "TL",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        try:
            r = requests.post(f"{API}/payments/havale/approve", headers=_hdrs(),
                              json={"merchant_oid": mo}, timeout=15)
            assert r.status_code == 200
            j = r.json()
            assert j["upgrade"]["upgraded"] is False
            assert "reason" in j["upgrade"]
        finally:
            _run(db.licenses.delete_many({"license_key": lic_key}))
            _run(db.payments.delete_many({"merchant_oid": mo}))

    def test_04_mid_cycle_preserves_remaining_days(self, db):
        """Kalan 10 gün varsa yeni bitiş = kalan + 30g (yaklaşık 40g'den fazla)."""
        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        r, lic_key, mo, _ = self._seed_and_approve(
            db, plan="pro", target_plan="enterprise", cur_exp=future, cycle="monthly",
        )
        try:
            assert r.status_code == 200
            j = r.json()
            assert j["upgrade"]["upgraded"] is True
            # Yeni expires >= şimdi + 39 gün (10 + 30 - biraz güvenlik)
            new_exp = datetime.fromisoformat(j["upgrade"]["expires_at"].replace("Z", "+00:00"))
            delta_days = (new_exp - datetime.now(timezone.utc)).days
            assert delta_days >= 39, f"mid-cycle should preserve remaining time, got delta_days={delta_days}"
        finally:
            self._cleanup(db, lic_key, mo)

    def test_05_case_insensitive_email_match(self, db):
        """Payment email UPPERCASE, license email lowercase — yine eşleşmeli."""
        r, lic_key, mo, email = self._seed_and_approve(
            db, plan="starter", target_plan="pro",
            email_case_variation=None,  # will do the trick below
        )
        try:
            # Re-seed manually with mixed case
            pass
        finally:
            self._cleanup(db, lic_key, mo)
        # Ayrı bir tam-case senaryo:
        email = f"case-{uuid.uuid4().hex[:6]}@Ornek.TLD"
        lic_key2 = f"MS-CASE-{uuid.uuid4().hex[:10].upper()}"
        mo2 = f"TRF-CASE-{uuid.uuid4().hex[:10].upper()}"
        _run(db.licenses.insert_one({
            "id": lic_key2, "license_key": lic_key2,
            "customer_email": email.lower(), "plan": "starter", "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        _run(db.payments.insert_one({
            "id": mo2, "merchant_oid": mo2, "provider": "havale", "status": "awaiting_transfer",
            "email": email.upper(), "plan": "pro", "amount": 599.0, "currency": "TL",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }))
        try:
            r2 = requests.post(f"{API}/payments/havale/approve", headers=_hdrs(),
                               json={"merchant_oid": mo2}, timeout=15)
            assert r2.status_code == 200, r2.text
            assert r2.json()["upgrade"]["upgraded"] is True
        finally:
            _run(db.licenses.delete_many({"license_key": lic_key2}))
            _run(db.payments.delete_many({"merchant_oid": mo2}))
            _run(db.master_alerts.delete_many({"license_key": lic_key2}))
            _run(db.notifications_inbox.delete_many({"license_key": lic_key2}))
