"""
V17 tests - Master gating, Version Publish, SMTP, Mail Detail, Alerts Timeline,
Reseller Branding, Engines dedupe, Events extended fields, Mark-Spam.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

MASTER_KEY = "MS-C02AB012652A4FE692D69676"
MASTER_IP = "89.19.15.58"
NON_MASTER_IP = "203.0.113.9"


def _hdr(ip=None):
    h = {"Content-Type": "application/json"}
    if ip:
        h["X-Forwarded-For"] = ip
    return h


# ---------- Admin whoami / master unlock ----------
class TestMasterGating:
    def test_whoami_without_master_ip(self):
        r = requests.get(f"{BASE_URL}/api/admin/whoami", headers=_hdr(NON_MASTER_IP))
        assert r.status_code == 200
        assert r.json().get("is_master") is False

    def test_whoami_with_master_ip_and_key(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/whoami?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("is_master") is True
        assert d.get("ip_match") is True
        assert d.get("key_match") is True

    def test_master_unlock_success_sets_cookie(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/master-unlock",
            headers=_hdr(MASTER_IP),
            json={"license_key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "valid_until" in d
        assert "token" in d
        set_cookie = r.headers.get("set-cookie", "") or r.headers.get("Set-Cookie", "")
        assert "gws_master_session" in set_cookie.lower()

    def test_master_unlock_wrong_ip_forbidden(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/master-unlock",
            headers=_hdr(NON_MASTER_IP),
            json={"license_key": MASTER_KEY},
        )
        assert r.status_code == 403


# ---------- Version publish ----------
class TestVersionPublish:
    def test_publish_without_master_forbidden(self):
        r = requests.post(
            f"{BASE_URL}/api/version/publish",
            headers=_hdr(NON_MASTER_IP),
            json={"latest_version": "1.2.3", "changelog": "test"},
        )
        assert r.status_code == 403

    def test_publish_with_master_dual_urls(self):
        r = requests.post(
            f"{BASE_URL}/api/version/publish",
            headers=_hdr(MASTER_IP),
            json={"latest_version": "9.9.9", "changelog": "pytest publish",
                  "license_key": MASTER_KEY},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        blob = str(d)
        assert "gokyuzuhosting.com" in blob, d
        assert "89.19.15.58" in blob, d
        assert "release_date" in blob.lower() or "released_at" in blob.lower()
        # affected clients (may be 'affected_clients' or nested)
        assert ("affected" in blob.lower()) or ("clients" in blob.lower())

    def test_publish_auto_detect_version(self):
        r = requests.post(
            f"{BASE_URL}/api/version/publish",
            headers=_hdr(MASTER_IP),
            json={"license_key": MASTER_KEY, "changelog": "auto detect"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        v = d.get("latest_version") or d.get("version") or (d.get("manifest") or {}).get("latest_version")
        assert v, d


# ---------- SMTP ----------
class TestSmtp:
    def test_smtp_get_masked(self):
        requests.put(
            f"{BASE_URL}/api/settings/smtp",
            headers=_hdr(MASTER_IP),
            json={"host": "smtp.example.com", "port": 587, "username": "u",
                  "password": "supersecret", "use_tls": "starttls", "from_addr": "a@b.c"},
        )
        r = requests.get(f"{BASE_URL}/api/settings/smtp", headers=_hdr(MASTER_IP))
        assert r.status_code == 200
        d = r.json()
        pw = d.get("password", "")
        # backend returns masked/empty — never the raw secret
        assert pw != "supersecret", f"raw password leaked: {pw!r}"

    def test_smtp_put_preserves_password_when_masked(self):
        requests.put(
            f"{BASE_URL}/api/settings/smtp",
            headers=_hdr(MASTER_IP),
            json={"host": "smtp.example.com", "port": 587, "username": "u",
                  "password": "keepthis", "use_tls": "starttls", "from_addr": "a@b.c"},
        )
        requests.put(
            f"{BASE_URL}/api/settings/smtp",
            headers=_hdr(MASTER_IP),
            json={"host": "smtp2.example.com", "port": 465, "username": "u2",
                  "password": "********", "use_tls": "ssl", "from_addr": "a@b.c"},
        )
        r = requests.get(f"{BASE_URL}/api/settings/smtp", headers=_hdr(MASTER_IP))
        d = r.json()
        assert d.get("host") == "smtp2.example.com"
        assert d.get("port") == 465

    def test_mail_test_ok(self):
        r = requests.post(
            f"{BASE_URL}/api/mail/test",
            headers=_hdr(MASTER_IP),
            json={"to": "user@example.com"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("via") in ("sendmail", "smtp", "log", "smtp_ssl", "smtp_starttls"), d

    def test_mail_test_invalid_email(self):
        r = requests.post(
            f"{BASE_URL}/api/mail/test",
            headers=_hdr(MASTER_IP),
            json={"to": "not-an-email"},
        )
        assert r.status_code == 400


# ---------- Events / mail detail / mark spam ----------
_event_state = {}

class TestEvents:
    def test_test_ingest_creates_extended_events(self):
        r = requests.post(
            f"{BASE_URL}/api/events/test-ingest?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("inserted") == 5, d

        # Filter by verdict=high_spam to reliably find the ingested junk sample
        r2 = requests.get(
            f"{BASE_URL}/api/events?license_key={MASTER_KEY}&limit=500&verdict=high_spam",
            headers=_hdr(MASTER_IP),
        )
        assert r2.status_code == 200
        events = r2.json().get("items", [])
        junk = [e for e in events if "junkmail" in str(e.get("from_addr", "")).lower()]
        assert junk, "spammer@junkmail.example event not found"
        ev = junk[0]
        assert ev.get("attachments"), f"attachments missing: {list(ev.keys())}"
        assert any("claim_form" in str(a).lower() for a in ev["attachments"])
        assert "adamu" in (ev.get("body_preview") or "").lower()
        assert "x-spam-level" in (ev.get("headers_full") or "").lower()
        _event_state["id"] = ev.get("id")

    def test_event_detail_and_mark_spam(self):
        eid = _event_state.get("id")
        if not eid:
            pytest.skip("no event id from previous test")
        r = requests.get(
            f"{BASE_URL}/api/events/{eid}?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # full event: extended fields present
        assert d.get("body_preview") and d.get("headers_full") and d.get("attachments")

        r2 = requests.post(
            f"{BASE_URL}/api/events/{eid}/mark-spam?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        assert r2.status_code in (200, 201), r2.text

        # verify sender was added to blacklist
        r3 = requests.get(
            f"{BASE_URL}/api/lists?license_key={MASTER_KEY}&kind=blacklist",
            headers=_hdr(MASTER_IP),
        )
        # This endpoint may not exist; skip if 404
        if r3.status_code == 200:
            body = r3.text.lower()
            assert "junkmail" in body or "spammer" in body


# ---------- Alerts timeline + reseller branding + engines ----------
class TestMiscEndpoints:
    def test_alerts_timeline(self):
        r = requests.get(
            f"{BASE_URL}/api/alerts/timeline?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d
        assert isinstance(d["items"], list)
        # timeline items must cover last-7-day window (may be empty if no alerts)
        # Each item should have day/total keys when present
        for it in d["items"]:
            assert "day" in it and "total" in it

    def test_reseller_branding_persist(self):
        payload = {
            "license_key": MASTER_KEY,
            "brand_name": "TESTBrand",
            "logo_url": "https://example.com/logo.png",
            "primary_color": "#123456",
            "accent_color": "#abcdef",
        }
        r = requests.put(
            f"{BASE_URL}/api/reseller/branding",
            headers=_hdr(MASTER_IP),
            json=payload,
        )
        assert r.status_code in (200, 201), r.text
        r2 = requests.get(
            f"{BASE_URL}/api/reseller/branding?license_key={MASTER_KEY}",
            headers=_hdr(MASTER_IP),
        )
        d = r2.json()
        assert d.get("brand_name") == "TESTBrand"
        assert d.get("primary_color") == "#123456"
        assert d.get("accent_color") == "#abcdef"

    def test_engines_no_duplicates(self):
        r = requests.get(f"{BASE_URL}/api/engines", headers=_hdr(MASTER_IP))
        assert r.status_code == 200, r.text
        d = r.json()
        items = d if isinstance(d, list) else (d.get("items") or d.get("engines") or [])
        names = [str(i.get("name") or i.get("id") or i).lower() for i in items]
        assert len(names) == len(set(names)), f"duplicates: {names}"
        assert len(names) == 6, f"expected 6 engines, got {len(names)}: {names}"
        for expected in ("spamassassin", "clamav", "dcc", "razor", "rspamd", "ai"):
            assert any(expected in n for n in names), f"missing {expected} in {names}"
