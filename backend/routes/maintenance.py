"""
DB bakım/temizlik endpoint'leri.
- Kullanılan alan raporu (koleksiyon boyutları)
- Cache/veri temizleme (ayarlar KORUNUR, sadece geçmiş data silinir)
- Sender IP → country resolve + block
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- Koleksiyon kategorileri ----
# DATA_COLS: silinecek "veri" koleksiyonları (event/history/log)
# SETTINGS_COLS: KORUNACAK ayar/config/lisans koleksiyonları
DATA_COLS = [
    "mail_events", "quarantine", "exploit_scans", "exploit_findings",
    "queue_audit", "pending_quarantine_actions", "alerts_fired",
    "logs", "ai_explanations", "ai_narrations", "ai_weekly_reports",
    "docs_qa_log", "module_qa_log", "dmarc_reports", "threat_iocs",
    "delist_requests", "outbound_queue", "notifications_history",
    "reseller_logins",
]
SETTINGS_COLS = [
    "settings", "licenses", "users", "engines", "rules", "lists",
    "mailscanner_config", "mailscanner_rules", "mailscanner_policies",
    "notifications_config", "smtp_settings", "pricing",
    "reseller_accounts", "country_rules", "alert_rules", "branding",
    "auto_suspend", "compliance_state", "docs_media", "onboarding_state",
]


@router.get("/db-usage")
async def db_usage():
    """Mongo koleksiyon boyutları + kayıt sayıları."""
    stats = await db.command({"dbstats": 1, "scale": 1024})
    cols = []
    total_docs_data = 0
    total_docs_settings = 0
    total_bytes_data = 0
    total_bytes_settings = 0
    all_cols = await db.list_collection_names()
    for name in all_cols:
        try:
            cs = await db.command({"collStats": name, "scale": 1})
            count = cs.get("count", 0)
            size = cs.get("size", 0)  # bytes
            storage = cs.get("storageSize", 0)
            kind = "data" if name in DATA_COLS else ("settings" if name in SETTINGS_COLS else "other")
            cols.append({
                "name": name, "count": count,
                "size_bytes": size, "storage_bytes": storage,
                "kind": kind,
            })
            if kind == "data":
                total_docs_data += count
                total_bytes_data += size
            elif kind == "settings":
                total_docs_settings += count
                total_bytes_settings += size
        except Exception:
            pass
    cols.sort(key=lambda c: c["size_bytes"], reverse=True)
    return {
        "db_name": stats.get("db"),
        "collections": len(cols),
        "storage_kb": stats.get("storageSize"),
        "data_kb": stats.get("dataSize"),
        "index_kb": stats.get("indexSize"),
        "totals": {
            "data_docs": total_docs_data,
            "settings_docs": total_docs_settings,
            "data_bytes": total_bytes_data,
            "settings_bytes": total_bytes_settings,
        },
        "items": cols,
        "will_delete": DATA_COLS,
        "will_preserve": SETTINGS_COLS,
    }


class CleanupIn(BaseModel):
    confirm: str = Field(..., description="'DELETE_DATA' yazılırsa siler")
    older_than_days: Optional[int] = Field(None, ge=0, le=365,
                                            description="Sadece bu günden eskiler silinir. None → tümü")
    collections: Optional[list[str]] = None  # None → tüm DATA_COLS


@router.post("/cleanup")
async def cleanup_data(payload: CleanupIn):
    """Sadece veri koleksiyonlarını temizler. Ayarlar/lisanslar korunur.
    Confirm='DELETE_DATA' zorunlu."""
    if payload.confirm != "DELETE_DATA":
        raise HTTPException(400, "Onay için 'DELETE_DATA' yazın")
    targets = payload.collections or DATA_COLS
    # settings koleksiyonlarına dokunma!
    targets = [c for c in targets if c in DATA_COLS]
    if not targets:
        raise HTTPException(400, "Silinebilir koleksiyon yok")
    filter_query: dict = {}
    if payload.older_than_days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=payload.older_than_days)).isoformat()
        # 'created_at', 'ingested_at', 'ts' hangisi varsa
        filter_query = {"$or": [
            {"created_at": {"$lt": cutoff}},
            {"ingested_at": {"$lt": cutoff}},
            {"ts": {"$lt": cutoff}},
        ]}
    results = []
    total_deleted = 0
    for name in targets:
        try:
            r = await db[name].delete_many(filter_query)
            results.append({"collection": name, "deleted": r.deleted_count})
            total_deleted += r.deleted_count
        except Exception as ex:
            results.append({"collection": name, "error": str(ex)[:100]})
    # Log the cleanup
    await db.maintenance_log.insert_one({
        "id": str(uuid.uuid4()), "action": "data_cleanup",
        "older_than_days": payload.older_than_days,
        "collections": targets, "deleted": total_deleted,
        "results": results, "created_at": _iso(),
    })
    return {"ok": True, "total_deleted": total_deleted,
            "collections_affected": len(results),
            "results": results,
            "note": "Ayarlar, lisanslar ve konfigürasyonlar KORUNDU. Sadece geçmiş veriler silindi."}


@router.get("/cleanup-log")
async def cleanup_log(limit: int = 20):
    rows = await db.maintenance_log.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}


# ============================================================================
# AUTO-CLEANUP CRON: her ayın 1'inde 90 günden eski data'yı "askıya al"
# (silmez — status=archived, archived_at ekler; sonra manuel silinebilir)
# ============================================================================
class AutoCleanupCfg(BaseModel):
    enabled: bool = True
    older_than_days: int = 90
    day_of_month: int = 1        # her ayın X'i
    hour_utc: int = 3            # UTC 03:00
    action: str = "archive"      # "archive" | "delete"
    email_to: Optional[str] = None
    last_run_at: Optional[str] = None
    last_archived: Optional[int] = None


@router.get("/auto-cleanup")
async def get_auto_cleanup():
    doc = await db.settings.find_one({"_key": "auto_cleanup"}, {"_id": 0}) or {}
    doc.pop("_key", None)
    if not doc:
        doc = AutoCleanupCfg().model_dump()
    return doc


@router.post("/auto-cleanup")
async def set_auto_cleanup(cfg: AutoCleanupCfg):
    await db.settings.update_one(
        {"_key": "auto_cleanup"},
        {"$set": {"_key": "auto_cleanup", **cfg.model_dump()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/auto-cleanup/run-now")
async def auto_cleanup_run_now():
    """Cron'u beklemeden hemen çalıştır (test/manual)."""
    from datetime import timedelta
    r = await _run_auto_cleanup_once()
    return r


async def _run_auto_cleanup_once():
    """Actual cron job body — 90 günden eski verileri arşivle veya sil, sonra e-posta gönder."""
    from datetime import timedelta
    cfg_doc = await db.settings.find_one({"_key": "auto_cleanup"}, {"_id": 0}) or {}
    days = int(cfg_doc.get("older_than_days") or 90)
    action = cfg_doc.get("action") or "archive"
    email_to = cfg_doc.get("email_to")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    filter_query = {"$or": [
        {"created_at": {"$lt": cutoff}},
        {"ingested_at": {"$lt": cutoff}},
        {"ts": {"$lt": cutoff}},
    ]}
    results = []
    total = 0
    for name in DATA_COLS:
        try:
            if action == "delete":
                r = await db[name].delete_many(filter_query)
                results.append({"collection": name, "deleted": r.deleted_count})
                total += r.deleted_count
            else:
                r = await db[name].update_many(
                    {**filter_query, "archived": {"$ne": True}},
                    {"$set": {"archived": True, "archived_at": _iso()}},
                )
                results.append({"collection": name, "archived": r.modified_count})
                total += r.modified_count
        except Exception as ex:
            results.append({"collection": name, "error": str(ex)[:100]})
    log_doc = {
        "id": str(uuid.uuid4()), "action": f"auto_cleanup_{action}",
        "older_than_days": days, "collections": DATA_COLS,
        "deleted": total if action == "delete" else 0,
        "archived": total if action == "archive" else 0,
        "results": results, "created_at": _iso(),
    }
    await db.maintenance_log.insert_one(log_doc)
    await db.settings.update_one({"_key": "auto_cleanup"}, {"$set": {
        "last_run_at": _iso(),
        "last_archived": total if action == "archive" else 0,
        "last_deleted": total if action == "delete" else 0,
    }})
    # E-mail rapor
    if email_to:
        try:
            from server import _send_email
            action_tr = "arşivlendi" if action == "archive" else "silindi"
            body = (
                f"GökyüzüWebSpam · Otomatik Veri Bakımı Raporu\n"
                f"Tarih: {_iso()}\nEşik: {days} günden eski\nAksiyon: {action_tr}\n"
                f"Toplam kayıt: {total}\n\nKoleksiyonlar:\n"
                + "\n".join(f"  · {r['collection']}: "
                            + str(r.get('deleted') or r.get('archived') or r.get('error') or 0)
                            for r in results)
                + "\n\n(Ayarlar ve lisanslar KORUNDU.)"
            )
            await _send_email(email_to, "🧹 Otomatik Veri Bakımı Raporu — GökyüzüWebSpam", body)
        except Exception as ex:
            _ = ex  # sessizce yut, cron başarısız gitmez
    return {"ok": True, "total": total, "action": action, "collections": len(results)}


# ============================================================================
# GEO HEATMAP: bloklanan IP'lerin ülkelere göre yoğunluğu (Landing için)
# ============================================================================
@router.get("/geo/blocked-heatmap")
async def geo_heatmap():
    """Bloklanan IP'leri ülkeye göre grupla. Landing world-map için."""
    try:
        from routes.security_adv import _ip_to_country, COUNTRY_COORDS
    except Exception:
        return {"items": [], "total": 0}
    counts: dict[str, int] = {}
    async for it in db.lists.find({"kind": "blacklist", "type": "ip"}, {"value": 1, "_id": 0}):
        cc = _ip_to_country(it.get("value", ""))
        if cc and cc != "LOCAL":
            counts[cc] = counts.get(cc, 0) + 1
    async for it in db.threat_iocs.find({"type": "ip"}, {"value": 1, "_id": 0}):
        cc = _ip_to_country(it.get("value", ""))
        if cc and cc != "LOCAL":
            counts[cc] = counts.get(cc, 0) + 1
    CC_NAME = {
        "US": "ABD", "CN": "Çin", "RU": "Rusya", "DE": "Almanya", "TR": "Türkiye",
        "GB": "Birleşik Krallık", "IN": "Hindistan", "BR": "Brezilya", "JP": "Japonya",
        "KR": "G. Kore", "NL": "Hollanda", "FR": "Fransa", "IT": "İtalya", "ES": "İspanya",
        "CA": "Kanada", "AU": "Avustralya", "UA": "Ukrayna", "PL": "Polonya",
        "VN": "Vietnam", "TH": "Tayland", "ID": "Endonezya", "IR": "İran",
        "PK": "Pakistan", "EG": "Mısır", "SA": "S. Arabistan", "ZA": "G. Afrika",
    }
    items = []
    for cc, n in counts.items():
        coord = COUNTRY_COORDS.get(cc)
        items.append({
            "country": cc, "name": CC_NAME.get(cc, cc), "count": n,
            "lat": coord[0] if coord else None, "lon": coord[1] if coord else None,
        })
    items.sort(key=lambda x: x["count"], reverse=True)
    return {"items": items, "total": sum(counts.values())}



# ============================================================================
# IP BLOCK: mail detayından "IP'yi bloka al" işlemi
# ============================================================================
class IPBlockIn(BaseModel):
    ip: str = Field(..., min_length=7, max_length=45)
    reason: Optional[str] = ""
    license_key: Optional[str] = None


@router.post("/ip/block")
async def ip_block(payload: IPBlockIn):
    """Bir IP'yi kalıcı olarak blacklist'e ekle."""
    doc = {
        "id": str(uuid.uuid4()),
        "kind": "blacklist", "type": "ip",
        "value": payload.ip,
        "reason": payload.reason or "Panel'den manuel blok",
        "license_key": payload.license_key,
        "created_at": _iso(),
        "source": "mail_detail_block",
    }
    await db.lists.update_one(
        {"kind": "blacklist", "type": "ip", "value": payload.ip},
        {"$set": doc}, upsert=True,
    )
    # Ayrıca IOC olarak da ekle (ingest-time enforce için)
    await db.threat_iocs.update_one(
        {"type": "ip", "value": payload.ip},
        {"$set": {
            "id": str(uuid.uuid4()), "type": "ip", "value": payload.ip,
            "tag": "spam", "confidence": 100, "source": "manual_block",
            "note": payload.reason or "Panel manuel blok",
            "created_at": _iso(),
        }},
        upsert=True,
    )
    return {"ok": True, "ip": payload.ip, "blocked": True}


@router.post("/ip/unblock")
async def ip_unblock(payload: IPBlockIn):
    """Bir IP bloğunu kaldır."""
    r1 = await db.lists.delete_many({"kind": "blacklist", "type": "ip", "value": payload.ip})
    r2 = await db.threat_iocs.delete_many({"type": "ip", "value": payload.ip})
    return {"ok": True, "removed_lists": r1.deleted_count,
            "removed_iocs": r2.deleted_count}


@router.get("/ip/status")
async def ip_status(ip: str = Query(..., min_length=7)):
    """Bir IP blok listede mi? Ülke + ilgili event sayısı."""
    listed = await db.lists.find_one({"kind": "blacklist", "type": "ip", "value": ip}, {"_id": 0})
    ioc = await db.threat_iocs.find_one({"type": "ip", "value": ip}, {"_id": 0})
    # Ülke tespiti — /8 prefix haritası (security_adv modülünden)
    try:
        from routes.security_adv import _ip_to_country, COUNTRY_COORDS
        cc = _ip_to_country(ip)
        coord = COUNTRY_COORDS.get(cc) if cc else None
    except Exception:
        cc, coord = None, None
    # Event sayısı
    events = await db.mail_events.count_documents({"$or": [{"client_ip": ip}, {"server_ip": ip}]})
    spam_events = await db.mail_events.count_documents({
        "$or": [{"client_ip": ip}, {"server_ip": ip}],
        "verdict": {"$in": ["spam", "high_spam", "virus"]},
    })
    return {
        "ip": ip, "blocked": bool(listed or ioc),
        "country": cc, "lat": coord[0] if coord else None,
        "lon": coord[1] if coord else None,
        "total_events": events, "spam_events": spam_events,
        "list_entry": listed, "ioc_entry": ioc,
    }
