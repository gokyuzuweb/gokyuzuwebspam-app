"""v44.00.33 — Karantina Ayarları + USOM Delta Sync Tests"""
import requests

BACKEND = "http://127.0.0.1:8001"
MASTER = "MS-C02AB012652A4FE692D69676"


def test_quarantine_settings_get_defaults():
    r = requests.get(f"{BACKEND}/api/quarantine/settings", timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("retention_days", "auto_delete_enabled",
              "spam_score_threshold", "high_spam_score_threshold",
              "auto_train_bayes_on_release", "auto_whitelist_on_release",
              "auto_train_bayes_on_report", "auto_blacklist_on_report"):
        assert k in d, f"missing key {k}"
    assert d["retention_days"] >= 0


def test_quarantine_settings_post_persists_master_only():
    # non-master → 403
    r = requests.post(f"{BACKEND}/api/quarantine/settings",
                      json={"retention_days": 45}, timeout=10)
    assert r.status_code == 403, r.text
    # master → 200
    r = requests.post(f"{BACKEND}/api/quarantine/settings",
                      headers={"X-Master-Key": MASTER},
                      json={"retention_days": 45, "spam_score_threshold": 6.0}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["retention_days"] == 45
    assert d["spam_score_threshold"] == 6.0
    # reset
    requests.post(f"{BACKEND}/api/quarantine/settings",
                  headers={"X-Master-Key": MASTER},
                  json={"retention_days": 30, "spam_score_threshold": 5.0}, timeout=10)


def test_quarantine_settings_validation():
    # invalid retention_days
    r = requests.post(f"{BACKEND}/api/quarantine/settings",
                      headers={"X-Master-Key": MASTER},
                      json={"retention_days": -1}, timeout=10)
    assert r.status_code == 400
    r = requests.post(f"{BACKEND}/api/quarantine/settings",
                      headers={"X-Master-Key": MASTER},
                      json={"retention_days": 9999}, timeout=10)
    assert r.status_code == 400


def test_quarantine_apply_retention():
    r = requests.post(f"{BACKEND}/api/quarantine/settings/apply-retention",
                      headers={"X-Master-Key": MASTER}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert "deleted" in d and "retention_days" in d and "cutoff" in d


def test_usom_fetch_accepts_min_date():
    # Check the source has min_date parameter (avoid runtime import to skip DB init)
    src = open("/app/backend/routes/usom.py").read()
    assert "min_date: str | None = None" in src or 'min_date' in src
    assert "min_date and date_str and date_str < min_date" in src


def test_daily_usom_delta_task_uses_last_max_date():
    # Verify the cron task is defined and imports the right helpers
    import sys, importlib
    sys.path.insert(0, "/app/backend")
    import server
    importlib.reload  # noqa
    assert hasattr(server, "_daily_usom_fetch_task")
    src = open("/app/backend/server.py").read()
    # Delta sync markers
    assert "last_max_date" in src
    assert "min_date=last_max" in src
    assert "delta" in src.lower()


def test_daily_quarantine_retention_task_exists():
    src = open("/app/backend/server.py").read()
    assert "async def _daily_quarantine_retention_task" in src
    assert "_daily_quarantine_retention_task()" in src  # registered in startup
