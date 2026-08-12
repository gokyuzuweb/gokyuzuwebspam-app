"""v39 — LiveMailEvents genişletilmiş limit + detaylı arama testleri.

Tests:
  F1: limit cap (5000 ok, 10000 → 422) + limit_applied response field
  F2: subject_search (case-insensitive contains)
  F3: from_search + min_score/max_score kombinasyonu
  F4: to_search
  F5: ip_search (sender/client/server IP herhangi biri)
  F6: hours filter
  F7: tenant isolation korunmuş (bayi master kayıtlarını göremez)
  F8: subject_search + verdict + hours kombinasyonu
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mailscanner-pro.preview.emergentagent.com").rstrip("/")
MASTER = "MS-C02AB012652A4FE692D69676"
BAYI = "MS-D85BE8E63A64478786361F54"


def _get(**params):
    return requests.get(f"{BASE_URL}/api/events", params=params, timeout=30)


class TestLimitCap:
    def test_limit_5000_ok(self):
        r = _get(license_key=MASTER, limit=5000)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("limit_applied") == 5000
        assert isinstance(data.get("items"), list)
        assert len(data["items"]) <= 5000

    def test_limit_10000_rejected(self):
        r = _get(license_key=MASTER, limit=10000)
        assert r.status_code == 422, f"expected 422 for limit>5000, got {r.status_code} {r.text}"

    def test_limit_default_applied(self):
        r = _get(license_key=MASTER)
        assert r.status_code == 200
        assert r.json().get("limit_applied") == 50


class TestSubjectSearch:
    def test_subject_case_insensitive(self):
        r = _get(license_key=MASTER, subject_search="TEST", limit=500)
        assert r.status_code == 200
        items = r.json()["items"]
        for it in items:
            assert "test" in (it.get("subject") or "").lower(), it.get("subject")


class TestFromMinMax:
    def test_from_with_score_range(self):
        r = _get(license_key=MASTER, from_search="spammer",
                 min_score=5, max_score=15, limit=500)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert "spammer" in (it.get("from_addr") or "").lower()
            sc = float(it.get("total_score") or 0)
            assert 5 <= sc <= 15, sc


class TestToSearch:
    def test_to_search(self):
        r = _get(license_key=MASTER, to_search="admin", limit=500)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert "admin" in (it.get("to_addr") or "").lower()


class TestIpSearch:
    def test_ip_search_any_field(self):
        r = _get(license_key=MASTER, ip_search="192.168", limit=500)
        assert r.status_code == 200
        for it in r.json()["items"]:
            hay = " ".join([
                str(it.get("sender_ip") or ""),
                str(it.get("client_ip") or ""),
                str(it.get("server_ip") or ""),
            ])
            assert "192.168" in hay, hay


class TestHoursFilter:
    def test_hours_1(self):
        r = _get(license_key=MASTER, hours=1, limit=500)
        assert r.status_code == 200
        # Sadece istekle döndü, içerik zamana bağlı — tip kontrolü
        assert isinstance(r.json()["items"], list)

    def test_hours_invalid(self):
        r = _get(license_key=MASTER, hours=99999)
        assert r.status_code == 422


class TestTenantIsolation:
    def test_bayi_cannot_see_master_via_search(self):
        # Bayi lisansı ile aynı ekstra filtreler master kayıtlarını sızdırmamalı.
        r = _get(license_key=BAYI, subject_search="test", limit=500)
        assert r.status_code == 200
        for it in r.json()["items"]:
            # Her item BAYI lisans anahtarına ait olmalı
            assert it.get("license_key") == BAYI, it.get("license_key")


class TestCombinedFilters:
    def test_subject_verdict_hours(self):
        r = _get(license_key=MASTER, subject_search="test",
                 verdict="spam", hours=24, limit=500)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert "test" in (it.get("subject") or "").lower()
            assert it.get("verdict") == "spam"
