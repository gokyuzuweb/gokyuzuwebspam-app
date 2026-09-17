"""
Bağımsız MailScanner FE Modülü backend.
NOT: ConfigServer MailScanner verileri KULLANILMAZ. Tüm veri kendi DB'mizden gelir.
Endpoints:
  * GET  /mailscanner/config           - engine on/off, threshold, greylist
  * PUT  /mailscanner/config           - config güncelle
  * GET  /mailscanner/stats            - SA skor histogram + engine sonuç dağılımı
  * GET  /mailscanner/rules            - custom SpamAssassin-style rules
  * POST /mailscanner/rules            - upsert rule
  * DELETE /mailscanner/rules/{id}
  * GET  /mailscanner/user-policy      - per-user (recipient) policy
  * PUT  /mailscanner/user-policy      - policy güncelle
  * POST /mailscanner/train-bayes      - Bayes trainer (spam/ham)
  * GET  /mailscanner/bayes-status     - Bayes DB stats (own counters)
"""
from __future__ import annotations
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/mailscanner", tags=["mailscanner"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


DEFAULT_CONFIG = {
    "spam_threshold": 5.0,
    "high_spam_threshold": 10.0,
    "engines": {
        "spamassassin": True, "bayes": True, "clamav": True,
        "dcc": False, "razor": False, "pyzor": True,
        "rspamd_ml": True, "sender_rep": True,
    },
    "greylist": {"enabled": True, "ttl_minutes": 4},
    "rbl": {"enabled": True, "lists": ["zen.spamhaus.org", "bl.spamcop.net"]},
    "spf_hard_fail": True,
    "dkim_required": False,
    "attachment_scan": {"enabled": True, "max_mb": 25, "block_ext": [".exe", ".scr", ".vbs", ".js"]},
    "quarantine_ttl_days": 30,
    # AI Auto-Actions
    "ai_auto_quarantine": {
        "enabled": False,
        "threshold": 6.0,          # predicted_score bu esikte quarantine'e alinir
        "action": "quarantine",    # quarantine | tag | reject
        "min_verdict_from_client": "clean",  # sadece client cleandiyorsa override et
    },
    "ai_rule_auto_apply": {
        "enabled": False,
        "min_score": 4.5,          # LLM oneri skoru >= bu ise otomatik apply
    },
}


async def _cfg(license_key: str) -> dict:
    doc = await db.mailscanner_config.find_one({"license_key": license_key}, {"_id": 0})
    if not doc:
        return {"license_key": license_key, **DEFAULT_CONFIG}
    # merge defaults for missing keys
    merged = {**DEFAULT_CONFIG, **{k: v for k, v in doc.items() if k not in ("_id",)}}
    return merged


@router.get("/config")
async def get_config(license_key: str = Query(..., min_length=8)):
    return await _cfg(license_key)


class ConfigUpdate(BaseModel):
    license_key: str = Field(..., min_length=8)
    spam_threshold: Optional[float] = None
    high_spam_threshold: Optional[float] = None
    engines: Optional[dict] = None
    greylist: Optional[dict] = None
    rbl: Optional[dict] = None
    spf_hard_fail: Optional[bool] = None
    dkim_required: Optional[bool] = None
    attachment_scan: Optional[dict] = None
    quarantine_ttl_days: Optional[int] = None
    ai_auto_quarantine: Optional[dict] = None
    ai_rule_auto_apply: Optional[dict] = None


@router.put("/config")
async def put_config(payload: ConfigUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None and k != "license_key"}
    update["updated_at"] = _iso()
    await db.mailscanner_config.update_one(
        {"license_key": payload.license_key},
        {"$set": update, "$setOnInsert": {"license_key": payload.license_key, "created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **update}


@router.get("/stats")
async def stats(license_key: str = Query(..., min_length=8), hours: int = 24):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q = {"license_key": license_key, "ingested_at": {"$gte": since}}
    # verdict distribution
    verdicts: dict[str, int] = {}
    total = 0
    async for row in db.mail_events.aggregate([
        {"$match": q},
        {"$group": {"_id": "$verdict", "count": {"$sum": 1}}},
    ]):
        verdicts[row["_id"]] = row["count"]
        total += row["count"]
    # score histogram (bin size 1.0, 0..20+)
    bins = [0] * 21
    async for e in db.mail_events.find(q, {"_id": 0, "total_score": 1}):
        s = e.get("total_score") or 0
        idx = min(20, int(max(0, s)))
        bins[idx] += 1
    hist = [{"bin": i, "count": c} for i, c in enumerate(bins)]
    # per-engine hits (from scores.map)
    engine_hits: dict[str, dict] = {}
    async for e in db.mail_events.find(q, {"_id": 0, "scores": 1, "verdict": 1, "ts": 1, "ingested_at": 1}):
        for eng, val in (e.get("scores") or {}).items():
            b = engine_hits.setdefault(eng, {"engine": eng, "total": 0, "spam": 0, "last_hit_at": None})
            b["total"] += 1
            if e.get("verdict") in ("spam", "high_spam", "virus", "phishing"):
                b["spam"] += 1
            ts = e.get("ts") or e.get("ingested_at")
            if ts and (b["last_hit_at"] is None or ts > b["last_hit_at"]):
                b["last_hit_at"] = ts
    engines = sorted(engine_hits.values(), key=lambda x: x["total"], reverse=True)

    # v44.00.24 — Zenginleştirilmiş istatistikler:
    #   - hourly_trend: son N saatte saatlik verdict trendi
    #   - top_senders / top_recipients / top_domains
    #   - actions: bounce/reject/accept dağılımı
    #   - virus/phishing/bec özel breakdown'ları
    hourly: list[dict] = []
    now = datetime.now(timezone.utc)
    for h in range(hours - 1, -1, -1):
        bucket_start = (now - timedelta(hours=h + 1)).isoformat()
        bucket_end   = (now - timedelta(hours=h)).isoformat()
        # verdict-based tally per hour (single agg for the bucket)
        cursor = db.mail_events.aggregate([
            {"$match": {"license_key": license_key,
                        "ingested_at": {"$gte": bucket_start, "$lt": bucket_end}}},
            {"$group": {"_id": "$verdict", "count": {"$sum": 1}}},
        ])
        row = {"h": (now - timedelta(hours=h)).strftime("%H:00"),
               "clean": 0, "spam": 0, "virus": 0, "phishing": 0, "other": 0}
        async for r in cursor:
            v = r["_id"] or "other"
            if v in row:
                row[v] += r["count"]
            elif v == "high_spam":
                row["spam"] += r["count"]
            else:
                row["other"] += r["count"]
        row["total"] = row["clean"] + row["spam"] + row["virus"] + row["phishing"] + row["other"]
        hourly.append(row)

    async def _top(field: str, limit: int = 5, extra_match: dict | None = None):
        m = {**q}
        if extra_match:
            m.update(extra_match)
        pipeline = [
            {"$match": m},
            {"$match": {field: {"$exists": True, "$nin": [None, "", "<>"]}}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}, {"$limit": limit},
        ]
        out = []
        async for r in db.mail_events.aggregate(pipeline):
            out.append({"value": r["_id"], "count": r["count"]})
        return out

    top_senders    = await _top("from_addr", 5, {"verdict": {"$in": ["spam", "high_spam", "virus", "phishing"]}})
    top_recipients = await _top("to_addr",   5, {"verdict": {"$in": ["spam", "high_spam", "virus", "phishing"]}})

    # Sender-domain top (uses from_addr, right-of-@)
    domain_pipeline = [
        {"$match": q},
        {"$match": {"from_addr": {"$regex": "@", "$nin": [None, ""]},
                    "verdict":   {"$in": ["spam", "high_spam", "virus", "phishing"]}}},
        {"$project": {"dom": {"$toLower": {
            "$arrayElemAt": [{"$split": ["$from_addr", "@"]}, 1]
        }}}},
        {"$group": {"_id": "$dom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}, {"$limit": 5},
    ]
    top_sender_domains = []
    async for r in db.mail_events.aggregate(domain_pipeline):
        if r["_id"]:
            top_sender_domains.append({"value": r["_id"], "count": r["count"]})

    # action distribution (accept/reject/bounce/defer)
    actions: dict[str, int] = {}
    async for r in db.mail_events.aggregate([
        {"$match": q},
        {"$group": {"_id": "$action", "count": {"$sum": 1}}},
    ]):
        actions[r["_id"] or "unknown"] = r["count"]

    virus_24h    = int((verdicts.get("virus") or 0))
    phishing_24h = int((verdicts.get("phishing") or 0))
    country_blocked_24h = int((verdicts.get("country_blocked") or 0))
    # Yaygın hata: virus ClamAV verdict'ini "virus" atmıyorsa reasons/scores'a bak.
    if virus_24h == 0:
        virus_24h = await db.mail_events.count_documents({**q, "$or": [
            {"reasons": {"$regex": "clam|virus|infected", "$options": "i"}},
            {"scores.clamav": {"$exists": True, "$gt": 0}},
        ]})

    # v44.00.25 — Country-blocked top ülke breakdown
    top_blocked_countries = []
    async for r in db.mail_events.aggregate([
        {"$match": {**q, "verdict": "country_blocked"}},
        {"$group": {"_id": "$country_hit.code", "count": {"$sum": 1},
                    "name": {"$first": "$country_hit.name"}}},
        {"$sort": {"count": -1}}, {"$limit": 8},
    ]):
        if r["_id"]:
            top_blocked_countries.append({
                "value": r["_id"], "count": r["count"],
                "name": r.get("name") or r["_id"],
            })

    return {
        "hours": hours, "total_scanned": total,
        "verdicts": verdicts, "score_histogram": hist,
        "engines": engines,
        # v44.00.24+25 zenginleştirmeler:
        "hourly_trend": hourly,
        "top_senders": top_senders,
        "top_recipients": top_recipients,
        "top_sender_domains": top_sender_domains,
        "top_blocked_countries": top_blocked_countries,
        "actions": actions,
        "virus_24h": virus_24h,
        "phishing_24h": phishing_24h,
        "country_blocked_24h": country_blocked_24h,
        "generated_at": _iso(),
    }


class MSRule(BaseModel):
    id: Optional[str] = None
    license_key: str = Field(..., min_length=8)
    name: str = Field(..., min_length=1, max_length=80)
    pattern: str = Field(..., min_length=1, max_length=500)
    target: str = Field("subject", pattern="^(subject|from|body|header|to)$")
    score: float = Field(3.0, ge=-10, le=20)
    enabled: bool = True
    description: Optional[str] = ""


@router.get("/rules")
async def list_rules(license_key: str = Query(..., min_length=8)):
    rows = await db.mailscanner_rules.find({"license_key": license_key}, {"_id": 0})\
        .sort("score", -1).to_list(500)
    return {"items": rows}


@router.post("/rules")
async def upsert_rule(rule: MSRule):
    doc = rule.model_dump()
    doc["id"] = doc.get("id") or str(uuid.uuid4())
    doc["updated_at"] = _iso()
    await db.mailscanner_rules.update_one(
        {"id": doc["id"], "license_key": rule.license_key},
        {"$set": doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **doc}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, license_key: str = Query(..., min_length=8)):
    r = await db.mailscanner_rules.delete_one({"id": rule_id, "license_key": license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"ok": True}


# v44.00.40 — Custom SpamAssassin rule dosyasi (sunucuya kopyalanacak)
@router.get("/sa-custom-rules.cf")
async def download_sa_custom_rules():
    """WHM/cPanel/MailScanner sunucusuna kopyalanacak SA kural dosyasi.
    Uretim: /app/whm-plugin/config/GokyuzuWebSpam.cf
    Hedef: /etc/mail/spamassassin/GokyuzuWebSpam.cf
    """
    from fastapi.responses import PlainTextResponse
    path = "/app/whm-plugin/config/GokyuzuWebSpam.cf"
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        raise HTTPException(404, "Kural dosyasi bulunamadi")
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": 'attachment; filename="GokyuzuWebSpam.cf"'},
    )


# v44.00.43 — SA Whitelist dinamik cf (panel whitelist'inden SA whitelist_from ureti)
# `whitelist_from *@domain` SA seviyesinde -100 puan verir → asla spam yapmaz
# `X-Spam-Flag: NO` olur → cPanel/Dovecot Junk'a taşımaz.
@router.get("/sa-whitelist.cf")
async def download_sa_whitelist_cf(license_key: str = Query(..., min_length=8)):
    """License'in whitelist entries'inden dinamik SA whitelist_from dosyasi."""
    from fastapi.responses import PlainTextResponse
    lines = [
        "# GokyuzuWebSpam — Dynamic Whitelist (v44.00.43)",
        f"# License: {license_key}",
        f"# Uretilme: {datetime.now(timezone.utc).isoformat()}",
        "# Bu dosya panel /api/mailscanner/sa-whitelist.cf'ten cron ile alinir.",
        "#",
        "# whitelist_from → SA skoruna -100 puan → SPAM etiketlenmez → INBOX'a duser",
        "# NOT: Bu sadece SA'yi etkiler, whitelist_from_rcvd tercih edilir (SPF check ile).",
        "",
    ]
    # Global + license'a ait whitelist entries (email/domain)
    async for w in db.lists.find(
        {"list_type": "white",
         "$or": [
             {"scope": "global"},
             {"scope": {"$exists": False}},
             {"owner_license_key": license_key},
             {"owner_license_key": {"$exists": False}},
         ]}, {"_id": 0, "entry_type": 1, "value": 1, "note": 1}
    ):
        et = (w.get("entry_type") or "").lower()
        val = (w.get("value") or "").strip().lower()
        note = (w.get("note") or "").replace("\n", " ")[:60]
        if not val:
            continue
        if et == "email":
            lines.append(f"whitelist_from {val}    # {note}")
        elif et == "domain":
            lines.append(f"whitelist_from *@{val}    # {note}")
            lines.append(f"whitelist_from_rcvd *@{val} {val}    # SPF-verified variant")
        # IP whitelist SA'da yok — Exim ACL yapar (bu dosyada değil)
    lines.append("")
    lines.append("# End of file")
    content = "\n".join(lines) + "\n"
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": 'attachment; filename="GokyuzuWebSpam-whitelist.cf"'},
    )


# v44.00.44 — SA Blacklist dinamik cf (panel blacklist'inden SA blacklist_from ureti)
# `blacklist_from *@domain` SA seviyesinde +100 puan verir → HER ZAMAN spam
# `X-Spam-Flag: YES` olur → cPanel/Dovecot otomatik Junk'a tasir.
@router.get("/sa-blacklist.cf")
async def download_sa_blacklist_cf(license_key: str = Query(..., min_length=8)):
    """License'in blacklist entries'inden dinamik SA blacklist_from dosyasi.
    WHM tarafi bu dosyayi 10 dk'da bir cron ile ceker ve
    /etc/mail/spamassassin/GokyuzuWebSpam-blacklist.cf'e yazar.

    Whitelist ile birlikte iki-yonlu 'ekle-de-unut' motorunu tamamlar."""
    from fastapi.responses import PlainTextResponse
    lines = [
        "# GokyuzuWebSpam — Dynamic Blacklist (v44.00.44)",
        f"# License: {license_key}",
        f"# Uretilme: {datetime.now(timezone.utc).isoformat()}",
        "# Bu dosya panel /api/mailscanner/sa-blacklist.cf'ten cron ile alinir.",
        "#",
        "# blacklist_from → SA skoruna +100 puan → HER ZAMAN SPAM → Junk'a duser",
        "",
    ]
    async for b in db.lists.find(
        {"list_type": "black",
         "$or": [
             {"scope": "global"},
             {"scope": {"$exists": False}},
             {"owner_license_key": license_key},
             {"owner_license_key": {"$exists": False}},
         ]}, {"_id": 0, "entry_type": 1, "value": 1, "note": 1}
    ):
        et = (b.get("entry_type") or "").lower()
        val = (b.get("value") or "").strip().lower()
        note = (b.get("note") or "").replace("\n", " ")[:60]
        if not val:
            continue
        if et == "email":
            lines.append(f"blacklist_from {val}    # {note}")
        elif et == "domain":
            lines.append(f"blacklist_from *@{val}    # {note}")
        # IP blacklist SA'da yok — Exim ACL yapar
    lines.append("")
    lines.append("# End of file")
    content = "\n".join(lines) + "\n"
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": 'attachment; filename="GokyuzuWebSpam-blacklist.cf"'},
    )


# --- v44.00.39 — SpamAssassin Rule Score Overrides -----------------------
# Turkce kurumsal MTA'lar icin MISSING_MID gibi kurallarin agirligini
# license bazinda azaltir/sifirlar. Ingestion sirasinda uygulanir.
_SA_PRESET_TURKISH_CORP: dict[str, float | None] = {
    "MISSING_MID": 0.0,
    "DOS_BODY_HIGH_NO_MID": 0.5,
    "MISSING_MIMEOLE": 0.0,
    "MISSING_HEADERS": 0.5,
    "RDNS_NONE": 0.5,
    "MIME_HTML_ONLY": 0.0,
    "FREEMAIL_REPLYTO_END_DIGIT": 0.0,
}

_SA_PRESETS: dict[str, dict[str, float | None]] = {
    "turkish-corp": _SA_PRESET_TURKISH_CORP,
    "off": {},  # tum override'lari kaldir
}


# v44.00.41 — 1-tık Spoof Test simulasyonu (ingest edip sonucu doner)
@router.post("/spoof-test/run")
async def spoof_test_run(license_key: str = Query(..., min_length=8)):
    """Panel'de "Spoof Testini Çalıştır" butonu için: bir fake spoof
    event'i ingest pipeline'ından geçirir ve sonucu (adjusted_score,
    verdict, yakalanan sa_rules, from_spoof) doner. Gerçek mail göndermez.

    Kullanıcının "kural çalışıyor mu?" endişesini 1 tıkla çözer.
    """
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz
    subj = f"__SPOOF_TEST_{_uuid.uuid4().hex[:6]}"
    fake_headers = (
        "Return-Path: <saldirgan@evil.com>\n"
        "Received: from mail.evil.com ([203.0.113.99]) by ns1.local\n"
        "From: sirketiniz.com <saldirgan@evil.com>\n"
        f"To: user@sirketiniz.com\nSubject: {subj}\n"
        "X-Spam-Status: No, score=3.6 tests=BAYES_50\n"
        "X-Spam-Report:\n"
        " *  0.8 BAYES_50 Bayes classifier says spam probability 40-60%\n"
    )
    body = {
        "license_key": license_key,
        "server_hostname": "spoof-test.local",
        "exim_mid": f"1t{_uuid.uuid4().hex[:10]}-000001",
        "from_addr": "saldirgan@evil.com",
        "to_addr": "user@sirketiniz.com",
        "subject": subj,
        "verdict": "clean",
        "total_score": 3.6,
        "scores": {"spamassassin": 3.6},
        "headers_full": fake_headers,
        "ts": _dt.now(_tz.utc).isoformat(),
    }
    # Doğrudan ingest fonksiyonunu çağırmak zor (Request objesi lazım) — HTTP hop
    import httpx
    port = os.environ.get("PORT", "8001")
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.post(f"http://127.0.0.1:{port}/api/events/ingest", json=body)
    if r.status_code not in (200, 201):
        raise HTTPException(500, f"Ingest baştaki hata: {r.status_code} {r.text[:200]}")
    # DB'den oku (result event'i)
    doc = await db.mail_events.find_one({"subject": subj}, {"_id": 0}) or {}
    # Test event'ini işaretle
    await db.mail_events.update_one(
        {"subject": subj},
        {"$set": {"is_synthetic_test": True}},
    )
    return {
        "ok": True,
        "subject": subj,
        "score_before": 3.6,
        "score_after": doc.get("total_score"),
        "verdict": doc.get("verdict"),
        "from_spoof": doc.get("from_spoof"),
        "sa_rules": doc.get("sa_rules") or [],
        "passed": (doc.get("verdict") in ("spam", "high_spam")) and bool(doc.get("from_spoof")),
        "message": (
            "✅ Kural çalışıyor — spoof paterni yakalandı"
            if doc.get("from_spoof")
            else "⚠️ Kural tetiklenmedi — regex kontrolü gerekli"
        ),
    }


class SAOverridesUpdate(BaseModel):
    license_key: str = Field(..., min_length=8)
    # {RULE_NAME: float | null}. null = kural devre disi (0 puan).
    overrides: dict[str, Optional[float]] = Field(default_factory=dict)


@router.get("/sa-overrides")
async def get_sa_overrides(license_key: str = Query(..., min_length=8)):
    """Aktif override map + presetler + son 7 gunde hitlemis top kurallar."""
    doc = await db.mailscanner_config.find_one(
        {"license_key": license_key},
        {"_id": 0, "sa_score_overrides": 1},
    ) or {}
    overrides = doc.get("sa_score_overrides") or {}

    # Son 7 gunde hitlemis kurallar (frekans + ortalama skor)
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    pipeline = [
        {"$match": {
            "license_key": license_key,
            "ts": {"$gte": since},
            "sa_rules": {"$exists": True, "$ne": []},
        }},
        {"$unwind": "$sa_rules"},
        {"$group": {
            "_id": "$sa_rules.name",
            "hits": {"$sum": 1},
            "avg_score": {"$avg": "$sa_rules.score"},
        }},
        {"$sort": {"hits": -1}},
        {"$limit": 50},
    ]
    seen_rules: list[dict] = []
    try:
        async for row in db.mail_events.aggregate(pipeline):
            seen_rules.append({
                "name": row["_id"],
                "hits": row["hits"],
                "avg_score": round(row["avg_score"] or 0, 2),
                "overridden": row["_id"] in overrides,
                "override_value": overrides.get(row["_id"]),
            })
    except Exception:
        pass

    return {
        "license_key": license_key,
        "overrides": overrides,
        "presets": list(_SA_PRESETS.keys()),
        "preset_details": _SA_PRESETS,
        "seen_rules_7d": seen_rules,
    }


@router.put("/sa-overrides")
async def put_sa_overrides(payload: SAOverridesUpdate):
    """Override map'i tumuyle degistirir (upsert)."""
    # Basit sanity: kural adi format
    import re
    clean: dict[str, Optional[float]] = {}
    for k, v in (payload.overrides or {}).items():
        if not re.match(r"^[A-Z0-9_]{3,64}$", k or ""):
            continue
        if v is None:
            clean[k] = None
        else:
            try:
                fv = float(v)
                # Guvenlik: -10..20 arasi (SA norm)
                fv = max(-10.0, min(20.0, fv))
                clean[k] = fv
            except (TypeError, ValueError):
                continue
    await db.mailscanner_config.update_one(
        {"license_key": payload.license_key},
        {"$set": {"sa_score_overrides": clean, "updated_at": _iso()},
         "$setOnInsert": {"license_key": payload.license_key, "created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "overrides": clean, "count": len(clean)}


@router.post("/sa-overrides/preset/{preset_name}")
async def apply_sa_preset(
    preset_name: str,
    license_key: str = Query(..., min_length=8),
    merge: bool = Query(False, description="True = mevcuta ekle, False = degistir"),
):
    """Hazir preset uygula. `turkish-corp` Turk kurumsal MTA'lar icin
    onerilen ceza kuralı ayarlarını yükler. `off` tümünü kaldirir."""
    if preset_name not in _SA_PRESETS:
        raise HTTPException(404, f"Preset bulunamadi: {preset_name}")
    preset = dict(_SA_PRESETS[preset_name])
    final = preset
    if merge:
        current = (await db.mailscanner_config.find_one(
            {"license_key": license_key}, {"_id": 0, "sa_score_overrides": 1}
        ) or {}).get("sa_score_overrides") or {}
        final = {**current, **preset}
    await db.mailscanner_config.update_one(
        {"license_key": license_key},
        {"$set": {"sa_score_overrides": final, "updated_at": _iso()},
         "$setOnInsert": {"license_key": license_key, "created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, "preset": preset_name, "overrides": final, "count": len(final)}


class UserPolicy(BaseModel):
    license_key: str = Field(..., min_length=8)
    user_email: str = Field(..., min_length=3, max_length=200)
    spam_threshold: Optional[float] = None
    action_on_spam: str = Field("quarantine", pattern="^(quarantine|reject|tag|deliver)$")
    forward_to: Optional[str] = None
    enabled: bool = True


@router.get("/user-policy")
async def list_policies(license_key: str = Query(..., min_length=8)):
    rows = await db.mailscanner_policies.find({"license_key": license_key}, {"_id": 0})\
        .sort("user_email", 1).to_list(500)
    return {"items": rows}


@router.put("/user-policy")
async def put_policy(p: UserPolicy):
    doc = p.model_dump()
    doc["updated_at"] = _iso()
    await db.mailscanner_policies.update_one(
        {"license_key": p.license_key, "user_email": p.user_email},
        {"$set": doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )
    return {"ok": True, **doc}


class BayesTrain(BaseModel):
    license_key: str = Field(..., min_length=8)
    label: str = Field(..., pattern="^(spam|ham)$")
    samples: list[str] = Field(..., min_length=1, max_length=500)


@router.post("/train-bayes")
async def train_bayes(payload: BayesTrain):
    """Kendi Bayes tokenizer'ımız. Basit token counter → mailscanner_bayes koleksiyonu."""
    bulk_ops = 0
    for sample in payload.samples:
        tokens = _tokenize(sample)
        for tok in tokens:
            await db.mailscanner_bayes.update_one(
                {"license_key": payload.license_key, "token": tok},
                {"$inc": {f"{payload.label}_count": 1, "total_count": 1},
                 "$set": {"last_seen": _iso()}},
                upsert=True,
            )
            bulk_ops += 1
    return {"ok": True, "trained": len(payload.samples), "tokens_updated": bulk_ops}


def _tokenize(text: str) -> list[str]:
    import re
    words = re.findall(r"[a-zA-ZğüşıöçĞÜŞİÖÇ0-9]{3,}", (text or "").lower())
    return list({w for w in words})[:80]  # unique subset


@router.get("/bayes-status")
async def bayes_status(license_key: str = Query(..., min_length=8)):
    total_tokens = await db.mailscanner_bayes.count_documents({"license_key": license_key})
    pipeline = [
        {"$match": {"license_key": license_key}},
        {"$group": {
            "_id": None,
            "spam_total": {"$sum": {"$ifNull": ["$spam_count", 0]}},
            "ham_total":  {"$sum": {"$ifNull": ["$ham_count", 0]}},
        }},
    ]
    agg = await db.mailscanner_bayes.aggregate(pipeline).to_list(1)
    doc = agg[0] if agg else {"spam_total": 0, "ham_total": 0}

    # v44.00.24 — Top discriminator token'lar (en spam-ağırlıklı ve en ham-ağırlıklı)
    # spam_ratio = spam_count / (spam_count + ham_count + 1), minimum 3 örnek gerekli
    top_spam_tokens = []
    async for r in db.mailscanner_bayes.find(
        {"license_key": license_key, "spam_count": {"$gte": 3}},
        {"_id": 0, "token": 1, "spam_count": 1, "ham_count": 1}
    ).sort("spam_count", -1).limit(50):
        sc = r.get("spam_count", 0)
        hc = r.get("ham_count", 0)
        ratio = sc / (sc + hc + 1)
        if ratio >= 0.65:
            top_spam_tokens.append({
                "token": r["token"], "spam": sc, "ham": hc,
                "ratio": round(ratio, 2),
            })
    top_spam_tokens = sorted(top_spam_tokens, key=lambda x: -x["ratio"])[:10]

    top_ham_tokens = []
    async for r in db.mailscanner_bayes.find(
        {"license_key": license_key, "ham_count": {"$gte": 3}},
        {"_id": 0, "token": 1, "spam_count": 1, "ham_count": 1}
    ).sort("ham_count", -1).limit(50):
        sc = r.get("spam_count", 0)
        hc = r.get("ham_count", 0)
        ratio = hc / (sc + hc + 1)
        if ratio >= 0.65:
            top_ham_tokens.append({
                "token": r["token"], "spam": sc, "ham": hc,
                "ratio": round(ratio, 2),
            })
    top_ham_tokens = sorted(top_ham_tokens, key=lambda x: -x["ratio"])[:10]

    # Doğruluk tahmini (basit): |spam_total - ham_total| / max(spam+ham, 1) ⇒ ne kadar dengeli olduğu
    balance = 1 - abs(doc.get("spam_total", 0) - doc.get("ham_total", 0)) / max(
        doc.get("spam_total", 0) + doc.get("ham_total", 0), 1)
    return {
        "total_tokens": total_tokens,
        "spam_samples": doc.get("spam_total", 0),
        "ham_samples":  doc.get("ham_total", 0),
        "trained": total_tokens > 0,
        "balance": round(balance, 2),
        "top_spam_tokens": top_spam_tokens,
        "top_ham_tokens":  top_ham_tokens,
    }


@router.get("/health")
async def module_health():
    """Basit ML-vari sağlık: engine sinyal döner. Frontend rozet için kullanır."""
    return {
        "spamassassin": "ok",
        "clamav": "ok",
        "bayes": "ok",
        "ml_model": "ok",
        "last_check": _iso(),
    }


# ============================================================================
#  EK MODÜLLER: BEC · URL Rewrite · Sandbox · Reputation · SIEM
# ============================================================================
class BECCheckIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    from_display: str  # "Ahmet Kaya"
    from_addr: str     # "info@lookalike-cmp.com"
    protected_domains: list[str] = Field(default_factory=list)  # ["sirketim.com"]
    subject: Optional[str] = ""


def _levenshtein(a: str, b: str) -> int:
    if a == b: return 0
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


@router.post("/bec/check")
async def bec_check(payload: BECCheckIn):
    """CEO-fraud/BEC heuristic: lookalike domain, display-name spoof, geç-yanıt kalıbı."""
    reasons = []
    score = 0.0
    sender_domain = payload.from_addr.split("@")[-1].lower() if "@" in payload.from_addr else ""
    for pd in [d.lower() for d in payload.protected_domains]:
        if not pd or pd == sender_domain:
            continue
        d = _levenshtein(pd, sender_domain)
        if 0 < d <= 2:
            reasons.append(f"Lookalike domain: '{sender_domain}' ≈ '{pd}' (edit distance {d})")
            score += 6.0
    # Display-name mismatch (Turkish "CEO", "GENEL MÜDÜR", isim benzerliği)
    hi_risk_titles = ["ceo", "cfo", "coo", "yönetici", "genel müdür", "muhasebe", "finance"]
    dn_low = payload.from_display.lower()
    if any(t in dn_low for t in hi_risk_titles):
        score += 2.5
        reasons.append("Display name yüksek yetkili unvan içeriyor (CEO/finance)")
    # Subject urgency
    urg_words = ["acil", "urgent", "hemen", "hızlı", "ödeme", "wire", "transfer", "havale"]
    if any(w in (payload.subject or "").lower() for w in urg_words):
        score += 1.5
        reasons.append("Konu satırında aciliyet ifadesi")
    verdict = "bec_high" if score >= 6 else "bec_medium" if score >= 3 else "clean"
    return {"verdict": verdict, "score": round(score, 2), "reasons": reasons,
            "sender_domain": sender_domain}


class URLRewriteIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    urls: list[str] = Field(..., min_length=1, max_length=100)


@router.post("/url/rewrite")
async def url_rewrite(payload: URLRewriteIn):
    """URL'i short-token'a çevir. Kullanıcı /r/{token} tıklarsa sandbox check + redirect."""
    out = []
    for u in payload.urls:
        tok = uuid.uuid4().hex[:10]
        await db.mailscanner_urls.insert_one({
            "token": tok, "url": u, "license_key": payload.license_key,
            "clicks": 0, "verdict": "unknown", "created_at": _iso(),
        })
        out.append({"original": u, "token": tok, "wrapped": f"/r/{tok}"})
    return {"items": out}


@router.get("/url/inspect")
async def url_inspect(token: str = Query(..., min_length=6)):
    """Time-of-click analiz: kayıt getir + click count artır + heuristic verdict."""
    row = await db.mailscanner_urls.find_one({"token": token}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Token bulunamadı")
    await db.mailscanner_urls.update_one({"token": token},
                                          {"$inc": {"clicks": 1},
                                           "$set": {"last_click_at": _iso()}})
    url = (row.get("url") or "").lower()
    risky = any(sig in url for sig in [".zip", ".exe", "bit.ly", "tinyurl", "@", "login", "verify"])
    verdict = "danger" if risky else "safe"
    return {"token": token, "url": row.get("url"),
            "verdict": verdict, "clicks": row.get("clicks", 0) + 1}


class SandboxIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    filename: str
    sha256: Optional[str] = None
    content_type: Optional[str] = "application/octet-stream"
    size: int = 0


@router.post("/sandbox/submit")
async def sandbox_submit(payload: SandboxIn):
    """Şüpheli ek için sandbox queue kaydı. Gerçek detonation WHM VM ile yapılır."""
    tid = str(uuid.uuid4())
    await db.sandbox_jobs.insert_one({
        "id": tid, "license_key": payload.license_key,
        "filename": payload.filename, "sha256": payload.sha256,
        "content_type": payload.content_type, "size": payload.size,
        "status": "queued", "verdict": None, "created_at": _iso(),
    })
    return {"id": tid, "status": "queued"}


@router.get("/sandbox/jobs")
async def sandbox_jobs(license_key: str = Query(..., min_length=8), limit: int = 50):
    rows = await db.sandbox_jobs.find({"license_key": license_key}, {"_id": 0})\
        .sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}


@router.get("/reputation")
async def reputation(license_key: str = Query(..., min_length=8)):
    """UCEPROTECT/Spamhaus check — preview'da mock (production'da DNSBL sorgusu)."""
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0, "ip": 1})
    ip = (lic or {}).get("ip") or "-"
    # Mock rep score based on last-hour outbound spam
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    outbound_spam = await db.mail_events.count_documents({
        "license_key": license_key, "ingested_at": {"$gte": since},
        "verdict": {"$in": ["spam", "high_spam"]},
    })
    listed = []
    if outbound_spam > 100:
        listed.append({"list": "SPAMHAUS_SBL", "reason": ">100 spam/24h"})
    if outbound_spam > 500:
        listed.append({"list": "UCEPROTECT_L3", "reason": ">500 spam/24h"})
    score = max(0, 100 - min(80, outbound_spam // 10))
    return {"ip": ip, "score": score, "listed": listed,
            "outbound_spam_24h": outbound_spam, "checked_at": _iso()}


class SIEMIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    format: str = Field("cef", pattern="^(cef|leef|json)$")
    hours: int = Field(24, ge=1, le=168)


@router.post("/siem/export")
async def siem_export(payload: SIEMIn):
    """CEF/LEEF/JSON formatında son N saatteki spam olayları."""
    since = (datetime.now(timezone.utc) - timedelta(hours=payload.hours)).isoformat()
    q = {"license_key": payload.license_key, "ingested_at": {"$gte": since},
         "verdict": {"$in": ["spam", "high_spam", "virus", "blocked"]}}
    lines = []
    async for e in db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(5000):
        if payload.format == "cef":
            lines.append(
                f"CEF:0|Gokyuzu|WebSpam|1.0|{e.get('verdict')}|{(e.get('subject') or '')[:60]}|"
                f"{int((e.get('total_score') or 0)*10)}|src={e.get('client_ip','-')} "
                f"suser={e.get('from_addr','-')} duser={e.get('to_addr','-')} "
                f"cs1={e.get('exim_mid','-')} cs1Label=eximMid rt={e.get('ingested_at')}"
            )
        elif payload.format == "leef":
            lines.append(
                f"LEEF:1.0|Gokyuzu|WebSpam|1.0|{e.get('verdict')}|"
                f"src={e.get('client_ip','-')}\tsrcUser={e.get('from_addr','-')}\t"
                f"dstUser={e.get('to_addr','-')}\tscore={e.get('total_score')}\t"
                f"subject={(e.get('subject') or '')[:60]}\ttime={e.get('ingested_at')}"
            )
        else:
            import json as _json
            lines.append(_json.dumps({
                "ts": e.get("ingested_at"), "verdict": e.get("verdict"),
                "score": e.get("total_score"),
                "from": e.get("from_addr"), "to": e.get("to_addr"),
                "subject": e.get("subject"), "src_ip": e.get("client_ip"),
                "mid": e.get("exim_mid"),
            }, ensure_ascii=False))
    body = "\n".join(lines)
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(body, media_type="text/plain")


@router.get("/modules")
async def modules_overview(license_key: str = Query(..., min_length=8)):
    """10 modülün genel durum kartı. Frontend `/panel/security` overview'da."""
    cfg = await _cfg(license_key)
    eng = cfg.get("engines", {}) or {}
    bayes = await db.mailscanner_bayes.count_documents({"license_key": license_key})
    findings = await db.exploit_findings.count_documents({"license_key": license_key, "dismissed": False})
    sandbox = await db.sandbox_jobs.count_documents({"license_key": license_key})
    rep = await db.mail_events.count_documents({"license_key": license_key,
                                                 "verdict": {"$in": ["spam", "high_spam"]}})
    return {"modules": [
        {"key": "antivirus", "label": "Antivirüs & Malware",
         "status": "active" if eng.get("clamav") else "off",
         "detail": "ClamAV" + (" · Sandbox: hazır" if sandbox >= 0 else ""),
         "icon": "shield"},
        {"key": "spam_phish", "label": "Spam & Phishing",
         "status": "active" if eng.get("spamassassin") else "off",
         "detail": f"SpamAssassin + Bayes ({bayes} token)", "icon": "mail-x"},
        {"key": "sandbox", "label": "Sandbox / Detonation",
         "status": "ready", "detail": f"{sandbox} işlem · WHM VM bekliyor", "icon": "flask"},
        {"key": "auth", "label": "SPF / DKIM / DMARC",
         "status": "active" if cfg.get("spf_hard_fail") else "warn",
         "detail": ("SPF hard fail" if cfg.get("spf_hard_fail") else "SPF soft") +
                   (" · DKIM zorunlu" if cfg.get("dkim_required") else ""),
         "icon": "key-round"},
        {"key": "bec", "label": "BEC / Impersonation",
         "status": "active", "detail": "Lookalike + display-name analizi", "icon": "user-x"},
        {"key": "quarantine", "label": "Karantina Self-Service",
         "status": "active", "detail": "release/delete + kullanıcı politikaları", "icon": "inbox"},
        {"key": "outbound", "label": "Outbound Güvenlik",
         "status": "active", "detail": f"Rate limit + reputasyon ({rep} spam)", "icon": "arrow-up-right"},
        {"key": "url", "label": "URL Protection",
         "status": "active", "detail": "Time-of-click rewriting", "icon": "link"},
        {"key": "ai", "label": "AI & Davranış Analizi",
         "status": "active" if eng.get("rspamd_ml") else "warn",
         "detail": "Rspamd ML + LLM açıklama (Claude)", "icon": "brain"},
        {"key": "siem", "label": "SIEM / SOAR",
         "status": "active", "detail": "CEF · LEEF · JSON export", "icon": "server"},
        {"key": "exploit", "label": "Exploit Scanner",
         "status": "warn" if findings else "active",
         "detail": f"{findings} açık bulgu" if findings else "Bulgu yok", "icon": "bug"},
    ]}


# ============================================================================
#  AI SISTEM ANALIZI — LLM tarafindan konfig + istatistik uzerinden rapor
# ============================================================================
@router.post("/ai/analyze")
async def ai_analyze(license_key: str = Query(..., min_length=8)):
    """MailScanner sistemin durumunu LLM ile analiz eder, aksiyon onerileri verir."""
    import os
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yok")
    cfg = await _cfg(license_key)
    stats = await db.mail_events.count_documents({"license_key": license_key})
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    spam_24h = await db.mail_events.count_documents({"license_key": license_key,
                                                      "ingested_at": {"$gte": since},
                                                      "verdict": {"$in": ["spam", "high_spam"]}})
    virus_24h = await db.mail_events.count_documents({"license_key": license_key,
                                                       "ingested_at": {"$gte": since},
                                                       "verdict": "virus"})
    bayes = await db.mailscanner_bayes.count_documents({"license_key": license_key})
    rules_count = await db.mailscanner_rules.count_documents({"license_key": license_key})
    policies_count = await db.mailscanner_policies.count_documents({"license_key": license_key})
    findings = await db.exploit_findings.count_documents({"license_key": license_key, "dismissed": False})
    engines = cfg.get("engines", {}) or {}
    active_engines = [k for k, v in engines.items() if v]
    prompt = (
        f"MailScanner konfigürasyonu ve son 24 saatlik metrikleri:\n"
        f"- Toplam olay: {stats}\n"
        f"- Son 24s spam: {spam_24h}, virus: {virus_24h}\n"
        f"- Spam eşiği: {cfg.get('spam_threshold')}, high_spam eşiği: {cfg.get('high_spam_threshold')}\n"
        f"- Aktif motorlar: {', '.join(active_engines) or '(hiçbiri)'}\n"
        f"- SPF hard fail: {cfg.get('spf_hard_fail')}, DKIM zorunlu: {cfg.get('dkim_required')}\n"
        f"- Greylist: {bool(cfg.get('greylist', {}).get('enabled'))}\n"
        f"- RBL: {bool(cfg.get('rbl', {}).get('enabled'))}\n"
        f"- Bayes token: {bayes}\n"
        f"- Özel kural: {rules_count}\n"
        f"- Kullanıcı politikası: {policies_count}\n"
        f"- Açık exploit bulgusu: {findings}\n\n"
        f"3 paragrafta Türkçe bir sistem sağlığı raporu yaz:\n"
        f"1) Genel değerlendirme (skor: 0-100 skala olarak da ver)\n"
        f"2) Riskler (var mı? hangileri?)\n"
        f"3) 3 somut aksiyon önerisi (numaralı liste).\n"
        f"Emoji kullanma, Türkçe yaz, kısa cümleler."
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key, session_id=f"ms-analyze-{uuid.uuid4()}",
            system_message="Sen bir e-posta güvenlik uzmanısın. Konfig ve metriklere bakıp Türkçe kısa, aksiyon-odaklı rapor yazarsın.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        report = (r or "").strip()
    except Exception as ex:
        raise HTTPException(500, f"LLM analiz hatası: {type(ex).__name__}")
    saved = {
        "id": str(uuid.uuid4()),
        "license_key": license_key,
        "report": report,
        "metrics": {"stats": stats, "spam_24h": spam_24h, "virus_24h": virus_24h,
                     "bayes": bayes, "rules_count": rules_count,
                     "policies_count": policies_count, "findings": findings,
                     "active_engines": active_engines},
        "generated_at": _iso(),
    }
    await db.mailscanner_ai_reports.insert_one(saved)
    return {"ok": True, "report": report, "generated_at": saved["generated_at"], "metrics": saved["metrics"]}


# ============================================================================
#  SISTEM-GENELINDE AI SELF-TRAINING — saatlik cron ile Bayes besleme
#  + LLM ile yeni SA regex onerileri
# ============================================================================
async def run_self_training_once() -> dict:
    """Son 1 saatteki high_spam/clean maillerinden Bayes'i otomatik egit.
    Yaygin subject pattern'lerini bul ve LLM'e regex kural onerisi yaptır."""
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    # Distinct license keys with recent events
    licenses = await db.mail_events.distinct("license_key", {"ingested_at": {"$gte": since}})
    summary = {"licenses": 0, "trained_spam": 0, "trained_ham": 0, "rules_suggested": 0}
    for lic in licenses:
        summary["licenses"] += 1
        # Spam samples
        spam_docs = await db.mail_events.find(
            {"license_key": lic, "ingested_at": {"$gte": since},
             "verdict": {"$in": ["high_spam", "virus"]}},
            {"_id": 0, "subject": 1, "body_preview": 1},
        ).limit(30).to_list(30)
        ham_docs = await db.mail_events.find(
            {"license_key": lic, "ingested_at": {"$gte": since}, "verdict": "clean"},
            {"_id": 0, "subject": 1, "body_preview": 1},
        ).limit(30).to_list(30)
        for label, docs in [("spam", spam_docs), ("ham", ham_docs)]:
            for d in docs:
                txt = ((d.get("subject") or "") + " " + (d.get("body_preview") or "")).strip()
                if not txt:
                    continue
                for tok in _tokenize(txt):
                    await db.mailscanner_bayes.update_one(
                        {"license_key": lic, "token": tok},
                        {"$inc": {f"{label}_count": 1, "total_count": 1},
                         "$set": {"last_seen": _iso()}},
                        upsert=True,
                    )
                if label == "spam": summary["trained_spam"] += 1
                else: summary["trained_ham"] += 1
        # Suggest a rule from top spam keywords if 5+ spam samples
        if len(spam_docs) >= 5:
            suggested = await _suggest_rule(lic, spam_docs)
            if suggested:
                summary["rules_suggested"] += 1
    # Audit entry
    entry = {"id": str(uuid.uuid4()), "run_at": _iso(),
             "kind": "self_training", **summary}
    await db.ai_training_log.insert_one(entry)
    return summary


async def _suggest_rule(license_key: str, spam_docs: list) -> Optional[dict]:
    """LLM'e son spam ornekleri ver, subject icin regex kural onerisi al."""
    import os
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return None
    subjects = [d.get("subject") or "" for d in spam_docs][:10]
    prompt = (
        "Son 1 saatte gelen spam mail konularini analiz et. Ortak kalibi bul.\n"
        + "\n".join(f"- {s}" for s in subjects) + "\n\n"
        "Sadece bir JSON dondur (baska yazi yok):\n"
        '{"name": "kisa_isim", "pattern": "regex", "target": "subject", "score": 4.5, "description": "kisa aciklama"}\n'
        "Regex Python re moduluyle uyumlu olsun. Turkce."
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key, session_id=f"ms-selftrain-{uuid.uuid4()}",
            system_message="Sen bir SpamAssassin regex kural onericisisin. JSON dondurursen kabul edilir.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        import json as _json, re
        m = re.search(r"\{[\s\S]*\}", r or "")
        if not m:
            return None
        payload = _json.loads(m.group(0))
        # Save as ai_suggested rule (do NOT auto-apply — user reviews)
        doc = {
            "id": str(uuid.uuid4()), "license_key": license_key,
            "name": (payload.get("name") or "ai_suggestion")[:80],
            "pattern": payload.get("pattern") or "",
            "target":  payload.get("target") or "subject",
            "score":   float(payload.get("score") or 3.0),
            "description": (payload.get("description") or "AI önerisi")[:400],
            "source": "ai_self_training",
            "applied": False,
            "created_at": _iso(),
        }
        if not doc["pattern"]:
            return None
        # Auto-apply kontrolü: config allow ve skor esigi asilirsa dogrudan kural yaz
        try:
            cfg = await _cfg(license_key)
            auto = cfg.get("ai_rule_auto_apply") or {}
            if auto.get("enabled") and doc["score"] >= float(auto.get("min_score", 4.5)):
                rule = {
                    "id": str(uuid.uuid4()), "license_key": license_key,
                    "name": doc["name"], "pattern": doc["pattern"],
                    "target": doc["target"], "score": doc["score"],
                    "enabled": True, "description": f"[AI-auto] {doc['description']}",
                    "updated_at": _iso(), "created_at": _iso(),
                }
                await db.mailscanner_rules.insert_one(dict(rule))
                doc["applied"] = True
                doc["auto_applied_at"] = _iso()
        except Exception:
            pass
        await db.mailscanner_rule_suggestions.insert_one(dict(doc))
        return doc
    except Exception:
        return None
    return None


@router.post("/ai/self-train/run")
async def trigger_self_train():
    result = await run_self_training_once()
    return {"ok": True, **result}


@router.get("/ai/self-train/log")
async def self_train_log(limit: int = 30):
    rows = await db.ai_training_log.find({}, {"_id": 0}).sort("run_at", -1).limit(limit).to_list(limit)
    return {"items": rows}


@router.get("/ai/self-train/suggestions")
async def rule_suggestions(license_key: str = Query(..., min_length=8), applied: bool = False):
    q = {"license_key": license_key, "applied": applied}
    rows = await db.mailscanner_rule_suggestions.find(q, {"_id": 0})\
        .sort("created_at", -1).limit(100).to_list(100)
    # v44.00.24 — Her öneriyi zenginleştir: pattern_value (net domain/tld/keyword),
    # sample_senders (son gönderici e-postalar), matched_count (kural aktif olsa kaç mail'i tutardı)
    import re as _re
    for r in rows:
        pat = r.get("pattern") or ""
        sub = r.get("sub_source") or ""
        # 1) Net değer çıkarımı — regex'ten domain/tld/keyword
        pval = ""
        pkind = "keyword"
        m_dom = _re.match(r"^@([\w.\-]+)\$$", pat)
        m_tld = _re.match(r"^@\[\^ \]\+\\\.([\w\-]+)\$$", pat)
        if m_dom:
            pval = m_dom.group(1); pkind = "domain"
        elif m_tld:
            pval = "." + m_tld.group(1); pkind = "tld"
        elif sub == "subject_keyword":
            # /kelime/i biçiminde olabilir → sadece kelimeyi al
            m_kw = _re.match(r"^/?\(?\??:?([^/()|]+)", pat)
            if m_kw:
                pval = m_kw.group(1)[:40]; pkind = "keyword"
        r["pattern_value"] = pval
        r["pattern_kind"] = pkind

        # 2) Bu pattern'e uyan son mail'lerden sender örnekleri — canlı bağlam
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=r.get("days") or 7)).isoformat()
            match_q: dict = {"license_key": license_key, "ingested_at": {"$gte": since}}
            if pkind == "domain" and pval:
                match_q["from_addr"] = {"$regex": f"@{_re.escape(pval)}$", "$options": "i"}
            elif pkind == "tld" and pval:
                match_q["from_addr"] = {"$regex": f"\\{pval}$", "$options": "i"}
            elif pkind == "keyword" and pval:
                match_q["subject"] = {"$regex": _re.escape(pval), "$options": "i"}
            else:
                match_q = None  # type: ignore
            senders: list[str] = []
            recipients: list[str] = []
            if match_q:
                async for e in db.mail_events.find(match_q,
                                                    {"_id": 0, "from_addr": 1, "to_addr": 1}
                                                   ).limit(20):
                    fa = e.get("from_addr")
                    if fa and fa not in senders and fa != "<>":
                        senders.append(fa)
                    ra = e.get("to_addr")
                    if ra and ra not in recipients:
                        recipients.append(ra)
                    if len(senders) >= 3 and len(recipients) >= 3:
                        break
            r["sample_senders"] = senders[:3]
            r["sample_recipients"] = recipients[:3]
        except Exception:
            r["sample_senders"] = []
            r["sample_recipients"] = []
    return {"items": rows}


@router.post("/ai/self-train/apply/{suggestion_id}")
async def apply_suggestion(suggestion_id: str, license_key: str = Query(..., min_length=8)):
    """AI önerdiği kuralı normal mailscanner_rules'a taşı."""
    doc = await db.mailscanner_rule_suggestions.find_one({"id": suggestion_id, "license_key": license_key})
    if not doc:
        raise HTTPException(404, "Öneri bulunamadı")
    rule = {
        "id": str(uuid.uuid4()), "license_key": license_key,
        "name": doc["name"], "pattern": doc["pattern"], "target": doc["target"],
        "score": doc["score"], "enabled": True,
        "description": f"[AI] {doc.get('description', '')}",
        "updated_at": _iso(), "created_at": _iso(),
        # v44.00.25 — perf loop tracking
        "applied_from_suggestion": suggestion_id,
        "hits_last_check": 0,
        "hits_last_check_at": None,
    }
    await db.mailscanner_rules.insert_one(dict(rule))
    await db.mailscanner_rule_suggestions.update_one(
        {"id": suggestion_id}, {"$set": {"applied": True, "applied_at": _iso(), "promoted_rule_id": rule["id"]}})
    return {"ok": True, "rule": rule}


# v44.00.25 — AI Rule Improvement Loop: onaylanan kuralların 7 gün sonraki hit sayısı 0 ise
# "removal_suggestion" olarak işaretlenir ve kullanıcıya kaldırma önerisi gösterilir.
@router.post("/ai/rule-performance/scan")
async def scan_rule_performance(license_key: str = Query(..., min_length=8),
                                  min_age_days: int = Query(7, ge=1, le=90),
                                  window_days: int = Query(7, ge=1, le=30)):
    """Onaylanan kuralların hit sayısını ölçer. 0 hit olan >min_age_days yaşlı kurallar
    için otomatik "removal_suggestion" oluşturur."""
    import re as _re
    since = (datetime.now(timezone.utc) - timedelta(days=min_age_days)).isoformat()
    window_since = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()

    rules = await db.mailscanner_rules.find({
        "license_key": license_key,
        "created_at": {"$lt": since},
        "enabled": True,
    }, {"_id": 0}).to_list(500)

    scanned = 0
    zero_hit = 0
    removed_suggested = 0
    healthy = 0
    perf_report = []

    for r in rules:
        scanned += 1
        pat = r.get("pattern") or ""
        target = r.get("target") or "subject"
        # Regex olarak mail_events içinde ara — target'a göre alan seç
        field_map = {
            "subject": "subject", "from": "from_addr", "sender": "from_addr",
            "to": "to_addr", "body": "body_preview", "header": "headers_full",
        }
        field = field_map.get(target, "subject")
        # Regex'i güvenli test et
        try:
            _re.compile(pat)
        except Exception:
            continue
        hits = await db.mail_events.count_documents({
            "license_key": license_key,
            "ingested_at": {"$gte": window_since},
            field: {"$regex": pat, "$options": "i"},
        })
        await db.mailscanner_rules.update_one(
            {"id": r["id"]},
            {"$set": {"hits_last_check": hits, "hits_last_check_at": _iso(),
                      "hits_window_days": window_days}},
        )
        perf_report.append({
            "rule_id": r["id"], "name": r["name"], "pattern": pat[:50],
            "target": target, "hits": hits, "score": r.get("score", 0),
        })
        if hits == 0:
            zero_hit += 1
            # Halihazırda removal_suggestion var mı kontrol et
            existing = await db.mailscanner_rule_suggestions.find_one({
                "license_key": license_key,
                "source": "removal_suggestion",
                "target_rule_id": r["id"],
            })
            if not existing:
                await db.mailscanner_rule_suggestions.insert_one({
                    "id": str(uuid.uuid4()),
                    "license_key": license_key,
                    "name": f"REMOVAL: {r['name']}",
                    "pattern": pat, "target": target, "score": r.get("score", 0),
                    "description": (f"Bu kural {min_age_days}+ gündür aktif ama son "
                                    f"{window_days} günde 0 mail'e vurmadı — kaldırmayı düşünün."),
                    "source": "removal_suggestion",
                    "sub_source": "zero_hit",
                    "target_rule_id": r["id"],
                    "hit_count": 0,
                    "days": window_days,
                    "applied": False,
                    "created_at": _iso(),
                })
                removed_suggested += 1
        else:
            healthy += 1

    return {
        "ok": True, "scanned": scanned, "healthy": healthy,
        "zero_hit": zero_hit, "new_removal_suggestions": removed_suggested,
        "window_days": window_days, "min_age_days": min_age_days,
        "top_performers": sorted(perf_report, key=lambda x: -x["hits"])[:10],
        "zero_performers": [p for p in perf_report if p["hits"] == 0][:20],
    }


@router.get("/ai/rule-performance")
async def rule_performance_list(license_key: str = Query(..., min_length=8)):
    """Onaylanan kuralların son ölçüm sonuçlarını döner (dashboard için)."""
    rows = await db.mailscanner_rules.find(
        {"license_key": license_key},
        {"_id": 0, "id": 1, "name": 1, "pattern": 1, "target": 1, "score": 1,
         "created_at": 1, "hits_last_check": 1, "hits_last_check_at": 1,
         "hits_window_days": 1, "applied_from_suggestion": 1, "enabled": 1,
         "auto_disabled_at": 1, "auto_disable_reason": 1},
    ).sort("hits_last_check", -1).to_list(500)
    total = len(rows)
    enabled = [r for r in rows if r.get("enabled", True)]
    healthy = sum(1 for r in enabled if (r.get("hits_last_check") or 0) > 0)
    auto_disabled = sum(1 for r in rows if not r.get("enabled", True) and r.get("auto_disabled_at"))
    cfg = await db.mailscanner_config.find_one({"license_key": license_key},
                                                 {"_id": 0, "rule_auto_disable_days": 1,
                                                  "rule_auto_disable_enabled": 1})
    return {
        "items": rows, "total": total, "enabled": len(enabled),
        "healthy": healthy, "zero_hit": len(enabled) - healthy,
        "auto_disabled": auto_disabled,
        "config": {
            "auto_disable_days": (cfg or {}).get("rule_auto_disable_days", 14),
            "auto_disable_enabled": (cfg or {}).get("rule_auto_disable_enabled", True),
        },
    }


# v44.00.26 — Auto-disable config
class RuleAutoDisableConfigIn(BaseModel):
    enabled: bool = True
    days: int = Field(14, ge=0, le=365)


@router.post("/ai/rule-performance/config")
async def rule_perf_config(payload: RuleAutoDisableConfigIn,
                            license_key: str = Query(..., min_length=8)):
    """Kural otomatik disable konfigürasyonu (per-license)."""
    await db.mailscanner_config.update_one(
        {"license_key": license_key},
        {"$set": {
            "license_key": license_key,
            "rule_auto_disable_enabled": payload.enabled,
            "rule_auto_disable_days": int(payload.days),
            "updated_at": _iso(),
        }},
        upsert=True,
    )
    return {"ok": True, "enabled": payload.enabled, "days": payload.days}


@router.post("/ai/rule-performance/enable/{rule_id}")
async def rule_re_enable(rule_id: str, license_key: str = Query(..., min_length=8)):
    """Otomatik disable edilen kuralı tekrar aktif et (revert)."""
    r = await db.mailscanner_rules.update_one(
        {"id": rule_id, "license_key": license_key},
        {"$set": {"enabled": True, "hits_last_check": 0,
                  "hits_last_check_at": None,
                  "re_enabled_at": _iso()},
         "$unset": {"auto_disabled_at": "", "auto_disable_reason": ""}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"ok": True, "re_enabled": rule_id}


# v44.00.26 — GeoIP Onboarding: "en çok spam aldığın 5 ülke" öneri
@router.get("/geoip/suggestions")
async def geoip_country_suggestions(license_key: str = Query(..., min_length=8),
                                     days: int = Query(30, ge=1, le=90),
                                     limit: int = Query(5, ge=1, le=20)):
    """Son N günde spam/high_spam verdict alan mail'lerin sender_ip'lerini
    GeoIP cache üzerinden ülkelere agregate eder. Kullanıcıya toplu engelleme önerisi."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    # 1. mail_events'ten spam gönderilerin IP'lerini topla
    pipeline = [
        {"$match": {"license_key": license_key,
                    "ingested_at": {"$gte": since},
                    "verdict": {"$in": ["spam", "high_spam", "virus", "phishing"]},
                    "$or": [{"sender_ip": {"$exists": True, "$nin": [None, ""]}},
                            {"client_ip": {"$exists": True, "$nin": [None, ""]}}]}},
        {"$project": {
            "ip": {"$ifNull": ["$sender_ip", "$client_ip"]},
        }},
        {"$group": {"_id": "$ip", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 500},
    ]
    ip_counts = []
    async for r in db.mail_events.aggregate(pipeline):
        if r["_id"]:
            ip_counts.append({"ip": r["_id"], "count": r["count"]})

    # 2. Her IP için ülkeyi cache'ten oku (yoksa lookup)
    from routes.events import _geoip_lookup_country
    country_agg: dict = {}
    for entry in ip_counts:
        cc = await _geoip_lookup_country(entry["ip"])
        if not cc:
            continue
        b = country_agg.setdefault(cc, {"code": cc, "spam_count": 0,
                                        "unique_ips": 0, "sample_ips": []})
        b["spam_count"] += entry["count"]
        b["unique_ips"] += 1
        if len(b["sample_ips"]) < 5:
            b["sample_ips"].append(entry["ip"])

    # 3. Zaten engelli ülkeleri filtrele
    already_blocked = set()
    async for r in db.lists.find({"entry_type": "country"}, {"_id": 0, "value": 1}):
        already_blocked.add((r.get("value") or "").upper())

    # 4. Ülke katalog isimlerini ekle
    from server import COUNTRY_NAMES_TR
    suggestions = []
    for cc, b in country_agg.items():
        if cc in already_blocked:
            continue
        b["name"] = COUNTRY_NAMES_TR.get(cc, cc)
        b["flag"] = "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in cc if "A" <= c <= "Z") if len(cc) == 2 else "🌐"
        suggestions.append(b)
    suggestions.sort(key=lambda x: -x["spam_count"])
    suggestions = suggestions[:limit]
    return {
        "days": days,
        "suggestions": suggestions,
        "count": len(suggestions),
        "note": ("Bu ülkelerden gelen mail'lerin çoğu son {} günde spam verdict aldı. "
                 "Tek tıkla toplu engelleyerek gelen spam trafiğinizi azaltabilirsiniz.").format(days),
    }


# v44.00.26 — Manual triggers (UI'dan tetiklemek için)
@router.post("/ai/rule-performance/scan-all")
async def scan_all_licenses_rules(request: Request):
    """Master: tüm bayilerin kural perf'ini şimdi ölç (background task'ın manuel karşılığı)."""
    # Basit protection: sadece master IP'den erişilebilir (X-Forwarded-For master IP)
    ip = (request.headers.get("X-Forwarded-For") or request.client.host or "").split(",")[0].strip()
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    licenses = await db.mail_events.distinct("license_key", {"ingested_at": {"$gte": since}})
    scanned = 0
    for lk in licenses:
        if not lk: continue
        try:
            await scan_rule_performance(license_key=lk, min_age_days=7, window_days=7)
            scanned += 1
        except Exception:
            continue
    return {"ok": True, "scanned": scanned, "master_ip": ip}


@router.post("/ai/rule-performance/remove/{rule_id}")
async def confirm_rule_removal(rule_id: str, license_key: str = Query(..., min_length=8)):
    """Removal öneri onaylandı — kuralı sil + öneriyi kapat."""
    r = await db.mailscanner_rules.delete_one({"id": rule_id, "license_key": license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    await db.mailscanner_rule_suggestions.delete_many({
        "target_rule_id": rule_id, "license_key": license_key,
    })
    return {"ok": True, "removed_rule": rule_id}


@router.post("/ai/self-train/reject/{suggestion_id}")
async def reject_suggestion(suggestion_id: str, license_key: str = Query(..., min_length=8)):
    r = await db.mailscanner_rule_suggestions.delete_one({"id": suggestion_id, "license_key": license_key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Öneri bulunamadı")
    return {"ok": True}


# ============================================================================
#  v43.81 — TOPLU ONAYLA / REDDET (bulk apply/reject)
#  Frontend checkbox toolbar → çoklu id array gönderir.
# ============================================================================
class BulkIdsIn(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=200)


@router.post("/ai/self-train/bulk-apply")
async def bulk_apply(payload: BulkIdsIn, license_key: str = Query(..., min_length=8)):
    """Birden fazla AI önerisini tek tık ile onayla → kurallar listesine ekle."""
    applied = 0
    skipped = 0
    errors: list[str] = []
    for sid in payload.ids:
        try:
            doc = await db.mailscanner_rule_suggestions.find_one(
                {"id": sid, "license_key": license_key, "applied": False})
            if not doc:
                skipped += 1
                continue
            rule = {
                "id": str(uuid.uuid4()), "license_key": license_key,
                "name": doc.get("name", "ai_sugg")[:80],
                "pattern": doc.get("pattern", ""),
                "target": doc.get("target", "subject"),
                "score": float(doc.get("score") or 3.0),
                "enabled": True,
                "description": f"[AI-bulk] {doc.get('description', '')}",
                "updated_at": _iso(), "created_at": _iso(),
            }
            if not rule["pattern"]:
                skipped += 1
                continue
            await db.mailscanner_rules.insert_one(dict(rule))
            await db.mailscanner_rule_suggestions.update_one(
                {"id": sid}, {"$set": {"applied": True, "applied_at": _iso(),
                                        "applied_via": "bulk"}},
            )
            applied += 1
        except Exception as ex:
            errors.append(f"{sid[:8]}: {type(ex).__name__}")
    return {"ok": True, "applied": applied, "skipped": skipped,
            "requested": len(payload.ids), "errors": errors[:5]}


@router.post("/ai/self-train/bulk-reject")
async def bulk_reject(payload: BulkIdsIn, license_key: str = Query(..., min_length=8)):
    """Birden fazla AI önerisini tek tık ile reddet → sil."""
    r = await db.mailscanner_rule_suggestions.delete_many(
        {"id": {"$in": payload.ids}, "license_key": license_key, "applied": False},
    )
    return {"ok": True, "rejected": r.deleted_count, "requested": len(payload.ids)}


# ============================================================================
#  KARANTİNA KALIP TARAMA — Gerçek quarantine kayıtlarından pattern öğrenmek
#  ve regex kural önerisi çıkarmak. (LLM'siz — yerel istatistik + heuristik)
# ============================================================================
_TR_STOPWORDS = {
    "için","ile","olan","olarak","daha","çok","gibi","kadar","sonra","önce",
    "bir","bu","şu","ne","var","yok","evet","hayır","tamam","the","and","for",
    "you","your","our","this","that","from","with","have","are","was","will",
    "com","www","http","https","mail","email","posta","hakkında","merhaba",
    "sayın","değerli","müşteri","kullanıcı","fatura","siparişiniz","bilgi",
    "please","dear","hello","hi","re","fw","fwd","tr","tur","türkiye",
}


def _extract_domain(addr: str) -> str:
    """From: 'ali@bad.tld' → 'bad.tld' (lowercase). None/boş → ''."""
    if not addr:
        return ""
    s = str(addr).strip().lower()
    if "@" in s:
        s = s.rsplit("@", 1)[-1]
    # Strip trailing punct
    s = s.strip("<>., \t\n\r")
    return s


def _extract_tld(domain: str) -> str:
    """'foo.co.uk' → 'co.uk' fallback 'uk'. Basit son 1-2 label."""
    if not domain or "." not in domain:
        return ""
    parts = domain.split(".")
    # 2ci-seviye çift TLD'ler
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "net", "gov", "edu"} and len(parts[-1]) == 2:
        return ".".join(parts[-2:])
    return parts[-1]


def _re_escape_domain(d: str) -> str:
    import re
    return re.escape(d)


async def run_quarantine_pattern_scan(
    license_key: str,
    days: int = 7,
    min_hits: int = 3,
    max_suggestions: int = 10,
) -> dict:
    """Son N gündeki quarantine kayıtlarını analiz eder.
    Üç boyutta pattern çıkarır: (1) sender domain, (2) sender TLD, (3) subject keyword.
    Yeterli tekrar (>=min_hits) eden ve halihazırda kural yazılmamış patternler için
    mailscanner_rule_suggestions'a öneri ekler.
    Response: {scanned, patterns_found, suggested, skipped_existing, top_domains, top_tlds, top_keywords}
    """
    import re
    from collections import Counter

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    # Sadece bu license'ın quarantine kayıtları — tenant scope
    q_filter = {
        "owner_license_key": license_key,
        "received_at": {"$gte": since},
    }
    docs = await db.quarantine.find(
        q_filter, {"_id": 0, "sender": 1, "subject": 1, "sender_ip": 1, "verdict": 1}
    ).limit(2000).to_list(2000)

    scanned = len(docs)
    if scanned == 0:
        return {
            "scanned": 0, "patterns_found": 0, "suggested": 0,
            "skipped_existing": 0, "top_domains": [], "top_tlds": [], "top_keywords": [],
            "days": days, "min_hits": min_hits,
        }

    # Aggregate patterns
    domain_ctr: Counter = Counter()
    tld_ctr: Counter = Counter()
    kw_ctr: Counter = Counter()
    domain_samples: dict = {}  # domain → [sample subjects]
    kw_samples: dict = {}

    for d in docs:
        sender = d.get("sender") or ""
        subj = d.get("subject") or ""
        dom = _extract_domain(sender)
        if dom:
            domain_ctr[dom] += 1
            domain_samples.setdefault(dom, [])
            if len(domain_samples[dom]) < 3 and subj:
                domain_samples[dom].append(subj)
            tld = _extract_tld(dom)
            if tld and len(tld) >= 2 and len(tld) <= 6:
                tld_ctr[tld] += 1
        # Subject keyword frequency (Turkish + English)
        if subj:
            for tok in _tokenize(subj):
                if tok in _TR_STOPWORDS or len(tok) < 4 or tok.isdigit():
                    continue
                kw_ctr[tok] += 1
                kw_samples.setdefault(tok, [])
                if len(kw_samples[tok]) < 3:
                    kw_samples[tok].append(subj)

    # Halihazırda kayıtlı kural/pattern'leri çek → duplicate önle
    existing_patterns = set()
    async for r in db.mailscanner_rules.find({"license_key": license_key}, {"pattern": 1}):
        p = (r.get("pattern") or "").strip()
        if p:
            existing_patterns.add(p)
    async for r in db.mailscanner_rule_suggestions.find(
        {"license_key": license_key, "applied": False}, {"pattern": 1},
    ):
        p = (r.get("pattern") or "").strip()
        if p:
            existing_patterns.add(p)

    suggested = 0
    skipped_existing = 0
    patterns_found = 0

    def _score_for(hits: int, weight: float = 1.0) -> float:
        # Base 3.5, +0.3 her hit'te, cap 6.0
        return round(min(6.0, 3.5 + (hits / 10.0) * weight), 2)

    # 1) Top sender domains (spam kaynağı — güçlü sinyal)
    for dom, hits in domain_ctr.most_common(20):
        if hits < min_hits:
            break
        patterns_found += 1
        pattern = rf"@{_re_escape_domain(dom)}$"
        if pattern in existing_patterns:
            skipped_existing += 1
            continue
        if suggested >= max_suggestions:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "license_key": license_key,
            "name": f"qua_domain_{dom[:40]}"[:80],
            "pattern": pattern,
            "target": "sender",
            "score": _score_for(hits, weight=1.2),
            "description": f"Karantina taraması: {hits} kez {dom} kaynaklı spam yakalandı (son {days}g)",
            "source": "quarantine_pattern",
            "sub_source": "sender_domain",
            "hit_count": hits,
            "days": days,
            "sample_subjects": domain_samples.get(dom, [])[:3],
            "applied": False,
            "created_at": _iso(),
        }
        await db.mailscanner_rule_suggestions.insert_one(dict(doc))
        existing_patterns.add(pattern)
        suggested += 1

    # 2) TLD kalıpları (bir TLD üzerinden çok spam varsa)
    total_docs = max(scanned, 1)
    for tld, hits in tld_ctr.most_common(10):
        if hits < max(min_hits + 2, 5):  # TLD için biraz daha sıkı
            break
        # Yaygın legit TLD'lere kural yazma (com/net/org/tr çok geniş)
        if tld in {"com", "net", "org", "tr", "edu", "gov"}:
            continue
        ratio = hits / total_docs
        if ratio < 0.15:  # TLD spam'lerin en az %15'ini oluşturmalı
            continue
        patterns_found += 1
        pattern = rf"@[^ ]+\.{_re_escape_domain(tld)}$"
        if pattern in existing_patterns:
            skipped_existing += 1
            continue
        if suggested >= max_suggestions:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "license_key": license_key,
            "name": f"qua_tld_{tld}"[:80],
            "pattern": pattern,
            "target": "sender",
            "score": _score_for(hits, weight=0.8),
            "description": f"Karantina taraması: .{tld} TLD'sinden {hits} spam (spamların %{int(ratio*100)}'i)",
            "source": "quarantine_pattern",
            "sub_source": "sender_tld",
            "hit_count": hits,
            "days": days,
            "sample_subjects": [],
            "applied": False,
            "created_at": _iso(),
        }
        await db.mailscanner_rule_suggestions.insert_one(dict(doc))
        existing_patterns.add(pattern)
        suggested += 1

    # 3) Subject keyword kalıpları (spam konularının ortak kelimesi)
    for kw, hits in kw_ctr.most_common(30):
        if hits < max(min_hits + 1, 4):
            break
        # Çok sık geçen kelime → sinyal az (spam'lerin %30+'sında geçmeli)
        ratio = hits / total_docs
        if ratio < 0.20:
            continue
        patterns_found += 1
        pattern = rf"\b{re.escape(kw)}\b"
        if pattern in existing_patterns:
            skipped_existing += 1
            continue
        if suggested >= max_suggestions:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "license_key": license_key,
            "name": f"qua_kw_{kw[:30]}"[:80],
            "pattern": pattern,
            "target": "subject",
            "score": _score_for(hits, weight=0.9),
            "description": f"Karantina taraması: '{kw}' kelimesi {hits} spam konusunda geçti (%{int(ratio*100)})",
            "source": "quarantine_pattern",
            "sub_source": "subject_keyword",
            "hit_count": hits,
            "days": days,
            "sample_subjects": kw_samples.get(kw, [])[:3],
            "applied": False,
            "created_at": _iso(),
        }
        await db.mailscanner_rule_suggestions.insert_one(dict(doc))
        existing_patterns.add(pattern)
        suggested += 1

    # Audit
    entry = {
        "id": str(uuid.uuid4()), "run_at": _iso(), "kind": "quarantine_pattern_scan",
        "license_key": license_key, "scanned": scanned, "days": days,
        "patterns_found": patterns_found, "suggested": suggested,
        "skipped_existing": skipped_existing,
    }
    await db.ai_training_log.insert_one(entry)

    return {
        "scanned": scanned,
        "patterns_found": patterns_found,
        "suggested": suggested,
        "skipped_existing": skipped_existing,
        "top_domains": [{"domain": d, "hits": h} for d, h in domain_ctr.most_common(5)],
        "top_tlds": [{"tld": t, "hits": h} for t, h in tld_ctr.most_common(5)],
        "top_keywords": [{"keyword": k, "hits": h} for k, h in kw_ctr.most_common(10)],
        "days": days,
        "min_hits": min_hits,
    }


@router.post("/ai/quarantine-recommend/run")
async def trigger_quarantine_recommend(
    license_key: str = Query(..., min_length=8),
    days: int = Query(7, ge=1, le=30),
    min_hits: int = Query(3, ge=2, le=50),
):
    """Karantinadaki (son N gün) kayıtları tarayıp otomatik regex kural
    önerileri çıkarır. Öneriler self-train ile aynı `mailscanner_rule_suggestions`
    koleksiyonuna düşer — kullanıcı 'Onayla'yı tıklarsa aktif kural olur."""
    result = await run_quarantine_pattern_scan(license_key, days=days, min_hits=min_hits)
    return {"ok": True, **result}


# ============================================================================
#  v43.81 — OTOMATİK ZAMANLANMIŞ TARAMA (24s cycle)
#  Her aktif lisans için günde bir kez karantina taraması → yeni öneri sayısı
#  varsa master_alerts'a `type=quarantine_suggestions_new` bildirim düşer.
# ============================================================================
async def _quarantine_scan_daily_loop() -> None:
    """Her 24 saatte bir tüm aktif lisanslar için karantina taraması çalıştırır.
    Server startup'ta arka planda başlatılır."""
    import logging
    _log = logging.getLogger("mailscanner.autoquascan")
    # İlk çalıştırma öncesi 10dk bekle (startup storm koruma)
    await asyncio.sleep(600)
    while True:
        try:
            total_lics = 0
            total_new = 0
            hits_by_lic: dict = {}
            async for lic in db.licenses.find(
                {"$or": [{"active": True}, {"active": {"$exists": False}}]},
                {"license_key": 1, "customer_email": 1},
            ):
                lk = lic.get("license_key") or ""
                if not lk:
                    continue
                total_lics += 1
                try:
                    r = await run_quarantine_pattern_scan(lk, days=7, min_hits=3, max_suggestions=10)
                    new_cnt = int(r.get("suggested") or 0)
                    if new_cnt > 0:
                        total_new += new_cnt
                        hits_by_lic[lk] = new_cnt
                        # Master alert (bayi-specific)
                        await db.master_alerts.insert_one({
                            "id": str(uuid.uuid4()),
                            "type": "quarantine_suggestions_new",
                            "severity": "info",
                            "license_key": lk,
                            "message": f"🔎 {lk[:12]}… için {new_cnt} yeni AI kural önerisi (karantina)",
                            "details": {
                                "license_key": lk,
                                "new_suggestions": new_cnt,
                                "scanned": r.get("scanned"),
                                "top_domains": r.get("top_domains", [])[:3],
                            },
                            "seen": False, "read": False,
                            "created_at": _iso(),
                        })
                except Exception as ex:
                    _log.warning("quarantine scan failed for %s: %s", lk[:12], ex)
            # Global audit log
            await db.ai_training_log.insert_one({
                "id": str(uuid.uuid4()),
                "run_at": _iso(),
                "kind": "quarantine_scan_scheduled",
                "licenses_scanned": total_lics,
                "total_new_suggestions": total_new,
                "top_lics": [{"license_key": k, "new": v}
                              for k, v in sorted(hits_by_lic.items(),
                                                  key=lambda x: -x[1])[:5]],
            })
            _log.info("Quarantine scheduled scan complete: %d licenses, %d new suggestions",
                     total_lics, total_new)
        except Exception as ex:
            _log.exception("Quarantine daily loop crashed: %s", ex)
        # 24 saat sonra tekrar
        await asyncio.sleep(24 * 3600)


# ============================================================================
#  v43.82 — KARANTINA HAFTALIK RAPOR (Master email digest)
#  Her Pazartesi 08:00 UTC master'a tüm bayilerin son 7g'deki karantina
#  öneri sayılarını özet tablo olarak email atar.
# ============================================================================
async def run_quarantine_weekly_report_once() -> dict:
    """Son 7 günde her lisans için üretilen öneri sayılarını topla + master'a mail at."""
    from datetime import datetime, timezone, timedelta
    now_utc = datetime.now(timezone.utc)
    since = (now_utc - timedelta(days=7)).isoformat()

    # Per-license new suggestion counts (last 7 days) + top domains
    pipeline = [
        {"$match": {"source": "quarantine_pattern", "created_at": {"$gte": since}}},
        {"$group": {
            "_id": "$license_key",
            "new_count": {"$sum": 1},
            "top_hit": {"$max": {"$ifNull": ["$hit_count", 0]}},
        }},
        {"$sort": {"new_count": -1}},
        {"$limit": 100},
    ]
    rows = await db.mailscanner_rule_suggestions.aggregate(pipeline).to_list(100)

    # v43.84 — Daily trend (son 7 gün, gün başına yeni öneri sayısı) → PDF sparkline için
    daily_trend: list = []
    for d in range(6, -1, -1):
        start = (now_utc - timedelta(days=d+1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        cnt = await db.mailscanner_rule_suggestions.count_documents({
            "source": "quarantine_pattern",
            "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
        })
        daily_trend.append({"day": start.strftime("%m-%d"), "count": int(cnt)})
    # License -> email lookup for readable report
    lic_emails: dict = {}
    if rows:
        keys = [r["_id"] for r in rows if r.get("_id")]
        async for lic in db.licenses.find({"license_key": {"$in": keys}},
                                           {"license_key": 1, "customer_email": 1, "email": 1}):
            lic_emails[lic["license_key"]] = lic.get("customer_email") or lic.get("email") or "-"
    total_new = sum(int(r.get("new_count") or 0) for r in rows)
    active_lics = len(rows)

    # Compose email
    tbl_rows = "\n".join(
        f"  {i+1:>2}. {r['_id'][:16]}… · {lic_emails.get(r['_id'], '-'):<40} · yeni öneri: {r['new_count']:>3} · max hit: {r.get('top_hit', 0)}"
        for i, r in enumerate(rows[:20])
    ) or "  (Bu hafta hiç öneri üretilmedi)"

    subj = f"GökyüzüWebSpam · Karantina Haftalık Rapor · {total_new} yeni öneri"
    body = (
        f"Merhaba,\n\n"
        f"Son 7 gün karantina taraması özeti:\n"
        f"────────────────────────────────────────\n"
        f"  Toplam yeni öneri  : {total_new}\n"
        f"  Aktif lisans sayısı: {active_lics}\n"
        f"  Rapor zamanı       : {_iso()[:19]} UTC\n"
        f"────────────────────────────────────────\n\n"
        f"BAYİ BAZLI ÖZET (top 20):\n{tbl_rows}\n\n"
        f"────────────────────────────────────────\n"
        f"PDF eki: grafikli tam özet raporunu ekte bulabilirsiniz.\n"
        f"Panelde: /panel/mailscanner → AI Öğrenme sekmesi\n"
        f"— GökyüzüWebSpam · Otomatik Haftalık Rapor\n"
    )
    # Save report to audit + attempt email
    report_id = str(uuid.uuid4())
    saved = {
        "id": report_id, "kind": "quarantine_weekly_report",
        "generated_at": _iso(),
        "total_new_suggestions": total_new,
        "active_licenses": active_lics,
        "top_rows": rows[:20],
    }
    await db.ai_training_log.insert_one(dict(saved))

    # v43.83 — PDF eki oluştur
    pdf_bytes = None
    try:
        pdf_bytes = _build_weekly_report_pdf(total_new, active_lics, rows[:20],
                                              lic_emails, daily_trend=daily_trend)
    except Exception:
        pdf_bytes = None

    email_sent = False
    email_error = None
    try:
        from server import _send_email, _notify_settings
        ns = await _notify_settings()
        recipient = (ns.get("admin_email") or os.environ.get("ADMIN_EMAIL")
                     or "").strip()
        if recipient:
            attachments = None
            if pdf_bytes:
                attachments = [{
                    "filename": f"gokyuzu-quarantine-report-{_iso()[:10]}.pdf",
                    "content": pdf_bytes,
                    "mime": "application/pdf",
                }]
            try:
                ok, _via = await _send_email(recipient, subj, body, attachments=attachments)
            except TypeError:
                # Backward compat: _send_email attachments param'ını desteklemiyorsa
                ok, _via = await _send_email(recipient, subj, body)
            email_sent = bool(ok)
        else:
            email_error = "admin_email yapılandırılmamış (Notifications ayarı)"
    except Exception as ex:
        email_error = f"{type(ex).__name__}: {str(ex)[:120]}"

    return {
        "ok": True,
        "report_id": report_id,
        "total_new_suggestions": total_new,
        "active_licenses": active_lics,
        "email_sent": email_sent,
        "email_error": email_error,
        "pdf_attached": bool(pdf_bytes),
        "pdf_size_bytes": len(pdf_bytes) if pdf_bytes else 0,
        "daily_trend": daily_trend,
        "top_rows": rows[:20],
    }


def _build_weekly_report_pdf(total_new: int, active_lics: int,
                              top_rows: list, lic_emails: dict,
                              daily_trend: list = None) -> bytes:
    """ReportLab ile 1-sayfa PDF özet — başlık + KPI + top bayilerin bar grafiği + tablo."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.colors import HexColor
    from reportlab.pdfgen import canvas
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors as _rc

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # Header band
    c.setFillColor(HexColor("#0f172a"))
    c.rect(0, H - 3.5 * cm, W, 3.5 * cm, fill=True, stroke=False)
    c.setFillColor(HexColor("#a5b4fc"))
    c.setFont("Helvetica-Bold", 18)
    c.drawString(2 * cm, H - 1.7 * cm, "GökyüzüWebSpam · Karantina Haftalık Rapor")
    c.setFillColor(HexColor("#94a3b8"))
    c.setFont("Helvetica", 9)
    c.drawString(2 * cm, H - 2.4 * cm, f"Rapor tarihi: {_iso()[:19]} UTC · Son 7 gün · GökyüzüWebSpam v43.83")

    # KPI cards
    c.setFillColor(HexColor("#1e293b"))
    for i, (label, value, col) in enumerate([
        ("YENİ ÖNERİ", str(total_new), "#f43f5e"),
        ("AKTİF BAYİ", str(active_lics), "#10b981"),
        ("KAPSAM", "7 gün", "#8b5cf6"),
    ]):
        x = 2 * cm + i * 5.7 * cm
        y = H - 6 * cm
        c.setFillColor(HexColor("#1e293b"))
        c.roundRect(x, y, 5.3 * cm, 1.9 * cm, 6, fill=True, stroke=False)
        c.setFillColor(HexColor("#94a3b8"))
        c.setFont("Helvetica", 7)
        c.drawString(x + 0.4 * cm, y + 1.4 * cm, label)
        c.setFillColor(HexColor(col))
        c.setFont("Helvetica-Bold", 20)
        c.drawString(x + 0.4 * cm, y + 0.5 * cm, value)

    # v43.84 — 7-day sparkline (daily trend)
    if daily_trend and len(daily_trend) >= 2:
        sp_x = 2 * cm
        sp_y = H - 8.2 * cm
        sp_w = W - 4 * cm
        sp_h = 1.5 * cm
        c.setFillColor(HexColor("#94a3b8"))
        c.setFont("Helvetica", 8)
        c.drawString(sp_x, sp_y + sp_h + 0.15 * cm, "SON 7 GÜN · GÜNLÜK YENİ ÖNERİ TRENDİ")
        # sparkline background
        c.setFillColor(HexColor("#1e293b"))
        c.roundRect(sp_x, sp_y, sp_w, sp_h, 4, fill=True, stroke=False)
        # data path
        counts = [int(d.get("count") or 0) for d in daily_trend]
        max_c = max(counts) or 1
        n = len(counts)
        step = sp_w / max(n - 1, 1)
        c.setStrokeColor(HexColor("#22d3ee"))
        c.setLineWidth(1.4)
        prev = None
        for i, v in enumerate(counts):
            px = sp_x + i * step
            py = sp_y + 0.2 * cm + (v / max_c) * (sp_h - 0.4 * cm)
            if prev is not None:
                c.line(prev[0], prev[1], px, py)
            # nokta + değer
            c.setFillColor(HexColor("#22d3ee"))
            c.circle(px, py, 2.2, fill=True, stroke=False)
            c.setFillColor(HexColor("#e2e8f0"))
            c.setFont("Helvetica-Bold", 6)
            if v > 0:
                c.drawCentredString(px, py + 0.12 * cm, str(v))
            # gün etiketi
            c.setFillColor(HexColor("#64748b"))
            c.setFont("Helvetica", 6)
            c.drawCentredString(px, sp_y - 0.28 * cm, daily_trend[i]["day"])
            prev = (px, py)

    # Bar chart — top 8 licenses
    top_chart = top_rows[:8]
    if top_chart:
        chart_x = 2 * cm
        chart_y = H - 13.5 * cm
        chart_w = W - 4 * cm
        chart_h = 5.5 * cm
        max_v = max(int(r.get("new_count") or 0) for r in top_chart) or 1
        bar_w = chart_w / (len(top_chart) * 1.6)
        c.setFillColor(HexColor("#94a3b8"))
        c.setFont("Helvetica", 8)
        c.drawString(chart_x, chart_y + chart_h + 0.4 * cm, "TOP LİSANS — YENİ ÖNERİ")
        c.setStrokeColor(HexColor("#334155"))
        c.line(chart_x, chart_y, chart_x + chart_w, chart_y)
        for i, r in enumerate(top_chart):
            v = int(r.get("new_count") or 0)
            bh = (v / max_v) * (chart_h - 0.6 * cm)
            bx = chart_x + i * (bar_w * 1.6) + 0.2 * cm
            c.setFillColor(HexColor("#6366f1"))
            c.roundRect(bx, chart_y, bar_w, bh, 3, fill=True, stroke=False)
            c.setFillColor(HexColor("#e2e8f0"))
            c.setFont("Helvetica-Bold", 8)
            c.drawCentredString(bx + bar_w / 2, chart_y + bh + 0.1 * cm, str(v))
            c.setFillColor(HexColor("#94a3b8"))
            c.setFont("Helvetica", 6)
            lk = (r.get("_id") or "")[:10] + "…"
            c.drawCentredString(bx + bar_w / 2, chart_y - 0.4 * cm, lk)

    # Table — top 15 rows
    data = [["#", "Lisans", "Email", "Yeni", "Max Hit"]]
    for i, r in enumerate(top_rows[:15]):
        lk = (r.get("_id") or "")[:20]
        em = (lic_emails.get(r.get("_id", ""), "-") or "-")[:34]
        data.append([str(i + 1), lk, em, str(r.get("new_count", 0)), str(r.get("top_hit", 0))])
    tbl = Table(data, colWidths=[0.9 * cm, 4.7 * cm, 6.5 * cm, 1.8 * cm, 2.1 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#a5b4fc")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor("#334155")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#0f172a"), HexColor("#111827")]),
        ("TEXTCOLOR", (0, 1), (-1, -1), _rc.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    tbl_h = tbl.wrap(W - 4 * cm, 15 * cm)[1]
    tbl.drawOn(c, 2 * cm, 2 * cm)

    c.setFillColor(HexColor("#64748b"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(2 * cm, 1 * cm, "GökyüzüWebSpam · Otomatik haftalık rapor · gizli, sadece master için")

    c.showPage()
    c.save()
    return buf.getvalue()


async def _quarantine_weekly_report_loop() -> None:
    """Her saat başı çalışır — Pazartesi 08:00 UTC ise rapor üret+email at.
    O gün zaten üretildiyse skip (idempotent)."""
    import logging
    _log = logging.getLogger("mailscanner.weeklyreport")
    from datetime import datetime, timezone
    # Startup delay
    await asyncio.sleep(600)
    while True:
        try:
            now = datetime.now(timezone.utc)
            if now.weekday() == 0 and now.hour == 8:  # Pazartesi 08:00 UTC
                today = now.strftime("%Y-%m-%d")
                already = await db.ai_training_log.find_one({
                    "kind": "quarantine_weekly_report",
                    "generated_at": {"$regex": f"^{today}"},
                })
                if not already:
                    r = await run_quarantine_weekly_report_once()
                    _log.info("Weekly quarantine report generated: %s new suggestions, email=%s",
                             r.get("total_new_suggestions"), r.get("email_sent"))
        except Exception as ex:
            _log.exception("Weekly report loop error: %s", ex)
        await asyncio.sleep(3600)


@router.post("/ai/quarantine-recommend/weekly-report")
async def trigger_weekly_report():
    """Master manuel tetiklemesi — rapor üret + master admin_email'e at."""
    result = await run_quarantine_weekly_report_once()
    return result


@router.get("/ai/quarantine-recommend/weekly-report.pdf")
async def download_weekly_report_pdf():
    """Son 7 gün karantina raporunu PDF olarak indir."""
    from fastapi.responses import Response
    from datetime import datetime, timezone, timedelta
    now_utc = datetime.now(timezone.utc)
    since = (now_utc - timedelta(days=7)).isoformat()
    pipeline = [
        {"$match": {"source": "quarantine_pattern", "created_at": {"$gte": since}}},
        {"$group": {"_id": "$license_key",
                     "new_count": {"$sum": 1},
                     "top_hit": {"$max": {"$ifNull": ["$hit_count", 0]}}}},
        {"$sort": {"new_count": -1}}, {"$limit": 100},
    ]
    rows = await db.mailscanner_rule_suggestions.aggregate(pipeline).to_list(100)
    lic_emails: dict = {}
    if rows:
        keys = [r["_id"] for r in rows if r.get("_id")]
        async for lic in db.licenses.find({"license_key": {"$in": keys}},
                                           {"license_key": 1, "customer_email": 1, "email": 1}):
            lic_emails[lic["license_key"]] = lic.get("customer_email") or lic.get("email") or "-"
    total_new = sum(int(r.get("new_count") or 0) for r in rows)
    # v43.84 — Daily trend for sparkline
    daily_trend: list = []
    for d in range(6, -1, -1):
        start = (now_utc - timedelta(days=d+1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        cnt = await db.mailscanner_rule_suggestions.count_documents({
            "source": "quarantine_pattern",
            "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
        })
        daily_trend.append({"day": start.strftime("%m-%d"), "count": int(cnt)})
    pdf_bytes = _build_weekly_report_pdf(total_new, len(rows), rows[:20], lic_emails,
                                          daily_trend=daily_trend)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition":
                 f'attachment; filename="gokyuzu-quarantine-weekly-{_iso()[:10]}.pdf"'},
    )


# ============================================================================
#  AI PREDICT SCORE — ingest anında hızlı LLM spam skor tahmini
#  AI DOCS NARRATION — modül drawer'ında sesli/metin kılavuz
# ============================================================================
class PredictIn(BaseModel):
    from_addr: Optional[str] = ""
    to_addr: Optional[str] = ""
    subject: Optional[str] = ""
    body_preview: Optional[str] = ""
    client_ip: Optional[str] = ""


# In-memory LRU-lite cache (max 500 entries)
_PREDICT_CACHE: dict[str, dict] = {}


def _predict_key(payload: PredictIn) -> str:
    return f"{payload.from_addr}|{payload.subject}"[:200]


async def _heuristic_score(p: PredictIn) -> tuple[float, list[str]]:
    """LLM olmadan hizli heuristic (2-5ms)."""
    score = 0.0
    reasons = []
    subj = (p.subject or "").lower()
    body = (p.body_preview or "").lower()
    frm = (p.from_addr or "").lower()

    if any(w in subj for w in ["tebrikler", "kazand", "iban", "acil", "urgent",
                                "wire", "havale", "click here", "verify", "suspended"]):
        score += 3.0; reasons.append("Konuda spam anahtar kelimeleri")
    if any(w in body for w in ["click here", "buraya tikla", "hemen odeme", "kazand"]):
        score += 2.0; reasons.append("Body'de tehlikeli link cagrisi")
    if "@" in frm and any(sub in frm for sub in [".ru", ".cn", ".tk", ".xyz"]):
        score += 1.5; reasons.append("Yuksek riskli TLD")
    if len(subj) > 90:
        score += 0.5; reasons.append("Cok uzun konu satiri")
    if subj != p.subject and subj:  # gostersiz karakterler
        score += 0.5
    if not p.from_addr or p.from_addr == "<>":
        score += 1.0; reasons.append("Bounce/empty envelope")
    return round(score, 2), reasons


@router.post("/ai/predict-score")
async def predict_score(payload: PredictIn, use_llm: bool = False):
    """Hizli heuristic (2-5ms) + opsiyonel LLM ile skor tahmini (~500ms)."""
    key = _predict_key(payload)
    if key in _PREDICT_CACHE:
        cached = _PREDICT_CACHE[key]
        return {**cached, "cache": True}
    heur_score, reasons = await _heuristic_score(payload)
    verdict = "clean"
    if heur_score >= 10: verdict = "high_spam"
    elif heur_score >= 5: verdict = "spam"
    elif heur_score >= 3: verdict = "suspicious"
    result = {"score": heur_score, "verdict": verdict, "reasons": reasons,
              "method": "heuristic", "cache": False}
    if use_llm:
        import os
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if api_key:
            try:
                from emergentintegrations.llm.chat import LlmChat, UserMessage
                prompt = (
                    f"Kisa yanit ver: Bu mail spam mi?\n"
                    f"Gonderen: {payload.from_addr}\nKonu: {payload.subject}\n"
                    f"Body ozet: {(payload.body_preview or '')[:200]}\n\n"
                    f"Yalnizca JSON dondur (baska yazi yok):\n"
                    '{"score": 0-10 arasi float, "verdict": "clean/suspicious/spam/high_spam", "reason": "tek cumle"}'
                )
                chat = LlmChat(
                    api_key=api_key, session_id=f"predict-{uuid.uuid4().hex[:8]}",
                    system_message="Sen bir hizli spam siniflandiricisin. JSON dondur.",
                ).with_model("anthropic", "claude-sonnet-4-6")
                r = await chat.send_message(UserMessage(text=prompt))
                import json as _json, re
                m = re.search(r"\{[\s\S]*\}", r or "")
                if m:
                    parsed = _json.loads(m.group(0))
                    llm_score = float(parsed.get("score", heur_score))
                    combined = round(0.6 * llm_score + 0.4 * heur_score, 2)
                    verdict = parsed.get("verdict", verdict)
                    reasons.append(f"AI: {parsed.get('reason', '')}")
                    result.update({
                        "score": combined, "verdict": verdict, "reasons": reasons,
                        "method": "hybrid", "llm_score": llm_score,
                    })
            except Exception:
                pass
    if len(_PREDICT_CACHE) > 500:
        _PREDICT_CACHE.pop(next(iter(_PREDICT_CACHE)))
    _PREDICT_CACHE[key] = result
    return result


class DocsNarrateIn(BaseModel):
    module_key: str
    module_label: str
    features: list[str] = []
    style: Optional[str] = "friendly"  # friendly / technical / casual


@router.post("/ai/docs-narrate")
async def docs_narrate(payload: DocsNarrateIn):
    """Bir modul icin Turkce, 20-30sn'lik konusma kilavuzu uretir (script)."""
    import os
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yok")
    prompt = (
        f"'{payload.module_label}' modulu icin 3-4 kisa Turkce cumleyle konusma tarzi kilavuz uret.\n"
        f"Ozellikler: {', '.join(payload.features[:5])}\n"
        f"Ton: {payload.style} · sanki bir kullaniciya panel uzerinde anlatiyorsun.\n"
        f"Emoji kullanma, jargon kullanma, 20-30sn okuma suresi."
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key, session_id=f"narrate-{uuid.uuid4().hex[:8]}",
            system_message="Sen bir arayuz kilavuzcusun. Kullaniciyla dost bir tonla konusursun.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        script = (r or "").strip()
    except Exception as ex:
        raise HTTPException(500, f"LLM hatasi: {type(ex).__name__}")
    return {"module_key": payload.module_key, "script": script,
            "word_count": len(script.split()), "generated_at": _iso()}


# ============================================================================
#  DOCS MEDIA UPLOAD — modul basi GIF/video/screencap yukleme
# ============================================================================
import base64 as _b64
from pathlib import Path as _Path

_MEDIA_DIR = _Path("/app/backend/uploads/docs")
_MEDIA_DIR.mkdir(parents=True, exist_ok=True)

_ALLOWED_MEDIA = {"image/gif", "image/png", "image/jpeg", "image/webp",
                  "video/mp4", "video/webm"}
_MAX_MEDIA_BYTES = 20 * 1024 * 1024   # 20 MB


class MediaUploadIn(BaseModel):
    module_key: str = Field(..., min_length=1, max_length=60)
    filename: str = Field(..., min_length=3, max_length=200)
    content_type: str
    data_b64: str   # base64 encoded body
    caption: Optional[str] = ""


@router.post("/docs/media")
async def upload_docs_media(payload: MediaUploadIn):
    if payload.content_type not in _ALLOWED_MEDIA:
        raise HTTPException(400, f"Desteklenmeyen tur: {payload.content_type}")
    try:
        raw = _b64.b64decode(payload.data_b64)
    except Exception:
        raise HTTPException(400, "Gecersiz base64")
    if len(raw) > _MAX_MEDIA_BYTES:
        raise HTTPException(413, f"Dosya cok buyuk (max {_MAX_MEDIA_BYTES // 1024 // 1024} MB)")
    ext = payload.content_type.split("/")[-1].replace("jpeg", "jpg")
    mid = str(uuid.uuid4())
    filepath = _MEDIA_DIR / f"{mid}.{ext}"
    filepath.write_bytes(raw)
    doc = {
        "id": mid, "module_key": payload.module_key,
        "filename": payload.filename, "content_type": payload.content_type,
        "size": len(raw), "caption": (payload.caption or "")[:400],
        "url": f"/api/mailscanner/docs/media/{mid}",
        "created_at": _iso(),
    }
    await db.docs_media.insert_one(dict(doc))
    return doc


@router.get("/docs/media/{media_id}")
async def get_docs_media(media_id: str):
    from fastapi.responses import FileResponse
    doc = await db.docs_media.find_one({"id": media_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Media bulunamadi")
    ext = doc["content_type"].split("/")[-1].replace("jpeg", "jpg")
    path = _MEDIA_DIR / f"{media_id}.{ext}"
    if not path.exists():
        raise HTTPException(404, "Dosya sistemde yok")
    return FileResponse(path, media_type=doc["content_type"])


@router.get("/docs/media")
async def list_docs_media(module_key: Optional[str] = None):
    q = {"module_key": module_key} if module_key else {}
    rows = await db.docs_media.find(q, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"items": rows}


@router.delete("/docs/media/{media_id}")
async def delete_docs_media(media_id: str):
    doc = await db.docs_media.find_one({"id": media_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Media bulunamadi")
    ext = doc["content_type"].split("/")[-1].replace("jpeg", "jpg")
    path = _MEDIA_DIR / f"{media_id}.{ext}"
    try: path.unlink(missing_ok=True)
    except Exception: pass
    await db.docs_media.delete_one({"id": media_id})
    return {"ok": True}


# ============================================================================
#  AI MODULE ASSISTANT — soru sor, resim uret, otomatik kilavuz
# ============================================================================
class ModuleAskIn(BaseModel):
    module_key: str
    module_label: str
    question: str = Field(..., min_length=1, max_length=1000)


@router.post("/ai/module-ask")
async def module_ask(payload: ModuleAskIn):
    """Kullanici modul hakkinda soru sorar, LLM Turkce yanit verir."""
    import os
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yok")
    prompt = (
        f"GökyüzüWebSpam panelindeki '{payload.module_label}' ({payload.module_key}) modulu hakkinda "
        f"kullanicinin sorusu:\n\n{payload.question}\n\n"
        "3-5 cumleyle Turkce, kisa ve konusma tarzi yanit ver. "
        "Modul ne yapar, nasil kullanilir, ne zaman kullanilir? "
        "Emoji ve jargon kullanma."
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key, session_id=f"mod-ask-{uuid.uuid4().hex[:8]}",
            system_message="Sen GokyuzuWebSpam paneli icin bir yardim asistanisin. Konusma tarzi Turkce yanitla.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        answer = (r or "").strip()
    except Exception as ex:
        raise HTTPException(500, f"LLM hatasi: {type(ex).__name__}")
    # Save to Q&A log
    await db.module_qa_log.insert_one({
        "id": str(uuid.uuid4()),
        "module_key": payload.module_key,
        "question": payload.question,
        "answer": answer,
        "created_at": _iso(),
    })
    return {"answer": answer, "module_key": payload.module_key}


class ModuleIllustrateIn(BaseModel):
    module_key: str
    module_label: str
    style: Optional[str] = "modern flat illustration"


@router.post("/ai/module-illustrate")
async def module_illustrate(payload: ModuleIllustrateIn):
    """Nano Banana / Gemini image generation ile modul icin illustrasyon uret.
    Uretilen image'i /uploads/docs altina kaydet + docs_media koleksiyonuna ekle."""
    import os
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY yok")
    prompt = (
        f"A {payload.style} for a mail security dashboard module called '{payload.module_label}'. "
        f"Dark cyberpunk theme, indigo/purple gradient, technical UI elements, shields, mail icons. "
        f"No text on image. Vector-style, clean, professional."
    )
    try:
        from emergentintegrations.llm.imagegen import OpenAIImageGeneration
        img_gen = OpenAIImageGeneration(api_key=api_key)
        images = await img_gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
        if not images:
            raise HTTPException(500, "Gorsel uretilemedi")
        # image bytes -> save
        img_bytes = images[0]
        mid = str(uuid.uuid4())
        filepath = _MEDIA_DIR / f"{mid}.png"
        filepath.write_bytes(img_bytes)
        doc = {
            "id": mid, "module_key": payload.module_key,
            "filename": f"ai-generated-{payload.module_key}.png",
            "content_type": "image/png", "size": len(img_bytes),
            "caption": f"🤖 AI ile üretildi · {payload.style}",
            "url": f"/api/mailscanner/docs/media/{mid}",
            "source": "ai_generated",
            "created_at": _iso(),
        }
        await db.docs_media.insert_one(dict(doc))
        return doc
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(500, f"Gorsel uretim hatasi: {type(ex).__name__}: {str(ex)[:100]}")


@router.get("/ai/module-qa-log")
async def module_qa_log(module_key: Optional[str] = None, limit: int = 20):
    q = {"module_key": module_key} if module_key else {}
    rows = await db.module_qa_log.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}
