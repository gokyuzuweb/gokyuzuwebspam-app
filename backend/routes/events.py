"""
Mail Event ingestion + listing (SaaS mode).
Milter (yerel WHM sunucusu) her taranmis mail icin buraya POST atar,
panel de buradan license_key'e gore filtreli olarak listeler.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from deps import db
import os
import re
import uuid

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
    await db.mail_events.insert_one(doc)
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


@router.get("")
async def list_events(
    license_key: str = Query(..., min_length=8),
    limit: int = Query(50, ge=1, le=500),
    verdict: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    scope_user: Optional[str] = Query(None),
):
    """Panelden cagirilir. Sadece verilen license_key'e ait eventleri doner.
    scope_user verilirse to_addr veya from_addr'ta o cPanel kullanicisi olan mailleri filtreler.
    """
    await _validate_license(license_key)
    q: dict[str, Any] = {"license_key": license_key}
    if verdict:
        q["verdict"] = verdict
    if since:
        q["ts"] = {"$gte": since}
    if scope_user:
        # cPanel end-user modu: substring match — kullanici 'user@domain' veya 'domain'
        # verebilir. Regex.escape ile safe injection'a karsi koruma.
        import re
        safe = re.escape(scope_user)
        q["$or"] = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
    cursor = db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "count": len(items)}


@router.get("/summary")
async def events_summary(
    license_key: str = Query(..., min_length=8),
    scope_user: Optional[str] = Query(None),
):
    """Ozet istatistik - toplam + verdict breakdown."""
    await _validate_license(license_key)
    match: dict[str, Any] = {"license_key": license_key}
    if scope_user:
        import re
        safe = re.escape(scope_user)
        match["$or"] = [
            {"to_addr":   {"$regex": safe, "$options": "i"}},
            {"from_addr": {"$regex": safe, "$options": "i"}},
        ]
    total = await db.mail_events.count_documents(match)
    pipeline = [{"$match": match}, {"$group": {"_id": "$verdict", "count": {"$sum": 1}}}]
    breakdown = {}
    async for row in db.mail_events.aggregate(pipeline):
        breakdown[row["_id"]] = row["count"]
    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0, "last_event_at": 1})
    return {
        "total": total,
        "by_verdict": breakdown,
        "last_event_at": (lic or {}).get("last_event_at"),
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
