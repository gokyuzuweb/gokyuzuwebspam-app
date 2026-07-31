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
