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
    v43.15c: ftfy kütüphanesi ile mixed-mojibake dahil tüm bozulmaları onarır."""
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
    # 2) Mojibake fix — ftfy tüm known encoding hatalarını çözer
    #    ("Ã¼" → "ü", "Ãœ" → "Ü", "Ä±" → "ı", karma metinler dahil)
    if any(m in out for m in ("Ã", "Å", "Ä±", "Ä°", "â€")):
        try:
            import ftfy
            fixed = ftfy.fix_text(out)
            # Kabul: sonuç orijinalden daha kısa VE Türkçe karakter sayısı artmışsa
            def _tr_ratio(t): return sum(1 for c in t if c in "çğıöşüÇĞİÖŞÜ")
            if _tr_ratio(fixed) >= _tr_ratio(out):
                out = fixed
        except ImportError:
            # Fallback: eski latin-1↔utf-8 chain
            try:
                fixed = out.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
                if fixed and "Ã" not in fixed and "Å" not in fixed:
                    out = fixed
            except Exception:
                pass
        except Exception:
            pass
    # 3) Whitespace normalize
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

    result = {
        "today_total": total,
        "today_spam": spam,
        "today_blocked": blocked,
        "throttled_users": throttled_users,
        "limit_per_hour": limit_hour,
        "top_users": top_users,
        "generated_at": _iso(),
    }
    await _cache.set(cache_key, result, 15.0)
    return result


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
        msg_id = (ev.get("message_id") or ev.get("exim_id") or "").strip()
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
        "message_id": ev.get("message_id") or ev.get("exim_id"),
        "headers_full": headers_full,
        "body_preview": body_preview,
        "body_html": body_html,
        "attachments": ev.get("attachments") or [],
        "action": ev.get("action"),
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
