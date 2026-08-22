"""v44.00.07 — PIN request → master e-posta bildirimi entegrasyon testi.

Bayı `/api/pin-approvals/request` çağırdığında:
  1. `pin_change_requests` DB'ye pending kayıt düşer
  2. `master_alerts` DB'ye info seviyesinde uyarı düşer
  3. `notify.admin_email` doluysa → `_send_email(master_email, ...)` tetiklenir

Bu test `_send_email`'i mock'layıp doğru payload ile çağrıldığını doğrular.
"""
from __future__ import annotations
import asyncio
import os
import uuid
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(scope="module")
def event_loop():
    """Module-scoped async loop."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def clean_test_db():
    """Test için izole bayı + master admin e-postası seed'le."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    test_lk = f"MS-PIN-TEST-{uuid.uuid4().hex[:10].upper()}"
    # 1) Test bayı lisansı
    await db.licenses.insert_one({
        "license_key": test_lk,
        "customer_name": "PIN Test Bayı",
        "customer_email": "pin.test@example.com",
        "plan": "pro",
        "active": True,
        "ip_addresses": ["203.0.113.99"],
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    # 2) Master admin e-postası ayarla
    await db.settings.update_one(
        {"_key": "notify"},
        {"$set": {"_key": "notify", "admin_email": "master-admin@gokyuzuhosting.com"}},
        upsert=True,
    )

    yield {"license_key": test_lk, "db": db}

    # Cleanup
    await db.licenses.delete_one({"license_key": test_lk})
    await db.pin_change_requests.delete_many({"bayi_license_key": test_lk})
    await db.master_alerts.delete_many({"details.license_key": test_lk})


class TestPinRequestEmailNotification:
    """PIN talebi → master e-posta akışı."""

    @pytest.mark.asyncio
    async def test_pin_request_triggers_master_email(self, clean_test_db):
        """Bayı /request endpoint'ini çağırınca _send_email master admin adresine
        doğru payload ile çağrılmalı."""
        cfg = clean_test_db
        # server modülünü import et — _send_email burada
        import sys, importlib
        sys.path.insert(0, "/app/backend")
        if "server" in sys.modules:
            server = sys.modules["server"]
        else:
            server = importlib.import_module("server")

        # _send_email'i mock'la
        mock_send = AsyncMock(return_value=(True, "smtp"))
        with patch.object(server, "_send_email", mock_send):
            # /request endpoint'ini simüle et
            from routes.pin_approvals import request_pin_change, PinChangeRequestIn
            from fastapi import Request
            from starlette.datastructures import Headers

            # Sahte Request nesnesi
            class _FakeRequest:
                def __init__(self, headers, client_host="203.0.113.99"):
                    self.headers = Headers(headers)
                    class C: pass
                    self.client = C()
                    self.client.host = client_host

            req = _FakeRequest({"x-master-key": cfg["license_key"], "user-agent": "test-bot"})
            payload = PinChangeRequestIn(new_pin="1234", reason="Test PIN değişikliği")

            resp = await request_pin_change(payload, req)
            assert resp.get("ok") is True
            assert resp.get("status") == "pending"

            # DB kaydı düştü mü?
            db = cfg["db"]
            row = await db.pin_change_requests.find_one({"bayi_license_key": cfg["license_key"]})
            assert row is not None, "pin_change_requests satırı oluşturulmadı"
            assert row.get("status") == "pending"

            # master_alerts kaydı düştü mü?
            alert = await db.master_alerts.find_one({"details.license_key": cfg["license_key"]})
            assert alert is not None, "master_alerts satırı oluşturulmadı"
            assert alert.get("type") == "pin_change_request"

            # _send_email çağrıldı mı?
            assert mock_send.called, "_send_email hiç çağrılmadı"
            call = mock_send.call_args
            args, kwargs = call.args, call.kwargs
            # (to, subject, body) positional veya kwargs olabilir
            to_addr = args[0] if args else kwargs.get("to_addr")
            subject = args[1] if len(args) > 1 else kwargs.get("subject")
            body = args[2] if len(args) > 2 else kwargs.get("body")
            assert to_addr == "master-admin@gokyuzuhosting.com", f"Yanlış to: {to_addr}"
            assert "PIN Değişikliği" in subject or "PIN" in subject, f"Subject: {subject}"
            assert "PIN Test Bayı" in body, "Bayı adı body'de yok"
            assert cfg["license_key"] in body, "Lisans key body'de yok"
            assert "203.0.113.99" in body, "IP body'de yok"

    @pytest.mark.asyncio
    async def test_pin_request_without_master_email_still_succeeds(self, clean_test_db):
        """notify.admin_email ayarlı değilse talep yine oluşmalı (e-posta hatası bloke ETMEMELİ)."""
        cfg = clean_test_db
        db = cfg["db"]
        # notify.admin_email'i sil
        await db.settings.update_one({"_key": "notify"}, {"$unset": {"admin_email": ""}})

        # Farklı bir bayı ile test et (pending çakışması olmasın)
        alt_lk = f"MS-PIN-TEST2-{uuid.uuid4().hex[:8].upper()}"
        await db.licenses.insert_one({
            "license_key": alt_lk,
            "customer_name": "Alt Bayı",
            "customer_email": "alt@example.com",
            "plan": "pro",
            "active": True,
            "ip_addresses": ["203.0.113.100"],
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        try:
            from routes.pin_approvals import request_pin_change, PinChangeRequestIn
            from starlette.datastructures import Headers

            class _FakeRequest:
                def __init__(self, headers, client_host="203.0.113.100"):
                    self.headers = Headers(headers)
                    class C: pass
                    self.client = C()
                    self.client.host = client_host
            req = _FakeRequest({"x-master-key": alt_lk})
            payload = PinChangeRequestIn(new_pin="5678", reason="no-mail-test")
            resp = await request_pin_change(payload, req)
            assert resp.get("ok") is True, "Talep oluşturulmalıydı"
        finally:
            await db.licenses.delete_one({"license_key": alt_lk})
            await db.pin_change_requests.delete_many({"bayi_license_key": alt_lk})
