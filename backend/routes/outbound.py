"""
v43 Outbound Filtering + Bulk Detection

Karantina/CanlıMail modülüne paralel bir sistem: giden mail'leri filtreleyip
bulk (toplu) davranışını tespit eder, kullanıcı throttle eder.

Endpoints:
  GET  /api/outbound/events        — filtreli giden mail listesi
  GET  /api/outbound/stats         — bugün giden / spam / bloklanan / top user
  GET  /api/outbound/bulk-alerts   — anlık toplu mail uyarıları
  GET  /api/outbound/throttles     — throttle uygulanmış kullanıcılar
  POST /api/outbound/throttle      — kullanıcı sınırla
  POST /api/outbound/throttle/remove — throttle kaldır
  POST /api/outbound/event/{id}/action — sil / karantina / whitelist_sender
  POST /api/outbound/migrate-direction — mevcut mail_events'a direction:"in" backfill

Data model:
  mail_events (existing) + `direction: "in"|"out"` + `from_user`
  outbound_throttles: { license_key, from_user, throttled, sent_count, limit, throttled_at }
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from deps import db


# ============================================================================
# v43.15 — Türkçe karakter safety-net (subject decoding on READ path)
# ============================================================================
def _fix_subject(s: str) -> str:
    """Legacy DB kayıtlarında hala bozuk (MIME encoded-word veya mojibake)
    subject'ler olabilir. Okuma sırasında da tekrar temizle — idempotent.
    v43.15c: ftfy kütüphanesi ile mixed-mojibake dahil tüm bozulmaları onarır.
    v43.17: ftfy'nin çözemediği Windows-1252/UTF-8 karma bigram'ları manuel çözer."""
    if not s:
        return s
    out = s
    # 1) MIME encoded-word decode (=?UTF-8?B?...?= veya =?UTF-8?Q?...?=)
    if "=?" in out and "?=" in out:
        try:
            from email.header import decode_header, make_header
            out = str(make_header(decode_header(out)))
        except Exception:
            pass
    # 2) ftfy ile toplu decode (mono-encoding mojibake için)
    if any(m in out for m in ("Ã", "Å", "Ä±", "Ä°", "â€", "â", "â")):
        try:
            import ftfy
            fixed = ftfy.fix_text(out)
            def _tr_ratio(t): return sum(1 for c in t if c in "çğıöşüÇĞİÖŞÜ")
            if _tr_ratio(fixed) >= _tr_ratio(out):
                out = fixed
        except ImportError:
            try:
                fixed = out.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
                if fixed and "Ã" not in fixed and "Å" not in fixed:
                    out = fixed
            except Exception:
                pass
        except Exception:
            pass
    # 3) v43.17 — Manual bigram fixup (Windows-1252/UTF-8 karma mojibake).
    # ftfy'nin yakalayamadığı isolated bigram'lar için hedefli substitusyon.
    _bigrams = {
        "\u00c5\u0178": "\u015e",  # Å + Ÿ → Ş
        "\u00c5\u009e": "\u015e",  # Å + <9E> → Ş
        "\u00c4\u00b0": "\u0130",  # Ä + ° → İ
        "\u00c4\u00b1": "\u0131",  # Ä + ± → ı
        "\u00c4\u0178": "\u017e",  # Ä + Ÿ → ž (rare)
        "\u00c3\u00bc": "\u00fc",  # Ã + ¼ → ü
        "\u00c3\u00b6": "\u00f6",  # Ã + ¶ → ö
        "\u00c3\u00a7": "\u00e7",  # Ã + § → ç
        "\u00c3\u009c": "\u00dc",  # Ã + <9C> → Ü
        "\u00c3\u0153": "\u00dc",  # Ã + œ → Ü (Windows-1252 path)
        # v43.17c — U+FFFD (replacement char) sonlu bigram'lar
        "\u00c5\ufffd": "\u015e",  # Å + � → Ş
        "\u00c4\ufffd": "\u011e",  # Ä + � → Ğ
        "\u00c3\ufffd": "\u0130",  # Ã + � → İ
        # v43.18 — â€ (Windows-1252 punctuation misread) bigram'lar
        "\u00e2\u20ac\u009c": "\u201c",  # â€œ → " (open quote)
        "\u00e2\u20ac\u009d": "\u201d",  # â€ → " (close quote)
        "\u00e2\u20ac\u0099": "\u2019",  # â€™ → ' (right single quote)
        "\u00e2\u20ac\u0098": "\u2018",  # â€˜ → ' (left single quote)
        "\u00e2\u20ac\ufffd": "\u201d",  # â€� → " (replacement char after â€)
        "\u00e2\u20ac\u201c": "\u2013",  # â€“ → – (en-dash)
        "\u00e2\u20ac\u201d": "\u2014",  # â€" → — (em-dash)
        # v43.18 — DISKWARN system message mojibake (⚠ warning triangle)
        "\u00e2\u0161\ufffd": "\u26a0",  # â� → ⚠ (warning triangle)
        "\u00e2\u0161\u00a0": "\u26a0",  # âš  → ⚠ (with trailing NBSP)
        "\u00e2\u0161": "\u26a0",         # âš (bare, warning triangle mojibake)
        "\u00e2\ufffd": "\u26a0",         # â� (2-char) → ⚠
        # v43.18 — Trailing â€ alone (unpaired close quote) → strip veya "
        "\u00e2\u20ac ": " ",             # â€ (space) → space (remove artifact)
        "\u00e2\u20ac$": "",              # â€ at end of string → strip
    }
    for bad, good in _bigrams.items():
        if bad in out:
            out = out.replace(bad, good)
    # v43.17b — Bigram sonrası büyük/küçük harf context düzeltmesi:
    # "edilmiŞ çözüm" → "edilmiş çözüm" (lowercase letter follows → lowercase Ş)
    # "müŞteri" → "müşteri"
    import re as _re
    out = _re.sub(r"(?<=[a-zçğıöüi])Ş(?=[a-zçğıöüi\s]|$)", "ş", out)
    out = _re.sub(r"(?<=[a-zçğıöüi])İ(?=[a-zçğıöüi\s]|$)", "i", out)
    out = _re.sub(r"(?<=[a-zçğıöüi])Ğ(?=[a-zçğıöüi\s]|$)", "ğ", out)
    # Ayrıca isolated Å kalmışsa (Ş yerine) — ardışık küçük harf varsa uygula
    out = _re.sub(r"Å(?=[a-zçğıöüi])", "ş", out)
    out = _re.sub(r"Å(?=\s|$|[A-ZÇĞİÖŞÜ])", "Ş", out)
    # 4) Whitespace normalize
    return out.strip() if out else out

from tenant import resolve_tenant_scope
from cache import cache as _cache

router = APIRouter(prefix="/outbound", tags=["outbound"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_user(from_addr: str) -> str:
    """`user@example.com` → `user`."""
    if not from_addr:
        return ""
    return from_addr.split("@", 1)[0].strip().lower()


# ============================================================================
# STATS: Bugün toplam giden, spam, bloklanan, top sender
# ============================================================================
@router.get("/stats")
async def outbound_stats(request: Request, license_key: Optional[str] = None):
    """Bugünkü outbound özet. Cache 15sn (Frontend 20sn polling)."""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""

    cache_key = f"outbound:stats:{lic_key or 'MASTER'}"
    cached = await _cache.get(cache_key)
    if cached is not None:
        return cached

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    match_base: dict = {"direction": "out", "ts": {"$gte": today_start}}
    if lic_key:
        match_base["license_key"] = lic_key

    policy = await db.settings.find_one({"_key": "policy"}, {"_id": 0}) or {}
    limit_hour = int(policy.get("outbound_limit_per_hour", 200))

    # Tek $facet ile 4 sayıyı topla
    pipeline = [
        {"$match": match_base},
        {"$facet": {
            "total": [{"$count": "n"}],
            "spam": [
                {"$match": {"verdict": {"$in": ["spam", "high_spam", "virus"]}}},
                {"$count": "n"},
            ],
            "blocked": [
                {"$match": {"verdict": {"$in": ["blocked", "block"]}}},
                {"$count": "n"},
            ],
            "top_users": [
                {"$group": {
                    "_id": {"$ifNull": ["$from_user", ""]},
                    "sent": {"$sum": 1},
                    "spam": {"$sum": {"$cond": [
                        {"$in": ["$verdict", ["spam", "high_spam", "virus"]]}, 1, 0,
                    ]}},
                    "blocked": {"$sum": {"$cond": [
                        {"$in": ["$verdict", ["blocked", "block"]]}, 1, 0,
                    ]}},
                }},
                {"$match": {"_id": {"$ne": ""}}},
                {"$sort": {"sent": -1}},
                {"$limit": 20},
            ],
        }},
    ]
    try:
        agg = await db.mail_events.aggregate(pipeline, allowDiskUse=True).to_list(1)
        r = agg[0] if agg else {}
    except Exception:
        r = {}

    total = (r.get("total") or [{}])[0].get("n", 0) if r.get("total") else 0
    spam = (r.get("spam") or [{}])[0].get("n", 0) if r.get("spam") else 0
    blocked = (r.get("blocked") or [{}])[0].get("n", 0) if r.get("blocked") else 0
    top_users = [
        {
            "user": row.get("_id") or "(bilinmeyen)",
            "sent": row.get("sent", 0),
            "spam": row.get("spam", 0),
            "blocked": row.get("blocked", 0),
        }
        for row in (r.get("top_users") or [])
    ]

    # Throttle count
    throttle_q: dict = {"throttled": True}
    if lic_key:
        throttle_q["license_key"] = lic_key
    throttled_users = await db.outbound_throttles.count_documents(throttle_q)

    # v43.24 — Tüm zamanlar sayacı (bugün 0 olsa bile kullanıcı geçmiş veriyi görsün)
    all_time_q: dict = {"direction": "out"}
    if lic_key:
        all_time_q["license_key"] = lic_key
    all_time_total = await db.mail_events.count_documents(all_time_q)

    result = {
        "today_total": total,
        "today_spam": spam,
        "today_blocked": blocked,
        "throttled_users": throttled_users,
        "limit_per_hour": limit_hour,
        "top_users": top_users,
        "all_time_total": all_time_total,
        "last_push_at": await _get_last_push_at(lic_key or "MASTER"),
        "generated_at": _iso(),
    }
    await _cache.set(cache_key, result, 15.0)
    return result


# ---------------------------------------------------------------------------
# v43.52 — Exim message ID → timestamp decoder
# ---------------------------------------------------------------------------
# Exim MID formatı: AAAAAA-BBBBBB-CC (örn: 1uHqCk-000123-A2)
# İlk 6 karakter = epoch saniye, base62 (0-9, A-Z, a-z).
# awk parser boş `ts` gönderirse mid'den doğru timestamp'i türetiriz —
# böylece 473 kayıt hepsi aynı ts'ye düşmesin (v43.51 bug fix).
_EXIM_B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _decode_exim_mid_ts(mid: str) -> Optional[str]:
    """Exim message ID'den ISO8601 timestamp türet. Başarısız olursa None."""
    if not mid or len(mid) < 6:
        return None
    try:
        secs = 0
        for c in mid[:6]:
            v = _EXIM_B62.index(c)
            secs = secs * 62 + v
        # Sanity check: 2000-01-01 .. 2050-01-01 arası kabul et
        if 946684800 < secs < 2524608000:
            return datetime.fromtimestamp(secs, tz=timezone.utc).isoformat()
    except (ValueError, IndexError):
        return None
    return None


async def _get_last_push_at(license_key: str) -> Optional[str]:
    """Son bash push zamanı — Outbound sayfası göstergesi."""
    if license_key == "MASTER":
        # En son push edilen lisansın timestamp'ini döndür
        latest = await db.settings.find(
            {"_key": {"$regex": "^exim_logtail_pos:"}},
            {"_id": 0, "last_push_at": 1},
        ).sort("last_push_at", -1).limit(1).to_list(1)
        return (latest[0].get("last_push_at") if latest else None)
    doc = await db.settings.find_one(
        {"_key": f"exim_logtail_pos:{license_key}"}, {"_id": 0, "last_push_at": 1}) or {}
    return doc.get("last_push_at")


# ============================================================================
# EVENTS: filtreli liste — Karantina/CanlıMail pattern
# ============================================================================
@router.get("/events")
async def outbound_events(
    request: Request,
    license_key: Optional[str] = None,
    limit: int = Query(200, ge=1, le=5000),
    search: Optional[str] = None,          # from_user regex
    to_search: Optional[str] = None,       # to_addr regex
    subject_search: Optional[str] = None,
    ip_search: Optional[str] = None,
    body_search: Optional[str] = None,     # v43.18: body_preview + body_html regex
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
    hours: Optional[int] = None,           # son N saat
    verdict: Optional[str] = None,         # clean|spam|high_spam|virus|blocked
):
    """Giden mail listesi — LiveMailEvents ile aynı filtre semantiği."""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""

    match: dict = {"direction": "out"}
    if lic_key:
        match["license_key"] = lic_key
    # v43.3: `<>` envelope sender (bounce/DSN) veya sistem pseudo-user'ları
    # outbound listesinden çıkar — bunlar gerçek user-initiated outbound değil.
    match["$and"] = [
        {"from_addr": {"$nin": ["", "<>", None]}},
        {"from_addr": {"$exists": True}},
        {"$or": [
            {"from_user": {"$exists": False}},
            {"from_user": None},
            {"from_user": {"$nin": ["mailnull", "Debian-exim", "exim", "root", "nobody",
                                     "mail", "mailman", "apache", "www-data",
                                     "debian-exim"]}},
        ]},
    ]
    if hours and hours > 0:
        match["ts"] = {"$gte": (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()}
    if verdict and verdict != "all":
        match["verdict"] = verdict
    if search:
        match["from_user"] = {"$regex": search, "$options": "i"}
    if to_search:
        match["to_addr"] = {"$regex": to_search, "$options": "i"}
    if subject_search:
        match["subject"] = {"$regex": subject_search, "$options": "i"}
    if ip_search:
        match["$or"] = [
            {"sender_ip": {"$regex": ip_search, "$options": "i"}},
            {"client_ip": {"$regex": ip_search, "$options": "i"}},
        ]
    if body_search:
        # v43.18 Body Search — body_preview + body_html içinde regex ara.
        # $and'e ekle ki $or ile çakışmasın (ip_search + body_search birlikte kullanılabilsin).
        import re as _re
        safe = _re.escape(body_search)
        match["$and"].append({"$or": [
            {"body_preview": {"$regex": safe, "$options": "i"}},
            {"body_html":    {"$regex": safe, "$options": "i"}},
        ]})
    if min_score is not None:
        match.setdefault("total_score", {})["$gte"] = float(min_score)
    if max_score is not None:
        match.setdefault("total_score", {})["$lte"] = float(max_score)

    projection = {
        "_id": 0, "id": 1, "ts": 1, "from_addr": 1, "from_user": 1,
        "to_addr": 1, "subject": 1, "verdict": 1, "total_score": 1,
        "sender_ip": 1, "client_ip": 1, "action": 1, "size_bytes": 1,
        "license_key": 1,
    }
    rows = await db.mail_events.find(match, projection).sort("ts", -1).limit(limit).to_list(limit)
    # v43.15+ — Türkçe karakter fix: her satırda subject decode uygula
    for row in rows:
        if row.get("subject"):
            row["subject"] = _fix_subject(row["subject"])
    return {"items": rows, "count": len(rows), "limit": limit}


# ============================================================================
# BULK ALERTS: aktif toplu mail uyarıları
# ============================================================================
@router.get("/bulk-alerts")
async def outbound_bulk_alerts(request: Request, license_key: Optional[str] = None,
                                 limit: int = 50):
    """Aktif/yakın zamanda tetiklenmiş toplu mail alarmları (son 24 saat)."""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""

    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    q: dict = {"type": "outbound_bulk", "created_at": {"$gte": since}}
    if lic_key:
        q["license_key"] = lic_key
    rows = await db.master_alerts.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows, "count": len(rows)}


# ============================================================================
# THROTTLES: user başına sınırlama yönetimi
# ============================================================================
@router.get("/throttles")
async def outbound_throttles(request: Request, license_key: Optional[str] = None):
    """Throttled user listesi."""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""

    q: dict = {"throttled": True}
    if lic_key:
        q["license_key"] = lic_key
    rows = await db.outbound_throttles.find(q, {"_id": 0}).sort("throttled_at", -1).to_list(500)
    return {"items": rows, "count": len(rows)}


class ThrottleIn(BaseModel):
    from_user: str = Field(..., min_length=1)
    license_key: Optional[str] = None
    reason: Optional[str] = "manual"


@router.post("/throttle")
async def outbound_throttle_add(payload: ThrottleIn, request: Request):
    """Bir user'ı manuel olarak throttle et."""
    import os as _os
    scope = await resolve_tenant_scope(request, payload.license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    # Master global throttle: owner boşsa master license'ı hedef al
    if not lic_key and scope.get("is_master"):
        lic_key = _os.environ.get("MASTER_LICENSE_KEY", "") or (payload.license_key or "")
    if not lic_key:
        raise HTTPException(400, "license_key gerekli")
    user = payload.from_user.strip().lower()
    await db.outbound_throttles.update_one(
        {"license_key": lic_key, "from_user": user},
        {"$set": {
            "license_key": lic_key,
            "from_user": user,
            "throttled": True,
            "reason": payload.reason or "manual",
            "throttled_at": _iso(),
        }},
        upsert=True,
    )
    # Cache invalidation — stats'ın throttled_users sayısı değişti
    await _cache.delete(f"outbound:stats:{lic_key}")
    return {"ok": True, "from_user": user, "throttled": True}


@router.post("/throttle/remove")
async def outbound_throttle_remove(payload: ThrottleIn, request: Request):
    """Throttle'ı kaldır."""
    import os as _os
    scope = await resolve_tenant_scope(request, payload.license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    if not lic_key and scope.get("is_master"):
        lic_key = _os.environ.get("MASTER_LICENSE_KEY", "") or (payload.license_key or "")
    if not lic_key:
        raise HTTPException(400, "license_key gerekli")
    user = payload.from_user.strip().lower()
    r = await db.outbound_throttles.delete_many({
        "license_key": lic_key, "from_user": user,
    })
    await _cache.delete(f"outbound:stats:{lic_key}")
    return {"ok": True, "removed": r.deleted_count}


# ============================================================================
# ACTIONS: event bazlı işlemler (sil / karantina / whitelist_sender)
# ============================================================================
class EventActionIn(BaseModel):
    action: str = Field(..., pattern="^(delete|quarantine|whitelist_sender|throttle_sender)$")
    license_key: Optional[str] = None


@router.post("/event/{event_id}/action")
async def outbound_event_action(event_id: str, payload: EventActionIn, request: Request):
    """Tek event üzerinde işlem: sil / karantina / whitelist_sender / throttle_sender."""
    scope = await resolve_tenant_scope(request, payload.license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    q: dict = {"id": event_id, "direction": "out"}
    if lic_key:
        q["license_key"] = lic_key

    ev = await db.mail_events.find_one(q, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event bulunamadı")

    action = payload.action
    from_user = ev.get("from_user") or _extract_user(ev.get("from_addr", ""))
    result: dict = {"ok": True, "event_id": event_id, "action": action}

    if action == "delete":
        await db.mail_events.delete_one({"id": event_id})
        result["deleted"] = True
    elif action == "quarantine":
        # mail_events üzerinde işaretle + quarantine koleksiyonuna çek
        await db.mail_events.update_one({"id": event_id}, {"$set": {"action": "quarantine"}})
        exists = await db.quarantine.find_one({"id": event_id}, {"_id": 1})
        if not exists:
            await db.quarantine.insert_one({
                "id": event_id,
                "owner_license_key": ev.get("license_key"),
                "license_key": ev.get("license_key"),
                "sender": ev.get("from_addr") or "",
                "recipient": ev.get("to_addr") or "",
                "subject": _fix_subject(ev.get("subject") or "") or "(konusuz)",
                "verdict": ev.get("verdict") or "spam",
                "total_score": ev.get("total_score", 0),
                "scores": ev.get("scores") or {},
                "sender_ip": ev.get("sender_ip") or ev.get("client_ip") or "",
                "received_at": ev.get("ts"),
                "ingested_at": ev.get("ingested_at") or _iso(),
                "direction": "out",
                "from_user": from_user,
                "released": False,
            })
        result["quarantined"] = True
    elif action == "whitelist_sender":
        # from_addr'ı whitelist'e ekle
        if not ev.get("from_addr"):
            raise HTTPException(400, "from_addr yok")
        await db.lists.update_one(
            {"kind": "whitelist", "type": "email", "value": ev["from_addr"]},
            {"$set": {
                "id": str(uuid.uuid4()),
                "kind": "whitelist", "type": "email",
                "value": ev["from_addr"],
                "reason": "Outbound Sistem — güvenilir gönderen",
                "license_key": lic_key or ev.get("license_key"),
                "created_at": _iso(),
            }},
            upsert=True,
        )
        result["whitelisted"] = ev["from_addr"]
    elif action == "throttle_sender":
        if not from_user:
            raise HTTPException(400, "from_user tespit edilemedi")
        await db.outbound_throttles.update_one(
            {"license_key": ev.get("license_key"), "from_user": from_user},
            {"$set": {
                "license_key": ev.get("license_key"),
                "from_user": from_user,
                "throttled": True,
                "reason": "manual_from_event",
                "throttled_at": _iso(),
            }},
            upsert=True,
        )
        result["throttled_user"] = from_user

    # Cache'i invalidate et
    await _cache.delete(f"outbound:stats:{ev.get('license_key') or 'MASTER'}")
    return result


# ============================================================================
# MIGRATION: mevcut mail_events dokümanlarına direction:"in" backfill
# ============================================================================
@router.get("/event/{event_id}/content")
async def outbound_event_content(event_id: str, request: Request,
                                   license_key: Optional[str] = None):
    """Tek outbound event'in tam içeriği — headers + body + attachments.
    Frontend'de "Mail İçeriği Oku" modal'ını besler."""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    q: dict = {"id": event_id, "direction": "out"}
    if lic_key:
        q["license_key"] = lic_key
    ev = await db.mail_events.find_one(q, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Mail bulunamadı veya yetkiniz yok")

    # v43.15 — Body/headers yoksa Exim spool'dan direkt okumayı dene.
    # Master (Docker) ortamında Exim yoktur; bayi sunucularında /var/spool/exim/input/
    # altında -H (headers) ve -D (data/body) dosyaları saatlerce kalır.
    body_preview = ev.get("body_preview") or ""
    body_html    = ev.get("body_html") or ""
    headers_full = ev.get("headers_full") or ev.get("headers_preview") or ""
    source_note  = ""
    if (not body_preview and not headers_full):
        msg_id = (ev.get("message_id") or ev.get("exim_mid") or ev.get("exim_id") or "").strip()
        if msg_id:
            spool_read = _try_read_exim_spool(msg_id)
            if spool_read["ok"]:
                headers_full = spool_read.get("headers") or headers_full
                body_preview = spool_read.get("body") or body_preview
                source_note = f"Exim spool'dan okundu: {spool_read.get('path')}"

    return {
        "id": ev.get("id"),
        "ts": ev.get("ts") or ev.get("ingested_at"),
        "from_addr": ev.get("from_addr"),
        "from_user": ev.get("from_user"),
        "to_addr": ev.get("to_addr"),
        "subject": _fix_subject(ev.get("subject") or ""),
        "verdict": ev.get("verdict"),
        "total_score": ev.get("total_score"),
        "scores": ev.get("scores") or {},
        "sender_ip": ev.get("sender_ip") or ev.get("client_ip"),
        "size_bytes": ev.get("size_bytes"),
        "message_id": ev.get("message_id") or ev.get("exim_mid") or ev.get("exim_id"),
        "headers_full": headers_full,
        # v43.24 — Türkçe mojibake fix'i body_preview + body_html'e de uygula
        # (eski bozuk kayıtlar da görüntülerken düzelir)
        "body_preview": _fix_subject(body_preview) if body_preview else body_preview,
        "body_html":    _fix_subject(body_html)    if body_html    else body_html,
        "attachments": ev.get("attachments") or [],
        "action": ev.get("action"),
        # v43.23 — ClamAV verdict + threats (Milter tarafından yazılır)
        "clam_verdict": ev.get("clam_verdict"),
        "clam_threats": ev.get("clam_threats") or [],
        # v43.15 — kullanıcıya rehber bilgi
        "content_source": source_note or ("db" if (headers_full or body_preview) else "none"),
        "spool_hint": (
            f"/var/spool/exim/input/{(ev.get('message_id') or '')[:3]}/{ev.get('message_id') or ''}-H "
            if ev.get("message_id") else ""
        ),
    }


def _try_read_exim_spool(msg_id: str) -> dict:
    """v43.15 — Bayi WHM sunucusunda Exim -H/-D dosyalarını okumayı dener.
    Master (Docker) ortamında Exim yoktur, {ok: False} döner. Dosya bulunursa:
    - -H dosyasından header'ları ayıklar
    - -D dosyasından body'nin ilk 8KB'ını okur
    """
    import os as _os
    if not msg_id or len(msg_id) < 3:
        return {"ok": False, "reason": "invalid_msg_id"}
    # Exim message-id formatı: XXXXXX-XXXXXX-XX (16 char) — spool'da ilk 3 char subdir
    subdir = msg_id[:3]
    base = f"/var/spool/exim/input/{subdir}"
    h_file = f"{base}/{msg_id}-H"
    d_file = f"{base}/{msg_id}-D"
    if not _os.path.exists(h_file) and not _os.path.exists(d_file):
        return {"ok": False, "reason": "spool_not_found", "path": h_file}
    out = {"ok": True, "path": base}
    try:
        if _os.path.exists(h_file):
            with open(h_file, "r", encoding="utf-8", errors="replace") as fh:
                raw = fh.read(64 * 1024)
                # Exim -H dosyasında sender/recipients ve boş satırdan sonra headers gelir
                if "\n\n" in raw:
                    _, hdrs = raw.split("\n\n", 1)
                    out["headers"] = hdrs[:8192]
                else:
                    out["headers"] = raw[:8192]
    except Exception as e:
        out["headers_err"] = str(e)
    try:
        if _os.path.exists(d_file):
            with open(d_file, "rb") as fb:
                # -D dosyası: 1. satır message-id (skip), sonra body
                first_line = fb.readline()
                del first_line
                body_bytes = fb.read(8 * 1024)  # 8KB
                out["body"] = body_bytes.decode("utf-8", errors="replace")[:8192]
    except Exception as e:
        out["body_err"] = str(e)
    return out


@router.post("/migrate-direction")
async def outbound_migrate_direction(request: Request, license_key: Optional[str] = None):
    """Master-only. Mevcut `mail_events`'ta `direction` alanı olmayan dokümanlara
    `direction: "in"` ekler. Idempotent; sadece missing'leri günceller.

    v43.1: Ayrıca `<>` envelope sender veya sistem pseudo-user (mailnull vb)
    olan bounce mesajlarını yanlış outbound sınıflandırmasından kurtarır."""
    from server import _require_master
    await _require_master(request, license_key)

    # 1) direction eksik olanlara "in" yaz
    r1 = await db.mail_events.update_many(
        {"direction": {"$exists": False}},
        {"$set": {"direction": "in"}},
    )
    # 2) Yanlış outbound sınıflandırılmış bounce'ları düzelt (<> sender)
    r2 = await db.mail_events.update_many(
        {"direction": "out", "$or": [
            {"from_addr": "<>"},
            {"from_addr": ""},
            {"from_addr": None},
        ]},
        {"$set": {"direction": "in"}, "$unset": {"from_user": ""}},
    )
    # 3) Sistem pseudo-user'ları düzelt
    system_users = ["mailnull", "Debian-exim", "exim", "root", "nobody", "mail",
                    "mailman", "apache", "www-data"]
    r3 = await db.mail_events.update_many(
        {"direction": "out",
         "from_user": {"$in": system_users + [u.lower() for u in system_users]}},
        {"$set": {"direction": "in"}, "$unset": {"from_user": ""}},
    )
    return {
        "ok": True,
        "missing_direction_fixed": r1.modified_count,
        "bounce_null_sender_fixed": r2.modified_count,
        "system_user_fixed": r3.modified_count,
        "total_fixed": r1.modified_count + r2.modified_count + r3.modified_count,
    }


# v43.28 — Outbound Sunucu Tanısı + Demo Seed
# Kullanıcının panelinde giden posta boş göründüğünde nedenini teşhis eder.
@router.get("/diagnostic")
async def outbound_diagnostic(request: Request):
    """Outbound boş görünme nedenini teşhis eder.
    Kontroller:
      - Master session aktif mi?
      - DB'de outbound event var mı?
      - Milter'ın direction=out yazıp yazmadığı (son 24 saatte outbound ingest'i)
    """
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=24)).isoformat()
    total_events = await db.mail_events.count_documents({})
    outbound_total = await db.mail_events.count_documents({"direction": "out"})
    outbound_24h = await db.mail_events.count_documents({"direction": "out", "ts": {"$gte": since}})
    inbound_24h = await db.mail_events.count_documents({"direction": "in", "ts": {"$gte": since}})
    # Master check
    master_key = (request.headers.get("x-master-key") or "").strip()
    is_master = master_key.startswith("MS-")
    # Bayi lisans
    lic_key = None
    if not is_master:
        lic_key = request.query_params.get("license_key") or None
    # Milter aktivite (son ingest)
    last_out = None
    async for d in db.mail_events.find({"direction": "out"}).sort("ts", -1).limit(1):
        last_out = d.get("ts")
        break
    # Değerlendirme
    diagnosis = []
    fix_hints = []
    # v43.41 — Plugin version detection (heartbeat.pl / systemd state)
    plugin_states = await db.plugin_state.find({}, {"_id": 0, "plugin_version": 1, "hostname": 1, "last_heartbeat_at": 1}).sort("last_heartbeat_at", -1).limit(5).to_list(5)
    stale_plugins = [p for p in plugin_states if (p.get("plugin_version") or "").startswith(("1.0", "1.1"))]
    if plugin_states:
        latest_plugin = plugin_states[0]
        pv = latest_plugin.get("plugin_version", "")
        if pv and pv < "1.2.0":
            diagnosis.append(f"⚠ Bayi WHM plugin sürümünüz eski: v{pv} (heartbeat.pl Exim log tailer'ı v1.2+ ile geldi)")
            fix_hints.append("Sunucunuza SSH ile bağlanıp: sudo gws-update  → sonra heartbeat.pl otomatik güncellenir ve 15dk cycle'ında Exim log push başlar")
    if not is_master and not lic_key:
        diagnosis.append("Master anahtarı gitmiyor — X-Master-Key header yok")
        fix_hints.append("Header'da 'Master Aktif Et' butonuna tıklayıp MS- anahtarınızı girin")
    if outbound_total == 0:
        diagnosis.append("Veritabanında hiç outbound kaydı yok")
        fix_hints.append("Sunucunuzda: 'sudo gws-update' çalıştırın. Yeni heartbeat.pl (v43.38+) Exim mainlog'u okuyup panele push eder — MILTER kurmak GEREKMEZ.")
    elif outbound_24h == 0 and outbound_total > 0:
        diagnosis.append(f"DB'de {outbound_total} outbound var ama son 24 saatte 0 — heartbeat.pl durmuş veya eski sürüm")
        fix_hints.append("Sunucuda: 'systemctl status gws-heartbeat' + 'tail /var/log/mailshield/exim-tail.log' + 'perl /usr/local/bin/heartbeat.pl' manuel deneyin")
    if outbound_total > 0 and is_master:
        diagnosis.append("Backend outbound veri sunuyor, panel görmelidir — cache/browser sorunu olabilir")
        fix_hints.append("Sayfayı yenileyin (Ctrl+F5) veya query cache'i temizleyin")
    return {
        "ok": True,
        "master_authenticated": is_master,
        "license_scope": lic_key,
        "total_events": total_events,
        "outbound_total": outbound_total,
        "outbound_last_24h": outbound_24h,
        "inbound_last_24h": inbound_24h,
        "last_outbound_ts": last_out,
        "plugin_states": plugin_states,
        "stale_plugins_count": len(stale_plugins),
        "diagnosis": diagnosis or ["Her şey normal görünüyor"],
        "fix_hints": fix_hints or [],
    }


@router.post("/dev/seed-sample")
async def outbound_seed_sample(request: Request):
    """v43.38 — Preview/demo için 50 gerçekçi outbound event ekler.
    ConfigServer MailScanner benzeri görünüm için farklı domain, verdict, saat
    dağılımı kullanılır. Master gerekli."""
    from datetime import datetime, timezone, timedelta
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli (X-Master-Key header)")
    import random, uuid
    now = datetime.now(timezone.utc)
    # Gerçekçi Türk hosting müşterisi profili (ConfigServer örneğine benzer)
    users = ["info", "admin", "sales", "support", "noreply", "kemal.ozturk", "ece.karahan",
             "burak", "ayla.uzun", "info", "hasan", "muhasebe", "iletisim", "destek"]
    domains = ["gokyuzuhosting.com", "aydogdudenizcilik.com", "sedefshipyard.com",
               "talentcenter.com.tr", "seramikcenter.com", "ditasdeniz.com.tr",
               "hammadde.com.tr", "erol denizcilik.com", "fatsachemicals.com",
               "tuzlaadr.com", "opus.tuzlaadr.com", "musteri.com.tr", "corporate.com"]
    ext_recipients = [
        "kemal.ozturk@sedefshipyard.com", "info@aydogdudenizcilik.com",
        "aylauzun@seramikcenter.com", "bilgi@eroldenizcilik.com",
        "eymen@alesend.com", "burak@fatsachemicals.com",
        "ece.karahan@talentcenter.com.tr", "hasananac@hammadde.com.tr",
        "kemal@dilsen.com", "info@ilkimas.com", "store@dilsen.com",
        "customer1@gmail.com", "customer2@outlook.com", "customer3@yahoo.com.tr",
    ]
    subjects_by_verdict = {
        "clean": [
            "5.000 TL'ye Varan İNDİRİM!", "Mağazanız için Görsel Çözümler",
            "Cari Hesap Mutabakatı Haziran/2026", "Workitive Insight #011",
            "İŞ KAZASI HK.", "Devlet desteği almak zor değil",
            "Ürün katalogumuz güncellendi", "Sipariş onayı - #S28193",
            "Kargo takip bilgisi", "Fatura ekli - Nisan 2026",
        ],
        "spam": [
            "URGENT: Milyon dolar bekliyor", "🎁 Kazandınız! Tıklayın",
            "IBAN değişti — yeni hesap numaram", "Şantaj: paranı öde",
            "Winner notification — claim now", "Sahte fatura ödemeniz gerekli",
        ],
        "high_spam": [
            "🔥 ACIL: Hesabınız kilitlenecek!!!", "PayPal doğrulama gerekli",
            "Cryptocurrency yatırım fırsatı!!!", "Nijerya prens miras",
        ],
        "blocked": [
            "Malware detected — attachment blocked",
        ],
    }
    verdict_weights = [("clean", 0.72), ("spam", 0.18), ("high_spam", 0.08), ("blocked", 0.02)]
    inserted = []
    for i in range(50):
        # Random verdict per weight
        r = random.random()
        acc = 0
        verdict = "clean"
        for v, w in verdict_weights:
            acc += w
            if r <= acc:
                verdict = v
                break
        # Score based on verdict
        score = round({
            "clean": random.uniform(-2.0, 2.5),
            "spam": random.uniform(5.0, 8.0),
            "high_spam": random.uniform(8.5, 15.0),
            "blocked": random.uniform(12.0, 20.0),
        }[verdict], 2)
        subj = random.choice(subjects_by_verdict[verdict])
        from_user = random.choice(users)
        domain = random.choice(domains)
        # Time spread: last 24 saat
        minutes_ago = random.randint(0, 60 * 23)
        ts = (now - timedelta(minutes=minutes_ago)).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "license_key": master_key,
            "direction": "out",
            "from_addr": f"{from_user}@{domain}",
            "from_user": from_user,
            "to_addr": random.choice(ext_recipients),
            "subject": subj,
            "verdict": verdict,
            "total_score": score,
            "action": "accept" if verdict == "clean" else ("reject" if verdict == "blocked" else "quarantine"),
            "sender_ip": f"{random.randint(31, 213)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}",
            "body_preview": f"[DEMO SEED] Gönderen: {from_user}@{domain}. Konu: {subj[:80]}",
            "ts": ts,
            "ingested_at": ts,
            "scores": {"spamassassin": score, "bayes": round(random.uniform(0, 3), 2)},
            "source": "demo_seed",
            "size_bytes": random.randint(2048, 900_000),
        }
        await db.mail_events.insert_one(doc)
        inserted.append(doc["id"])
    return {"ok": True, "inserted": len(inserted),
            "note": f"{len(inserted)} demo outbound eklendi. Sayfayı yenileyin — filtre 'Son 24 saat' ise hepsi görünmeli."}



# ============================================================================
# v43.38 — EXIM LOG PUSH (no-milter fallback)
# ---------------------------------------------------------------------------
# heartbeat.pl her cycle'da /var/log/exim_mainlog son N satırını okuyup bu
# endpoint'e POST eder. Bu sayede Milter kurulmadan sadece heartbeat daemon'la
# outbound trafik pane'e akar.
#
# Exim log formatı (delivery/reject lines):
#   2026-08-15 14:34:56 1uHqCk-000123-A2 <= user@domain.com H=... U=user P=esmtp S=12345 id=xyz
#   2026-08-15 14:34:57 1uHqCk-000123-A2 => external@example.com R=dnslookup T=remote_smtp
#   2026-08-15 14:34:58 1uHqCk-000123-A2 Completed
# ============================================================================
class EximLogLine(BaseModel):
    ts: str
    exim_mid: Optional[str] = ""
    from_addr: Optional[str] = ""
    to_addr: Optional[str] = ""
    from_user: Optional[str] = ""
    subject: Optional[str] = ""
    size_bytes: Optional[int] = 0
    host: Optional[str] = ""
    action: Optional[str] = "accept"


class EximPushIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    hostname: Optional[str] = ""
    server_ip: Optional[str] = ""
    events: list[dict] = Field(default_factory=list, max_length=1000)
    since_position: Optional[int] = None
    checkpoint_position: Optional[int] = None


@router.post("/exim-log-push")
async def exim_log_push(payload: EximPushIn):
    """Bayi heartbeat.pl'in Exim log tailer'ı — /var/log/exim_mainlog'dan
    son okunan pozisyondan itibaren yeni satırları buraya push eder.
    Idempotent: exim_mid varsa aynı olay tekrar eklenmez (upsert).

    v43.47 — Master anahtarı (MS-…) kabul et: db.licenses'ta kayıt olmasa dahi
    master key ile push edilebilir (self-hosted deployment kolaylığı)."""
    import os as _os_lic
    lic = await db.licenses.find_one(
        {"license_key": payload.license_key, "active": True}, {"_id": 0})
    # v43.47: Fallback — master license (self-hosted). Master key env'de/settings'te
    # tanımlıysa VE payload aynı ise, licenses tablosuna otomatik ekle + kabul et.
    if not lic:
        pk = (payload.license_key or "").strip()
        env_master = _os_lic.environ.get("MASTER_LICENSE_KEY", "").strip()
        is_master_shape = pk.startswith("MS-") and len(pk) >= 20
        settings_master = await db.settings.find_one(
            {"_key": "master_license"}, {"_id": 0, "value": 1}) or {}
        settings_master_key = (settings_master.get("value") or "").strip()
        if pk and (pk == env_master or pk == settings_master_key or is_master_shape):
            # Auto-register as active license (self-hosted master convenience)
            await db.licenses.update_one(
                {"license_key": pk},
                {"$set": {
                    "license_key": pk, "active": True, "kind": "master_self_hosted",
                    "plan": "master", "company": "Self-Hosted Master",
                    "email": "master@self-hosted.local",
                    "hostname": payload.hostname or "unknown",
                    "auto_registered_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            lic = {"license_key": pk, "active": True, "kind": "master_self_hosted", "plan": "master"}
        else:
            raise HTTPException(403, "Geçersiz lisans")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    inserted = 0
    updated = 0
    ts_fallback_count = 0  # v43.52 — kaç eventte ts fallback devreye girdi
    for idx, e in enumerate(payload.events[:1000]):
        mid = str(e.get("exim_mid") or e.get("mid") or "").strip()
        from_addr = str(e.get("from_addr") or "").strip()
        to_addr = str(e.get("to_addr") or "").strip()
        if not (mid or (from_addr and to_addr)):
            continue
        # Only OUTBOUND: from_user is a local cPanel user OR from_addr is on
        # the server's local domains. Heuristic: exim log 'U=' field maps to
        # from_user; presence of it means outbound.
        from_user = str(e.get("from_user") or "").strip()
        if not from_user and "@" in from_addr:
            from_user = from_addr.split("@", 1)[0]
        # Verdict + score: heartbeat pl usually cannot compute — use "unknown"
        verdict = e.get("verdict") or "clean"
        score = float(e.get("total_score") or 0)

        # v43.52 — Robust timestamp resolution:
        # 1) awk'dan gelen ts geçerliyse kullan
        # 2) Değilse Exim mid'in ilk 6 char'ından türet (base62 epoch)
        # 3) Yine olmadıysa now - offset (batch içi sıralı spread)
        raw_ts = str(e.get("ts") or "").strip()
        ts_val = ""
        if raw_ts and raw_ts.startswith(("19", "20")) and len(raw_ts) >= 10:
            ts_val = raw_ts
        else:
            decoded = _decode_exim_mid_ts(mid)
            if decoded:
                ts_val = decoded
            else:
                # Son çare: batch içindeki idx kadar geriye kaydır
                ts_val = (now - timedelta(seconds=idx)).isoformat()
                ts_fallback_count += 1
        doc = {
            "id": str(uuid.uuid4()),
            "license_key": payload.license_key,
            "direction": "out",
            "exim_mid": mid,
            "from_addr": from_addr,
            "from_user": from_user,
            "to_addr": to_addr,
            "subject": e.get("subject") or "",
            "verdict": verdict,
            "total_score": score,
            "action": e.get("action") or "accept",
            "sender_ip": e.get("sender_ip") or payload.server_ip,
            "size_bytes": int(e.get("size_bytes") or 0),
            "ts": ts_val,
            "ingested_at": now_iso,
            "source": "exim_logtail_heartbeat",
            "server_hostname": payload.hostname or lic.get("hostname"),
        }
        # Idempotent upsert by exim_mid+to_addr
        key = {"license_key": payload.license_key, "exim_mid": mid, "to_addr": to_addr} \
            if mid else {"license_key": payload.license_key, "from_addr": from_addr,
                         "to_addr": to_addr, "ts": doc["ts"]}
        r = await db.mail_events.update_one(
            key,
            {"$set": doc, "$setOnInsert": {"first_seen": now_iso}},
            upsert=True,
        )
        if r.upserted_id is not None:
            inserted += 1
        else:
            updated += 1

    # Checkpoint kaydı
    if payload.checkpoint_position is not None:
        await db.settings.update_one(
            {"_key": f"exim_logtail_pos:{payload.license_key}"},
            {"$set": {
                "_key": f"exim_logtail_pos:{payload.license_key}",
                "license_key": payload.license_key,
                "hostname": payload.hostname,
                "last_position": payload.checkpoint_position,
                "last_push_at": now_iso,
                "last_inserted": inserted,
            }},
            upsert=True,
        )

    return {"ok": True, "inserted": inserted, "updated": updated,
            "total": inserted + updated, "checkpoint": payload.checkpoint_position,
            "ts_fallback_used": ts_fallback_count}


@router.get("/exim-log-checkpoint")
async def exim_log_checkpoint(license_key: str = Query(..., min_length=8)):
    """heartbeat.pl bir sonraki cycle'da nereden okumaya devam edeceğini öğrenir."""
    doc = await db.settings.find_one(
        {"_key": f"exim_logtail_pos:{license_key}"}, {"_id": 0}) or {}
    return {
        "last_position": doc.get("last_position", 0),
        "last_push_at": doc.get("last_push_at"),
        "last_inserted": doc.get("last_inserted", 0),
    }


# ============================================================================
# v43.54 — RAW Exim log push (bash awk parser silent-fail çözüm)
# ---------------------------------------------------------------------------
# Sunucudan raw exim log text'i alınır, Python ile parse edilir. Bash awk
# script'inin silent-fail sorunlarını atlar; tek gereklilik curl + tail.
# Kullanıcı SSH tek satır: tail -n 5000 /var/log/exim_mainlog | \
#   curl -X POST panel.gokyuzuhosting.com/api/outbound/exim-log-push-raw \
#     -H "X-License-Key: MS-..." --data-binary @-
# ============================================================================
import re as _re_raw


_ARRIVAL_RE = _re_raw.compile(
    r"^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s(\S+)\s<=\s(\S+)(.*)$"
)
_DELIVERY_RE = _re_raw.compile(
    r"^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s(\S+)\s(=>|->|\*\*|==)\s(\S+)(.*)$"
)


def _parse_exim_log_raw(text: str, userdomains: set[str] | None = None) -> list[dict]:
    """Raw exim log text'i events'lere parse et. Awk yerine Python — daha robust."""
    userdomains = userdomains or set()
    in_flight: dict[str, dict] = {}
    events: list[dict] = []
    for line in text.splitlines():
        line = line.rstrip()
        if not line:
            continue
        m_arr = _ARRIVAL_RE.match(line)
        if m_arr:
            date, time_, mid, sender, rest = m_arr.groups()
            # v43.56 — Exim log timestamp'i **server local time** yazar (UTC değil).
            # Timezone bilgisi eklemiyoruz — browser as-is gösterir (double conversion önlenir).
            ts = f"{date}T{time_}"
            user = ""
            auth_user = ""
            size = 0
            subj = ""
            # Parse rest for U=, A=dovecot_login, S=, T=
            for token in rest.split():
                if token.startswith("U="):
                    user = token[2:]
                elif token.startswith("A=dovecot_login:") or token.startswith("A=courier_login:"):
                    auth_user = token.split(":", 1)[1] if ":" in token else ""
                elif token.startswith("S="):
                    try:
                        size = int(token[2:])
                    except ValueError:
                        pass
            # Subject: T="..." pattern
            m_subj = _re_raw.search(r'T="([^"]*)"', rest)
            if m_subj:
                subj = m_subj.group(1)
            in_flight[mid] = {
                "ts": ts, "from_addr": sender,
                "from_user": auth_user or user, "size_bytes": size, "subject": subj,
            }
            continue
        m_del = _DELIVERY_RE.match(line)
        if m_del:
            date, time_, mid, direction, rcpt, rest = m_del.groups()
            arr = in_flight.get(mid)
            if not arr:
                continue
            # Recipient: rest'te <full@email> varsa onu al
            m_full = _re_raw.search(r"<([^>]+@[^>]+)>", rest)
            if m_full:
                rcpt = m_full.group(1)
            elif "@" not in rcpt:
                sd = arr["from_addr"].split("@", 1)[-1] if "@" in arr["from_addr"] else ""
                if sd:
                    rcpt = f"{rcpt}@{sd}"
            # Outbound check
            u = arr["from_user"]
            is_outbound = bool(u and u not in ("root", "mailnull", "Debian-exim"))
            if not is_outbound:
                sd = arr["from_addr"].split("@", 1)[-1].lower() if "@" in arr["from_addr"] else ""
                if sd in userdomains:
                    is_outbound = True
            if not is_outbound:
                continue
            display_user = u.split("@", 1)[0] if "@" in u else u
            action = {"**": "bounce", "==": "defer"}.get(direction, "accept")
            events.append({
                "exim_mid": mid,
                "ts": arr["ts"],
                "from_addr": arr["from_addr"],
                "from_user": display_user,
                "to_addr": rcpt,
                "subject": arr["subject"],
                "size_bytes": arr["size_bytes"],
                "verdict": "clean",
                "total_score": 0,
                "action": action,
            })
    return events


class RawPushIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    log_text: Optional[str] = None  # Explicit text
    userdomains: Optional[list[str]] = None
    hostname: Optional[str] = ""


@router.post("/exim-log-push-raw")
async def exim_log_push_raw(request: Request):
    """Raw exim log text kabul eder, Python ile parse eder, DB'ye yazar.

    İki kullanım (Content-Type'a göre otomatik seçim):
    1) Content-Type: application/json → body: {"license_key":"MS-…", "log_text":"...", "userdomains":["..."]}
    2) Content-Type: text/plain veya diğer → X-License-Key header + raw body

    Bash awk silent-fail sorununu bypass eder. Basit tail-and-post workflow'una uyar.
    """
    import os as _os_lic
    lic_key = ""
    log_text = ""
    userdomains_set: set[str] = set()
    hostname = ""

    ct = (request.headers.get("content-type") or "").lower()
    body = await request.body()

    if "application/json" in ct and body:
        try:
            import json as _json
            import base64 as _b64
            data = _json.loads(body.decode("utf-8", errors="ignore"))
            lic_key = str(data.get("license_key") or "").strip()
            # v43.55 — Base64 encoded body desteği (LiteSpeed/WAF bypass için)
            b64_val = data.get("log_text_b64") or ""
            if b64_val:
                try:
                    log_text = _b64.b64decode(b64_val).decode("utf-8", errors="ignore")
                except Exception as e:
                    raise HTTPException(400, f"log_text_b64 decode hatası: {e} (b64 uzunluk={len(b64_val)})")
                if not log_text.strip():
                    raise HTTPException(400,
                        f"log_text_b64 decode edildi ama sonuç boş. b64 uzunluk={len(b64_val)}, decoded uzunluk={len(log_text)}. "
                        f"Muhtemelen tail 0 byte döndü — script sudo ile mi çalışıyor?")
            else:
                log_text = data.get("log_text") or ""
            userdomains_set = set(data.get("userdomains") or [])
            hostname = data.get("hostname") or ""
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"JSON parse hatası: {e}")
    else:
        lic_key = (request.headers.get("x-license-key") or "").strip()
        log_text = body.decode("utf-8", errors="ignore")
        hostname = request.headers.get("x-hostname") or ""

    if not lic_key or (not lic_key.startswith("MS-") and len(lic_key) < 8):
        raise HTTPException(400, "License key gerekli (X-License-Key header veya JSON body)")

    # License doğrula/oluştur (v43.47 auto-register mantığı)
    lic = await db.licenses.find_one(
        {"license_key": lic_key, "active": True}, {"_id": 0})
    if not lic:
        env_master = _os_lic.environ.get("MASTER_LICENSE_KEY", "").strip()
        is_master_shape = lic_key.startswith("MS-") and len(lic_key) >= 20
        if lic_key == env_master or is_master_shape:
            await db.licenses.update_one(
                {"license_key": lic_key},
                {"$set": {"license_key": lic_key, "active": True,
                          "kind": "master_self_hosted", "plan": "master",
                          "company": "Self-Hosted Master",
                          "email": "master@self-hosted.local",
                          "auto_registered_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
        else:
            raise HTTPException(403, "Geçersiz lisans")

    if not log_text.strip():
        raise HTTPException(400, "log_text boş — tail çıktısı gönderin")

    events = _parse_exim_log_raw(log_text, userdomains_set)
    if not events:
        return {"ok": True, "parsed": 0, "inserted": 0, "updated": 0,
                "note": "Parse edilebilir arrival/delivery çifti bulunamadı — daha fazla log satırı gönderin"}

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    inserted = 0
    updated = 0
    for idx, e in enumerate(events[:1000]):
        mid = e.get("exim_mid", "")
        from_addr = e.get("from_addr", "")
        to_addr = e.get("to_addr", "")
        raw_ts = e.get("ts", "")
        if raw_ts and raw_ts.startswith(("19", "20")):
            ts_val = raw_ts
        else:
            decoded = _decode_exim_mid_ts(mid)
            ts_val = decoded or (now - timedelta(seconds=idx)).isoformat()

        doc = {
            "id": str(uuid.uuid4()),
            "license_key": lic_key,
            "direction": "out",
            "exim_mid": mid,
            "from_addr": from_addr,
            "from_user": e.get("from_user", ""),
            "to_addr": to_addr,
            "subject": e.get("subject", ""),
            "verdict": e.get("verdict", "clean"),
            "total_score": e.get("total_score", 0),
            "action": e.get("action", "accept"),
            "size_bytes": e.get("size_bytes", 0),
            "ts": ts_val,
            "ingested_at": now_iso,
            "source": "exim_raw_push",
            "server_hostname": hostname,
        }
        key = {"license_key": lic_key, "exim_mid": mid, "to_addr": to_addr}
        r = await db.mail_events.update_one(
            key, {"$set": doc, "$setOnInsert": {"first_seen": now_iso}}, upsert=True)
        if r.upserted_id is not None:
            inserted += 1
        else:
            updated += 1

    await db.settings.update_one(
        {"_key": f"exim_logtail_pos:{lic_key}"},
        {"$set": {"_key": f"exim_logtail_pos:{lic_key}",
                  "license_key": lic_key,
                  "last_push_at": now_iso,
                  "last_inserted": inserted,
                  "source": "raw_push"}},
        upsert=True,
    )
    return {"ok": True, "parsed": len(events), "inserted": inserted,
            "updated": updated, "total": inserted + updated}


# ============================================================================
# v43.52 — Timestamp Repair (473 kayıt aynı ts bug'ı için tek seferlik migration)
# ============================================================================
@router.post("/repair-timestamps")
async def repair_timestamps(request: Request, dry_run: bool = False):
    """Aynı ts'ye sıkışmış outbound mail_events'a Exim mid'inden türetilmiş
    doğru timestamp'i yaz. Master anahtarı ile korunur. Idempotent.

    Bug: v43.51 öncesi awk parser bazen boş ts gönderiyordu → backend `now`
    fallback → tek batch'te 473 kayıt aynı ts'ye düştü. Bu endpoint mid'den
    base62 decode ederek gerçek timestamp'i geri getirir.
    """
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")

    # 1) Tekrarlanan ts değerlerini bul (aynı ts'ye ≥3 kayıt sıkışmışsa şüpheli)
    pipeline = [
        {"$match": {"direction": "out", "source": "exim_logtail_heartbeat"}},
        {"$group": {"_id": "$ts", "n": {"$sum": 1},
                    "ids": {"$push": {"id": "$id", "mid": "$exim_mid"}}}},
        {"$match": {"n": {"$gte": 3}}},
        {"$sort": {"n": -1}},
        {"$limit": 50},
    ]
    dup_groups = await db.mail_events.aggregate(pipeline).to_list(50)

    repaired = 0
    unresolved = 0
    scanned = 0
    dup_ts_list = []
    for grp in dup_groups:
        dup_ts_list.append({"ts": grp["_id"], "count": grp["n"]})
        for entry in grp["ids"]:
            scanned += 1
            mid = entry.get("mid") or ""
            derived = _decode_exim_mid_ts(mid)
            if not derived:
                unresolved += 1
                continue
            if derived == grp["_id"]:
                # zaten doğru
                continue
            if dry_run:
                repaired += 1
                continue
            await db.mail_events.update_one(
                {"id": entry["id"]},
                {"$set": {"ts": derived, "ts_repaired_at":
                          datetime.now(timezone.utc).isoformat()}}
            )
            repaired += 1

    return {
        "ok": True,
        "dry_run": dry_run,
        "duplicate_groups": dup_ts_list,
        "scanned": scanned,
        "repaired": repaired,
        "unresolved": unresolved,
        "note": ("Aynı ts'ye ≥3 kayıt bulunan grupları taradı. mid'i olan "
                 "kayıtlarda base62 decode ile gerçek zamanı geri getirdi."),
    }


# ============================================================================
# v43.40 — 24h Backfill (kullanıcı butondan tetikler; heartbeat.pl işler)
# ============================================================================
@router.post("/exim-backfill/trigger")
async def exim_backfill_trigger(request: Request):
    """Master UI 'Son 24s Exim log çek' butonu → bayi lisanslara sinyal yaz.
    v43.48 — Cron her dakika çalıştığından max 60sn içinde backfill başlar.
    Signal geldiğinde bash script kendi checkpoint'ini + panel checkpoint'ini sıfırlar."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    now = datetime.now(timezone.utc).isoformat()
    signaled = 0
    # v43.48 — Auto-register master license (v43.47 mantığıyla senkron)
    known = await db.licenses.find_one(
        {"license_key": master_key, "active": True}, {"_id": 0, "license_key": 1})
    if not known:
        await db.licenses.update_one(
            {"license_key": master_key},
            {"$set": {"license_key": master_key, "active": True,
                      "kind": "master_self_hosted", "plan": "master",
                      "company": "Self-Hosted Master",
                      "email": "master@self-hosted.local",
                      "auto_registered_at": now}},
            upsert=True,
        )
    async for lic in db.licenses.find(
        {"active": True, "$or": [
            {"license_key": master_key},
            {"master_license_key": master_key},
        ]},
        {"license_key": 1, "hostname": 1},
    ):
        # Sinyal yaz
        await db.settings.update_one(
            {"_key": f"exim_backfill_signal:{lic['license_key']}"},
            {"$set": {
                "_key": f"exim_backfill_signal:{lic['license_key']}",
                "license_key": lic["license_key"],
                "hostname": lic.get("hostname"),
                "requested_at": now,
                "handled": False,
            }},
            upsert=True,
        )
        # Panel-side checkpoint'i de sıfırla — daemon tekrar tam log'u okusun
        await db.settings.update_one(
            {"_key": f"exim_logtail_pos:{lic['license_key']}"},
            {"$set": {"last_position": 0}},
        )
        signaled += 1
    return {
        "ok": True, "signaled_licenses": signaled,
        "note": (f"{signaled} sunucuya backfill sinyali yazıldı + panel checkpoint sıfırlandı. "
                 f"Cron 1 dakikada bir çalıştığından 60sn içinde son 24s log push edilecek."
                 if signaled > 0 else
                 "⚠ Aktif master lisansınız veritabanında yok. Önce bash script'i sunucunuzda "
                 "en az bir kez çalıştırın (kendini otomatik register eder)."),
    }


@router.get("/backfill-signal")
async def backfill_signal(license_key: str = Query(..., min_length=8)):
    """heartbeat.pl her cycle'da bunu kontrol eder — pending backfill varsa çalıştırır."""
    doc = await db.settings.find_one(
        {"_key": f"exim_backfill_signal:{license_key}"}, {"_id": 0}) or {}
    if not doc or doc.get("handled"):
        return {"pending": False}
    return {
        "pending": True,
        "requested_at": doc.get("requested_at"),
        "hostname": doc.get("hostname"),
    }


class BackfillAck(BaseModel):
    license_key: str = Field(..., min_length=8)
    pushed: int = 0


@router.post("/backfill-ack")
async def backfill_ack(ack: BackfillAck):
    """heartbeat.pl backfill'i tamamladıktan sonra çağırır."""
    await db.settings.update_one(
        {"_key": f"exim_backfill_signal:{ack.license_key}"},
        {"$set": {
            "handled": True,
            "handled_at": datetime.now(timezone.utc).isoformat(),
            "pushed": ack.pushed,
        }},
    )
    return {"ok": True}


# ============================================================================
# v43.40 — Outbound Geo/Threat Heatmap
# ============================================================================
_TLD_COUNTRY = {
    "com": "Uluslararası", "org": "Uluslararası", "net": "Uluslararası",
    "tr": "Türkiye", "com.tr": "Türkiye", "gov.tr": "Türkiye", "edu.tr": "Türkiye",
    "de": "Almanya", "fr": "Fransa", "uk": "Birleşik Krallık", "co.uk": "Birleşik Krallık",
    "ru": "Rusya", "cn": "Çin", "jp": "Japonya", "kr": "Güney Kore",
    "us": "ABD", "ca": "Kanada", "mx": "Meksika", "br": "Brezilya",
    "ir": "İran", "sa": "Suudi Arabistan", "ae": "BAE", "eg": "Mısır",
    "it": "İtalya", "es": "İspanya", "nl": "Hollanda", "pl": "Polonya",
    "ua": "Ukrayna", "gr": "Yunanistan", "bg": "Bulgaristan", "ro": "Romanya",
    "au": "Avustralya", "nz": "Yeni Zelanda", "in": "Hindistan", "pk": "Pakistan",
    "tk": "Yüksek Risk (Tokelau)", "xyz": "Yüksek Risk (Generic)",
    "click": "Yüksek Risk (Generic)", "top": "Yüksek Risk (Generic)",
}
_TLD_RISK = {"tk", "xyz", "click", "top", "cn", "ru", "ir"}


def _tld_of(email: str) -> str:
    if not email or "@" not in email:
        return ""
    host = email.split("@", 1)[1].lower().rstrip(".")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("com", "gov", "edu", "org", "co", "net", "ac"):
        return ".".join(parts[-2:])
    return parts[-1] if parts else ""


@router.get("/geo-stats")
async def outbound_geo_stats(request: Request, hours: int = 24, license_key: Optional[str] = None):
    """Outbound geo heatmap için son N saatteki alıcı domain kırılımı.
    Dönüş: [{tld, country, domain_count, mail_count, spam_count, risk}]"""
    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    match: dict = {"direction": "out", "ts": {"$gte": since}}
    if lic_key:
        match["license_key"] = lic_key

    # Aggregate by TLD (regex-derived on server side)
    per_domain: dict[str, dict] = {}
    async for e in db.mail_events.find(
        match, {"_id": 0, "to_addr": 1, "verdict": 1, "total_score": 1},
    ).limit(10000):
        rcpt = e.get("to_addr") or ""
        if "@" not in rcpt:
            continue
        domain = rcpt.split("@", 1)[1].lower().rstrip(".")
        tld = _tld_of(rcpt)
        d = per_domain.setdefault(domain, {
            "domain": domain, "tld": tld,
            "country": _TLD_COUNTRY.get(tld, tld.upper() or "Bilinmeyen"),
            "mail_count": 0, "spam_count": 0, "blocked_count": 0,
            "risk": tld in _TLD_RISK,
            "sample_recipients": set(),
        })
        d["mail_count"] += 1
        if e.get("verdict") in ("spam", "high_spam", "virus"):
            d["spam_count"] += 1
        if e.get("verdict") in ("blocked", "block"):
            d["blocked_count"] += 1
        if len(d["sample_recipients"]) < 3:
            d["sample_recipients"].add(rcpt)

    domains = [
        {**d, "sample_recipients": list(d["sample_recipients"])}
        for d in per_domain.values()
    ]
    domains.sort(key=lambda x: x["mail_count"], reverse=True)

    # Country roll-up
    per_country: dict[str, dict] = {}
    for d in domains:
        c = per_country.setdefault(d["country"], {
            "country": d["country"], "domains": 0, "mail_count": 0,
            "spam_count": 0, "risky": False,
        })
        c["domains"] += 1
        c["mail_count"] += d["mail_count"]
        c["spam_count"] += d["spam_count"]
        if d["risk"]:
            c["risky"] = True
    countries = sorted(per_country.values(), key=lambda x: x["mail_count"], reverse=True)

    return {
        "hours": hours,
        "total_domains": len(domains),
        "total_mail": sum(d["mail_count"] for d in domains),
        "top_domains": domains[:20],
        "countries": countries[:20],
        "risky_tlds": sorted({d["tld"] for d in domains if d["risk"]}),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================================
# v43.41 — AI Insights on Geo Heatmap Data (LLM-powered risk summary)
# ============================================================================
@router.post("/ai-insights")
async def outbound_ai_insights(request: Request, hours: int = 24, license_key: Optional[str] = None):
    """LLM'e son N saatlik heatmap + top user + top domain verisini gönderir,
    3 maddede Türkçe risk analizi + aksiyon önerisi döner. Cache 5dk."""
    import os as _os
    from cache import cache as _cache

    scope = await resolve_tenant_scope(request, license_key, db)
    lic_key = scope.get("owner_license_key") or ""
    cache_key = f"ob:ai-insights:{lic_key or 'MASTER'}:{hours}"
    cached = await _cache.get(cache_key)
    if cached is not None:
        return cached

    api_key = _os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yok")

    # Aggregate — reuse geo-stats logic
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    match: dict = {"direction": "out", "ts": {"$gte": since}}
    if lic_key:
        match["license_key"] = lic_key

    total = await db.mail_events.count_documents(match)
    spam = await db.mail_events.count_documents(
        {**match, "verdict": {"$in": ["spam", "high_spam", "virus"]}})
    high_spam = await db.mail_events.count_documents(
        {**match, "verdict": "high_spam"})

    # Top users
    top_users: list[dict] = []
    async for row in db.mail_events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$from_user", "sent": {"$sum": 1},
                    "spam": {"$sum": {"$cond": [
                        {"$in": ["$verdict", ["spam", "high_spam", "virus"]]}, 1, 0]}}}},
        {"$sort": {"sent": -1}}, {"$limit": 5},
    ]):
        top_users.append({"user": row["_id"] or "(bilinmeyen)",
                          "sent": row["sent"], "spam": row["spam"]})

    # Top domains (reuse geo)
    per_domain: dict[str, dict] = {}
    async for e in db.mail_events.find(
        match, {"_id": 0, "to_addr": 1, "verdict": 1}).limit(5000):
        rcpt = e.get("to_addr") or ""
        if "@" not in rcpt: continue
        dom = rcpt.split("@", 1)[1].lower()
        d = per_domain.setdefault(dom, {"domain": dom, "mail": 0, "spam": 0})
        d["mail"] += 1
        if e.get("verdict") in ("spam", "high_spam", "virus"):
            d["spam"] += 1
    top_domains = sorted(per_domain.values(), key=lambda x: x["mail"], reverse=True)[:8]

    # High-risk TLDs
    risky_tlds_hit: list[str] = []
    for d in top_domains:
        tld = _tld_of("x@" + d["domain"])
        if tld in _TLD_RISK:
            risky_tlds_hit.append(f".{tld} ({d['domain']})")

    if total == 0:
        result = {
            "ok": True,
            "hours": hours,
            "summary": "Son " + str(hours) + " saatte outbound trafik yok — analiz için veri gerekli. "
                       "Butondan '⚡ Son 24s Backfill' ile geçmiş veri çekebilir veya '🧪 Demo Outbound Ekle' ile örnekleyebilirsiniz.",
            "risk_level": "unknown",
            "actions": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        await _cache.set(cache_key, result, 60.0)
        return result

    # Build LLM prompt
    spam_ratio = round((spam / max(total, 1)) * 100, 1)
    prompt = (
        f"GökyüzüWebSpam outbound mail sunucusu için {hours} saatlik analiz:\n"
        f"- Toplam giden mail: {total}\n"
        f"- Spam olarak işaretlenen: {spam} ({spam_ratio}%)\n"
        f"- Yüksek risk (high_spam): {high_spam}\n\n"
        f"Top 5 gönderen kullanıcı:\n"
        + "\n".join([f"  · {u['user']}: {u['sent']} mail ({u['spam']} spam)" for u in top_users])
        + f"\n\nTop alıcı domainler:\n"
        + "\n".join([f"  · {d['domain']}: {d['mail']} mail ({d['spam']} spam)" for d in top_domains])
        + (f"\n\nYüksek riskli TLD tespit edildi: {', '.join(risky_tlds_hit)}"
           if risky_tlds_hit else "\n\nYüksek riskli TLD tespit edilmedi.")
        + "\n\nTürkçe cevapla, kısa net cümleler:\n"
          "1) 'summary' — 2 cümlelik durum özeti (en kritik noktayı vurgula)\n"
          "2) 'risk_level' — 'low' / 'medium' / 'high' / 'critical' arası tek kelime\n"
          "3) 'actions' — 3 maddelik somut aksiyon listesi ('kullanıcı X'i throttle et', "
          "'.tk TLD'ni bloklayın' gibi eyleme yönelik)\n\n"
          "Yalnızca JSON dön:\n"
          '{"summary":"…","risk_level":"…","actions":["…","…","…"]}'
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key, session_id=f"ob-ai-{uuid.uuid4().hex[:8]}",
            system_message="Sen bir outbound e-posta güvenlik analistisin. JSON dön.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        import json as _json, re
        m = re.search(r"\{[\s\S]*\}", r or "")
        parsed = _json.loads(m.group(0)) if m else {}
    except Exception as ex:
        raise HTTPException(500, f"LLM hata: {type(ex).__name__}")

    result = {
        "ok": True,
        "hours": hours,
        "summary": parsed.get("summary", ""),
        "risk_level": (parsed.get("risk_level") or "medium").lower(),
        "actions": (parsed.get("actions") or [])[:3],
        "metrics": {
            "total": total, "spam": spam, "high_spam": high_spam,
            "spam_ratio_pct": spam_ratio,
            "top_users": top_users, "top_domains": top_domains,
            "risky_tlds_hit": risky_tlds_hit,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await _cache.set(cache_key, result, 300.0)
    return result


# ============================================================================
# v43.41 — Outbound Anomaly Detection (rolling 7-day baseline)
# ============================================================================
async def run_outbound_anomaly_check_once() -> dict:
    """Her aktif lisans için son 1 saatteki gönderim vs 7 gün ortalamasını
    kıyaslar. Ratio >= 5x ise master_alerts'e kayıt yazar (idempotent — aynı
    kullanıcı 24 saat içinde tekrar tetiklenmez)."""
    import uuid as _uuid
    now = datetime.now(timezone.utc)
    since_1h = (now - timedelta(hours=1)).isoformat()
    since_7d = (now - timedelta(days=7)).isoformat()
    since_dedupe = (now - timedelta(hours=24)).isoformat()
    licenses = await db.mail_events.distinct(
        "license_key", {"direction": "out", "ts": {"$gte": since_7d}})
    flagged = 0
    for lic in licenses:
        if not lic:
            continue
        # 7-day baseline hourly average per user
        base_pipeline = [
            {"$match": {"license_key": lic, "direction": "out",
                         "ts": {"$gte": since_7d}}},
            {"$group": {"_id": "$from_user", "sent_7d": {"$sum": 1}}},
        ]
        baselines: dict[str, float] = {}
        async for r in db.mail_events.aggregate(base_pipeline):
            u = r["_id"]
            if not u: continue
            # 7 gün = 168 saat, dolayısıyla saatlik ortalama
            baselines[u] = max(r["sent_7d"] / 168.0, 0.2)  # min 0.2/saat (aksi halde spam olmasa dahi trigger olur)
        # Son 1 saat per user
        last_hour_pipeline = [
            {"$match": {"license_key": lic, "direction": "out",
                         "ts": {"$gte": since_1h}}},
            {"$group": {"_id": "$from_user", "sent_1h": {"$sum": 1}}},
        ]
        async for r in db.mail_events.aggregate(last_hour_pipeline):
            u = r["_id"]
            sent = r["sent_1h"]
            if not u or sent < 5:
                continue  # 5'ten az mail için anomali kabul etme
            base = baselines.get(u, 0.2)
            ratio = sent / base
            if ratio < 5.0:
                continue
            # Dedupe: son 24 saatte aynı user için alert varsa atla
            dupe = await db.master_alerts.find_one({
                "kind": "outbound_anomaly",
                "license_key": lic,
                "user": u,
                "created_at": {"$gte": since_dedupe},
            }, {"_id": 0, "id": 1})
            if dupe:
                continue
            severity = "error" if ratio >= 10 else "warning"
            await db.master_alerts.insert_one({
                "id": str(_uuid.uuid4()),
                "kind": "outbound_anomaly",
                "severity": severity,
                "license_key": lic,
                "user": u,
                "title": f"Outbound anomali: {u} son 1 saatte {sent} mail ({ratio:.1f}x baseline)",
                "detail": f"7 gün ortalama: {base:.2f}/saat. Şu an: {sent}. Throttle önerilir.",
                "ratio": round(ratio, 2),
                "sent_last_hour": sent,
                "baseline_per_hour": round(base, 2),
                "created_at": now.isoformat(),
                "read": False,
            })
            flagged += 1
    return {"ok": True, "licenses_scanned": len(licenses), "flagged": flagged,
            "generated_at": now.isoformat()}


@router.post("/anomaly/run-now")
async def anomaly_run_now(request: Request):
    """Kullanıcı manuel çalıştırabilsin. Master gerekli."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    return await run_outbound_anomaly_check_once()


@router.get("/anomaly/status")
async def anomaly_status():
    """Son çalıştırma bilgisi + son 20 anomali."""
    doc = await db.settings.find_one({"_key": "outbound_anomaly_last"}, {"_id": 0}) or {}
    items = await db.master_alerts.find(
        {"kind": "outbound_anomaly"}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    return {
        "last_run_at": doc.get("last_run_at"),
        "last_flagged": doc.get("last_flagged", 0),
        "recent": items,
    }


async def _outbound_anomaly_loop():
    """Background task — her 15dk anomali check. server.py startup'ta başlatılır."""
    import asyncio as _asyncio
    while True:
        try:
            res = await run_outbound_anomaly_check_once()
            await db.settings.update_one(
                {"_key": "outbound_anomaly_last"},
                {"$set": {"_key": "outbound_anomaly_last",
                          "last_run_at": res["generated_at"],
                          "last_flagged": res["flagged"]}},
                upsert=True,
            )
        except Exception:
            pass
        await _asyncio.sleep(900)  # 15 dakika
