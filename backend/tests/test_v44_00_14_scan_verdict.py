"""v44.00.14 — Panel-authority scan-verdict endpoint testleri.

Exim system_filter bu endpoint'i her mail delivery ÖNCESİ çağırır.
Verdict'e göre mail Inbox/Junk'a routing yapılır.
"""
import os
import pytest
import requests

BASE = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")


def _scan(**kwargs):
    return requests.post(f"{BASE}/api/plugin/scan-verdict",
                         json=kwargs, timeout=5).json()


def test_normal_mail_is_clean():
    r = _scan(subject="Toplantı", from_addr="ali@x.com",
              body="Merhaba, dosyayı ekte gönderdim.")
    assert r["verdict"] == "clean"
    assert r["score"] < 5


def test_gtube_string_is_high_spam():
    """GTUBE endüstri-standart spam test string — mutlaka HIGH_SPAM."""
    r = _scan(subject="test",
              body="XJS*C4JDBQADN1.NSBN3*2IDNEN*GTUBE-STANDARD-ANTI-UBE-TEST-EMAIL*C.34X")
    assert r["verdict"] == "high_spam"
    assert "GTUBE" in r["reasons"]


def test_whitelist_domain_never_spam():
    """gokyuzuhosting/gokyuzuweb domain'lerinden gelen mail spam sayılmasın."""
    r = _scan(
        subject="CASINO WIN MONEY VIAGRA",
        from_addr="admin@gokyuzuhosting.com",
        body="click here to claim urgent action required you have won",
    )
    assert r["verdict"] == "clean", f"Whitelist bypass edilmedi: {r}"
    assert "WHITELISTED" in r["reasons"]


def test_yandex_loop_header_ignored():
    """Yandex forward header'ı skoru yükseltmesin (döngü koruması)."""
    r = _scan(subject="normal", body="normal body",
              headers="X-Yandex-Spam: 1\nX-Yandex-Forward: abc")
    assert r["verdict"] == "clean"
    assert "YANDEX_LOOP_IGNORED" in r["reasons"]


def test_many_spam_phrases_triggers_spam():
    r = _scan(subject="WIN FREE BITCOIN",
              from_addr="spammer@evil.com",
              body="viagra casino win money lottery winner urgent action required")
    assert r["verdict"] in ("spam", "high_spam")
    assert r["score"] >= 5


def test_endpoint_returns_valid_verdicts_only():
    """Verdict daima 3 değerden biri olmalı."""
    for body in ["", "a", "spam" * 100, "viagra casino"]:
        r = _scan(subject="test", body=body)
        assert r["verdict"] in ("clean", "spam", "high_spam")
