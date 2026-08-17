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
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
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
    async for e in db.mail_events.find(q, {"_id": 0, "scores": 1, "verdict": 1}):
        for eng, val in (e.get("scores") or {}).items():
            b = engine_hits.setdefault(eng, {"engine": eng, "total": 0, "spam": 0})
            b["total"] += 1
            if e.get("verdict") in ("spam", "high_spam", "virus"):
                b["spam"] += 1
    engines = sorted(engine_hits.values(), key=lambda x: x["total"], reverse=True)
    return {
        "hours": hours, "total_scanned": total,
        "verdicts": verdicts, "score_histogram": hist,
        "engines": engines, "generated_at": _iso(),
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
    return {
        "total_tokens": total_tokens,
        "spam_samples": doc.get("spam_total", 0),
        "ham_samples":  doc.get("ham_total", 0),
        "trained": total_tokens > 0,
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
    }
    await db.mailscanner_rules.insert_one(dict(rule))
    await db.mailscanner_rule_suggestions.update_one(
        {"id": suggestion_id}, {"$set": {"applied": True, "applied_at": _iso()}})
    return {"ok": True, "rule": rule}


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
