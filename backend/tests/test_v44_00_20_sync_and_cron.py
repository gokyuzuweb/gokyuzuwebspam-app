"""v44.00.20 (part 3) — Whitelist UI sync + IOC domain daily cron."""
from __future__ import annotations
from pathlib import Path


def test_whitelist_endpoint_syncs_to_lists_collection():
    """`/plugin/trusted-domains` POST must mirror into `db.lists`."""
    src = Path("/app/backend/server.py").read_text()
    assert 'await db.lists.insert_one(list_doc)' in src, "trusted_domains → lists mirror insert missing"
    assert '"synced_to_ui": True' in src


def test_scan_verdict_reads_both_lists_collections():
    """scan-verdict must read whitelist/blacklist from BOTH `trusted_domains` and `lists`."""
    src = Path("/app/backend/server.py").read_text()
    # Both collections referenced in whitelist merge
    assert 'db.trusted_domains.find({"kind": "whitelist"}' in src
    assert 'db.lists.find({"entry_type": "domain", "list_type": "white"}' in src
    assert 'db.lists.find({"entry_type": "domain", "list_type": "black"}' in src
    # Email entries also merged
    assert 'db.lists.find({"entry_type": "email"' in src


def test_migration_task_scheduled():
    """One-time migration from trusted_domains to lists at startup."""
    src = Path("/app/backend/server.py").read_text()
    assert "asyncio.create_task(_migrate_trusted_domains_to_lists())" in src
    assert "async def _migrate_trusted_domains_to_lists" in src


def test_delete_trusted_domain_also_removes_from_lists():
    """DELETE endpoint must remove from lists collection too."""
    src = Path("/app/backend/server.py").read_text()
    assert 'await db.lists.delete_many({"entry_type": "domain", "value": dom})' in src


def test_ioc_domain_extract_helper_extracted():
    """Refactor: reusable helper _run_ioc_domain_extract_once() available."""
    src = Path("/app/backend/routes/threat_intel.py").read_text()
    assert "async def _run_ioc_domain_extract_once" in src
    # POST endpoint delegates to helper
    assert "return await _run_ioc_domain_extract_once()" in src


def test_daily_ioc_extract_cron_scheduled():
    """Daily 04:00 UTC cron for URL→domain extraction."""
    src = Path("/app/backend/server.py").read_text()
    assert "asyncio.create_task(_daily_ioc_domain_extract_task())" in src
    assert "async def _daily_ioc_domain_extract_task" in src
    # Runs at 04:00 UTC
    assert "if now.hour == 4:" in src
    # Uses shared helper
    assert "from routes.threat_intel import _run_ioc_domain_extract_once" in src
