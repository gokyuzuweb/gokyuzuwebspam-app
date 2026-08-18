"""v43.84 — Weekly Report Sparkline (daily_trend) + Theme Preview + Search Highlight.

Backend tests (theme preview + highlight are frontend-only):
- 01 weekly-report response includes daily_trend (list of 7 days)
- 02 each daily_trend entry has 'day' and 'count' fields
- 03 sum of daily_trend counts >= total_new_suggestions (bugün üretilenler
     dahil son 7 günün toplamı, TAM eşit değil çünkü toplamada başka fark olabilir)
- 04 PDF endpoint returns larger size than v43.83 (sparkline ekli)
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


class TestWeeklySparkline:
    def test_01_response_includes_daily_trend(self):
        r = requests.post(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report",
                          headers=_hdrs(), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "daily_trend" in d
        assert isinstance(d["daily_trend"], list)
        assert len(d["daily_trend"]) == 7   # exactly 7 days

    def test_02_daily_trend_entries_structure(self):
        r = requests.post(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report",
                          headers=_hdrs(), timeout=20)
        d = r.json()
        for entry in d["daily_trend"]:
            assert "day" in entry
            assert "count" in entry
            assert isinstance(entry["count"], int)
            # day format MM-DD
            assert len(entry["day"]) == 5
            assert entry["day"][2] == "-"

    def test_03_daily_trend_counts_consistent(self):
        r = requests.post(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report",
                          headers=_hdrs(), timeout=20)
        d = r.json()
        # Sum of daily counts should match total_new_suggestions
        total_from_trend = sum(e["count"] for e in d["daily_trend"])
        assert total_from_trend == d["total_new_suggestions"], \
            f"trend sum={total_from_trend} != total_new={d['total_new_suggestions']}"

    def test_04_pdf_download_larger_than_baseline(self):
        r = requests.get(f"{API}/mailscanner/ai/quarantine-recommend/weekly-report.pdf",
                         headers=_hdrs(), timeout=15)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF-1.")
        # v43.83 was ~3580 byte, sparkline ekli olduğu için >4000
        assert len(r.content) > 4000, f"PDF too small: {len(r.content)} bytes"
