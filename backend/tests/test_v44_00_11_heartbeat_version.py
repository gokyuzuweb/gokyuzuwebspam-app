"""
v44.00.11 regression tests — heartbeat version tracking bug fix
================================================================

Bug: Master panel "Kurulu Versiyon" sütunu müşterinin gerçek kurulu
sürümünü göstermiyordu. Sebep: `license_heartbeat` IP mismatch (403)
durumunda `last_heartbeat_version` alanını GÜNCELLEMEDEN çıkıyordu.

Fix: Heartbeat lisans bulunduğunda `payload.version` alanını daima yazar;
IP/domain/tarih validasyonu yalnızca HTTP cevap kodunu belirler, versiyon
izleme alanları güncellenmeye devam eder.

Test yaklaşımı: canlı backend'e (supervisord ile çalışan) HTTP çağrısı
yapıp DB'yi doğrudan kontrol eder. TestClient event-loop çatışmalarından
kaçınmak için requests kütüphanesi kullanılır.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "gws_master_db")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def seeded_lic(db):
    key = f"MS-TEST{uuid.uuid4().hex[:20].upper()}"
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "license_key": key,
        "customer_name": "Test v44.00.11",
        "customer_email": "test@example.com",
        "plan": "pro",
        "ip_addresses": ["203.0.113.99"],
        "max_domains": 100,
        "valid_until": (now + timedelta(days=365)).isoformat(),
        "active": True,
        "created_at": now.isoformat(),
    }
    db.licenses.insert_one(doc)
    yield key
    db.licenses.delete_one({"license_key": key})


def _hb(key, ip, version=None, use_alias=True):
    body = {"license_key": key, "ip": ip, "hostname": "customer.example.com"}
    if version is not None:
        if use_alias:
            body["plugin_version"] = version
        body["version"] = version
    return requests.post(f"{BASE_URL}/api/plugin/heartbeat", json=body, timeout=5)


def test_heartbeat_happy_path_saves_version(db, seeded_lic):
    r = _hb(seeded_lic, "203.0.113.99", "44.00.11")
    assert r.status_code == 200, r.text
    doc = db.licenses.find_one({"license_key": seeded_lic})
    assert doc["last_heartbeat_version"] == "44.00.11"
    assert doc["last_heartbeat_ip"] == "203.0.113.99"


def test_heartbeat_ip_mismatch_still_saves_version(db, seeded_lic):
    """REGRESSION: v44.00.10'da IP mismatch → 403 → version GÜNCELLENMİYORDU."""
    # Baseline
    r1 = _hb(seeded_lic, "203.0.113.99", "44.00.10")
    assert r1.status_code == 200
    # Wrong IP, new version
    r2 = _hb(seeded_lic, "10.0.0.5", "44.00.11")
    assert r2.status_code == 403
    doc = db.licenses.find_one({"license_key": seeded_lic})
    assert doc["last_heartbeat_version"] == "44.00.11", (
        f"IP mismatch heartbeat version'ı yazmadı — master panel eski gösterir. "
        f"Got: {doc.get('last_heartbeat_version')}"
    )


def test_heartbeat_alias_plugin_version_only(db, seeded_lic):
    """gws-simple-push timer'ı yalnızca `plugin_version` göndermiş olsa dahi
    backend bunu `version` field'ına map etmelidir."""
    r = requests.post(f"{BASE_URL}/api/plugin/heartbeat", json={
        "license_key": seeded_lic,
        "ip": "203.0.113.99",
        "plugin_version": "44.00.11",
    }, timeout=5)
    assert r.status_code == 200
    doc = db.licenses.find_one({"license_key": seeded_lic})
    assert doc["last_heartbeat_version"] == "44.00.11"


def test_heartbeat_empty_version_preserves_old(db, seeded_lic):
    """Payload version boş gönderilirse eski değer korunmalı — yanlış
    varsayılan (örn. 44.00.05) master paneli yanıltmamalı."""
    # Baseline
    _hb(seeded_lic, "203.0.113.99", "44.00.11")
    # Empty version
    r = requests.post(f"{BASE_URL}/api/plugin/heartbeat", json={
        "license_key": seeded_lic,
        "ip": "203.0.113.99",
    }, timeout=5)
    assert r.status_code == 200
    doc = db.licenses.find_one({"license_key": seeded_lic})
    # v44.00.11'de mevcut eski değer korunmalı (44.00.11), 44.00.05 default'a düşmemeli
    assert doc["last_heartbeat_version"] == "44.00.11"
