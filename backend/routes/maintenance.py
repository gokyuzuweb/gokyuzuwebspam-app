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
async def public_blocked_stats(region: str = "all"):
    """Landing için: bugün bloklanan sayı + son 30 gün bar chart verisi.
    Cache dostu, license gerektirmez.
    region: 'all' (default) | 'tr' (Türkiye) | 'external' (dış)."""
    from datetime import date, timedelta, datetime as _dt
    try:
        from routes.security_adv import _ip_to_country
    except Exception:
        _ip_to_country = lambda x: None  # noqa: E731

    today = date.today()
    today_iso = today.isoformat()
    start = today - timedelta(days=29)

    verdict_filter = {"verdict": {"$in": ["spam", "high_spam", "virus"]}}

    def _match_region(ip: str | None) -> bool:
        if region == "all":
            return True
        cc = _ip_to_country(ip or "")
        if region == "tr":
            return cc == "TR"
        if region == "external":
            return cc is not None and cc != "TR" and cc != "LOCAL"
        return True

    # Toplam ve bugünü tek geçişte topla
    since_iso = start.isoformat()
    today_count = 0
    total_events_today = 0
    all_time_blocked = 0
    by_day: dict[str, int] = {}
    # all-time: sadece region=all için hızlı; region filtreli ise event-scan zorunlu
    if region == "all":
        all_time_blocked = await db.mail_events.count_documents(verdict_filter)
        total_events_today = await db.mail_events.count_documents({
            "$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}],
        })
        today_count = await db.mail_events.count_documents({
            **verdict_filter,
            "$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}],
        })
        # 30 gün
        async for e in db.mail_events.find(
            {**verdict_filter,
             "$or": [{"ts": {"$gte": since_iso}}, {"ingested_at": {"$gte": since_iso}}]},
            {"ts": 1, "ingested_at": 1, "_id": 0},
        ).limit(50000):
            raw = e.get("ts") or e.get("ingested_at") or ""
            day_key = raw[:10] if raw else None
            if day_key:
                by_day[day_key] = by_day.get(day_key, 0) + 1
    else:
        # Region filter — IP'yi al, ülke bak
        async for e in db.mail_events.find(
            {**verdict_filter},
            {"ts": 1, "ingested_at": 1, "sender_ip": 1, "client_ip": 1, "_id": 0},
        ).limit(100000):
            ip = e.get("sender_ip") or e.get("client_ip")
            if not _match_region(ip):
                continue
            all_time_blocked += 1
            raw = e.get("ts") or e.get("ingested_at") or ""
            if not raw:
                continue
            if raw >= today_iso:
                today_count += 1
            if raw >= since_iso:
                day_key = raw[:10]
                by_day[day_key] = by_day.get(day_key, 0) + 1
        # today total (region-filtered)
        async for e in db.mail_events.find(
            {"$or": [{"ts": {"$gte": today_iso}}, {"ingested_at": {"$gte": today_iso}}]},
            {"sender_ip": 1, "client_ip": 1, "_id": 0},
        ).limit(50000):
            ip = e.get("sender_ip") or e.get("client_ip")
            if _match_region(ip):
                total_events_today += 1

    # 30 slot doldur
    series: list[dict] = []
    for i in range(30):
        d = (start + timedelta(days=i)).isoformat()
        series.append({"date": d, "count": by_day.get(d, 0)})
    peak = max((s["count"] for s in series), default=0)
    avg = round(sum(s["count"] for s in series) / 30, 1)

    return {
        "today_blocked": today_count,
        "today_total": total_events_today,
        "block_rate": round(today_count * 100 / max(1, total_events_today), 1),
        "all_time_blocked": all_time_blocked,
        "series_30d": series,
        "peak_30d": peak,
        "avg_30d": avg,
        "region": region,
        "last_updated": _iso(),
    }




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
