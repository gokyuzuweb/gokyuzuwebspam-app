"""
Mail Event ingestion + listing (SaaS mode).
Milter (yerel WHM sunucusu) her taranmis mail icin buraya POST atar,
panel de buradan license_key'e gore filtreli olarak listeler.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from deps import db
import logging
import os
import re
import uuid

log = logging.getLogger("events")

router = APIRouter(prefix="/events", tags=["events"])


class MailEvent(BaseModel):
    license_key: str = Field(..., min_length=8)
    server_ip: Optional[str] = None
    server_hostname: Optional[str] = None
    exim_mid: Optional[str] = None   # Exim message id (spool executor icin)
    from_addr: Optional[str] = None
    to_addr: Optional[str] = None
    subject: Optional[str] = None
    verdict: str = Field(..., pattern="^(clean|spam|high_spam|virus|blocked|whitelisted)$")
    action: Optional[str] = None
    total_score: float = 0.0
    scores: dict[str, Any] = Field(default_factory=dict)
    headers_preview: Optional[str] = None
    headers_full: Optional[str] = None      # Complete SMTP headers (multi-line)
    body_preview: Optional[str] = None      # Plain-text body (first N KB)
    body_html: Optional[str] = None         # HTML body if available
    attachments: Optional[list[dict]] = None  # [{filename, content_type, size, sha256}]
    ts: Optional[str] = None  # ISO ts, milter tarafinda uretilirse
    # v43 Outbound tracking — WHM Perl script logtail-mainlog.pl outbound
    # mail'leri direction="out" ile gönderir (from_addr sistem kullanıcısı).
    # Backward compatible: default "in" (gelen), boş bırakılırsa "in" varsayılır.
    direction: Optional[str] = Field(default="in", pattern="^(in|out)$")
    # Outbound için gönderen sistem kullanıcısı (Exim'de "$originator_login")
    from_user: Optional[str] = None


async def _validate_license(license_key: str) -> dict:
    # Master anahtarı env'den — DB'de olmasa bile geçerli (master her şeyi görür)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    if master_key and license_key == master_key:
        return {
            "license_key": master_key,
            "customer_name": "Master",
            "plan": "enterprise",
            "active": True,
            "ip_addresses": [os.environ.get("MASTER_IP", "")],
            "panel_domains": [os.environ.get("MASTER_HOST", "")],
        }
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(401, "Gecersiz lisans anahtari")
    if lic.get("active") is False:
        raise HTTPException(403, "Lisans pasif/iptal")
    return lic


@router.post("/admin/migrate-ts-tz")
async def migrate_ts_timezone(payload: dict):
    """Perl script eski versiyonda Exim log lokal saatini alıp yanlış '+00:00' ekliyordu.
    Bu endpoint, event'lerin ts alanlarını yeniden yorumlar ve doğru UTC'ye çevirir.
    Örn: '2026-02-15T15:51:00+00:00' → sunucu +03:00 idi → gerçek UTC '12:51:00+00:00'.

    payload: {
      license_key: str (master anahtarı gerekli),
      from_offset: '+00:00',
      to_offset:   '+03:00',
      only_exim: bool (default True) — sadece exim_mid dolu olanları migrate et,
      dry_run:   bool (default False) — sadece kaç kayıt etkilenecek göster,
      limit:     int (default 20000)
    }
    """
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    if payload.get("license_key") != master_key:
        raise HTTPException(403, "Sadece master anahtarı bu migrasyonu çalıştırabilir")
    from_off = payload.get("from_offset", "+00:00")
    to_off   = payload.get("to_offset", "+03:00")
    only_exim = payload.get("only_exim", True)
    dry = bool(payload.get("dry_run", False))
    limit = int(payload.get("limit", 20000))

    # from_off ile biten ts field'ları hedef
    q: dict[str, Any] = {"ts": {"$regex": f"{re.escape(from_off)}$"}}
    if only_exim:
        q["exim_mid"] = {"$exists": True, "$ne": None}

    total = await db.mail_events.count_documents(q)
    if dry:
        sample = await db.mail_events.find(q, {"_id": 0, "id": 1, "ts": 1, "from_addr": 1, "subject": 1}).limit(5).to_list(5)
        return {"ok": True, "dry_run": True, "would_migrate": total, "sample": sample}

    # to_off'u timedelta'ya çevir
    m = re.match(r"^([+-])(\d{2}):(\d{2})$", to_off)
    if not m:
        raise HTTPException(400, f"Gecersiz to_offset: {to_off}")
    sign, hh, mm = m.group(1), int(m.group(2)), int(m.group(3))
    delta_min = (hh * 60 + mm) * (1 if sign == "+" else -1)

    cursor = db.mail_events.find(q, {"_id": 1, "ts": 1}).limit(limit)
    migrated = 0
    async for row in cursor:
        old_ts = row.get("ts")
        try:
            # Eski: ts=15:51:00+00:00 → aslında bu, +03:00 lokal saatiydi.
            # Gerçek UTC = 15:51:00 - 3sa = 12:51:00+00:00
            base = old_ts[:-len(from_off)]  # "2026-02-15T15:51:00"
            dt_naive = datetime.fromisoformat(base)
            # dt_naive'e -delta_min uygula (server_tz idi, UTC'ye çevir)
            from datetime import timedelta as _td
            real_utc = dt_naive - _td(minutes=delta_min)
            new_ts = real_utc.replace(tzinfo=timezone.utc).isoformat()
            await db.mail_events.update_one(
                {"_id": row["_id"]},
                {"$set": {"ts": new_ts, "ts_migrated_from": old_ts, "ts_migration_offset": to_off}},
            )
            migrated += 1
        except Exception:
            continue

    return {
        "ok": True,
        "matched": total,
        "migrated": migrated,
        "from_offset": from_off,
        "to_offset_interpreted_as": to_off,
        "message": f"{migrated} kayıt '+00:00' yerine {to_off} lokal olarak yeniden yorumlandı ve UTC'ye çevrildi.",
    }


@router.post("/logtail-heartbeat")
async def logtail_heartbeat(payload: dict, request: Request):
    """WHM sunucusundaki mailshield-logtail.pl script'i her 60sn bir bunu POST'lar.
    Script gerçekten canlı mı, hangi offset'te, kaç satır işledi — panelde gösterilir."""
    lic = payload.get("license_key")
    if not lic:
        raise HTTPException(400, "license_key gerekli")
    await _validate_license(lic)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "license_key": lic,
        "hostname": payload.get("hostname"),
        "last_seen": now,
        "last_kind": payload.get("kind", "alive"),
        "processed": int(payload.get("processed") or 0),
        "matched": int(payload.get("matched") or 0),
        "uptime_sec": int(payload.get("uptime_sec") or 0),
        "offset": int(payload.get("offset") or 0),
        "exim_log": payload.get("exim_log"),
        "server_url": payload.get("server_url"),
        "remote_ip": request.client.host if request.client else None,
    }
    await db.logtail_heartbeats.update_one(
        {"license_key": lic, "hostname": doc["hostname"]},
        {"$set": doc, "$setOnInsert": {"first_seen": now}},
        upsert=True,
    )
    return {"ok": True, "recorded_at": now}


@router.get("/logtail-status")
async def logtail_status(license_key: str = Query(..., min_length=8)):
    """Panelde 'Script canlı mı?' göstergesi için. Son heartbeat + trafik özeti."""
    await _validate_license(license_key)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    is_master = master_key and license_key == master_key
    q: dict[str, Any] = ({"$or": [{"license_key": master_key},
                                    {"license_key": {"$regex": "^AUTO-"}}]}
                          if is_master else {"license_key": license_key})
    rows = await db.logtail_heartbeats.find(q, {"_id": 0}).sort("last_seen", -1).to_list(50)
    now = datetime.now(timezone.utc)
    items = []
    for r in rows:
        try:
            last = datetime.fromisoformat(str(r.get("last_seen", "")).replace("Z", "+00:00"))
            age = int((now - last).total_seconds())
        except Exception:
            age = -1
        status = "alive" if 0 <= age < 180 else ("stale" if 0 <= age < 900 else "dead")
        items.append({**r, "age_sec": age, "status": status})
    alive_count = sum(1 for i in items if i["status"] == "alive")
    return {
        "items": items,
        "total_hosts": len(items),
        "alive_count": alive_count,
        "healthy": alive_count > 0,
    }


@router.post("/ingest")
async def ingest_event(evt: MailEvent, request: Request):
    """Milter -> backend. Tek mail rapor.
    Rate limiting yok (guven license anahtarina). Failsafe: ts eksikse simdi.
    """
    await _validate_license(evt.license_key)
    doc = evt.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["ts"] = doc.get("ts") or datetime.now(timezone.utc).isoformat()
    doc["ingested_at"] = datetime.now(timezone.utc).isoformat()
    # ---- AUTO TZ CORRECTION ---------------------------------------------
    # Perl script'in eski versiyonu Exim log lokal saatini alıp yanlış "+00:00"
    # ile postluyordu. Yeni versiyon bunu düzeltir ama geçiş süresinde ve
    # deploy edilmemiş sunucular için otomatik correction:
    #   Eğer ts, server now_utc'sinden > 30dk ileri ise, tam saat offset
    #   olarak yorumla ve UTC'ye geri çek. Böylece kullanıcı 3sa ileri saat
    #   görmez, deploy sonrası da double-correction olmaz.
    try:
        ts_dt = datetime.fromisoformat(str(doc["ts"]).replace("Z", "+00:00"))
        if ts_dt.tzinfo is None:
            ts_dt = ts_dt.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        diff_min = (ts_dt - now_utc).total_seconds() / 60.0
        if 30 < diff_min < 720:  # 30dk - 12sa arası ileri → offset hatası
            offset_hours = round(diff_min / 60.0)
            from datetime import timedelta as _td
            corrected = ts_dt - _td(hours=offset_hours)
            doc["ts"] = corrected.astimezone(timezone.utc).isoformat()
            doc["ts_auto_corrected"] = f"shifted_-{offset_hours}h"
    except Exception:
        pass
    # ---------------------------------------------------------------------
    # Subject Türkçe karakter safety-net: MIME encoded-word decode (Perl kaçırırsa).
    # =?UTF-8?B?...?= veya =?UTF-8?Q?...?= gibi header'ları Türkçe UTF-8'e çevir.
    if doc.get("subject") and "=?" in doc["subject"]:
        try:
            from email.header import decode_header, make_header
            doc["subject"] = str(make_header(decode_header(doc["subject"])))
        except Exception:
            pass
    # Double-encoded UTF-8 fix — eski Perl versiyonunda JSON çıktısı
    # "Ã§, Ã¼, Ã¶, Ä±" gibi geliyordu (2x UTF-8 encode). Otomatik düzelt:
    #   subject.encode('latin-1').decode('utf-8') → gerçek UTF-8'e çevir.
    if doc.get("subject"):
        s = doc["subject"]
        if any(m in s for m in ("Ã", "Å", "Ä±", "Ä°", "Ã§", "Ã¼", "Ã¶")):
            try:
                fixed = s.encode("latin-1").decode("utf-8")
                doc["subject"] = fixed
                doc["subject_double_decoded"] = True
            except Exception:
                pass
    # Sender IP tespit: header'da X-Originating-IP > client_ip payload > request.client
    sender_ip = None
    headers = (doc.get("headers_full") or doc.get("headers_preview") or "")
    import re as _re
    m = _re.search(r"X-Originating-IP:\s*\[?([\d.]+)\]?", headers, _re.IGNORECASE)
    if m:
        sender_ip = m.group(1)
    if not sender_ip:
        m = _re.search(r"Received:.*?\[([\d.]+)\]", headers)
        if m:
            sender_ip = m.group(1)
    if not sender_ip:
        sender_ip = doc.get("client_ip")
    if not sender_ip and request.client:
        sender_ip = request.client.host
    doc["client_ip"] = sender_ip or doc.get("client_ip")
    doc["sender_ip"] = sender_ip

    # ---- SKOR & VERDICT NORMALIZATION -----------------------------------
    # ConfigServer MailScanner Front-End ile parite: gerçek SA skoru
    # `scores.spamassassin` içindedir (Perl script bunu her zaman ekler).
    # `total_score` bazı plugin sürümlerinde yanlış toplam (motor kural
    # numaraları, byte size vb.) döndürüyor → panelde 81 gibi anormal
    # değerler görülüyordu. SA skoru varsa onu tek doğru kaynak olarak al
    # ve verdict'i standart SA eşikleriyle yeniden hesapla.
    try:
        scores_map = doc.get("scores") or {}
        sa_raw = scores_map.get("spamassassin")
        sa_score = float(sa_raw) if sa_raw is not None else None
    except (TypeError, ValueError):
        sa_score = None
    if sa_score is not None:
        doc["total_score"] = sa_score
        # Sadece SA skoru düşük olduğu halde plugin yüksek verdict yolladıysa
        # düzelt. Virus/phish gibi gerçek tehdit verdict'lerini KORU.
        cur_verdict = (doc.get("verdict") or "").lower()
        # Per-license eşik: license belgesindeki spam_threshold/high_spam_threshold
        # (default: 5.0 / 10.0 — ConfigServer varsayılanı ile aynı)
        lic_doc = await db.licenses.find_one(
            {"license_key": evt.license_key},
            {"_id": 0, "spam_threshold": 1, "high_spam_threshold": 1},
        ) or {}
        try:
            th_spam = float(lic_doc.get("spam_threshold") or 5.0)
            th_high = float(lic_doc.get("high_spam_threshold") or 10.0)
        except (TypeError, ValueError):
            th_spam, th_high = 5.0, 10.0
        if cur_verdict not in ("virus", "phish", "phishing", "blocked"):
            if sa_score >= th_high:
                doc["verdict"] = "high_spam"
            elif sa_score >= th_spam:
                doc["verdict"] = "spam"
            else:
                doc["verdict"] = "clean"
        doc["score_normalized"] = True
        doc["score_source"] = "spamassassin"
        doc["thresholds_used"] = {"spam": th_spam, "high_spam": th_high}
    else:
        # SA yok — plugin total_score'a güven ama abartılı değerleri clamp'le
        try:
            ts = float(doc.get("total_score") or 0)
            if ts > 30:  # gerçek SA maks ~30; yukarısı plugin bug'ı
                doc["total_score_original"] = ts
                doc["total_score"] = 30.0
                doc["score_clamped"] = True
        except (TypeError, ValueError):
            doc["total_score"] = 0
    # ---------------------------------------------------------------------
    # v43.1 BOUNCE FIX: `<>` (null envelope sender, RFC 5321 §4.5.5) veya
    # sistem pseudo-user'ları (mailnull, Debian-exim vs) her zaman inbound
    # olarak sınıflandır. Bunlar Exim'in bounce/DSN mesajları — user gerçek
    # gönderen değil. Bu güvenlik ağı; Perl script eski sürümdeyse bile
    # backend'te yakalarız.
    _fa = (doc.get("from_addr") or "").strip()
    _fu = (doc.get("from_user") or "").strip().lower()
    SYSTEM_USERS = {"mailnull", "debian-exim", "exim", "root", "nobody", "mail", "mailman", "apache", "www-data"}
    if (not _fa or _fa == "<>") or (_fu in SYSTEM_USERS) or _fu.startswith("systemd-"):
        doc["direction"] = "in"
        doc.pop("from_user", None)
    # ---------------------------------------------------------------------
    await db.mail_events.insert_one(doc)

    # ---- OUTBOUND BULK DETECTION (v43) ----------------------------------
    # Aynı `from_user` (Exim originator_login) 1 saatte threshold'u aşarsa:
    #   1) master_alerts'a "outbound_bulk" tipi alert yaz (throttle uygula)
    #   2) `outbound_throttles` koleksiyonuna user throttle kaydı ekle
    # Threshold: policy.outbound_limit_per_hour (varsayılan 200).
    if doc.get("direction") == "out":
        from_user = (doc.get("from_user") or "").strip().lower()
        # v43.5 Broadcast every outbound event to ws/outbound listeners
        try:
            from routes.maintenance import push_outbound_event
            await push_outbound_event({
                "type": "event",
                "id": doc.get("id"),
                "from_addr": doc.get("from_addr"),
                "from_user": from_user or None,
                "to_addr": doc.get("to_addr"),
                "subject": doc.get("subject"),
                "verdict": doc.get("verdict"),
                "total_score": doc.get("total_score"),
                "ts": doc.get("ts"),
            })
        except Exception:
            pass
        if from_user:
            try:
                from datetime import timedelta
                since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
                policy = await db.settings.find_one({"_key": "policy"}, {"_id": 0}) or {}
                limit_hour = int(policy.get("outbound_limit_per_hour", 200))
                sent_count = await db.mail_events.count_documents({
                    "license_key": evt.license_key,
                    "direction": "out",
                    "from_user": from_user,
                    "ts": {"$gte": since},
                })
                if sent_count >= limit_hour:
                    # Idempotent alert — aynı user aynı saat için birden fazla alert oluşturma
                    hour_bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
                    alert_key = f"outbound_bulk:{evt.license_key}:{from_user}:{hour_bucket}"
                    exists = await db.master_alerts.find_one({"dedupe_key": alert_key}, {"_id": 1})
                    if not exists:
                        await db.master_alerts.insert_one({
                            "id": str(uuid.uuid4()),
                            "type": "outbound_bulk",
                            "severity": "warning",
                            "license_key": evt.license_key,
                            "from_user": from_user,
                            "sent_count": sent_count,
                            "limit": limit_hour,
                            "message": f"Toplu giden mail: {from_user} son 1 saatte {sent_count} mail atmış (limit: {limit_hour})",
                            "dedupe_key": alert_key,
                            "seen": False,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        # Auto-throttle: kullanıcıyı bloka al
                        await db.outbound_throttles.update_one(
                            {"license_key": evt.license_key, "from_user": from_user},
                            {"$set": {
                                "license_key": evt.license_key,
                                "from_user": from_user,
                                "throttled": True,
                                "sent_count": sent_count,
                                "limit": limit_hour,
                                "reason": "auto_bulk_detect",
                                "throttled_at": datetime.now(timezone.utc).isoformat(),
                            }},
                            upsert=True,
                        )
                        # v43.5 WebSocket broadcast — Frontend anında toast görsün
                        try:
                            from routes.maintenance import push_outbound_event
                            await push_outbound_event({
                                "type": "bulk_alert",
                                "from_user": from_user,
                                "sent_count": sent_count,
                                "limit": limit_hour,
                                "license_key": evt.license_key,
                                "ts": datetime.now(timezone.utc).isoformat(),
                            })
                        except Exception:
                            pass
            except Exception as ex:
                log.warning("outbound bulk detect failed: %s", ex)
    # ---------------------------------------------------------------------

    # ---- KARANTİNAYA OTOMATİK YAZ (spam/high_spam/virus/phish/blocked) ----
    # `mail_events` = tüm mail feed; `quarantine` = sadece yakalanan mailler
    # (frontend Karantina sayfası bu koleksiyondan besleniyor).
    verdict_lc = (doc.get("verdict") or "").lower()
    if verdict_lc in {"spam", "high_spam", "virus", "phish", "phishing", "blocked", "block"}:
        try:
            engines = doc.get("engines") or list((doc.get("scores") or {}).keys())
            q_doc = {
                "id": doc["id"],  # mail_events.id ile eşit (delete/release/report için)
                "owner_license_key": evt.license_key,
                "license_key": evt.license_key,
                "sender": doc.get("from_addr") or "",
                "recipient": doc.get("to_addr") or "",
                "subject": doc.get("subject") or "(konusuz)",
                "verdict": doc["verdict"],
                "total_score": doc.get("total_score") or 0,
                "engines": engines if isinstance(engines, list) else [],
                "scores": doc.get("scores") or {},
                "sender_ip": doc.get("sender_ip") or doc.get("client_ip") or "",
                "size_bytes": doc.get("size_bytes") or (doc.get("scores") or {}).get("size"),
                "received_at": doc.get("ts") or doc.get("ingested_at"),
                "ingested_at": doc.get("ingested_at"),
                "released": False,
                "score_normalized": doc.get("score_normalized", False),
                "thresholds_used": doc.get("thresholds_used"),
            }
            await db.quarantine.insert_one(q_doc)
        except Exception as ex:
            log.warning("quarantine insert failed for mail_events.id=%s: %s", doc.get("id"), ex)
    # ---------------------------------------------------------------------
    # Canlı akışa yayınla — Landing + Panel WebSocket dinleyicileri anında görsün
    try:
        from routes.maintenance import push_attack_event, _GEO_CC_NAME
        from routes.security_adv import _ip_to_country
        verdict = (doc.get("verdict") or "").lower()
        # Sadece kötü verdict'leri broadcast et (spam/virus/phish/blocked)
        if verdict in {"spam", "high_spam", "virus", "phish", "phishing", "block", "blocked"}:
            # client_ip önceliği: payload > header > request.client
            # Test IP (127.0.0.1) yerine payload IP'yi tercih et
            broadcast_ip = doc.get("client_ip") or sender_ip
            cc = _ip_to_country(broadcast_ip or "")
            if cc and cc != "LOCAL":
                await push_attack_event({
                    "type": "attack",
                    "country": cc,
                    "name": _GEO_CC_NAME.get(cc, cc),
                    "verdict": verdict,
                    "ip": broadcast_ip,
                    "from": doc.get("from_addr") or doc.get("from") or "",
                    "ts": doc.get("ts") or doc.get("ingested_at"),
                    "license_key": evt.license_key,
                })
    except Exception:
        pass  # WebSocket sorunu ingest'i bloklamasın
    # Ek olarak license'in son_seen timestamp'ini guncelle
    await db.licenses.update_one(
        {"license_key": evt.license_key},
        {"$set": {"last_event_at": doc["ingested_at"]},
         "$inc": {"total_events": 1}}
    )
    # Alert rules degerlendir (fire & forget)
    try:
        from routes.alerts import evaluate_and_fire
        import asyncio
        asyncio.create_task(evaluate_and_fire(evt.license_key, doc))
    except Exception:
        pass
    # IOC otomatik enforce (ingest-time: client_ip / body url'lerini IOC listesiyle kontrol)
    try:
        import asyncio
        asyncio.create_task(_ioc_enforce(doc))
    except Exception:
        pass
    # AI Batch Pre-generate: high_spam / virus verdictleri icin arkaplan LLM aciklama
    if doc.get("verdict") in ("high_spam", "virus"):
        try:
            import asyncio
            asyncio.create_task(_ai_prewarm(doc))
        except Exception:
            pass
    # AI Predict Score: her mail icin heuristic + cache (opsiyonel LLM ile hybrid)
    try:
        import asyncio
        asyncio.create_task(_ai_predict_bg(doc))
    except Exception:
        pass
    # Saldırı ve Toplu Mail alarmları (background)
    try:
        import asyncio
        asyncio.create_task(_check_attack_bulk_alerts(evt.license_key, doc))
    except Exception:
        pass
    return {"ok": True, "id": doc["id"]}


async def _check_attack_bulk_alerts(license_key: str, evt_doc: dict) -> None:
    """Panelden aç/kapa yapılabilen alarmları değerlendir:
    - Saldırı: 5 dakikada aynı sender_ip'den >= threshold olay
    - Toplu Mail: 1 saatte aynı from_addr'den >= threshold outbound mail
    Alarm halinde admin_email + slack + notifications_inbox'a düşer."""
    try:
        from server import _notify_settings, _send_email, _smart_from, _send_slack
    except Exception:
        return
    ns = await _notify_settings()
    now = datetime.now(timezone.utc)
    from datetime import timedelta as _td

    async def _record_alarm(kind: str, subj: str, body: str, meta: dict):
        # Cool-down: aynı kind + key son 30 dk içinde tetiklendiyse tekrarlama
        last = await db.settings.find_one({"_key": f"alarm_last_{kind}_{meta.get('cool_key','all')}"}, {"_id": 0})
        cool = 30 * 60
        if last and last.get("at"):
            try:
                last_at = datetime.fromisoformat(last["at"].replace("Z", "+00:00"))
                if (now - last_at).total_seconds() < cool:
                    return
            except Exception:
                pass
        await db.settings.update_one(
            {"_key": f"alarm_last_{kind}_{meta.get('cool_key','all')}"},
            {"$set": {"at": now.isoformat()}}, upsert=True,
        )
        await db.notifications_inbox.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind, "subject": subj, "body": body, "meta": meta,
            "license_key": license_key,
            "read": False, "created_at": now.isoformat(),
        })
        # E-posta
        if ns.get("email_enabled") and ns.get("admin_email"):
            try:
                await _send_email(ns["admin_email"], subj, body, _smart_from(ns))
            except Exception:
                pass
        # Slack
        if ns.get("slack_enabled") and ns.get("slack_webhook_url"):
            try:
                await _send_slack(ns["slack_webhook_url"], f"*{subj}*\n{body}")
            except Exception:
                pass

    # Saldırı kontrolü
    if ns.get("alert_on_attack", True):
        threshold = int(ns.get("attack_threshold_5min", 100) or 100)
        sender_ip = evt_doc.get("sender_ip") or evt_doc.get("client_ip")
        if sender_ip and sender_ip not in ("127.0.0.1", "::1"):
            since = (now - _td(minutes=5)).isoformat()
            count = await db.mail_events.count_documents({
                "license_key": license_key,
                "sender_ip": sender_ip,
                "ingested_at": {"$gte": since},
            })
            if count >= threshold:
                await _record_alarm(
                    "attack_alert",
                    f"🛡️ Saldırı Tespit Edildi · {sender_ip}",
                    f"Son 5 dakika içinde {sender_ip} IP'sinden {count} mail olayı tespit edildi (eşik: {threshold}).\n"
                    f"Lisans: {license_key}\n"
                    f"Aksiyon: IP'yi geo-block veya firewall'a ekleyin.",
                    {"sender_ip": sender_ip, "count": count, "threshold": threshold, "cool_key": sender_ip},
                )

    # Toplu mail kontrolü
    if ns.get("alert_on_bulk_mail", True):
        threshold = int(ns.get("bulk_mail_threshold_1h", 500) or 500)
        from_addr = (evt_doc.get("from_addr") or "").lower()
        if from_addr and "@" in from_addr:
            since = (now - _td(hours=1)).isoformat()
            count = await db.mail_events.count_documents({
                "license_key": license_key,
                "from_addr": {"$regex": f"^{re.escape(from_addr)}$", "$options": "i"},
                "ingested_at": {"$gte": since},
            })
            if count >= threshold:
                await _record_alarm(
                    "bulk_mail_alert",
                    f"📤 Toplu Mail Tespit Edildi · {from_addr}",
                    f"Son 1 saatte {from_addr} adresinden {count} giden mail tespit edildi (eşik: {threshold}).\n"
                    f"Lisans: {license_key}\n"
                    f"Muhtemel neden: hesap ele geçirildi veya bilinçli toplu gönderim.",
                    {"from_addr": from_addr, "count": count, "threshold": threshold, "cool_key": from_addr},
                )


@router.post("/simulate-alert")
async def simulate_attack_bulk_alert(payload: dict):
    """Test endpoint: simulate attack or bulk mail alert.
    payload: { kind: 'attack'|'bulk_mail', license_key?: str }
    Alarm zincirini (inbox + e-posta + Slack) gerçek verilerle tetikler."""
    kind = payload.get("kind", "attack")
    license_key = payload.get("license_key") or "TEST-LICENSE"
    if kind == "attack":
        fake_doc = {
            "sender_ip": "185.220.101.44",
            "client_ip": "185.220.101.44",
            "from_addr": "attacker@malicious.example",
            "license_key": license_key,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    else:
        fake_doc = {
            "sender_ip": "10.20.30.40",
            "from_addr": "compromised@yourdomain.com",
            "license_key": license_key,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    # Cool-down atlatmak için önce eski kayıtları sil
    from server import _notify_settings
    ns = await _notify_settings()
    now = datetime.now(timezone.utc)
    if kind == "attack":
        cool_key = fake_doc["sender_ip"]
        await db.settings.delete_one({"_key": f"alarm_last_attack_alert_{cool_key}"})
        # Test için 100+ event ekleyelim ki threshold aşılsın
        threshold = int(ns.get("attack_threshold_5min", 100) or 100)
        docs = []
        for i in range(threshold + 5):
            docs.append({
                "id": str(uuid.uuid4()),
                "license_key": license_key,
                "sender_ip": cool_key,
                "from_addr": fake_doc["from_addr"],
                "ingested_at": now.isoformat(),
                "ts": now.isoformat(),
                "simulated": True,
            })
        if docs:
            await db.mail_events.insert_many(docs)
    else:
        cool_key = fake_doc["from_addr"]
        await db.settings.delete_one({"_key": f"alarm_last_bulk_mail_alert_{cool_key}"})
        threshold = int(ns.get("bulk_mail_threshold_1h", 500) or 500)
        docs = []
        for i in range(threshold + 5):
            docs.append({
                "id": str(uuid.uuid4()),
                "license_key": license_key,
                "sender_ip": fake_doc["sender_ip"],
                "from_addr": cool_key,
                "ingested_at": now.isoformat(),
                "ts": now.isoformat(),
                "simulated": True,
            })
        if docs:
            await db.mail_events.insert_many(docs)
    # Şimdi alarm kontrolünü tetikle
    await _check_attack_bulk_alerts(license_key, fake_doc)
    return {
        "ok": True,
        "kind": kind,
        "message": f"{'Saldırı' if kind == 'attack' else 'Toplu mail'} alarmı simüle edildi",
        "hint": "Bildirim kutusuna, admin e-postasına ve Slack'e gönderildi (aktifse)",
    }



async def _ai_predict_bg(doc: dict) -> None:
    """Hizli AI predict — heuristic sonucu event uzerine yazilir.
    Config'de ai_auto_quarantine aktifse threshold uzeri predicted skorlar otomatik override eder."""
    try:
        from routes.mailscanner import PredictIn, _heuristic_score, _cfg
        p = PredictIn(
            from_addr=doc.get("from_addr", ""),
            to_addr=doc.get("to_addr", ""),
            subject=doc.get("subject", ""),
            body_preview=doc.get("body_preview", ""),
            client_ip=doc.get("client_ip", ""),
        )
        score, reasons = await _heuristic_score(p)
        pred_verdict = "clean"
        if score >= 10: pred_verdict = "high_spam"
        elif score >= 5: pred_verdict = "spam"
        elif score >= 3: pred_verdict = "suspicious"
        update = {"predicted_score": score, "predicted_verdict": pred_verdict,
                  "predicted_reasons": reasons}
        # AI Auto-Action config check
        cfg = await _cfg(doc.get("license_key", ""))
        auto = cfg.get("ai_auto_quarantine") or {}
        if (auto.get("enabled") and score >= float(auto.get("threshold", 6.0))
                and doc.get("verdict") in ("clean", None, "")):
            action = auto.get("action", "quarantine")
            override = {"quarantine": "spam", "tag": "spam", "reject": "blocked"}.get(action, "spam")
            update["verdict"] = override
            update["ai_override"] = {"reason": "predict_auto_action",
                                      "orig_verdict": doc.get("verdict"),
                                      "score": score, "action": action}
        await db.mail_events.update_one({"id": doc["id"]}, {"$set": update})
    except Exception:
        return


async def _ioc_enforce(doc: dict) -> None:
    """Ingest sonrasi client_ip veya body url'lerini IOC listesiyle kontrol et.
    Eslesirse verdict'i override et."""
    try:
        ip = doc.get("client_ip") or doc.get("server_ip")
        if ip:
            ioc = await db.threat_iocs.find_one({"type": "ip", "value": ip}, {"_id": 0})
            if ioc:
                await db.mail_events.update_one(
                    {"id": doc["id"]},
                    {"$set": {
                        "verdict": "blocked" if ioc.get("tag") in ("malware", "c2", "ransomware") else "high_spam",
                        "ioc_hit": {"type": "ip", "value": ip, "tag": ioc.get("tag"),
                                     "confidence": ioc.get("confidence"),
                                     "source": ioc.get("source")},
                    }},
                )
                return
        import re
        urls = re.findall(r"https?://[^\s<>\"']+", (doc.get("body_preview") or "")[:2000])
        for url in urls[:20]:
            ioc = await db.threat_iocs.find_one({"type": "url", "value": url}, {"_id": 0})
            if ioc:
                await db.mail_events.update_one(
                    {"id": doc["id"]},
                    {"$set": {
                        "verdict": "blocked",
                        "ioc_hit": {"type": "url", "value": url, "tag": ioc.get("tag"),
                                     "confidence": ioc.get("confidence"),
                                     "source": ioc.get("source")},
                    }},
                )
                return
    except Exception:
        return


async def _ai_prewarm(doc: dict) -> None:
    """Yuksek riskli mailler icin LLM aciklamayi onceden uret + cache. UI ilk tikta hazir olsun."""
    try:
        import os, uuid as _uuid
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            return
        sender = doc.get("from_addr") or ""
        subject = doc.get("subject") or ""
        cache_key = f"{sender}|{subject}|{doc.get('verdict')}|{doc.get('total_score')}"[:200]
        existing = await db.ai_explanations.find_one({"key": cache_key}, {"_id": 0, "text": 1})
        if existing and existing.get("text"):
            return
        prompt = (
            f"Bir spam filtresi bir e-postayi karantinaya aldi. Kullanicilara 2-3 cumleyle "
            f"anlasilir Turkce olarak neden spam/tehlikeli oldugunu acikla.\n"
            f"Gonderen: {sender}\nKonu: {subject}\n"
            f"Verdict: {doc.get('verdict')}\nSkor: {doc.get('total_score')}\n"
            f"Ilk cumle: mailin ne oldugunu ozet.\nIkinci cumle: kullanici acmali mi.\n"
            f"Emoji, madde isareti, teknik jargon kullanma."
        )
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"ai-prewarm-{_uuid.uuid4()}",
            system_message="Sen bir e-posta guvenlik uzmanisin. Sade, arkadas canlisi Turkce ile spam maillerini aciklarsin.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        r = await chat.send_message(UserMessage(text=prompt))
        text = (r or "").strip()
        if not text:
            return
        await db.ai_explanations.update_one(
            {"key": cache_key},
            {"$set": {
                "key": cache_key, "text": text, "sender": sender, "subject": subject,
                "verdict": doc.get("verdict"), "score": doc.get("total_score"),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "prewarm",
            }},
            upsert=True,
        )
    except Exception:
        return


@router.post("/ingest-batch")
async def ingest_batch(events: list[MailEvent]):
    """Milter offline-cache burst upload icin (network flap sonrasi)."""
    if not events:
        return {"ok": True, "inserted": 0}
    lic_keys = {e.license_key for e in events}
    if len(lic_keys) > 1:
        raise HTTPException(400, "Batch icinde tek license_key olmali")
    key = lic_keys.pop()
    await _validate_license(key)
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for e in events:
        d = e.model_dump()
        d["id"] = str(uuid.uuid4())
        d["ts"] = d.get("ts") or now
        d["ingested_at"] = now
        docs.append(d)
    await db.mail_events.insert_many(docs)
    await db.licenses.update_one(
        {"license_key": key},
        {"$set": {"last_event_at": now}, "$inc": {"total_events": len(docs)}}
    )
    return {"ok": True, "inserted": len(docs)}


class ActionComplete(BaseModel):
    result: Optional[str] = None
    ok: bool = True
    output: Optional[str] = None


@router.post("/pending-actions/{action_id}/complete")
async def complete_pending_action(action_id: str, payload: ActionComplete,
                                    license_key: str = Query(..., min_length=8)):
    """Bayi plugin tarafından action tamamlandığında çağrılır. Master paneli
    Bildirimler drawer'ında real-time toast görür."""
    action = await db.pending_quarantine_actions.find_one(
        {"id": action_id, "license_key": license_key},
        {"_id": 0},
    )
    if not action:
        raise HTTPException(404, "Action bulunamadı")
    now = datetime.now(timezone.utc).isoformat()
    await db.pending_quarantine_actions.update_one(
        {"id": action_id},
        {"$set": {
            "completed_at": now, "result": payload.result or ("ok" if payload.ok else "fail"),
            "ok": payload.ok, "output": (payload.output or "")[:500],
        }},
    )
    # Master notifications için toast ekle
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0, "email": 1})
    label = (lic or {}).get("email") or license_key[:20]
    await db.master_alerts.insert_one({
        "id": str(uuid.uuid4()),
        "type": "plugin_update_complete",
        "severity": "info" if payload.ok else "warning",
        "license_key": license_key,
        "action_id": action_id,
        "action_type": action.get("action_type"),
        "message": (
            f"{label} plugin güncellemesi {'başarıyla tamamlandı ✓' if payload.ok else 'BAŞARISIZ'}"
        ),
        "seen": False,
        "created_at": now,
    })
    return {"ok": True, "completed_at": now}


# ------- Kaydedilmiş filtre setleri (per-license) -------------------------
class SavedFilter(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    module: str = Field(..., pattern="^(quarantine|live_events)$")
    filters: dict


@router.get("/saved-filters")
async def list_saved_filters(request: Request, license_key: Optional[str] = None,
                              module: Optional[str] = None):
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    owner = scope["owner_license_key"] if not scope["is_master"] else (license_key or "__master__")
    q = {"owner": owner}
    if module: q["module"] = module
    items = await db.saved_filters.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": items}


@router.post("/saved-filters")
async def create_saved_filter(payload: SavedFilter, request: Request,
                               license_key: Optional[str] = None):
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    if not scope["is_master"] and scope["owner_license_key"] in ("", "__none__"):
        raise HTTPException(403, "Geçerli lisans gerekli")
    owner = scope["owner_license_key"] if not scope["is_master"] else (license_key or "__master__")
    doc = {
        "id": str(uuid.uuid4()),
        "owner": owner,
        "name": payload.name,
        "module": payload.module,
        "filters": payload.filters,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.saved_filters.insert_one(doc)
    return {"ok": True, "id": doc["id"], "item": {k: v for k, v in doc.items() if k != "_id"}}


@router.post("/saved-filters/{sid}/delete")
async def delete_saved_filter(sid: str, request: Request, license_key: Optional[str] = None):
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    owner = scope["owner_license_key"] if not scope["is_master"] else (license_key or "__master__")
    r = await db.saved_filters.delete_one({"id": sid, "owner": owner})
    if r.deleted_count == 0:
        raise HTTPException(404, "Filtre bulunamadı")
    return {"ok": True}


@router.post("/backfill-quarantine")
async def backfill_quarantine(request: Request, license_key: Optional[str] = None,
                                dry_run: bool = False, limit: int = 50000):
    """`mail_events` içindeki spam/high_spam/virus/phish/blocked kayıtları
    `quarantine` koleksiyonuna aktar. Idempotent — aynı `id` varsa atlar.

    Karantina sayfası boş görünüyorsa (ör: ingest'ten önce sadece mail_events
    yazılıyordu) bu endpoint ile geriye dönük doldurulur.

    - Master (header/cookie) → tüm bayilerinki (opsiyonel `license_key` ile drill-down)
    - Bayi → sadece kendi kayıtları
    - `dry_run=true` → sayım yapar, insert etmez"""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    if not scope["is_master"] and scope["owner_license_key"] in ("", "__none__"):
        raise HTTPException(403, "Geçerli lisans veya master yetkisi gerekli")

    q: dict = {"verdict": {"$in": ["spam", "high_spam", "virus", "phish", "phishing", "blocked", "block"]}}
    if not scope["is_master"]:
        q["license_key"] = scope["owner_license_key"]
    elif scope["owner_license_key"]:
        q["license_key"] = scope["owner_license_key"]

    # Zaten quarantine'da olan id'leri topla (dup önle)
    existing_ids: set[str] = set()
    async for x in db.quarantine.find({}, {"_id": 0, "id": 1}).limit(200000):
        if x.get("id"):
            existing_ids.add(x["id"])

    scanned = 0
    inserted = 0
    to_insert: list[dict] = []
    async for e in db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit):
        scanned += 1
        if e.get("id") in existing_ids:
            continue
        engines = e.get("engines") or list((e.get("scores") or {}).keys())
        to_insert.append({
            "id": e["id"],
            "owner_license_key": e.get("license_key") or "",
            "license_key": e.get("license_key") or "",
            "sender": e.get("from_addr") or "",
            "recipient": e.get("to_addr") or "",
            "subject": e.get("subject") or "(konusuz)",
            "verdict": e.get("verdict"),
            "total_score": e.get("total_score") or 0,
            "engines": engines if isinstance(engines, list) else [],
            "scores": e.get("scores") or {},
            "sender_ip": e.get("sender_ip") or e.get("client_ip") or "",
            "size_bytes": e.get("size_bytes") or (e.get("scores") or {}).get("size"),
            "received_at": e.get("ts") or e.get("ingested_at"),
            "ingested_at": e.get("ingested_at"),
            "released": False,
            "score_normalized": e.get("score_normalized", False),
            "backfilled": True,
        })
        if len(to_insert) >= 500 and not dry_run:
            r = await db.quarantine.insert_many(to_insert, ordered=False)
            inserted += len(r.inserted_ids)
            to_insert = []
    if to_insert and not dry_run:
        r = await db.quarantine.insert_many(to_insert, ordered=False)
        inserted += len(r.inserted_ids)
    elif to_insert and dry_run:
        inserted = len(to_insert)  # olası ekleme sayısı
    return {
        "ok": True, "scanned": scanned, "inserted": inserted,
        "already_in_quarantine": len(existing_ids),
        "dry_run": dry_run,
        "scope": {"is_master": scope["is_master"], "owner": scope["owner_license_key"]},
    }


@router.post("/rescore")
async def rescore_events(request: Request, license_key: Optional[str] = None,
                          dry_run: bool = False):
    """Mevcut mail_events kayıtlarında `total_score`'u `scores.spamassassin`
    üzerinden yeniden hesapla ve verdict'i standart SA eşikleriyle düzelt.

    Kullanım: Plugin `total_score` alanına yanlış değer yollamış (ör: motor
    kural numaralarını toplamış) → panelde 27, 81 gibi anormal skorlar +
    tüm mailler high_spam olarak görünüyorsa.

    - Master (header/cookie) → tüm bayilerinki (opsiyonel `license_key` ile drill-down)
    - Bayi lisansı → sadece kendi kayıtları
    - `dry_run=true` → sadece kaç kayıt etkileneceğini sayar, değiştirmez"""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    if not scope["is_master"] and scope["owner_license_key"] == "__none__":
        raise HTTPException(403, "Geçerli lisans veya master yetkisi gerekli")

    q: dict = {}
    if not scope["is_master"]:
        q["license_key"] = scope["owner_license_key"]
    elif scope["owner_license_key"]:
        q["license_key"] = scope["owner_license_key"]

    updated = 0
    fixed_verdicts = 0
    scanned = 0
    async for ev in db.mail_events.find(q, {"_id": 0, "id": 1, "scores": 1, "total_score": 1, "verdict": 1}).limit(50000):
        scanned += 1
        try:
            sa = (ev.get("scores") or {}).get("spamassassin")
            sa = float(sa) if sa is not None else None
        except (TypeError, ValueError):
            sa = None
        if sa is None:
            continue
        cur_total = ev.get("total_score") or 0
        cur_verdict = (ev.get("verdict") or "").lower()
        target_verdict = cur_verdict
        if cur_verdict not in ("virus", "phish", "phishing", "blocked"):
            if sa >= 10: target_verdict = "high_spam"
            elif sa >= 5: target_verdict = "spam"
            else: target_verdict = "clean"
        if abs(float(cur_total) - sa) > 0.01 or target_verdict != cur_verdict:
            updated += 1
            if target_verdict != cur_verdict:
                fixed_verdicts += 1
            if not dry_run:
                await db.mail_events.update_one(
                    {"id": ev["id"]},
                    {"$set": {
                        "total_score": sa,
                        "verdict": target_verdict,
                        "score_normalized": True,
                        "score_source": "spamassassin",
                        "total_score_original": cur_total,
                    }},
                )
    return {
        "ok": True, "scanned": scanned,
        "updated": updated, "fixed_verdicts": fixed_verdicts,
        "dry_run": dry_run,
        "scope": {"is_master": scope["is_master"], "owner": scope["owner_license_key"]},
    }


# ------- Threshold config (per-license) ------------------------------------
class ThresholdIn(BaseModel):
    spam_threshold: float = Field(default=5.0, ge=0.0, le=30.0)
    high_spam_threshold: float = Field(default=10.0, ge=0.0, le=30.0)


@router.get("/thresholds")
async def get_thresholds(request: Request, license_key: Optional[str] = None):
    """Her lisans için spam/high_spam skor eşiklerini oku. ConfigServer paritesi.
    Master için: `?license_key=X` ile herhangi bayinin eşiğini görebilir.
    Bayi için: kendi eşiğini görür."""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    if not scope["is_master"] and scope["owner_license_key"] in ("", "__none__"):
        raise HTTPException(403, "Geçerli lisans veya master yetkisi gerekli")
    target = scope["owner_license_key"] if not scope["is_master"] else (scope["owner_license_key"] or license_key or "")
    if not target and scope["is_master"]:
        # Master global default'ları döner
        return {"spam_threshold": 5.0, "high_spam_threshold": 10.0, "scope": "master_default"}
    lic = await db.licenses.find_one(
        {"license_key": target},
        {"_id": 0, "spam_threshold": 1, "high_spam_threshold": 1},
    ) or {}
    return {
        "spam_threshold": float(lic.get("spam_threshold") or 5.0),
        "high_spam_threshold": float(lic.get("high_spam_threshold") or 10.0),
        "license_key": target,
    }


@router.post("/thresholds")
async def set_thresholds(payload: ThresholdIn, request: Request,
                          license_key: Optional[str] = None):
    """Eşikleri güncelle. Master herhangi bayinin, bayi sadece kendisininki.
    high_spam_threshold >= spam_threshold olmalı."""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    if not scope["is_master"] and scope["owner_license_key"] in ("", "__none__"):
        raise HTTPException(403, "Geçerli lisans veya master yetkisi gerekli")
    if payload.high_spam_threshold < payload.spam_threshold:
        raise HTTPException(400, "high_spam_threshold ≥ spam_threshold olmalı")
    target = (
        scope["owner_license_key"]
        if not scope["is_master"]
        else (scope["owner_license_key"] or license_key or "")
    )
    if not target:
        raise HTTPException(400, "Hedef lisans belirtilmedi (master için ?license_key gerekli)")
    r = await db.licenses.update_one(
        {"license_key": target},
        {"$set": {
            "spam_threshold": payload.spam_threshold,
            "high_spam_threshold": payload.high_spam_threshold,
            "thresholds_updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Lisans bulunamadı")
    return {"ok": True, "license_key": target,
            "spam_threshold": payload.spam_threshold,
            "high_spam_threshold": payload.high_spam_threshold}


# ------- Plugin health metrics (skor normalize sayacı) --------------------
@router.get("/health/normalization")
async def normalization_health(request: Request, license_key: Optional[str] = None,
                                hours: int = 24):
    """Son N saatte kaç mail'in `score_normalized=True` olduğunu döner.
    Normalize sayısı >100 ise plugin'de bug var demektir → master'a uyarı.

    Alarm mantığı arka planda `_run_plugin_health_check` ile periyodik olarak
    çalışır; bu endpoint dashboard/inceleme içindir."""
    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key, db)
    q: dict = {}
    if not scope["is_master"]:
        if scope["owner_license_key"] in ("", "__none__"):
            raise HTTPException(403, "Geçerli lisans gerekli")
        q["license_key"] = scope["owner_license_key"]
    elif scope["owner_license_key"]:
        q["license_key"] = scope["owner_license_key"]
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    total = await db.mail_events.count_documents({**q, "ingested_at": {"$gte": since}})
    normalized = await db.mail_events.count_documents({**q, "ingested_at": {"$gte": since}, "score_normalized": True})
    clamped = await db.mail_events.count_documents({**q, "ingested_at": {"$gte": since}, "score_clamped": True})
    ratio = (normalized / total * 100) if total else 0
    status = "healthy"
    if normalized > 100:
        status = "critical"
    elif ratio > 20 and total >= 20:
        status = "warning"
    return {
        "total": total, "normalized": normalized, "clamped": clamped,
        "normalized_ratio": round(ratio, 1),
        "status": status, "hours": hours,
        "scope": {"is_master": scope["is_master"], "owner": scope["owner_license_key"]},
    }


@router.get("")
async def list_events(
    license_key: str = Query(..., min_length=8),
    limit: int = Query(50, ge=1, le=5000),
    verdict: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    scope_user: Optional[str] = Query(None),
    from_search: Optional[str] = Query(None, description="Gönderici içerir"),
    to_search: Optional[str] = Query(None, description="Alıcı içerir"),
    subject_search: Optional[str] = Query(None, description="Konu içerir"),
    ip_search: Optional[str] = Query(None, description="Gönderici IP içerir"),
    min_score: Optional[float] = Query(None, description="Toplam skor ≥"),
    max_score: Optional[float] = Query(None, description="Toplam skor ≤"),
    hours: Optional[int] = Query(None, ge=1, le=8760, description="Son N saat"),
):
    """Panelden cagirilir. Sadece verilen license_key'e ait eventleri doner.
    scope_user verilirse to_addr veya from_addr'ta o cPanel kullanicisi olan mailleri filtreler.
    Master anahtarı ise KENDİ altyapısındaki trafiği görür:
      - Kendi lisansıyla gelen (master WHM plugin) eventler
      - AUTO-* lisansı (ns1/ns2.gokyuzuhosting.com bazlı otomatik lisanslı) eventler
      Bayilerin trafiği MASTER'a görünmez (kendi kapsamlarında kalır).

    Ek filtreler (v39): from_search / to_search / subject_search / ip_search
    (regex contains), min_score / max_score (skor aralığı), hours (son N saat).
    """
    await _validate_license(license_key)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    is_master = master_key and license_key == master_key
    if is_master:
        # Master: kendi altyapısındaki tüm license_key'ler (master + AUTO-*)
        q: dict[str, Any] = {
            "$or": [
                {"license_key": master_key},
                {"license_key": {"$regex": "^AUTO-"}},
            ]
        }
    else:
        q = {"license_key": license_key}
    if verdict:
        q["verdict"] = verdict
    if since:
        q["ts"] = {"$gte": since}
    if hours and not since:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        q["ts"] = {"$gte": cutoff}
    # Skor aralığı
    if min_score is not None or max_score is not None:
        score_q: dict = {}
        if min_score is not None: score_q["$gte"] = min_score
        if max_score is not None: score_q["$lte"] = max_score
        q["total_score"] = score_q
    # Detaylı arama — regex $and ile birleşir
    import re as _re
    contains_filters: list[dict] = []
    if from_search:
        contains_filters.append({"from_addr": {"$regex": _re.escape(from_search), "$options": "i"}})
    if to_search:
        contains_filters.append({"to_addr": {"$regex": _re.escape(to_search), "$options": "i"}})
    if subject_search:
        contains_filters.append({"subject": {"$regex": _re.escape(subject_search), "$options": "i"}})
    if ip_search:
        contains_filters.append({"$or": [
            {"sender_ip":   {"$regex": _re.escape(ip_search), "$options": "i"}},
            {"client_ip":   {"$regex": _re.escape(ip_search), "$options": "i"}},
            {"server_ip":   {"$regex": _re.escape(ip_search), "$options": "i"}},
        ]})
    if contains_filters:
        base_ands: list[dict] = []
        if "$or" in q and "$and" not in q:
            base_ands = [{"$or": q.pop("$or")}]
        base_ands.extend(contains_filters)
        base_ands.extend([{k: v} for k, v in q.items() if k != "$and"])
        q = {"$and": base_ands}
    if scope_user:
        safe = _re.escape(scope_user)
        scope_or = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
        if "$and" in q:
            q["$and"].append({"$or": scope_or})
        elif "$or" in q:
            q = {"$and": [{"$or": q["$or"]}, {"$or": scope_or}]}
            if verdict: q["$and"].append({"verdict": verdict})
            if since:   q["$and"].append({"ts": {"$gte": since}})
        else:
            q["$or"] = scope_or
    cursor = db.mail_events.find(q, {"_id": 0}).sort([("ts", -1), ("ingested_at", -1)]).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "count": len(items), "limit_applied": limit}


@router.get("/summary")
async def events_summary(
    license_key: str = Query(..., min_length=8),
    scope_user: Optional[str] = Query(None),
):
    """Ozet istatistik - toplam + verdict breakdown.
    Master anahtarı ise kendi altyapısı (master + AUTO-*) — bayiler hariç.
    """
    await _validate_license(license_key)
    master_key = os.environ.get("MASTER_LICENSE_KEY", "")
    is_master = master_key and license_key == master_key
    if is_master:
        match: dict[str, Any] = {
            "$or": [
                {"license_key": master_key},
                {"license_key": {"$regex": "^AUTO-"}},
            ]
        }
    else:
        match = {"license_key": license_key}
    if scope_user:
        import re
        safe = re.escape(scope_user)
        scope_or = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
        if "$or" in match:
            match = {"$and": [{"$or": match["$or"]}, {"$or": scope_or}]}
        else:
            match["$or"] = scope_or
    total = await db.mail_events.count_documents(match)
    pipeline = [{"$match": match}, {"$group": {"_id": "$verdict", "count": {"$sum": 1}}}]
    breakdown = {}
    async for row in db.mail_events.aggregate(pipeline):
        breakdown[row["_id"]] = row["count"]
    # Son event zamanı
    last_event_at = None
    if is_master:
        last = await db.mail_events.find(match, {"_id": 0, "ingested_at": 1, "ts": 1}).sort("ingested_at", -1).limit(1).to_list(1)
        if last:
            last_event_at = last[0].get("ingested_at") or last[0].get("ts")
    else:
        lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0, "last_event_at": 1})
        last_event_at = (lic or {}).get("last_event_at")
    return {
        "total": total,
        "by_verdict": breakdown,
        "last_event_at": last_event_at,
    }


@router.get("/by-server")
async def events_by_server(license_key: str = Query(..., min_length=8)):
    """Multi-server rozetleri icin: distinct server_hostname + count + last_seen."""
    await _validate_license(license_key)
    pipeline = [
        {"$match": {"license_key": license_key, "server_hostname": {"$ne": None}}},
        {"$group": {
            "_id": "$server_hostname",
            "count": {"$sum": 1},
            "last_seen": {"$max": "$ts"},
            "spam_count": {"$sum": {"$cond": [{"$in": ["$verdict", ["spam", "high_spam", "virus"]]}, 1, 0]}},
        }},
        {"$sort": {"count": -1}},
    ]
    items = []
    async for row in db.mail_events.aggregate(pipeline):
        items.append({
            "hostname": row["_id"],
            "count": row["count"],
            "last_seen": row["last_seen"],
            "spam_count": row.get("spam_count", 0),
        })
    return {"items": items, "total_servers": len(items)}



@router.post("/test-ingest")
async def test_ingest(license_key: str = Query(..., min_length=8)):
    """Curl ile tetiklenir. 5 ornek event yaratir, panele hemen dusmesi icin."""
    await _validate_license(license_key)
    import random
    samples = [
        {"from_addr": "spammer@junkmail.example", "to_addr": "user@your.tld",
         "subject": "*** ACİL *** Nijeryalı prensin yardıma ihtiyacı var", "verdict": "high_spam",
         "action": "quarantine", "total_score": 12.4, "scores": {"spamassassin": 9.2, "ai": 3.2},
         "client_ip": "45.32.11.7",
         "headers_full": ("Return-Path: <spammer@junkmail.example>\n"
                          "Received: from junkmail.example (unknown [45.32.11.7])\n"
                          "  by mail.your.tld with ESMTP; Wed, 31 Jul 2026 10:14:22 +0000\n"
                          "From: \"Prens Adamu\" <spammer@junkmail.example>\n"
                          "To: user@your.tld\n"
                          "Subject: *** ACİL *** Nijeryalı prensin yardıma ihtiyacı var\n"
                          "X-Originating-IP: 45.32.11.7\n"
                          "X-Spam-Level: *********\n"
                          "X-Spam-Score: 12.4\n"),
         "body_preview": ("Değerli Dost,\n\nSize hesabınıza bırakılmış 45,000,000 USD'lik büyük bir "
                          "meblağdan bahsetmek üzere yazıyorum. Bu acil transferi talep etmek için "
                          "lütfen banka bilgilerinizle birlikte 500$ işlem ücretini ivedilikle gönderin.\n\n"
                          "Allah'ın rahmeti üzerinize olsun.\nPrens Adamu"),
         "attachments": [{"filename": "talep_formu.pdf", "content_type": "application/pdf",
                          "size": 218450, "sha256": "3f4a…"}]},
        {"from_addr": "newsletter@shop.example", "to_addr": "user@your.tld",
         "subject": "Haftalık indirim bülteni · %30'a varan fırsatlar", "verdict": "clean",
         "action": "accept", "total_score": 1.2, "scores": {"spamassassin": 1.2},
         "client_ip": "185.42.11.203",
         "headers_full": ("From: Shop Newsletter <newsletter@shop.example>\n"
                          "To: user@your.tld\n"
                          "Subject: =?UTF-8?B?SGFmdGFsxLFrIGluZGlyaW0gYsO8bHRlbmk=?=\n"
                          "X-Originating-IP: 185.42.11.203\n"),
         "body_preview": "Bu hafta %30'a varan indirimler başladı!\nÜrünlerimizi görmek için tıklayın.",
         "body_html": "<html><body style='font-family:sans-serif;'><h2>Haftalık İndirim</h2><p>%30'a varan indirimler!</p></body></html>"},
        {"from_addr": "phish@bank-fake.example", "to_addr": "user@your.tld",
         "subject": "Hesabınızı doğrulayın · kimlik güncelleme (ACİL)", "verdict": "spam",
         "action": "quarantine", "total_score": 7.8, "scores": {"spamassassin": 5.1, "ai": 2.7},
         "client_ip": "190.211.45.22",
         "headers_full": ("From: <security@bank-fake.example>\n"
                          "Reply-To: <different@evil.example>\n"
                          "Subject: Hesabınızı doğrulayın\n"
                          "X-Originating-IP: 190.211.45.22\n"),
         "body_preview": ("Sayın müşteri,\n\nHesabınızın güvenliği için lütfen aşağıdaki linke tıklayarak "
                          "kimlik bilgilerinizi güncelleyin: http://bank-fake.example/verify?token=xyz\n\n"
                          "24 saat içinde işlem yapmazsanız hesabınız askıya alınacaktır."),
         "attachments": []},
        {"from_addr": "virus@bad.example", "to_addr": "user@your.tld",
         "subject": "Fatura_1023.doc.exe", "verdict": "virus",
         "action": "reject", "total_score": 20.0, "scores": {"clamav": 15.0, "spamassassin": 5.0},
         "client_ip": "218.94.55.101",
         "headers_full": "From: virus@bad.example\nSubject: Fatura_1023.doc.exe\nX-Originating-IP: 218.94.55.101\n",
         "body_preview": "Geçen ayın faturası ektedir. Lütfen ekli dosyayı inceleyin.",
         "attachments": [{"filename": "Fatura_1023.doc.exe", "content_type": "application/octet-stream",
                          "size": 82340, "sha256": "e10a…", "malware": "Trojan.Generic.KX-2842"}]},
        {"from_addr": "friend@known.example", "to_addr": "user@your.tld",
         "subject": "Bugün kahve içelim mi? ☕", "verdict": "clean",
         "action": "accept", "total_score": 0.5, "scores": {"spamassassin": 0.5},
         "client_ip": "78.186.42.19",
         "headers_full": "From: friend@known.example\nSubject: Kahve\nX-Originating-IP: 78.186.42.19\n",
         "body_preview": "Selam! Yarın 15:00'de eski yerimizde buluşalım mı? Konuşacak çok şey var :)"},
    ]
    now = datetime.now(timezone.utc)
    docs = []
    for i, s in enumerate(samples):
        d = {**s, "license_key": license_key,
             "server_ip": "89.19.15.58", "server_hostname": "ns1.gokyuzuhosting.com",
             "id": str(uuid.uuid4()),
             "sender_ip": s.get("client_ip"),
             "ts": now.isoformat(),
             "ingested_at": now.isoformat()}
        docs.append(d)
    await db.mail_events.insert_many(docs)
    await db.licenses.update_one(
        {"license_key": license_key},
        {"$set": {"last_event_at": now.isoformat()}, "$inc": {"total_events": len(docs)}}
    )
    return {"ok": True, "inserted": len(docs),
            "message": "5 ornek event olusturuldu. Panelde canli event akisinda gorulmelidir."}


@router.post("/{event_id}/mark-spam")
async def mark_event_spam(event_id: str, license_key: str = Query(..., min_length=8)):
    """User marks a mail as spam. Updates the event, adds sender to blacklist,
    queues a sa-learn report action for the WHM daemon to consume."""
    await _validate_license(license_key)
    evt = await db.mail_events.find_one({"id": event_id, "license_key": license_key}, {"_id": 0})
    if not evt:
        raise HTTPException(404, "Event bulunamadi")
    # Update the event verdict
    await db.mail_events.update_one(
        {"id": event_id},
        {"$set": {"verdict": "high_spam", "marked_spam_at": datetime.now(timezone.utc).isoformat(),
                  "marked_by": "user"}},
    )
    # Add sender to blacklist
    if evt.get("from_addr"):
        await db.lists.update_one(
            {"kind": "blacklist", "value": evt["from_addr"], "license_key": license_key},
            {"$set": {"kind": "blacklist", "value": evt["from_addr"], "type": "email",
                      "reason": f"Marked spam by user (event {event_id[:8]})",
                      "license_key": license_key, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    # Queue report_spam action for the daemon (mirrors quarantine-action flow)
    action_doc = {
        "id": str(uuid.uuid4()),
        "license_key": license_key,
        "event_id": event_id,
        "exim_mid": evt.get("exim_mid"),
        "action": "report_spam",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quarantine_actions.insert_one(action_doc)
    return {"ok": True, "marked": True, "blacklisted": evt.get("from_addr")}


# --- Quarantine Sync ---
# Kullanici panelden bir mail'i karantinaya alma / silme / release isterse
# ilgili sunucudaki logtail daemon'a job kuyrugu yazariz. Sunucudaki daemon
# short-poll ile pending action listesini alir, sunucu spool'unda gercek
# aksiyon uygular ve action_completed = True'yi geri raporlar.

class QuarantineActionReq(BaseModel):
    license_key: str
    event_id: str
    action: str = Field(..., pattern="^(delete|release|report_spam)$")


@router.post("/quarantine-action")
async def request_quarantine_action(req: QuarantineActionReq):
    """Panel -> sunucu: karantina aksiyon talebi kuyruga alinir."""
    await _validate_license(req.license_key)
    evt = await db.mail_events.find_one(
        {"license_key": req.license_key, "id": req.event_id}, {"_id": 0}
    )
    if not evt:
        raise HTTPException(404, "Event bulunamadi")
    action_id = str(uuid.uuid4())
    await db.pending_quarantine_actions.insert_one({
        "id": action_id,
        "license_key": req.license_key,
        "event_id": req.event_id,
        "action": req.action,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "result": None,
    })
    return {"ok": True, "action_id": action_id, "queued": True}



@router.get("/export")
async def export_events(request: Request,
                        license_key: Optional[str] = None,
                        format: str = Query("csv", pattern="^(csv|json)$"),
                        module: str = Query("live_events", pattern="^(live_events|quarantine)$"),
                        limit: int = Query(5000, ge=1, le=50000),
                        verdict: Optional[str] = None,
                        from_search: Optional[str] = None,
                        to_search: Optional[str] = None,
                        subject_search: Optional[str] = None,
                        ip_search: Optional[str] = None,
                        min_score: Optional[float] = None,
                        max_score: Optional[float] = None,
                        hours: Optional[int] = None):
    """Filtrelenmiş sonuçları CSV veya JSON olarak indir."""
    from fastapi.responses import StreamingResponse
    from tenant import resolve_tenant_scope
    import csv, io, json as _json
    scope = await resolve_tenant_scope(request, license_key, db)
    q: dict = {}
    if module == "quarantine":
        coll = db.quarantine
        if not scope["is_master"]:
            q["owner_license_key"] = scope["owner_license_key"] or "__none__"
        elif scope["owner_license_key"]:
            q["owner_license_key"] = scope["owner_license_key"]
        fields = ["received_at", "sender", "recipient", "subject", "verdict",
                  "total_score", "sender_ip", "size_bytes", "owner_license_key"]
    else:
        coll = db.mail_events
        if not scope["is_master"]:
            q["license_key"] = scope["owner_license_key"] or "__none__"
        elif scope["owner_license_key"]:
            q["license_key"] = scope["owner_license_key"]
        fields = ["ts", "from_addr", "to_addr", "subject", "verdict",
                  "total_score", "sender_ip", "license_key"]
    if verdict: q["verdict"] = verdict
    if hours:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        q["ingested_at" if module == "quarantine" else "ts"] = {"$gte": cutoff}
    if min_score is not None or max_score is not None:
        s: dict = {}
        if min_score is not None: s["$gte"] = min_score
        if max_score is not None: s["$lte"] = max_score
        q["total_score"] = s
    import re as _re
    contains: list[dict] = []
    if from_search: contains.append({("sender" if module == "quarantine" else "from_addr"): {"$regex": _re.escape(from_search), "$options": "i"}})
    if to_search: contains.append({("recipient" if module == "quarantine" else "to_addr"): {"$regex": _re.escape(to_search), "$options": "i"}})
    if subject_search: contains.append({"subject": {"$regex": _re.escape(subject_search), "$options": "i"}})
    if ip_search: contains.append({"sender_ip": {"$regex": _re.escape(ip_search), "$options": "i"}})
    if contains:
        base = [{k: v} for k, v in q.items()]
        q = {"$and": base + contains}
    rows = await coll.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit).to_list(limit)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"gws_{module}_{stamp}.{format}"
    if format == "json":
        content = _json.dumps({"count": len(rows), "items": rows}, ensure_ascii=False, indent=2, default=str)
        return StreamingResponse(iter([content]), media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow(fields)
    for row in rows:
        w.writerow([str(row.get(f, "") or "") for f in fields])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/score-trend/{event_id}")
async def score_trend(event_id: str, hours: int = Query(24, ge=1, le=720)):
    """Belirli event ile aynı göndericiden son N saatteki Panel/MailScanner/SA
    skor zaman serisi (karantina detayında trend line için)."""
    ev = await db.mail_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event bulunamadı")
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q = {"license_key": ev.get("license_key"), "from_addr": ev.get("from_addr"),
         "ingested_at": {"$gte": since}}
    points = []
    async for e in db.mail_events.find(q, {"_id": 0, "ts": 1, "ingested_at": 1, "total_score": 1, "scores": 1}).sort("ts", 1).limit(500):
        sc = e.get("scores") or {}
        sa_raw = sc.get("spamassassin") if sc.get("spamassassin") is not None else sc.get("sa")
        ms_raw = sc.get("mailscanner") if sc.get("mailscanner") is not None else (sc.get("msc") or sc.get("ms"))
        points.append({
            "ts": e.get("ts") or e.get("ingested_at"),
            "panel": float(e.get("total_score") or 0),
            "sa": float(sa_raw) if sa_raw is not None else None,
            "mailscanner": float(ms_raw) if ms_raw is not None else None,
        })
    return {"sender": ev.get("from_addr"), "hours": hours, "count": len(points), "points": points}

@router.get("/pending-actions")
async def list_pending_actions(license_key: str = Query(..., min_length=8)):
    """Sunucudaki logtail daemon her N saniyede bir bunu poll'lar."""
    await _validate_license(license_key)
    cursor = db.pending_quarantine_actions.find(
        {"license_key": license_key, "completed_at": None},
        {"_id": 0},
    ).sort("created_at", 1).limit(20)
    return {"items": await cursor.to_list(length=20)}


class ActionResult(BaseModel):
    license_key: str
    action_id: str
    result: str
    message: Optional[str] = None


@router.get("/{event_id}")
async def get_event(event_id: str, license_key: str = Query(..., min_length=8)):
    """Get full mail event including body and attachments (if stored)."""
    await _validate_license(license_key)
    evt = await db.mail_events.find_one({"id": event_id, "license_key": license_key}, {"_id": 0})
    if not evt:
        raise HTTPException(404, "Event bulunamadi")
    return evt


@router.post("/complete-action")
async def complete_action(res: ActionResult):
    """Sunucudaki daemon aksiyonu tamamladiktan sonra sonucu buraya bildirir."""
    await _validate_license(res.license_key)
    r = await db.pending_quarantine_actions.update_one(
        {"license_key": res.license_key, "id": res.action_id, "completed_at": None},
        {"$set": {
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": res.result,
            "message": res.message,
        }},
    )
    return {"ok": True, "matched": r.matched_count}
