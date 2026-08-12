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
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================================
# v40 In-memory TTL cache — Landing polling endpoint'leri için (public/blocked-stats,
# geo/blocked-heatmap). Sadece process-local; bir bayi başkasının cache'ini görmez
# çünkü key'e license_key/region dahil ediyoruz. Prod'da process başına yeterli.
# ============================================================================
import time as _time
_TTL_CACHE: dict[str, tuple[float, object]] = {}

def _cache_get(key: str):
    hit = _TTL_CACHE.get(key)
    if not hit:
        return None
    expires_at, val = hit
    if _time.time() > expires_at:
        _TTL_CACHE.pop(key, None)
        return None
    return val

def _cache_set(key: str, val, ttl_sec: float):
    _TTL_CACHE[key] = (_time.time() + ttl_sec, val)
    # Prevent unbounded growth in worst case
    if len(_TTL_CACHE) > 200:
        # Drop expired entries
        now = _time.time()
        for k in [k for k, (exp, _) in _TTL_CACHE.items() if exp < now]:
            _TTL_CACHE.pop(k, None)


# ---- Koleksiyon kategorileri ----
# DATA_COLS: silinecek "veri" koleksiyonları (event/history/log)
# SETTINGS_COLS: KORUNACAK ayar/config/lisans koleksiyonları
DATA_COLS = [
    "mail_events", "quarantine", "exploit_scans", "exploit_findings",
    "queue_audit", "pending_quarantine_actions", "alerts_fired",
    "logs", "ai_explanations", "ai_narrations", "ai_weekly_reports",
    "docs_qa_log", "module_qa_log", "dmarc_reports", "threat_iocs",
    "delist_requests", "outbound_queue", "notifications_history",
    "reseller_logins", "license_violations", "violations",
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


@router.post("/violations/auto-cleanup")
async def violations_auto_cleanup(days: int = 7):
    """7 günden eski lisans ihlallerini otomatik sil. Cron ile günlük tetiklenir.
    Master paneli üzerinden manuel de çağrılabilir: POST /api/maintenance/violations/auto-cleanup?days=7"""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q = {"$or": [{"at": {"$lt": cutoff}}, {"created_at": {"$lt": cutoff}}]}
    r1 = await db.license_violations.delete_many(q)
    r2 = await db.violations.delete_many(q)
    total = r1.deleted_count + r2.deleted_count
    if total:
        await db.logs.insert_one({
            "id": str(uuid.uuid4()),
            "source": "auto_cleanup",
            "level": "info",
            "message": f"Otomatik temizlik: {days} günden eski {total} lisans ihlali silindi",
            "at": _iso(),
        })
    return {"deleted": total, "older_than_days": days, "ok": True}


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
            # Top 10 spam kaynağı ülke (mail_events'den son 30 gün)
            top_countries: list[tuple[str, int]] = []
            try:
                from datetime import timedelta as _td
                from routes.security_adv import _ip_to_country
                since = (datetime.now(timezone.utc) - _td(days=30)).isoformat()
                cc_counts: dict[str, int] = {}
                async for e in db.mail_events.find(
                    {"verdict": {"$in": ["spam", "high_spam", "virus"]},
                     "$or": [{"ts": {"$gte": since}}, {"ingested_at": {"$gte": since}}]},
                    {"sender_ip": 1, "client_ip": 1, "_id": 0},
                ).limit(20000):
                    ip = e.get("sender_ip") or e.get("client_ip")
                    if not ip: continue
                    cc = _ip_to_country(ip)
                    if cc and cc != "LOCAL":
                        cc_counts[cc] = cc_counts.get(cc, 0) + 1
                top_countries = sorted(cc_counts.items(), key=lambda x: -x[1])[:10]
            except Exception:
                pass
            # 30 gün trend özeti
            trend_line = ""
            try:
                from datetime import timedelta as _td
                since = (datetime.now(timezone.utc) - _td(days=30)).isoformat()
                total_spam = await db.mail_events.count_documents(
                    {"verdict": {"$in": ["spam", "high_spam", "virus"]},
                     "$or": [{"ts": {"$gte": since}}, {"ingested_at": {"$gte": since}}]},
                )
                total_all = await db.mail_events.count_documents(
                    {"$or": [{"ts": {"$gte": since}}, {"ingested_at": {"$gte": since}}]},
                )
                rate = round(total_spam * 100 / max(1, total_all), 2)
                trend_line = f"Son 30 gün: {total_all} mail · {total_spam} spam (%{rate})"
            except Exception:
                pass
            body = (
                f"GökyüzüWebSpam · Otomatik Veri Bakımı Raporu\n"
                f"════════════════════════════════════════\n"
                f"Tarih: {_iso()}\nEşik: {days} günden eski\nAksiyon: {action_tr}\n"
                f"Toplam kayıt: {total}\n"
            )
            if trend_line:
                body += f"\n📊 TREND\n{trend_line}\n"
            if top_countries:
                body += "\n🌍 TOP 10 SPAM KAYNAĞI ÜLKE (son 30 gün)\n"
                for i, (cc, n) in enumerate(top_countries, 1):
                    body += f"  {i:2d}. {cc}: {n} spam mail\n"
            body += "\n📁 KOLEKSİYONLAR\n" + "\n".join(
                f"  · {r['collection']}: "
                + str(r.get('deleted') or r.get('archived') or r.get('error') or 0)
                for r in results)
            body += "\n\n(Ayarlar, lisanslar ve kullanıcı hesapları KORUNDU.)"
            await _send_email(email_to, "🧹 Otomatik Veri Bakımı Raporu — GökyüzüWebSpam", body)
        except Exception as ex:
            _ = ex  # sessizce yut, cron başarısız gitmez
    return {"ok": True, "total": total, "action": action, "collections": len(results)}


# ============================================================================
# GEO HEATMAP: bloklanan IP'lerin ülkelere göre yoğunluğu (Landing için)
# ============================================================================
_GEO_CC_NAME = {
    "US": "ABD", "CN": "Çin", "RU": "Rusya", "DE": "Almanya", "TR": "Türkiye",
    "GB": "Birleşik Krallık", "IN": "Hindistan", "BR": "Brezilya", "JP": "Japonya",
    "KR": "G. Kore", "NL": "Hollanda", "FR": "Fransa", "IT": "İtalya", "ES": "İspanya",
    "CA": "Kanada", "AU": "Avustralya", "UA": "Ukrayna", "PL": "Polonya",
    "VN": "Vietnam", "TH": "Tayland", "ID": "Endonezya", "IR": "İran",
    "PK": "Pakistan", "EG": "Mısır", "SA": "S. Arabistan", "ZA": "G. Afrika",
    "MX": "Meksika", "AR": "Arjantin", "CO": "Kolombiya", "CL": "Şili", "PE": "Peru",
    "SE": "İsveç", "NO": "Norveç", "FI": "Finlandiya", "DK": "Danimarka",
    "BE": "Belçika", "CH": "İsviçre", "AT": "Avusturya", "PT": "Portekiz",
    "GR": "Yunanistan", "CZ": "Çekya", "RO": "Romanya", "HU": "Macaristan",
    "BG": "Bulgaristan", "RS": "Sırbistan", "HR": "Hırvatistan", "IE": "İrlanda",
    "NZ": "Y. Zelanda", "SG": "Singapur", "MY": "Malezya", "PH": "Filipinler",
    "HK": "Hong Kong", "TW": "Tayvan", "IL": "İsrail", "AE": "BAE", "QA": "Katar",
    "KW": "Kuveyt", "JO": "Ürdün", "LB": "Lübnan", "MA": "Fas", "DZ": "Cezayir",
    "TN": "Tunus", "KE": "Kenya", "NG": "Nijerya", "ET": "Etiyopya",
    "BD": "Bangladeş", "LK": "Sri Lanka", "MM": "Myanmar", "KZ": "Kazakistan",
    "UZ": "Özbekistan", "AZ": "Azerbaycan", "GE": "Gürcistan", "AM": "Ermenistan",
    "BY": "Belarus", "LT": "Litvanya", "LV": "Letonya", "EE": "Estonya",
    "SK": "Slovakya", "SI": "Slovenya", "BA": "Bosna-Hersek", "AL": "Arnavutluk",
    "MK": "K. Makedonya", "MD": "Moldova", "CY": "Kıbrıs", "MT": "Malta",
    "IS": "İzlanda", "LU": "Lüksemburg", "IQ": "Irak", "SY": "Suriye",
    "AF": "Afganistan", "YE": "Yemen",
}

# Fallback CC → lat/lon (security_adv.COUNTRY_COORDS eksik olursa)
_GEO_CC_COORD = {
    "US": (39.5, -98.35), "CN": (35.86, 104.19), "RU": (61.52, 105.31), "DE": (51.16, 10.45),
    "TR": (38.96, 35.24), "GB": (55.37, -3.44), "IN": (20.59, 78.96), "BR": (-14.24, -51.93),
    "JP": (36.20, 138.25), "KR": (35.90, 127.77), "NL": (52.13, 5.29), "FR": (46.60, 1.89),
    "IT": (41.87, 12.57), "ES": (40.46, -3.75), "CA": (56.13, -106.35), "AU": (-25.27, 133.78),
    "UA": (48.38, 31.17), "PL": (51.92, 19.13), "VN": (14.06, 108.28), "TH": (15.87, 100.99),
    "ID": (-0.79, 113.92), "IR": (32.43, 53.69), "PK": (30.38, 69.35), "EG": (26.82, 30.80),
    "SA": (23.89, 45.08), "ZA": (-30.56, 22.94), "MX": (23.63, -102.55), "AR": (-38.42, -63.62),
    "CO": (4.57, -74.30), "CL": (-35.68, -71.54), "PE": (-9.19, -75.02), "SE": (60.13, 18.64),
    "NO": (60.47, 8.47), "FI": (61.92, 25.75), "DK": (56.26, 9.50), "BE": (50.50, 4.47),
    "CH": (46.82, 8.23), "AT": (47.52, 14.55), "PT": (39.40, -8.22), "GR": (39.07, 21.82),
    "CZ": (49.82, 15.47), "RO": (45.94, 24.97), "HU": (47.16, 19.50), "BG": (42.73, 25.49),
    "RS": (44.02, 21.01), "HR": (45.10, 15.20), "IE": (53.14, -7.69), "NZ": (-40.90, 174.89),
    "SG": (1.35, 103.82), "MY": (4.21, 101.98), "PH": (12.88, 121.77), "HK": (22.32, 114.17),
    "TW": (23.70, 120.96), "IL": (31.05, 34.85), "AE": (23.42, 53.85), "QA": (25.35, 51.18),
    "KW": (29.31, 47.48), "JO": (30.59, 36.24), "LB": (33.85, 35.86), "MA": (31.79, -7.09),
    "DZ": (28.03, 1.66), "TN": (33.89, 9.54), "KE": (-0.02, 37.90), "NG": (9.08, 8.68),
    "ET": (9.15, 40.49), "BD": (23.68, 90.36), "LK": (7.87, 80.77), "MM": (21.91, 95.96),
    "KZ": (48.02, 66.92), "UZ": (41.38, 64.59), "AZ": (40.14, 47.58), "GE": (42.32, 43.36),
    "AM": (40.07, 45.04), "BY": (53.71, 27.95), "LT": (55.17, 23.88), "LV": (56.88, 24.60),
    "EE": (58.60, 25.01), "SK": (48.67, 19.70), "SI": (46.15, 14.99), "BA": (43.92, 17.68),
    "AL": (41.15, 20.17), "MK": (41.61, 21.75), "MD": (47.41, 28.37), "CY": (35.13, 33.43),
    "MT": (35.94, 14.38), "IS": (64.96, -19.02), "LU": (49.82, 6.13), "IQ": (33.22, 43.68),
    "SY": (34.80, 38.99), "AF": (33.94, 67.71), "YE": (15.55, 48.52),
}


@router.get("/geo/blocked-heatmap")
async def geo_heatmap(license_key: Optional[str] = None):
    """Bloklanan IP'leri ülkeye göre grupla + son saldırı zamanları + kırılım.
    Landing world-map için zenginleştirildi:
      • blacklist + threat_iocs + mail_events (spam/virus/phish/blocked)
      • Her ülke için: count, last_attack_at, top_verdicts
      • ~90 ülke isim + koordinat eşleşmesi
      • Baseline seed düşük veride Landing'i canlı gösterir
      • `?license_key=X` ile master belirli bir bayinin trafiğini filtreler

    v40 Perf: distinct-IP $group (20k iterasyon → ~500 unique IP);
    60sn TTL cache (license_key başına ayrı key).
    """
    # Cache — Landing 5-10sn polling'de ilk çağrı hariç DB'ye hiç gitmez
    cache_key = f"geo_heatmap:{license_key or 'ALL'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        from routes.security_adv import _ip_to_country, COUNTRY_COORDS
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731
        COUNTRY_COORDS = {}

    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    day30 = (now - timedelta(days=30)).isoformat()

    # cc → {count, last_attack_at, verdicts:{spam,virus,phish,blocked}}
    stats: dict = {}

    def _bump(cc: str, verdict: Optional[str] = None, ts: Optional[str] = None, cnt: int = 1):
        if not cc or cc == "LOCAL":
            return
        s = stats.setdefault(cc, {"count": 0, "last_attack_at": "", "verdicts": {}})
        s["count"] += cnt
        if verdict:
            s["verdicts"][verdict] = s["verdicts"].get(verdict, 0) + cnt
        if ts and ts > (s["last_attack_at"] or ""):
            s["last_attack_at"] = ts

    # 1) Statik blacklist
    async for it in db.lists.find({"kind": "blacklist", "type": "ip"}, {"value": 1, "created_at": 1, "_id": 0}):
        _bump(_ip_to_country(it.get("value", "")), None, it.get("created_at"))
    # 2) Threat intel IOC'ler
    async for it in db.threat_iocs.find({"type": "ip"}, {"value": 1, "created_at": 1, "_id": 0}):
        _bump(_ip_to_country(it.get("value", "")), None, it.get("created_at"))
    # 3) Son 30 gün mail_events — $group by (client_ip, verdict) ile 20k event yerine ~500 unique IP
    bad_verdicts = {"$in": ["spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"]}
    ev_match: dict = {"verdict": bad_verdicts, "ts": {"$gte": day30},
                      "client_ip": {"$exists": True, "$ne": ""}}
    if license_key:
        ev_match["license_key"] = license_key
    try:
        pipeline = [
            {"$match": ev_match},
            {"$group": {
                "_id": {"ip": "$client_ip", "verdict": {"$toLower": "$verdict"}},
                "count": {"$sum": 1},
                "last_ts": {"$max": "$ts"},
            }},
        ]
        # Ülke lookup cache — aynı IP birden fazla verdict grubunda olur
        ip_cc_cache: dict[str, Optional[str]] = {}
        async for r in db.mail_events.aggregate(pipeline, allowDiskUse=True):
            gid = r.get("_id") or {}
            ip = gid.get("ip") or ""
            if ip not in ip_cc_cache:
                ip_cc_cache[ip] = _ip_to_country(ip)
            _bump(ip_cc_cache[ip], gid.get("verdict"), r.get("last_ts"), int(r.get("count") or 0))
    except Exception:
        pass

    # Baseline seed — Landing'de boş görünmesin diye
    seed_cfg = await db.settings.find_one({"_key": "landing_traffic_seed"}, {"_id": 0}) or {}
    if seed_cfg.get("enabled", True) and sum(s["count"] for s in stats.values()) < 200:
        import hashlib, random as _rmod
        _r = _rmod.Random(int(hashlib.md5(now.strftime("%Y%m%d").encode()).hexdigest()[:8], 16))
        # Realistik saldırı dağılımı (top attackers)
        seeds = {
            "RU": 8420, "CN": 7830, "US": 5240, "IN": 3820, "BR": 2960, "UA": 2110,
            "VN": 1980, "IR": 1750, "TR": 1620, "DE": 1420, "NL": 1290, "GB": 1180,
            "PL": 980, "FR": 890, "ID": 810, "PK": 720, "TH": 640, "KZ": 580,
            "MX": 520, "AR": 490, "RO": 450, "BG": 420, "EG": 380, "IT": 360,
            "ES": 340, "CO": 320, "CA": 300, "PH": 280, "JP": 260, "KR": 240,
            "MY": 220, "TW": 210, "ZA": 200, "AU": 180, "IL": 170, "HK": 160,
            "SA": 150, "AE": 140, "GR": 130, "CZ": 120, "RS": 110, "HU": 100,
            "SG": 95, "SE": 90, "NO": 85, "FI": 80, "DK": 78, "BE": 75, "CH": 72,
            "AT": 68, "PT": 65, "IE": 60, "LK": 58, "BD": 55, "AZ": 52, "GE": 50,
            "BY": 48, "LT": 45, "LV": 42, "EE": 40, "SK": 38, "SI": 35, "HR": 32,
            "MA": 30, "DZ": 28, "TN": 26, "KE": 24, "NG": 22, "ET": 20,
        }
        for cc, n in seeds.items():
            noise = _r.uniform(0.7, 1.3)
            floor = int(n * noise)
            s = stats.setdefault(cc, {"count": 0, "last_attack_at": "", "verdicts": {}})
            if s["count"] < floor:
                # Verdict kırılımını mantıklı böl
                s["count"] = floor
                s["verdicts"] = {
                    "spam": int(floor * 0.55),
                    "virus": int(floor * 0.15),
                    "phishing": int(floor * 0.18),
                    "blocked": int(floor * 0.12),
                }
                # Son saldırı zamanı: 0-90dk arası rastgele
                s["last_attack_at"] = (now - timedelta(minutes=_r.randint(0, 90))).isoformat()

    # Son N canlı saldırı (animasyon için) — küçük sort limit, hızlı
    recent_attacks: list = []
    try:
        async for e in db.mail_events.find(
            {"verdict": bad_verdicts, "client_ip": {"$exists": True, "$ne": ""}},
            {"client_ip": 1, "verdict": 1, "ts": 1, "_id": 0},
        ).sort("ts", -1).limit(20):
            cc = _ip_to_country(e.get("client_ip", ""))
            if cc and cc != "LOCAL":
                recent_attacks.append({
                    "country": cc, "name": _GEO_CC_NAME.get(cc, cc),
                    "verdict": (e.get("verdict") or "").lower(),
                    "ts": e.get("ts"),
                })
    except Exception:
        pass
    # Seed recent attacks if empty
    if seed_cfg.get("enabled", True) and not recent_attacks and stats:
        import random as _rmod
        _r = _rmod.Random(int(now.strftime("%Y%m%d%H%M")[-6:]))
        top_ccs = sorted(stats.keys(), key=lambda k: stats[k]["count"], reverse=True)[:15]
        for i in range(15):
            cc = _r.choice(top_ccs)
            v = _r.choice(["spam", "spam", "virus", "phishing", "blocked"])
            ts = (now - timedelta(seconds=_r.randint(0, 300))).isoformat()
            recent_attacks.append({
                "country": cc, "name": _GEO_CC_NAME.get(cc, cc),
                "verdict": v, "ts": ts,
            })
        recent_attacks.sort(key=lambda x: x["ts"], reverse=True)

    # items listesi
    items = []
    for cc, s in stats.items():
        coord = _GEO_CC_COORD.get(cc) or COUNTRY_COORDS.get(cc)
        items.append({
            "country": cc,
            "name": _GEO_CC_NAME.get(cc, cc),
            "count": s["count"],
            "lat": coord[0] if coord else None,
            "lon": coord[1] if coord else None,
            "last_attack_at": s.get("last_attack_at") or None,
            "verdicts": s.get("verdicts") or {},
        })
    items.sort(key=lambda x: x["count"], reverse=True)
    result = {
        "items": items,
        "total": sum(s["count"] for s in stats.values()),
        "countries": len(items),
        "recent_attacks": recent_attacks[:20],
        "generated_at": now.isoformat(),
    }
    _cache_set(cache_key, result, 60.0)
    return result


@router.get("/geo/country-detail")
async def geo_country_detail(cc: str, limit: int = 50):
    """Bir ülkeden bloklanan tüm IP'lerin listesi + zaman damgaları."""
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        return {"items": [], "country": cc}
    cc = (cc or "").upper()
    items: list[dict] = []
    seen: set[str] = set()
    async for it in db.lists.find({"kind": "blacklist", "type": "ip"}, {"_id": 0}):
        ip = it.get("value", "")
        if _ip_to_country(ip) == cc and ip not in seen:
            seen.add(ip)
            items.append({
                "ip": ip, "reason": it.get("reason", ""),
                "created_at": it.get("created_at", ""), "source": "list",
            })
    async for it in db.threat_iocs.find({"type": "ip"}, {"_id": 0}):
        ip = it.get("value", "")
        if _ip_to_country(ip) == cc and ip not in seen:
            seen.add(ip)
            items.append({
                "ip": ip, "reason": it.get("note", ""),
                "created_at": it.get("created_at", ""),
                "source": it.get("source", "ioc"),
                "confidence": it.get("confidence"),
            })
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"country": cc, "total": len(items), "items": items[:limit]}


# ============================================================================
# TRUST SCORE HISTORY: son 30 günün skor trendi
# ============================================================================
@router.post("/trust-score/snapshot")
async def trust_score_snapshot(score: int, findings: int = 0, rbl_listed: int = 0):
    """Frontend her Dashboard yüklemesinde günlük skor bırakır. Aynı gün için upsert.
    Skor 60 altına düşerse admin'e e-posta uyarısı gönderir (günde bir kez)."""
    from datetime import date
    today = date.today().isoformat()
    # Önceki durum
    prev = await db.trust_score_history.find_one({"date": today}, {"_id": 0}) or {}
    prev_score = prev.get("score")
    await db.trust_score_history.update_one(
        {"date": today},
        {"$set": {
            "date": today, "score": int(score),
            "findings": int(findings), "rbl_listed": int(rbl_listed),
            "ts": _iso(),
        }},
        upsert=True,
    )
    # Uyarı tetikle: skor 60 altına yeni düştüyse
    alert_fired = False
    if score < 60 and (prev_score is None or prev_score >= 60):
        cfg = await db.settings.find_one({"_key": "auto_cleanup"}, {"_id": 0}) or {}
        admin_email = cfg.get("email_to")
        if admin_email:
            try:
                from server import _send_email
                subj = f"⚠️ Güven Skoru Uyarısı — GökyüzüWebSpam · Skor: {score}"
                body = (
                    f"Güven skorunuz 60 eşiğinin altına düştü!\n\n"
                    f"Şu anki skor: {score}/100\n"
                    f"Kritik bulgu: {findings}\n"
                    f"RBL listeleme: {rbl_listed}\n"
                    f"Bir önceki skor: {prev_score or 'kayıt yok'}\n\n"
                    f"Öneri:\n"
                    f"  1. Güvenlik → Exploit sekmesinden bulguları temizleyin\n"
                    f"  2. Reputation sekmesinden RBL delisting başlatın\n"
                    f"  3. Kapalı modülleri Genel sekmesinden aktive edin\n\n"
                    f"Panel: /panel/security"
                )
                await _send_email(admin_email, subj, body)
                alert_fired = True
                await db.notifications_inbox.insert_one({
                    "id": str(uuid.uuid4()), "kind": "trust_score_alert",
                    "score": score, "prev_score": prev_score,
                    "findings": findings, "rbl_listed": rbl_listed,
                    "created_at": _iso(), "read": False,
                })
            except Exception:
                pass
    return {"ok": True, "date": today, "score": score, "alert_fired": alert_fired}


@router.get("/trust-score/history")
async def trust_score_history(days: int = 30):
    """Son N günün skor trendi. Boş günleri interpolate etmez (gap = null)."""
    from datetime import date, timedelta
    end = date.today()
    start = end - timedelta(days=days - 1)
    rows = await db.trust_score_history.find(
        {"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).sort("date", 1).to_list(days + 5)
    by_date = {r["date"]: r for r in rows}
    series: list[dict] = []
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        r = by_date.get(d)
        series.append({"date": d, "score": r["score"] if r else None,
                       "findings": r.get("findings") if r else None})
    scores = [s["score"] for s in series if s["score"] is not None]
    return {
        "days": days, "series": series,
        "min": min(scores) if scores else None,
        "max": max(scores) if scores else None,
        "avg": round(sum(scores) / len(scores), 1) if scores else None,
        "delta": (series[-1]["score"] - series[0]["score"])
                 if series[-1]["score"] is not None and series[0]["score"] is not None else None,
    }


# ============================================================================
# PUBLIC LANDING STATS: bugünkü + 30 gün bloklanan mail sayısı
# ============================================================================
@router.get("/public/blocked-stats")
async def public_blocked_stats(region: str = "all", raw: int = 0):
    """Landing için: bugün bloklanan sayı + son 30 gün bar chart verisi.
    Cache dostu, license gerektirmez.
    region: 'all' (default) | 'tr' (Türkiye) | 'external' (dış).

    v40 Perf: $facet aggregation ile tek round-trip; 45sn TTL cache;
    region filter'de distinct-IP $group ile Python loop 100k→~2k'ya iner."""
    from datetime import date, timedelta, datetime as _dt

    # Cache lookup — raw=1 (admin) cache bypass eder ki taze veri görsün
    cache_key = f"blocked_stats:{region}"
    if not raw:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731

    today = date.today()
    today_iso = today.isoformat()
    start = today - timedelta(days=29)
    since_iso = start.isoformat()

    bad_verdicts = ["spam", "high_spam", "virus"]

    today_count = 0
    total_events_today = 0
    all_time_blocked = 0
    by_day: dict[str, int] = {}
    quarantined_today = 0
    virus_all_time = 0
    phishing_all_time = 0

    if region == "all":
        # Tek $facet pipeline: 30 gün spam eventleri üzerinden day-bucket + today + all-time
        # + today_total + quarantined_today. Bu 5 count'u tek round-trip'te alır.
        # NOTE: `_ts` alanı `ts` veya `ingested_at`'ten hangisi varsa. Alternate `$or`
        # yerine `$ifNull` ile canonical timestamp üretiyoruz — pipeline planlaması daha iyi.
        pipeline_bad = [
            {"$match": {"verdict": {"$in": bad_verdicts}}},
            {"$facet": {
                "all_time": [{"$count": "n"}],
                "today": [
                    {"$match": {"$or": [{"ts": {"$gte": today_iso}},
                                        {"ingested_at": {"$gte": today_iso}}]}},
                    {"$count": "n"},
                ],
                "by_day": [
                    {"$match": {"$or": [{"ts": {"$gte": since_iso}},
                                        {"ingested_at": {"$gte": since_iso}}]}},
                    {"$project": {
                        "day": {"$substr": [
                            {"$ifNull": ["$ts", {"$ifNull": ["$ingested_at", ""]}]},
                            0, 10,
                        ]},
                    }},
                    {"$group": {"_id": "$day", "count": {"$sum": 1}}},
                ],
                "virus_all_time": [
                    {"$match": {"verdict": "virus"}},
                    {"$count": "n"},
                ],
                "phishing_all_time": [
                    {"$match": {"verdict": "high_spam"}},
                    {"$count": "n"},
                ],
            }},
        ]
        try:
            agg = await db.mail_events.aggregate(pipeline_bad, allowDiskUse=True).to_list(1)
            r = agg[0] if agg else {}
            all_time_blocked = (r.get("all_time") or [{}])[0].get("n", 0) if r.get("all_time") else 0
            today_count = (r.get("today") or [{}])[0].get("n", 0) if r.get("today") else 0
            virus_all_time = (r.get("virus_all_time") or [{}])[0].get("n", 0) if r.get("virus_all_time") else 0
            phishing_all_time = (r.get("phishing_all_time") or [{}])[0].get("n", 0) if r.get("phishing_all_time") else 0
            for row in (r.get("by_day") or []):
                dk = row.get("_id") or ""
                if dk:
                    by_day[dk] = int(row.get("count") or 0)
        except Exception:
            # Fallback (index'ler yoksa vb)
            all_time_blocked = await db.mail_events.count_documents({"verdict": {"$in": bad_verdicts}})
            today_count = await db.mail_events.count_documents({
                "verdict": {"$in": bad_verdicts},
                "$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}],
            })

        total_events_today = await db.mail_events.count_documents({
            "$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}],
        })
        quarantined_today = await db.mail_events.count_documents({
            "action": "quarantine",
            "$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}],
        })
    else:
        # Region filter: distinct sender_ip $group üzerinden — 100k iterasyon yerine
        # sadece unique IP başına _ip_to_country çağrısı yapılır (~50-200 IP).
        pipeline_by_ip = [
            {"$match": {
                "verdict": {"$in": bad_verdicts},
                "$or": [{"sender_ip": {"$exists": True, "$ne": ""}},
                        {"client_ip": {"$exists": True, "$ne": ""}}],
            }},
            {"$project": {
                "ip": {"$ifNull": ["$sender_ip", "$client_ip"]},
                "day": {"$substr": [
                    {"$ifNull": ["$ts", {"$ifNull": ["$ingested_at", ""]}]},
                    0, 10,
                ]},
                "ts_raw": {"$ifNull": ["$ts", "$ingested_at"]},
            }},
            {"$group": {
                "_id": {"ip": "$ip", "day": "$day"},
                "count": {"$sum": 1},
                "any_ts": {"$max": "$ts_raw"},
            }},
        ]
        rows = await db.mail_events.aggregate(pipeline_by_ip, allowDiskUse=True).to_list(200000)
        # Ülke lookup cache — aynı IP birden fazla gün grubunda olabilir
        ip_country_cache: dict[str, Optional[str]] = {}

        def _cc_of(ip: str | None):
            if not ip:
                return None
            if ip not in ip_country_cache:
                ip_country_cache[ip] = _ip_to_country(ip)
            return ip_country_cache[ip]

        def _match_region(cc: Optional[str]) -> bool:
            if region == "tr":
                return cc == "TR"
            if region == "external":
                return cc is not None and cc != "TR" and cc != "LOCAL"
            return True

        for r in rows:
            gid = r.get("_id") or {}
            ip = gid.get("ip")
            cc = _cc_of(ip)
            if not _match_region(cc):
                continue
            cnt = int(r.get("count") or 0)
            all_time_blocked += cnt
            day_key = gid.get("day") or ""
            ts_raw = r.get("any_ts") or ""
            if day_key and day_key >= since_iso:
                by_day[day_key] = by_day.get(day_key, 0) + cnt
            if day_key >= today_iso or (ts_raw and ts_raw >= today_iso):
                today_count += cnt

        # total_events_today (region-filtered): today distinct IPs
        pipe_today_total = [
            {"$match": {"$and": [
                {"$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}]},
                {"$or": [{"sender_ip": {"$exists": True, "$ne": ""}},
                         {"client_ip": {"$exists": True, "$ne": ""}}]},
            ]}},
            {"$project": {"ip": {"$ifNull": ["$sender_ip", "$client_ip"]}}},
            {"$group": {"_id": "$ip", "count": {"$sum": 1}}},
        ]
        try:
            async for r in db.mail_events.aggregate(pipe_today_total, allowDiskUse=True):
                if _match_region(_cc_of(r.get("_id"))):
                    total_events_today += int(r.get("count") or 0)
        except Exception:
            pass

    # 30 slot doldur
    series: list[dict] = []
    for i in range(30):
        d = (start + timedelta(days=i)).isoformat()
        series.append({"date": d, "count": by_day.get(d, 0)})
    peak = max((s["count"] for s in series), default=0)
    avg = round(sum(s["count"] for s in series) / 30, 1)

    # BASELINE FLOOR — Landing sayfası ilk aylarda "boş" görünmesin diye
    # gerçek trafik düşükse organik-benzeri bir dolgu yapılır. Master DB'de
    # `landing_traffic_seed=true` toggle'ı ile açık/kapalı yönetilir; ayrıca
    # `?raw=1` query'i geldiğinde baseline devre dışıdır (gerçek admin görür).
    total_real = sum(s["count"] for s in series)
    seed_cfg = await db.settings.find_one({"_key": "landing_traffic_seed"}, {"_id": 0}) or {}
    seed_enabled = seed_cfg.get("enabled", True)
    if seed_enabled and total_real < 500 and not raw:
        import hashlib, random as _rmod
        # İzole RNG instance — global random state'e sızıntı yok
        _r = _rmod.Random(int(hashlib.md5(today_iso.encode()).hexdigest()[:8], 16))
        # Bölgeye göre baseline yoğunluğu
        base_daily = 8500 if region == "all" else 5200 if region == "tr" else 3200
        for i, s in enumerate(series):
            days_ago = 29 - i
            trend = 1.0 - (days_ago / 60)  # yakınlaştıkça hafif artış
            noise = _r.uniform(0.75, 1.25)
            weekday_factor = 0.72 if _dt.fromisoformat(s["date"]).weekday() >= 5 else 1.0
            floor = int(base_daily * trend * noise * weekday_factor)
            # Gerçek veriden büyükse gerçeği koru, yoksa floor uygula
            s["count"] = max(s["count"], floor)
        peak = max((s["count"] for s in series), default=0)
        avg = round(sum(s["count"] for s in series) / 30, 1)
        all_time_blocked = max(all_time_blocked, sum(s["count"] for s in series) * 4)  # tahmini all-time
        today_count = max(today_count, series[-1]["count"])
        total_events_today = max(total_events_today, int(today_count / 0.75))

    # Ek metrikler — küçük koleksiyonlar, tek count her biri < 5ms
    if region == "all":
        # region=all için virus/phishing zaten $facet'ten geldi
        pass
    else:
        # region filter'de bunlar önemli değil (region'la ilgili değil), simple count
        virus_all_time = await db.mail_events.count_documents({"verdict": "virus"})
        phishing_all_time = await db.mail_events.count_documents({"verdict": "high_spam"})

    result = {
        "today_blocked": today_count,
        "today_total": total_events_today,
        "block_rate": round(today_count * 100 / max(1, total_events_today), 1),
        "all_time_blocked": all_time_blocked,
        "series_30d": series,
        "peak_30d": peak,
        "avg_30d": avg,
        "region": region,
        "seed_applied": seed_enabled and total_real < 500 and not raw,
        # Ek metrikler
        "exploits_caught": await db.exploit_findings.count_documents({}),
        "exploits_critical": await db.exploit_findings.count_documents({"severity": "critical"}),
        "ips_blocked": await db.lists.count_documents({"kind": "blacklist", "type": "ip"}),
        "quarantined_today": quarantined_today,
        "virus_caught_all_time": virus_all_time,
        "phishing_caught_all_time": phishing_all_time,
        "iocs_tracked": await db.threat_iocs.count_documents({}),
        "active_licenses": await db.licenses.count_documents({"status": "active"}),
        "last_updated": _iso(),
    }

    # Cache 45sn — Landing 5sn polling'de aynı response servis edilir
    if not raw:
        _cache_set(cache_key, result, 45.0)
    return result




# ============================================================================
# PUBLIC LIVE TICKER — Landing sayfası "son dakika X saldırı engellendi" bandı.
# Amaç: ziyaretçilere sosyal ispat + canlı sistem hissi vermek. 5sn polling.
# ============================================================================
@router.get("/public/live-ticker")
async def public_live_ticker():
    """Landing canlı sayaç — son 1 dakika / son 1 saat bloklama sayıları,
    aktif bayi sayısı ve tur atacak son 5 event özeti (anonimleştirilmiş).

    Cache HTTP 200 · Rate limit yok · lisans gerekmez · 15-20ms hedefi."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    m1 = (now - timedelta(minutes=1)).isoformat()
    h1 = (now - timedelta(hours=1)).isoformat()
    day = (now - timedelta(days=1)).isoformat()
    verdict_bad = {"$in": ["spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"]}

    # Sayaçları paralel almak yerine tek pipeline'da al (Motor async - hızlı)
    blocked_1m = await db.mail_events.count_documents({"verdict": verdict_bad, "ts": {"$gte": m1}})
    blocked_1h = await db.mail_events.count_documents({"verdict": verdict_bad, "ts": {"$gte": h1}})
    blocked_24h = await db.mail_events.count_documents({"verdict": verdict_bad, "ts": {"$gte": day}})

    # Baseline seed — düşük trafikte Landing "0 saldırı engellendi" gözükmesin
    seed_cfg = await db.settings.find_one({"_key": "landing_traffic_seed"}, {"_id": 0}) or {}
    if seed_cfg.get("enabled", True):
        import hashlib, random as _rmod
        # Dakikaya bağlı deterministic seed → her dakika farklı sayı, ama
        # aynı dakika içinde 5sn polling'lerde stabil
        bucket = now.strftime("%Y%m%d%H%M")
        _r = _rmod.Random(int(hashlib.md5(bucket.encode()).hexdigest()[:8], 16))
        # 1dk için 8-45 arası, 1sa için 400-1400, 24sa için 8500-14500
        floor_1m = _r.randint(8, 45)
        floor_1h = _r.randint(420, 1380)
        floor_24h = _r.randint(8500, 14500)
        blocked_1m = max(blocked_1m, floor_1m)
        blocked_1h = max(blocked_1h, floor_1h)
        blocked_24h = max(blocked_24h, floor_24h)

    # Son 5 anonim event (attack map için)
    recent = []
    async for e in db.mail_events.find(
        {"verdict": verdict_bad}, {"_id": 0, "ts": 1, "verdict": 1, "from_addr": 1}
    ).sort("ts", -1).limit(5):
        addr = e.get("from_addr") or ""
        # Anonimleştir: user@example.com → u***@example.com
        try:
            if "@" in addr:
                user, dom = addr.split("@", 1)
                addr = (user[:1] + "***@" + dom) if user else "***@" + dom
        except Exception:
            addr = "***"
        recent.append({
            "ts": e.get("ts"),
            "verdict": e.get("verdict"),
            "from": addr,
        })

    active_bayi = await db.licenses.count_documents({"active": True})
    return {
        "blocked_last_minute": blocked_1m,
        "blocked_last_hour": blocked_1h,
        "blocked_last_24h": blocked_24h,
        "active_resellers": active_bayi,
        "recent_events": recent,
        "generated_at": now.isoformat(),
    }


@router.get("/geo/country/{cc}/ips")
async def geo_country_ips(cc: str, license_key: Optional[str] = None, limit: int = 100):
    """Belirli bir ülke için bloklu IP'lerin detay listesi (modal için).

    Kaynak: db.lists (blacklist) + son 30 günde saldıran mail_events IP'leri.
    Master `?license_key=X` ile bayi bazlı filtre uygulayabilir.
    """
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731
    cc = cc.upper()
    limit = max(10, min(int(limit), 500))
    ips_map: dict = {}  # ip -> {ip, country, last_seen, verdict, source, count}

    # 1) Statik blacklist kayıtları
    async for it in db.lists.find({"kind": "blacklist", "type": "ip"}, {"_id": 0}):
        v = it.get("value", "")
        if _ip_to_country(v) == cc:
            ips_map[v] = {
                "ip": v, "country": cc,
                "verdict": "manual_block", "source": "blacklist",
                "last_seen": it.get("created_at"),
                "count": 1,
                "note": it.get("note") or "",
                "list_entry_id": it.get("id"),
            }

    # 2) mail_events (son 30 gün)
    from datetime import datetime, timezone, timedelta
    day30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    bad = {"$in": ["spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"]}
    q = {"verdict": bad, "ts": {"$gte": day30}, "client_ip": {"$exists": True, "$ne": ""}}
    if license_key:
        q["license_key"] = license_key
    try:
        async for e in db.mail_events.find(q, {"_id": 0}).sort("ts", -1).limit(5000):
            ip = e.get("client_ip", "")
            if not ip or _ip_to_country(ip) != cc:
                continue
            row = ips_map.get(ip)
            if not row:
                ips_map[ip] = {
                    "ip": ip, "country": cc,
                    "verdict": (e.get("verdict") or "").lower(),
                    "source": "mail_event",
                    "last_seen": e.get("ts"),
                    "count": 1,
                    "from_addr": e.get("from_addr", ""),
                }
            else:
                row["count"] = row.get("count", 1) + 1
                if e.get("ts") and (not row.get("last_seen") or e["ts"] > row["last_seen"]):
                    row["last_seen"] = e["ts"]
    except Exception:
        pass

    items = list(ips_map.values())
    items.sort(key=lambda x: (x.get("last_seen") or ""), reverse=True)
    return {
        "country": cc,
        "total": len(items),
        "items": items[:limit],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/admin/geo/bulk-block-country")
async def admin_geo_bulk_block_country(request: Request, cc: str,
                                         license_key: Optional[str] = None,
                                         limit: int = 200,
                                         note: Optional[str] = ""):
    """Master-only. Bir ülkeye ait TOP N saldırgan IP'yi tek işlemle blacklist'e ekler.

    Kaynak: geo_country_ips ile aynı — son 30 gün mail_events + mevcut blacklist.
    Zaten blacklist'te olan IP'ler atlanır (duplicate önleme).
    """
    # _require_master aynı server.py'deki gibi, burada minimum
    from server import _require_master
    await _require_master(request, license_key)
    cc = cc.upper()
    limit = max(1, min(int(limit), 1000))
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731

    from datetime import datetime, timezone, timedelta
    import uuid
    day30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    bad = {"$in": ["spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"]}

    # Zaten blacklist'te olan IP'leri kümele
    already: set = set()
    async for it in db.lists.find({"kind": "blacklist", "type": "ip"}, {"value": 1, "_id": 0}):
        v = it.get("value", "")
        if v and _ip_to_country(v) == cc:
            already.add(v)

    # Saldıran IP'leri topla (count sıralı)
    counters: dict = {}
    async for e in db.mail_events.find(
        {"verdict": bad, "ts": {"$gte": day30}, "client_ip": {"$exists": True, "$ne": ""}},
        {"client_ip": 1, "_id": 0}
    ).limit(50000):
        ip = e.get("client_ip", "")
        if not ip or ip in already or _ip_to_country(ip) != cc:
            continue
        counters[ip] = counters.get(ip, 0) + 1
    sorted_ips = sorted(counters.items(), key=lambda x: x[1], reverse=True)[:limit]

    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for ip, cnt in sorted_ips:
        docs.append({
            "id": str(uuid.uuid4()),
            "kind": "blacklist", "type": "ip",
            "value": ip,
            "note": note or f"Toplu ülke bloklama · {cc} · {cnt} olay (son 30g)",
            "created_at": now,
            "scope": "master",
            "list_type": "black",
            "entry_type": "ip",
        })
    if docs:
        await db.lists.insert_many(docs)
    # Log
    try:
        from server import db as _db, ActivityLog
        await _db.logs.insert_one(ActivityLog(
            source="geo", level="warning",
            message=f"TOPLU BLOK · ülke={cc} · eklenen={len(docs)} · atlanan={len(already)}",
        ).model_dump())
    except Exception:
        pass
    return {
        "ok": True,
        "country": cc,
        "added": len(docs),
        "skipped_already_blocked": len(already),
        "note": note or f"Toplu ülke bloklama · {cc}",
    }


# ============================================================================
# WEBSOCKET: Canlı saldırı akışı — Landing/Panel için realtime feed
# ============================================================================
from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402
import asyncio  # noqa: E402
import json as _json  # noqa: E402


class _AttackBroadcaster:
    """WebSocket connection pool. Her yeni event `broadcast()` ile tüm
    dinleyicilere JSON olarak yollanır. Landing MapFooter + arcs bunu
    dinleyerek anlık patlama animasyonu tetikler."""
    def __init__(self):
        self.subscribers: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self.subscribers.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self.subscribers.discard(ws)

    async def broadcast(self, payload: dict):
        if not self.subscribers:
            return
        msg = _json.dumps(payload, default=str)
        dead = []
        for ws in list(self.subscribers):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


_ATTACK_BROADCASTER = _AttackBroadcaster()


async def push_attack_event(payload: dict):
    """Diğer route'lardan (events.py ingest) çağrılır — event geldiğinde
    tüm WebSocket dinleyicilere yayınlar."""
    await _ATTACK_BROADCASTER.broadcast(payload)


@router.websocket("/ws/attacks")
async def ws_attacks(ws: WebSocket):
    """Canlı saldırı akışı. JSON mesaj örneği:
       {"country":"RU","name":"Rusya","verdict":"spam","ts":"2026-...","ip":"1.2.3.4"}
    """
    await _ATTACK_BROADCASTER.connect(ws)
    try:
        # Bağlantı sağlıklı kalsın diye ping/pong loop (30sn)
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await ws.send_text('{"type":"ping"}')
            except WebSocketDisconnect:
                break
    except Exception:
        pass
    finally:
        await _ATTACK_BROADCASTER.disconnect(ws)


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


@router.post("/ip/whitelist")
async def ip_whitelist(payload: IPBlockIn):
    """Bir IP'yi bloktan kaldır ve kalıcı whitelist'e ekle."""
    # Önce blacklist ve IOC'lerden temizle
    await db.lists.delete_many({"kind": "blacklist", "type": "ip", "value": payload.ip})
    await db.threat_iocs.delete_many({"type": "ip", "value": payload.ip})
    # Whitelist'e ekle
    await db.lists.update_one(
        {"kind": "whitelist", "type": "ip", "value": payload.ip},
        {"$set": {
            "id": str(uuid.uuid4()),
            "kind": "whitelist", "type": "ip", "value": payload.ip,
            "reason": payload.reason or "Yanlış pozitif düzeltmesi",
            "license_key": payload.license_key,
            "source": "false_positive_recovery",
            "created_at": _iso(),
        }},
        upsert=True,
    )
    return {"ok": True, "ip": payload.ip, "whitelisted": True}


@router.get("/whitelist/list")
async def whitelist_list(limit: int = 200):
    """Whitelist'teki tüm IP'leri listele."""
    rows = await db.lists.find(
        {"kind": "whitelist", "type": "ip"}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    # Ülke ve event sayısı ile zenginleştir
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731
    for r in rows:
        ip = r.get("value", "")
        r["country"] = _ip_to_country(ip)
        try:
            r["event_count"] = await db.mail_events.count_documents({
                "$or": [{"client_ip": ip}, {"sender_ip": ip}],
            })
        except Exception:
            r["event_count"] = 0
    return {"items": rows, "count": len(rows)}


@router.post("/whitelist/remove")
async def whitelist_remove(payload: IPBlockIn):
    """Whitelist'ten çıkar."""
    r = await db.lists.delete_many({"kind": "whitelist", "type": "ip", "value": payload.ip})
    return {"ok": True, "removed": r.deleted_count}


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



# ============================================================================
# PUBLIC LANDING: Bugün satın alan kişi sayacı (bot destekli social proof)
# ============================================================================
@router.get("/public/sales-today")
async def public_sales_today():
    """Landing için 'Bugün X kişi lisans aldı' sayacı.
    Gerçek satışlar + bot-şişirme kombine edilir (satış kanıtı için).

    Formül:
      base = 8-14 (günlük tohum ile sabit)
      time_curve = 0-1 (gün ilerledikçe artar, akşam ~19'da doruk)
      inflated_today = base + time_curve × (25-45)
      final = max(gerçek_satış, inflated_today)
    """
    import hashlib
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    tr_now = now  # UTC; TR+3 zaten kabaca aynı gün
    hour = tr_now.hour + tr_now.minute / 60

    # Gerçek bugünkü satış (DB'den)
    today_start = tr_now.replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        real_today = await db.licenses.count_documents({
            "created_at": {"$gte": today_start.isoformat()}
        })
    except Exception:
        real_today = 0

    # Günlük tohum → aynı gün boyunca aynı base + hedef sayı
    day_seed = int(hashlib.md5(tr_now.strftime("%Y-%m-%d").encode()).hexdigest()[:8], 16)
    base = 8 + (day_seed % 7)  # 8-14
    daily_target_max = 32 + (day_seed >> 8) % 18  # 32-49

    # Zaman eğrisi: gece 00:00'da 0, akşam 19:00'da 1
    time_factor = min(1.0, max(0.0, hour / 19.0))
    inflated_today = base + int(time_factor * daily_target_max)

    # Dakika bazlı küçük dalgalanma
    min_seed = int(hashlib.md5(tr_now.strftime("%Y-%m-%d %H:%M").encode()).hexdigest()[:6], 16)
    jitter = min_seed % 3
    inflated_today += jitter

    # Gerçek satışların altına düşmesin
    sales_today = max(real_today, inflated_today)

    # Haftalık ve aylık şişirme (satış momentumu)
    sales_week = sales_today * (5 + (day_seed >> 4) % 3)  # ~5-7 gün
    sales_month = sales_today * (24 + (day_seed >> 12) % 6)  # ~24-29 gün

    # Son satın alanlar (fake, sosyal kanıt için)
    # Türkçe + uluslararası isim ve şehir karışımı — global bir SaaS gibi görünsün.
    turkish_names = [
        "Ahmet Y.", "Mehmet K.", "Ayşe D.", "Fatma A.", "Mustafa Ö.",
        "Emre B.", "Zeynep T.", "Elif Ç.", "Ali H.", "Selin M.",
        "Burak V.", "Deniz S.", "Cem G.", "Merve L.", "Kerem P.",
        "Hakan U.", "İpek R.", "Onur E.", "Sude N.", "Furkan İ.",
    ]
    intl_names = [
        "John M.", "Emma S.", "Michael R.", "Sarah K.", "David L.",
        "Maria G.", "Ahmed H.", "Fatima A.", "Chen W.", "Yuki T.",
        "Ivan P.", "Klaus B.", "Sofia V.", "Anders J.", "Rajesh K.",
        "Anna F.", "Lars N.", "Priya S.", "Omar F.", "Elena R.",
    ]
    # (şehir, ülke, bayrak_emoji) tuple'ları — kart üzerinde "İstanbul, TR 🇹🇷" gibi görünür.
    tr_cities = [
        ("İstanbul", "TR", "🇹🇷"), ("Ankara", "TR", "🇹🇷"), ("İzmir", "TR", "🇹🇷"),
        ("Bursa", "TR", "🇹🇷"), ("Antalya", "TR", "🇹🇷"), ("Konya", "TR", "🇹🇷"),
        ("Adana", "TR", "🇹🇷"), ("Gaziantep", "TR", "🇹🇷"), ("Kayseri", "TR", "🇹🇷"),
        ("Samsun", "TR", "🇹🇷"), ("Trabzon", "TR", "🇹🇷"), ("Eskişehir", "TR", "🇹🇷"),
        ("Kocaeli", "TR", "🇹🇷"), ("Mersin", "TR", "🇹🇷"),
    ]
    intl_cities = [
        ("Berlin", "DE", "🇩🇪"), ("München", "DE", "🇩🇪"), ("Hamburg", "DE", "🇩🇪"),
        ("London", "GB", "🇬🇧"), ("Manchester", "GB", "🇬🇧"),
        ("Paris", "FR", "🇫🇷"), ("Lyon", "FR", "🇫🇷"),
        ("Amsterdam", "NL", "🇳🇱"), ("Rotterdam", "NL", "🇳🇱"),
        ("New York", "US", "🇺🇸"), ("Los Angeles", "US", "🇺🇸"), ("Chicago", "US", "🇺🇸"),
        ("Toronto", "CA", "🇨🇦"), ("Vancouver", "CA", "🇨🇦"),
        ("Dubai", "AE", "🇦🇪"), ("Abu Dhabi", "AE", "🇦🇪"),
        ("Doha", "QA", "🇶🇦"), ("Riyadh", "SA", "🇸🇦"), ("Kuwait City", "KW", "🇰🇼"),
        ("Baku", "AZ", "🇦🇿"), ("Tashkent", "UZ", "🇺🇿"),
        ("Moscow", "RU", "🇷🇺"), ("Kiev", "UA", "🇺🇦"),
        ("Tokyo", "JP", "🇯🇵"), ("Osaka", "JP", "🇯🇵"), ("Seoul", "KR", "🇰🇷"),
        ("Singapore", "SG", "🇸🇬"), ("Hong Kong", "HK", "🇭🇰"),
        ("Sydney", "AU", "🇦🇺"), ("Melbourne", "AU", "🇦🇺"),
        ("Milan", "IT", "🇮🇹"), ("Rome", "IT", "🇮🇹"),
        ("Madrid", "ES", "🇪🇸"), ("Barcelona", "ES", "🇪🇸"),
        ("Zurich", "CH", "🇨🇭"), ("Vienna", "AT", "🇦🇹"),
        ("Stockholm", "SE", "🇸🇪"), ("Copenhagen", "DK", "🇩🇰"), ("Oslo", "NO", "🇳🇴"),
        ("Warsaw", "PL", "🇵🇱"), ("Prague", "CZ", "🇨🇿"),
        ("Athens", "GR", "🇬🇷"), ("Bucharest", "RO", "🇷🇴"),
        ("Sofia", "BG", "🇧🇬"), ("Skopje", "MK", "🇲🇰"),
        ("Cairo", "EG", "🇪🇬"), ("Casablanca", "MA", "🇲🇦"),
        ("Lagos", "NG", "🇳🇬"), ("Nairobi", "KE", "🇰🇪"),
        ("Mumbai", "IN", "🇮🇳"), ("Bangalore", "IN", "🇮🇳"), ("Delhi", "IN", "🇮🇳"),
        ("São Paulo", "BR", "🇧🇷"), ("Buenos Aires", "AR", "🇦🇷"), ("Mexico City", "MX", "🇲🇽"),
    ]
    plans = ["Starter", "Pro", "Enterprise"]

    # Bölgesel isim + şirket havuzları — her şehir kendi kültürüne uygun
    # isim/şirket ile eşleşir. Firma satın alımı ~%35 ihtimal ile görünür.
    region_pool = {
        "TR": {
            "cities": [
                ("İstanbul", "TR", "🇹🇷"), ("Ankara", "TR", "🇹🇷"), ("İzmir", "TR", "🇹🇷"),
                ("Bursa", "TR", "🇹🇷"), ("Antalya", "TR", "🇹🇷"), ("Konya", "TR", "🇹🇷"),
                ("Adana", "TR", "🇹🇷"), ("Gaziantep", "TR", "🇹🇷"), ("Kayseri", "TR", "🇹🇷"),
                ("Samsun", "TR", "🇹🇷"), ("Trabzon", "TR", "🇹🇷"), ("Eskişehir", "TR", "🇹🇷"),
                ("Kocaeli", "TR", "🇹🇷"), ("Mersin", "TR", "🇹🇷"),
            ],
            "names": [
                "Ahmet Y.", "Mehmet K.", "Ayşe D.", "Fatma A.", "Mustafa Ö.",
                "Emre B.", "Zeynep T.", "Elif Ç.", "Ali H.", "Selin M.",
                "Burak V.", "Deniz S.", "Cem G.", "Merve L.", "Kerem P.",
            ],
            "firms": [
                "Yıldız Yazılım A.Ş.", "Anadolu Hosting Ltd.", "Ege Bilişim Ltd.",
                "Marmara Tech Ltd.", "Bosphorus Digital", "Kuzey Yazılım",
            ],
        },
        "DE": {
            "cities": [("Berlin", "DE", "🇩🇪"), ("München", "DE", "🇩🇪"), ("Hamburg", "DE", "🇩🇪"),
                       ("Frankfurt", "DE", "🇩🇪"), ("Köln", "DE", "🇩🇪")],
            "names": ["Klaus B.", "Anna F.", "Hans M.", "Ingrid W.", "Stefan R.", "Petra L."],
            "firms": ["Bauer GmbH", "Nord Systems AG", "Schmidt IT UG", "Digital Bayern GmbH"],
        },
        "GB": {
            "cities": [("London", "GB", "🇬🇧"), ("Manchester", "GB", "🇬🇧"),
                       ("Edinburgh", "GB", "🇬🇧"), ("Birmingham", "GB", "🇬🇧")],
            "names": ["John M.", "Emma S.", "Oliver P.", "Sophie H.", "James W.", "Charlotte D."],
            "firms": ["Redwood Ltd.", "Thames Digital Ltd.", "Northern IT Solutions",
                      "London Cloud Services"],
        },
        "FR": {
            "cities": [("Paris", "FR", "🇫🇷"), ("Lyon", "FR", "🇫🇷"),
                       ("Marseille", "FR", "🇫🇷"), ("Toulouse", "FR", "🇫🇷")],
            "names": ["Pierre D.", "Marie L.", "Jean-Luc B.", "Sophie R.", "Antoine V."],
            "firms": ["Étoile Numérique SARL", "Provence Hosting", "Paris Cloud SAS"],
        },
        "NL": {
            "cities": [("Amsterdam", "NL", "🇳🇱"), ("Rotterdam", "NL", "🇳🇱"),
                       ("Utrecht", "NL", "🇳🇱")],
            "names": ["Jan V.", "Marieke B.", "Pieter D.", "Sanne K."],
            "firms": ["Delta Cloud BV", "Nord Hosting", "Amsterdam Digital"],
        },
        "US": {
            "cities": [("New York", "US", "🇺🇸"), ("Los Angeles", "US", "🇺🇸"),
                       ("Chicago", "US", "🇺🇸"), ("Miami", "US", "🇺🇸"),
                       ("Austin", "US", "🇺🇸"), ("Seattle", "US", "🇺🇸")],
            "names": ["Michael R.", "Sarah K.", "David L.", "Jennifer M.", "Ryan T.", "Emily J."],
            "firms": ["Pinnacle Systems Inc.", "Blue Ridge Hosting LLC",
                      "West Coast Cloud Inc.", "Summit Digital LLC"],
        },
        "CA": {
            "cities": [("Toronto", "CA", "🇨🇦"), ("Vancouver", "CA", "🇨🇦"),
                       ("Montreal", "CA", "🇨🇦")],
            "names": ["Liam T.", "Olivia F.", "Noah S.", "Emma B."],
            "firms": ["Maple Digital Inc.", "Rocky Mountain IT", "Great Lakes Hosting"],
        },
        "AE": {
            "cities": [("Dubai", "AE", "🇦🇪"), ("Abu Dhabi", "AE", "🇦🇪")],
            "names": ["Omar F.", "Ahmed H.", "Fatima A.", "Layla K.", "Khalid M."],
            "firms": ["Al Noor Systems LLC", "Emirates Cloud", "Gulf Digital FZE"],
        },
        "SA": {
            "cities": [("Riyadh", "SA", "🇸🇦"), ("Jeddah", "SA", "🇸🇦")],
            "names": ["Yousef A.", "Nora B.", "Faisal K.", "Sara H."],
            "firms": ["Najm Technology Co.", "Riyadh Digital", "Kingdom Hosting"],
        },
        "QA": {
            "cities": [("Doha", "QA", "🇶🇦")],
            "names": ["Hamad A.", "Aisha M."],
            "firms": ["Qatar Cloud W.L.L.", "Doha Systems"],
        },
        "AZ": {
            "cities": [("Baku", "AZ", "🇦🇿")],
            "names": ["Elvin M.", "Aygün H.", "Rauf İ."],
            "firms": ["Baku Digital MMC", "Caspian IT"],
        },
        "UZ": {
            "cities": [("Tashkent", "UZ", "🇺🇿")],
            "names": ["Rustam K.", "Malika A."],
            "firms": ["Tashkent Cloud LLC"],
        },
        "RU": {
            "cities": [("Moscow", "RU", "🇷🇺"), ("St. Petersburg", "RU", "🇷🇺")],
            "names": ["Ivan P.", "Elena V.", "Dmitry S.", "Anastasia K."],
            "firms": ["Nord IT OOO", "Volga Digital"],
        },
        "UA": {
            "cities": [("Kiev", "UA", "🇺🇦"), ("Lviv", "UA", "🇺🇦")],
            "names": ["Oleksandr M.", "Iryna V."],
            "firms": ["Kyiv Cloud LLC", "Dnipro Digital"],
        },
        "JP": {
            "cities": [("Tokyo", "JP", "🇯🇵"), ("Osaka", "JP", "🇯🇵")],
            "names": ["Yuki T.", "Hiroshi M.", "Sakura I.", "Kenji A."],
            "firms": ["Sakura IT株式会社", "Nihon Cloud Co.", "Osaka Digital Ltd."],
        },
        "KR": {
            "cities": [("Seoul", "KR", "🇰🇷"), ("Busan", "KR", "🇰🇷")],
            "names": ["Min-jun L.", "Ji-woo K.", "Seo-yeon P."],
            "firms": ["Hanul IT Co.", "Seoul Cloud Corp."],
        },
        "CN": {
            "cities": [("Shanghai", "CN", "🇨🇳"), ("Beijing", "CN", "🇨🇳")],
            "names": ["Chen W.", "Li Ming", "Wang Fang", "Zhang Wei"],
            "firms": ["Dragon Cloud Ltd.", "Great Wall Digital", "Shanghai IT Corp."],
        },
        "SG": {
            "cities": [("Singapore", "SG", "🇸🇬")],
            "names": ["Wei L.", "Mei Ling C.", "Rajesh S."],
            "firms": ["Marina Cloud Pte Ltd", "Lion City Digital"],
        },
        "HK": {
            "cities": [("Hong Kong", "HK", "🇭🇰")],
            "names": ["Kwok M.", "Yuen L."],
            "firms": ["Harbour Cloud Ltd.", "HK Digital Co."],
        },
        "IN": {
            "cities": [("Mumbai", "IN", "🇮🇳"), ("Bangalore", "IN", "🇮🇳"),
                       ("Delhi", "IN", "🇮🇳"), ("Hyderabad", "IN", "🇮🇳")],
            "names": ["Rajesh K.", "Priya S.", "Arjun M.", "Ananya V.", "Vikram R."],
            "firms": ["Sundar Systems Pvt Ltd", "Bengaluru IT Solutions",
                      "Himalaya Cloud Pvt", "Mumbai Digital Ltd."],
        },
        "AU": {
            "cities": [("Sydney", "AU", "🇦🇺"), ("Melbourne", "AU", "🇦🇺")],
            "names": ["Jack W.", "Chloe R.", "Mason B."],
            "firms": ["Outback Cloud Pty Ltd", "Aussie IT Solutions"],
        },
        "IT": {
            "cities": [("Milan", "IT", "🇮🇹"), ("Rome", "IT", "🇮🇹")],
            "names": ["Marco B.", "Giulia F.", "Alessandro V."],
            "firms": ["Roma Digital S.r.l.", "Milano Cloud SpA"],
        },
        "ES": {
            "cities": [("Madrid", "ES", "🇪🇸"), ("Barcelona", "ES", "🇪🇸")],
            "names": ["Carlos R.", "María L.", "Sofía G.", "Diego M."],
            "firms": ["Ibérica Cloud S.L.", "Sol Digital SA"],
        },
        "CH": {
            "cities": [("Zurich", "CH", "🇨🇭"), ("Geneva", "CH", "🇨🇭")],
            "names": ["Andreas M.", "Nicole R."],
            "firms": ["Alpine IT AG", "Swiss Cloud GmbH"],
        },
        "AT": {
            "cities": [("Vienna", "AT", "🇦🇹")],
            "names": ["Lukas H.", "Sophie K."],
            "firms": ["Wien Cloud GmbH", "Donau Digital AG"],
        },
        "SE": {
            "cities": [("Stockholm", "SE", "🇸🇪")],
            "names": ["Anders J.", "Astrid L."],
            "firms": ["Nordic Cloud AB", "Stockholm IT AB"],
        },
        "DK": {
            "cities": [("Copenhagen", "DK", "🇩🇰")],
            "names": ["Lars N.", "Freja E."],
            "firms": ["København Cloud ApS"],
        },
        "NO": {
            "cities": [("Oslo", "NO", "🇳🇴")],
            "names": ["Erik B.", "Ingrid V."],
            "firms": ["Fjord Cloud AS"],
        },
        "PL": {
            "cities": [("Warsaw", "PL", "🇵🇱"), ("Kraków", "PL", "🇵🇱")],
            "names": ["Piotr K.", "Anna N."],
            "firms": ["Wisła Cloud Sp. z o.o."],
        },
        "CZ": {
            "cities": [("Prague", "CZ", "🇨🇿")],
            "names": ["Jakub S.", "Tereza N."],
            "firms": ["Vltava Digital s.r.o."],
        },
        "GR": {
            "cities": [("Athens", "GR", "🇬🇷")],
            "names": ["Nikos P.", "Eleni M."],
            "firms": ["Aegean Cloud IKE"],
        },
        "EG": {
            "cities": [("Cairo", "EG", "🇪🇬")],
            "names": ["Mahmoud A.", "Yasmin K."],
            "firms": ["Nile Cloud LLC"],
        },
        "MA": {
            "cities": [("Casablanca", "MA", "🇲🇦")],
            "names": ["Youssef B.", "Salma R."],
            "firms": ["Atlas Digital SARL"],
        },
        "NG": {
            "cities": [("Lagos", "NG", "🇳🇬")],
            "names": ["Chinedu O.", "Adaeze N."],
            "firms": ["Lagos Cloud Ltd."],
        },
        "BR": {
            "cities": [("São Paulo", "BR", "🇧🇷"), ("Rio de Janeiro", "BR", "🇧🇷")],
            "names": ["Lucas S.", "Beatriz A.", "Rafael M."],
            "firms": ["Amazônia Digital Ltda.", "Copacabana Cloud SA"],
        },
        "AR": {
            "cities": [("Buenos Aires", "AR", "🇦🇷")],
            "names": ["Diego P.", "Camila R."],
            "firms": ["Pampa Cloud S.A."],
        },
        "MX": {
            "cities": [("Mexico City", "MX", "🇲🇽")],
            "names": ["Miguel Á.", "Valentina H."],
            "firms": ["Aztec Cloud S.A. de C.V."],
        },
    }
    regions = list(region_pool.keys())
    # Ağırlıklı seçim: Türkiye baskın (~%50), gerisi uluslararası mix.
    # TR'ye 20 slot, diğer her ülkeye 1 slot ver → hash % len(weighted) ile pick.
    weighted_regions = ["TR"] * 20 + [r for r in regions if r != "TR"]

    recent = []
    for i in range(6):
        row_hash = int(hashlib.md5(f"{day_seed}-{min_seed}-buyer-{i}".encode()).hexdigest()[:12], 16)
        region = weighted_regions[row_hash % len(weighted_regions)]
        pool = region_pool[region]
        city_t = pool["cities"][(row_hash >> 8) % len(pool["cities"])]
        # ~%35 firma satın alımı, ~%65 bireysel
        is_firm = (row_hash % 20) < 7
        if is_firm and pool["firms"]:
            buyer = pool["firms"][(row_hash >> 4) % len(pool["firms"])]
            kind = "firm"
        else:
            buyer = pool["names"][(row_hash >> 4) % len(pool["names"])]
            kind = "individual"
        recent.append({
            "name": buyer,
            "kind": kind,           # "firm" veya "individual" (UI'de ikon değişebilir)
            "city": city_t[0],
            "country_code": city_t[1],
            "flag": city_t[2],
            "plan": plans[(row_hash >> 16) % len(plans)],
            "minutes_ago": 2 + (row_hash >> 24) % 58,  # 2-59 dk önce
        })
    # Zamana göre sırala (yakın olan üstte)
    recent.sort(key=lambda x: x["minutes_ago"])

    return {
        "sales_today": sales_today,
        "sales_this_week": sales_week,
        "sales_this_month": sales_month,
        "recent_buyers": recent,
        "generated_at": tr_now.isoformat(),
    }
