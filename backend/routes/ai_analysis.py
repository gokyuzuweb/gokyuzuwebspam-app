"""v44.00.35 — AI System Health Analysis (Claude Sonnet 4.6 via Emergent LLM Key)
Master-only endpoint that collects current signals (spam trend, rule performance,
threat feed health, DMARC alarms) and asks Claude to produce a plain-language
Turkish summary + recommended actions.

v44.00.36 — Added:
  * `_daily_ai_analysis_task` — her sabah 08:00 UTC otomatik rapor + skor düşüşü alarmı
  * `GET /system-analysis/history` — geçmiş raporlar
  * `GET /system-analysis/{id}/pdf` — PDF export
"""
from __future__ import annotations
import asyncio
import io
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
_client = AsyncIOMotorClient(MONGO_URL)
db = _client[DB_NAME]


async def _require_master(request: Request, license_key: Optional[str]):
    from server import _require_master as core_check
    return await core_check(request, license_key)


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _collect_signals() -> dict:
    """Sistemin son 7 günlük sinyallerini derle → LLM'e context olarak verilecek."""
    now = datetime.now(timezone.utc)
    d7 = (now - timedelta(days=7)).isoformat()
    d1 = (now - timedelta(days=1)).isoformat()

    # Mail metrikleri (7 gün)
    total_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}})
    spam_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7},
                                                     "verdict": {"$in": ["spam", "high_spam"]}})
    virus_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}, "verdict": "virus"})
    phish_7d = await db.mail_events.count_documents({"received_at": {"$gte": d7}, "verdict": "phish"})

    # 24 saat delta
    total_24h = await db.mail_events.count_documents({"received_at": {"$gte": d1}})
    spam_24h = await db.mail_events.count_documents({"received_at": {"$gte": d1},
                                                      "verdict": {"$in": ["spam", "high_spam"]}})

    # Kural performansı (top 5 hit, zero-hit süresi)
    top_rules = await db.mailscanner_rule_suggestions.find(
        {"status": "active"}, {"_id": 0, "rule_id": 1, "hits": 1, "zero_hit_days": 1}
    ).sort("hits", -1).limit(5).to_list(5)
    zero_hit_count = await db.mailscanner_rule_suggestions.count_documents(
        {"status": "active", "zero_hit_days": {"$gte": 7}}
    )
    active_rules_total = await db.mailscanner_rule_suggestions.count_documents({"status": "active"})

    # Threat feed sağlığı
    feeds = await db.threat_intel_feeds.find({}, {"_id": 0, "key": 1, "last_sync_status": 1,
                                                    "last_sync_at": 1, "last_error": 1}).to_list(50)
    error_feeds = [f for f in feeds if f.get("last_sync_status") == "error"]

    # USOM
    usom_last = await db.settings.find_one({"_key": "usom_last_run"}, {"_id": 0}) or {}

    # Karantina
    q_total = await db.quarantine.count_documents({})
    q_recent = await db.quarantine.count_documents({"received_at": {"$gte": d7}})

    # Notifications (son 7 gün alarmlar)
    alerts_7d = await db.notifications_inbox.count_documents({"created_at": {"$gte": d7}})
    dmarc_alerts_7d = await db.notifications_inbox.count_documents({
        "created_at": {"$gte": d7}, "kind": "dmarc_attack",
    })

    return {
        "generated_at": _iso(),
        "mail_metrics_7d": {
            "total": total_7d, "spam": spam_7d, "virus": virus_7d, "phish": phish_7d,
            "spam_rate_pct": round(spam_7d / total_7d * 100, 2) if total_7d else 0,
        },
        "mail_metrics_24h": {"total": total_24h, "spam": spam_24h},
        "rule_performance": {
            "active_total": active_rules_total,
            "zero_hit_7d_plus": zero_hit_count,
            "top_5": top_rules,
        },
        "threat_feeds": {
            "total": len(feeds),
            "error_count": len(error_feeds),
            "errors": [{"key": f["key"], "last_error": (f.get("last_error") or "")[:120]}
                       for f in error_feeds[:5]],
        },
        "usom": {
            "last_run_date": usom_last.get("date"),
            "records": usom_last.get("count"),
            "added_to_blacklist": usom_last.get("added_to_blacklist"),
        },
        "quarantine": {"total": q_total, "last_7d": q_recent},
        "alerts_7d": {"total": alerts_7d, "dmarc_attacks": dmarc_alerts_7d},
    }


SYSTEM_PROMPT = """Sen, GökyüzüWebSpam adlı bir WHM/cPanel mail spam koruma
yönetim panelinin AI sağlık analistisin. Kullanıcı bir sistem yöneticisidir.

Görevin: Verilen JSON metriklerini incele ve şu formatta bir Türkçe rapor üret:

1. **Genel Sağlık Skoru** (0-100 arası tek sayı, tek satır)
2. **Öne Çıkan Tehlike Sinyalleri** (madde işaretli 2-4 madde, olumsuz durumlar)
3. **Olumlu Notlar** (madde işaretli 1-3 madde)
4. **Önerilen Aksiyonlar** (öncelik sırasıyla 3-5 madde, her biri 1 cümle, spesifik ve aksiyona yönelik)

Kurallar:
- Sadece verilen JSON verisini kullan, uydurma
- Yüksek spam oranı (%40+), 5+ hata veren feed, 10+ zero-hit kural, 3+ DMARC alarm gibi durumları vurgula
- Kısa ve net yaz, sysadmin dili kullan
- Her bölüm için 1 emoji kullan (📊, 🚨, ✅, 💡)
- Yanıtı Markdown formatında ver
- Toplam uzunluk: max 400 kelime"""


@router.get("/system-analysis/latest")
async def get_latest_analysis(request: Request, license_key: Optional[str] = None):
    """Son üretilen sistem sağlık raporunu döner (cache olarak kullanmak için)."""
    await _require_master(request, license_key)
    doc = await db.ai_system_reports.find_one({}, sort=[("generated_at", -1)], projection={"_id": 0})
    return doc or {}


# v44.00.36 — Skor extraction & history & PDF & cron
_SCORE_RE = re.compile(r"(\d{1,3})\s*/\s*100", re.MULTILINE)


def _extract_score(md: str) -> Optional[int]:
    """Rapor markdown'undan '62 / 100' gibi ilk sağlık skorunu çıkar."""
    if not md:
        return None
    m = _SCORE_RE.search(md)
    if not m:
        return None
    try:
        v = int(m.group(1))
        return v if 0 <= v <= 100 else None
    except Exception:
        return None


async def _generate_report(reason: str = "manual") -> dict:
    """Rapor üretme ortak fonksiyon (endpoint + cron ortak kullanır)."""
    if not EMERGENT_LLM_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY tanımlı değil")
    signals = await _collect_signals()
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        raise RuntimeError("emergentintegrations yüklü değil")
    import json as _json
    session_id = f"sys-analysis-{uuid.uuid4()}"
    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=SYSTEM_PROMPT)
        .with_model("anthropic", "claude-sonnet-4-6")
    )
    msg = UserMessage(text=(
        "Aşağıdaki JSON, GökyüzüWebSpam master panelinin son 7 günlük durum sinyalleridir. "
        "Sistem prompt'undaki 4 bölümlü Türkçe rapor formatında yanıtla.\n\n"
        f"```json\n{_json.dumps(signals, ensure_ascii=False, indent=2)}\n```"
    ))
    response_text = await chat.send_message(msg)
    score = _extract_score(response_text)
    doc = {
        "id": str(uuid.uuid4()),
        "generated_at": _iso(),
        "model": "anthropic/claude-sonnet-4-6",
        "reason": reason,
        "health_score": score,
        "signals": signals,
        "report_markdown": response_text,
    }
    await db.ai_system_reports.insert_one({**doc})
    doc.pop("_id", None)
    return doc


# system-analysis endpoint'ini shared fonksiyona bağla
@router.post("/system-analysis")
async def system_analysis(request: Request, license_key: Optional[str] = None):
    """Claude Sonnet 4.6 ile sistem sağlık raporu üret. Master-only."""
    await _require_master(request, license_key)
    try:
        return await _generate_report(reason="manual")
    except RuntimeError as ex:
        raise HTTPException(500, str(ex))
    except Exception as ex:
        raise HTTPException(502, f"LLM çağrısı başarısız: {ex}")


@router.get("/system-analysis/history")
async def get_history(request: Request, license_key: Optional[str] = None,
                       limit: int = 30):
    """Son N raporu döner (metadata + skor, tam markdown yok)."""
    await _require_master(request, license_key)
    limit = max(1, min(200, int(limit)))
    docs = await db.ai_system_reports.find(
        {}, projection={"_id": 0, "id": 1, "generated_at": 1, "model": 1,
                        "reason": 1, "health_score": 1}
    ).sort("generated_at", -1).limit(limit).to_list(limit)
    return {"items": docs, "count": len(docs)}


@router.get("/system-analysis/{report_id}")
async def get_report(report_id: str, request: Request, license_key: Optional[str] = None):
    """Belirli bir raporu detaylı döner."""
    await _require_master(request, license_key)
    doc = await db.ai_system_reports.find_one({"id": report_id}, projection={"_id": 0})
    if not doc:
        raise HTTPException(404, "Rapor bulunamadı")
    return doc


@router.get("/system-analysis/{report_id}/pdf")
async def export_pdf(report_id: str, request: Request, license_key: Optional[str] = None):
    """Raporu PDF olarak indir."""
    await _require_master(request, license_key)
    doc = await db.ai_system_reports.find_one({"id": report_id}, projection={"_id": 0})
    if not doc:
        raise HTTPException(404, "Rapor bulunamadı")
    pdf_bytes = _render_report_pdf(doc)
    fname = f"gws-health-{doc.get('generated_at', '')[:10]}-{report_id[:8]}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


def _md_bold(s: str) -> str:
    """Markdown **bold** → HTML <b> for reportlab paragraphs."""
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    # Escape < unless it's part of a tag we just made
    return s


# ═════════════════════════════════════════════════════════════════════
# v44.00.36 — Otomatik Sabah Cron + Skor Düşüşü Alarmı
# ═════════════════════════════════════════════════════════════════════

def _render_report_pdf(doc: dict) -> bytes:
    """v44.00.37 — Rapor doc'undan PDF bytes üret (endpoint + cron ortak)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    buf = io.BytesIO()
    docp = SimpleDocTemplate(buf, pagesize=A4,
                              leftMargin=2*cm, rightMargin=2*cm,
                              topMargin=2*cm, bottomMargin=2*cm,
                              title="GokyuzuWebSpam Health Report", author="GokyuzuWebSpam AI")
    styles = getSampleStyleSheet()
    if "H1TR" not in styles.byName:
        styles.add(ParagraphStyle(name="H1TR", parent=styles["Heading1"],
                                   textColor=colors.HexColor("#4f46e5"), spaceAfter=12, fontSize=16))
        styles.add(ParagraphStyle(name="H2TR", parent=styles["Heading2"],
                                   textColor=colors.HexColor("#6366f1"), spaceAfter=8, fontSize=13))
        styles.add(ParagraphStyle(name="BodyTR", parent=styles["BodyText"],
                                   fontSize=10, leading=14, spaceAfter=4))
        styles.add(ParagraphStyle(name="MonoTR", parent=styles["Code"],
                                   fontSize=8, textColor=colors.HexColor("#64748b")))
    elements = []
    elements.append(Paragraph("GokyuzuWebSpam - AI Sistem Saglik Raporu", styles["H1TR"]))
    elements.append(Paragraph(
        f"Olusturulma: {doc.get('generated_at', '')}<br/>Model: {doc.get('model')}<br/>"
        f"Neden: {doc.get('reason', '-')}<br/>"
        f"Saglik Skoru: <b>{doc.get('health_score') if doc.get('health_score') is not None else '-'} / 100</b>",
        styles["MonoTR"]))
    elements.append(Spacer(1, 12))
    md = doc.get("report_markdown") or ""
    for raw in md.split("\n"):
        line = raw.rstrip()
        if not line.strip(): elements.append(Spacer(1, 6)); continue
        if line.startswith("# "):    elements.append(Paragraph(line[2:], styles["H1TR"]))
        elif line.startswith("## "): elements.append(Paragraph(line[3:], styles["H2TR"]))
        elif line.startswith("### "):elements.append(Paragraph(f"<b>{line[4:]}</b>", styles["BodyTR"]))
        elif line.startswith("---"): elements.append(Spacer(1, 10))
        elif line.lstrip().startswith(("- ", "* ", "• ")):
            elements.append(Paragraph(f"• {_md_bold(line.lstrip()[2:])}", styles["BodyTR"]))
        elif re.match(r"^\d+\.\s", line.lstrip()):
            elements.append(Paragraph(_md_bold(line.lstrip()), styles["BodyTR"]))
        else:
            elements.append(Paragraph(_md_bold(line), styles["BodyTR"]))
    docp.build(elements)
    buf.seek(0)
    return buf.getvalue()


async def _daily_ai_analysis_task():
    """Her sabah 08:00 UTC AI raporu üret + önceki raporla skor karşılaştır.
    Skor 15+ puan düştüyse notifications_inbox'a 'ai_health_drop' alarmı at."""
    await asyncio.sleep(900)  # startup +15dk
    while True:
        try:
            now = datetime.now(timezone.utc)
            if now.hour == 8:
                today = now.date().isoformat()
                last = await db.settings.find_one({"_key": "ai_analysis_last_cron"}, {"_id": 0}) or {}
                if last.get("date") == today:
                    await asyncio.sleep(3600); continue
                if not EMERGENT_LLM_KEY:
                    log.info("ai analysis cron skipped: no EMERGENT_LLM_KEY")
                else:
                    try:
                        prev = await db.ai_system_reports.find_one(
                            {}, sort=[("generated_at", -1)], projection={"_id": 0, "health_score": 1}
                        ) or {}
                        prev_score = prev.get("health_score")
                        doc = await _generate_report(reason="daily_cron")
                        new_score = doc.get("health_score")
                        drop = None
                        if isinstance(prev_score, int) and isinstance(new_score, int):
                            drop = prev_score - new_score
                            if drop >= 15:
                                # Skor 15+ düştü → alarm
                                await db.notifications_inbox.insert_one({
                                    "id": str(uuid.uuid4()),
                                    "kind": "ai_health_drop",
                                    "subject": f"[SAĞLIK UYARISI] Sistem skoru {prev_score}→{new_score} (−{drop} puan)",
                                    "body": (
                                        f"AI günlük sağlık raporu, sisteminizin sağlık skorunun "
                                        f"{prev_score}/100'den {new_score}/100'e düştüğünü tespit etti (−{drop} puan).\n\n"
                                        f"Detaylı rapor için: Dashboard → AI Sistem Analizi butonuna basın."
                                    ),
                                    "meta": {"prev_score": prev_score, "new_score": new_score,
                                             "drop": drop, "report_id": doc.get("id")},
                                    "license_key": None, "read": False,
                                    "severity": "high" if drop >= 25 else "medium",
                                    "created_at": _iso(),
                                })
                        await db.settings.update_one(
                            {"_key": "ai_analysis_last_cron"},
                            {"$set": {"_key": "ai_analysis_last_cron", "date": today,
                                      "score": new_score, "prev_score": prev_score,
                                      "drop": drop, "report_id": doc.get("id"),
                                      "at": now.isoformat()}},
                            upsert=True,
                        )
                        log.info("ai analysis cron: score=%s prev=%s drop=%s report=%s",
                                 new_score, prev_score, drop, doc.get("id"))
                        # v44.00.41 — Master Alarm Bell'e günlük AI raporu PIN et
                        try:
                            dk = f"ai_daily:{today}"
                            exists = await db.master_alerts.find_one({"dedupe_key": dk}, {"_id": 1})
                            if not exists:
                                # Severity mantığı: skor < 60 → danger, < 80 → warning, aksi → info
                                sev = ("danger" if (new_score or 100) < 60
                                       else "warning" if (new_score or 100) < 80
                                       else "info")
                                if drop and drop >= 15:
                                    sev = "danger"
                                await db.master_alerts.insert_one({
                                    "id": str(uuid.uuid4()),
                                    "type": "ai_daily_report",
                                    "severity": sev,
                                    "title": f"🤖 Günlük AI Sağlık Raporu — {new_score}/100",
                                    "subtitle": (
                                        f"Skor: {prev_score}→{new_score}" +
                                        (f" (−{drop} puan)" if drop else "")
                                    ),
                                    "report_id": doc.get("id"),
                                    "health_score": new_score,
                                    "prev_score": prev_score,
                                    "drop": drop,
                                    "action_url": "/panel/mailscanner?tab=stats",
                                    "dedupe_key": dk,
                                    "created_at": now.isoformat(),
                                    "seen": False,
                                })
                                log.info("ai analysis cron: master_alert pinned (severity=%s)", sev)
                        except Exception as ex_pin:
                            log.warning("ai analysis cron pin failed: %s", ex_pin)
                        # v44.00.37 — PDF'i master admin'e mail at
                        try:
                            master_email = os.environ.get("MASTER_ADMIN_EMAIL") or ""
                            if not master_email:
                                # Fallback: settings.master_email
                                s = await db.settings.find_one({"_key": "master_email"}, {"_id": 0}) or {}
                                master_email = (s.get("email") or "").strip()
                            if master_email and "@" in master_email:
                                pdf_bytes = _render_report_pdf(doc)
                                fname = f"gws-health-{doc.get('generated_at','')[:10]}.pdf"
                                from server import _send_email
                                score_line = f"Saglik Skoru: {new_score}/100"
                                if drop and drop >= 15:
                                    score_line += f" (onceki: {prev_score}, DUSUS: -{drop})"
                                body = (
                                    "Merhaba,\n\n"
                                    "GokyuzuWebSpam gunluk otomatik AI saglik raporu ekli PDF'te.\n\n"
                                    f"{score_line}\n\n"
                                    "Detayli analiz icin panele giris yapin: Dashboard > AI Sistem Analizi.\n"
                                )
                                ok, info = await _send_email(
                                    to_addr=master_email,
                                    subject=f"[GWS Saglik] {new_score}/100 · {doc.get('generated_at','')[:10]}",
                                    body=body,
                                    attachments=[(fname, pdf_bytes, "application/pdf")],
                                )
                                log.info("ai analysis cron email: to=%s ok=%s info=%s",
                                         master_email, ok, info)
                        except Exception as em:
                            log.warning("ai analysis cron email send failed: %s", em)
                    except Exception as ex:
                        log.warning("ai analysis cron failed: %s", ex)
        except Exception as ex:
            log.warning("ai analysis cron error: %s", ex)
        await asyncio.sleep(3600)


# ═════════════════════════════════════════════════════════════════════
# v44.00.36 — DMARC / SPF / DKIM DNS Doğrulama
# ═════════════════════════════════════════════════════════════════════

@router.get("/dmarc-verify")
async def dmarc_verify(domain: str, request: Request, license_key: Optional[str] = None):
    """v44.00.36 — SPF/DKIM/DMARC canlı DNS sorgu · v44.00.37: 60sn DB cache."""
    await _require_master(request, license_key)
    if not domain or "." not in domain:
        raise HTTPException(400, "Geçerli bir domain gir")
    domain = domain.lower().strip()

    # v44.00.37 — 60sn DB cache
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    cached = await db.dns_verify_cache.find_one(
        {"domain": domain, "checked_at": {"$gt": cutoff}}, {"_id": 0},
    )
    if cached:
        cached["from_cache"] = True
        return cached

    def _query(fqdn: str) -> list[str]:
        try:
            import dns.resolver
            r = dns.resolver.Resolver()
            r.timeout = 4; r.lifetime = 5
            r.nameservers = ["1.1.1.1", "8.8.8.8"]
            ans = r.resolve(fqdn, "TXT")
            out = []
            for rr in ans:
                try:
                    txt = "".join(s.decode("utf-8", errors="replace") if isinstance(s, bytes) else str(s)
                                  for s in rr.strings)
                except Exception:
                    txt = str(rr)
                out.append(txt)
            return out
        except Exception:
            return []

    loop = asyncio.get_event_loop()
    # DNS queries paralel
    spf_res, dmarc_res, dkim_res = await asyncio.gather(
        loop.run_in_executor(None, _query, domain),
        loop.run_in_executor(None, _query, f"_dmarc.{domain}"),
        loop.run_in_executor(None, _query, f"default._domainkey.{domain}"),
    )

    def _analyze_spf(records):
        spf = [r for r in records if r.lower().startswith("v=spf1")]
        if not spf:
            return {"present": False, "value": None, "policy": None, "issue": "SPF kaydı yok"}
        v = spf[0]
        policy = "-all" if "-all" in v else "~all" if "~all" in v else "?all" if "?all" in v else "+all" if "+all" in v else None
        return {"present": True, "value": v, "policy": policy,
                "issue": None if policy in ("-all", "~all") else "Sonu ~all veya -all olmalı (yetkisiz reddeder)"}

    def _analyze_dmarc(records):
        dm = [r for r in records if r.lower().startswith("v=dmarc1")]
        if not dm:
            return {"present": False, "value": None, "policy": None, "rua": None,
                    "issue": "DMARC kaydı yok — spoof'a açık!"}
        v = dm[0]
        p_match = re.search(r"p\s*=\s*(none|quarantine|reject)", v, re.I)
        rua_match = re.search(r"rua\s*=\s*(mailto:[^;\s]+)", v, re.I)
        return {"present": True, "value": v,
                "policy": (p_match.group(1).lower() if p_match else None),
                "rua": (rua_match.group(1) if rua_match else None),
                "issue": None if p_match else "p= yok, geçersiz DMARC"}

    def _analyze_dkim(records):
        dk = [r for r in records if "v=dkim1" in r.lower() or "k=" in r.lower() or "p=" in r.lower()]
        return {"present": bool(dk), "value": (dk[0] if dk else None),
                "selector": "default",
                "issue": None if dk else "default._domainkey seçicisi yok. cPanel'de otomatik oluşturun."}

    spf = _analyze_spf(spf_res)
    dmarc = _analyze_dmarc(dmarc_res)
    dkim = _analyze_dkim(dkim_res)
    ok = spf.get("present") and dmarc.get("present") and dkim.get("present")

    result = {
        "domain": domain,
        "checked_at": _iso(),
        "spf": spf,
        "dkim": dkim,
        "dmarc": dmarc,
        "all_ok": bool(ok),
        "from_cache": False,
    }
    # v44.00.37 — Persist cache (60sn TTL applied on read)
    try:
        await db.dns_verify_cache.update_one(
            {"domain": domain}, {"$set": result}, upsert=True,
        )
    except Exception:
        pass
    return result
