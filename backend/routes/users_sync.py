"""
Users Sync Routes — extracted from monolithic server.py as first modularization
step of the v1.4 refactor.

Contents:
  - GET  /users/sync-status
  - POST /users/sync            (bayi plugin daemon push)
  - POST /users/refresh-from-cpanel  (Master UI trigger)

NOTE: `POST /users/sync` bir yazma isteği olduğu için master demo-write-guard
middleware'i tarafından `X-Master-Key` header'ı zorunludur. Bayi plugin
daemon'ı ise `master_license_key` bilgisini ilgili license'tan çeker.
"""
from __future__ import annotations
import os
import json
import logging
import subprocess
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from deps import db


router = APIRouter(tags=["users-sync"])
log = logging.getLogger("gws.users_sync")


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class UserSyncAccount(BaseModel):
    username: str
    domain: Optional[str] = ""
    email_count_today: Optional[int] = 0
    spam_caught_today: Optional[int] = 0
    quarantine_size: Optional[int] = 0
    disk_used: Optional[str] = None
    plan: Optional[str] = None
    suspended: Optional[bool] = False


class UserSyncIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    accounts: list[dict] = Field(default_factory=list)


@router.get("/users/sync-status")
async def users_sync_status(request: Request):
    """v43.37 — Global cPanel sync durumu.

    Users sayfası üst şeridinde "Son senkron: <zaman> · <n> kullanıcı" göstergesi
    bunu tüketir. Bayi WHM plugin daemon her heartbeat cycle'da
    `POST /api/users/sync` çağırırsa buradaki last_synced_at değeri güncellenir.
    """
    master_key = (request.headers.get("x-master-key") or "").strip()
    q = {"license_key": master_key} if master_key.startswith("MS-") else {}
    total = await db.users.count_documents(q)
    latest = await db.users.find(
        q, {"_id": 0, "last_synced_at": 1, "source": 1, "license_key": 1},
    ).sort("last_synced_at", -1).limit(1).to_list(1)
    src: dict[str, int] = {}
    async for row in db.users.aggregate([
        {"$match": q}, {"$group": {"_id": "$source", "count": {"$sum": 1}}},
    ]):
        src[row["_id"] or "unknown"] = row["count"]
    return {
        "total": total,
        "last_synced_at": (latest[0].get("last_synced_at") if latest else None),
        "last_source": (latest[0].get("source") if latest else None),
        "sources": src,
        "generated_at": _iso(),
    }


@router.post("/users/sync")
async def users_sync(payload: UserSyncIn):
    """WHM plugin daemon `POST /api/users/sync` — gerçek cPanel hesap listesini push eder.
    Aynı license için ilk sync'te demo/seed kullanıcılar temizlenir."""
    lic = await db.licenses.find_one(
        {"license_key": payload.license_key, "active": True}, {"_id": 0})
    if not lic:
        raise HTTPException(403, "Geçersiz lisans")
    _DEMO_USERNAMES = {"example", "sirket", "tekno", "deneme", "kobi"}
    await db.users.delete_many({"username": {"$in": list(_DEMO_USERNAMES)}})
    ups = 0
    for a in payload.accounts[:1000]:
        u = str(a.get("username") or "").strip()
        if not u:
            continue
        await db.users.update_one(
            {"username": u},
            {"$set": {
                "username": u,
                "domain": a.get("domain", ""),
                "license_key": payload.license_key,
                "email_count_today": int(a.get("email_count_today") or 0),
                "spam_caught_today": int(a.get("spam_caught_today") or 0),
                "quarantine_size": int(a.get("quarantine_size") or 0),
                "source": "whm",
                "last_synced_at": _iso(),
            }},
            upsert=True,
        )
        ups += 1
    return {"synced": ups, "purged_demo": True}


@router.post("/users/refresh-from-cpanel")
async def users_refresh_from_cpanel(request: Request):
    """v43.32 — Master UI'dan tetiklenen sync.

    Akış:
    1. Yerel `/usr/local/cpanel/bin/whmapi1` varsa direkt listaccts çalıştır.
    2. Yoksa bayi WHM plugin daemon'a `plugin_demand_sync` sinyali yaz.
       Bayi daemon 60sn içinde algılayıp `POST /users/sync` yapar.

    Demo/örnek hesap ARTIK EKLENMEZ.
    """
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli (X-Master-Key header)")
    now = _iso()
    current_count = await db.users.count_documents({"license_key": master_key})

    whm_bin = "/usr/local/cpanel/bin/whmapi1"
    real_added, real_updated = 0, 0
    if os.path.exists(whm_bin) and os.access(whm_bin, os.X_OK):
        try:
            proc = subprocess.run(
                [whm_bin, "--output=json", "listaccts"],
                capture_output=True, text=True, timeout=25,
            )
            data = json.loads(proc.stdout or "{}")
            accounts = (data.get("data") or {}).get("acct") or []
            for a in accounts[:2000]:
                username = (a.get("user") or "").strip()
                if not username:
                    continue
                res = await db.users.update_one(
                    {"username": username},
                    {"$set": {
                        "username": username,
                        "domain": a.get("domain") or "",
                        "license_key": master_key,
                        "email_count_today": 0,
                        "spam_caught_today": 0,
                        "quarantine_size": 0,
                        "source": "whmapi1",
                        "last_synced_at": now,
                        "disk_used_mb": int(a.get("diskused", "0M").rstrip("M") or 0)
                                        if isinstance(a.get("diskused"), str) else None,
                        "disk_quota_mb": int(a.get("disklimit", "0M").rstrip("M") or 0)
                                         if isinstance(a.get("disklimit"), str) else None,
                        "email_addresses": [],
                    }},
                    upsert=True,
                )
                if res.upserted_id is not None:
                    real_added += 1
                elif res.modified_count > 0:
                    real_updated += 1
            return {
                "ok": True,
                "source": "whmapi1_local",
                "synced": real_added + real_updated,
                "added": real_added,
                "updated": real_updated,
                "previous_count": current_count,
                "note": f"Yerel WHM'den {real_added} yeni + {real_updated} güncellenen cPanel hesabı senkronize edildi.",
            }
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "WHM API zaman aşımı (listaccts 25sn'de yanıt vermedi)")
        except Exception as e:
            log.warning(f"[refresh-from-cpanel] whmapi1 failed: {e}")
            raise HTTPException(500, f"whmapi1 hata: {str(e)[:200]}")

    demand_count = 0
    async for lic in db.licenses.find({"active": True, "$or": [
        {"license_key": master_key},
        {"master_license_key": master_key},
    ]}, {"license_key": 1, "hostname": 1}):
        await db.settings.update_one(
            {"_key": f"plugin_demand_sync:{lic['license_key']}"},
            {"$set": {
                "_key": f"plugin_demand_sync:{lic['license_key']}",
                "license_key": lic["license_key"],
                "hostname": lic.get("hostname"),
                "requested_at": now,
                "requested_by": "master_ui",
                "handled": False,
            }},
            upsert=True,
        )
        demand_count += 1

    return {
        "ok": True,
        "source": "signal_only",
        "signaled_licenses": demand_count,
        "previous_count": current_count,
        "current_count": current_count,
        "note": (
            f"⚠ Bu sunucuda cPanel yok ({whm_bin} bulunamadı). {demand_count} bayi WHM "
            f"sunucusuna 'listaccts çalıştır ve gönder' sinyali yazıldı. Bayi plugin "
            f"daemon 60sn içinde algılayıp gerçek cPanel hesaplarını master'a push edecek."
            if demand_count > 0 else
            f"❌ Bu sunucuda cPanel yok ({whm_bin} bulunamadı) VE master'a bağlı aktif bayi lisansı yok. "
            f"Kullanıcı listesi için bayi WHM sunucularına GökyüzüWebSpam plugin kurulu ve aktif olmalı."
        ),
    }
