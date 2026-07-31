"""
Shared dependencies for GökyüzüWebSpam routes.
Import DB, models and helpers here so route modules avoid circular imports.
Historical: extracted from monolithic server.py in v1.4 (Feb 2026).
"""
from __future__ import annotations
import os
from motor.motor_asyncio import AsyncIOMotorClient

# ---- Env & DB ---------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
PLUGIN_MODE = os.environ.get("MAILSHIELD_MODE", "seller").lower()

_client = AsyncIOMotorClient(MONGO_URL)
db = _client[DB_NAME]


def seller_only():
    """FastAPI dependency to enforce seller mode on an endpoint."""
    from fastapi import HTTPException
    if PLUGIN_MODE != "seller":
        raise HTTPException(403, "Sadece satıcı modu")
    return True
