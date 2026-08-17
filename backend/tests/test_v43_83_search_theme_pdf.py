"""v43.83 — Öneri Arama (frontend), Discord kanal seçici + role mention,
Kilit ekranı teması, Weekly Report PDF.

Tests (backend):
- 01 idle-lock/me PUT theme='alarm' persists ve GET yansıtır
- 02 idle-lock/me PUT theme='light' persists
- 03 idle-lock/me PUT invalid theme → 422
- 04 discord config extra_webhooks + mention_role_id save/round-trip
- 05 weekly-report response now includes pdf_attached + pdf_size_bytes
- 06 weekly-report.pdf endpoint returns application/pdf 200 with %PDF magic
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


class TestIdleLockTheme:
    def test_01_set_alarm_theme(self, db):
        r = requests.put(f"{API}/settings/idle-lock/me",
                         json={"theme": "alarm"},
                         headers=_hdrs(), timeout=10)
        assert r.status_code == 200, r.text
        # Read back
        r2 = requests.get(f"{API}/settings/idle-lock/me", headers=_hdrs(), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["theme"] == "alarm"

    def test_02_set_light_theme(self, db):
        r = requests.put(f"{API}/settings/idle-lock/me",
                         json={"theme": "light"},
                         headers=_hdrs(), timeout=10)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/settings/idle-lock/me", headers=_hdrs(), timeout=10)
        assert r2.json()["theme"] == "light"

    def test_03_invalid_theme_rejected(self, db):
        r = requests.put(f"{API}/settings/idle-lock/me",
                         json={"theme": "rainbow"},
                         headers=_hdrs(), timeout=10)
        assert r.status_code == 422
        # Cleanup — reset to dark
        requests.put(f"{API}/settings/idle-lock/me", json={"theme": "dark"},
                     headers=_hdrs(), timeout=10)


class TestDiscordMultiWebhook:
    def test_04_extra_webhooks_and_mention_role_roundtrip(self, db):
        payload = {
            "enabled": True, "send_hour_utc": 9,
            "delivery_method": "discord",
            "discord_webhook_url": "https://discord.com/api/webhooks/100/main",
            "discord_extra_webhooks": "https://discord.com/api/webhooks/200/two\nhttps://discord.com/api/webhooks/300/three",
            "discord_mention_role_id": "1234567890",
        }
        r = requests.post(f"{API}/bounce-digest/config", headers=_hdrs(),
                          json=payload, timeout=10)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/bounce-digest/config", headers=_hdrs(), timeout=10)
        cfg = r2.json()
        assert cfg["discord_extra_webhooks"].count("discord.com") == 2
        assert cfg["discord_mention_role_id"] == "1234567890"
        # Cleanup
        requests.post(f"{API}/bounce-digest/config", headers=_hdrs(),
                      json={"enabled": True, "send_hour_utc": 9,
                            "delivery_method": "panel"}, timeout=10)


class TestWeeklyReportPDF:
    def test_05_weekly_report_response_pdf_metadata(self, db):
        r = requests.post(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report",
                          headers=_hdrs(), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["pdf_attached"] is True
        assert d["pdf_size_bytes"] > 500   # sane PDF minimum

    def test_06_weekly_report_pdf_download(self, db):
        r = requests.get(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report.pdf",
                         headers=_hdrs(), timeout=15)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF-1.")
        assert len(r.content) > 500
