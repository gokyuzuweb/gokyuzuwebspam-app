"""v43.90 — Scheduled Mail Report Delivery.

Bayi advanced mail-activity raporlarını custom gün/saat'te otomatik email ile
teslim edecek şekilde zamanlar. Background loop `_report_schedule_loop` her 5 dk
schedule'ları tarar, next_run_at <= now olanları çalıştırır.
"""
from __future__ import annotations
import os
import uuid
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal, List

from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from routes.reports import _collect_events, _build_report_pdf, _build_report_xlsx

log = logging.getLogger("report_schedules")

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]

router = APIRouter(prefix="/report-schedules", tags=["report-schedules"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _requester_key(request: Request) -> Optional[str]:
    k = request.headers.get("x-master-key") or request.headers.get("x-license-key") or ""
    return k or None


def _next_run(day_of_week: Optional[int], hour: int, minute: int = 0) -> datetime:
    """Bir sonraki çalışma zamanını hesapla (UTC).
    day_of_week: None → günlük · 0-6 → Pzt-Paz (haftalık)
    """
    now = datetime.now(timezone.utc)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if day_of_week is None:
        # Günlük: bugün geçtiyse yarına
        if target <= now:
            target += timedelta(days=1)
        return target
    # Haftalık: hedef weekday'e ilerlet
    current_dow = now.weekday()
    days_ahead = (day_of_week - current_dow) % 7
    if days_ahead == 0 and target <= now:
        days_ahead = 7
    return target + timedelta(days=days_ahead)


class ScheduleIn(BaseModel):
    email: str = Field(..., min_length=3)          # rapor konusu email
    recipient: EmailStr                             # kime gönderilecek
    direction: Literal["sent", "received", "both"] = "both"
    days: int = Field(30, ge=1, le=365)
    format: Literal["pdf", "xlsx"] = "pdf"
    day_of_week: Optional[int] = Field(None, ge=0, le=6)   # None=daily
    hour: int = Field(8, ge=0, le=23)
    minute: int = Field(0, ge=0, le=59)


@router.get("/")
async def list_schedules(request: Request):
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    rows = await db.mail_report_schedules.find(
        {"owner_license_key": key}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    return {"items": rows, "count": len(rows)}


@router.post("/")
async def create_schedule(payload: ScheduleIn, request: Request):
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    # Cap: 20 schedule per bayi
    count = await db.mail_report_schedules.count_documents({"owner_license_key": key, "active": True})
    if count >= 20:
        raise HTTPException(400, "En fazla 20 aktif zamanlama tanımlanabilir")

    nr = _next_run(payload.day_of_week, payload.hour, payload.minute)
    doc = {
        "id": str(uuid.uuid4()),
        "owner_license_key": key,
        "email": payload.email.strip().lower(),
        "recipient": payload.recipient,
        "direction": payload.direction,
        "days": payload.days,
        "format": payload.format,
        "day_of_week": payload.day_of_week,
        "hour": payload.hour,
        "minute": payload.minute,
        "active": True,
        "created_at": _iso(),
        "next_run_at": nr.isoformat(),
        "last_run_at": None,
        "last_run_status": None,
        "run_count": 0,
    }
    await db.mail_report_schedules.insert_one(dict(doc))
    return {"ok": True, "schedule": doc}


@router.delete("/{sched_id}")
async def delete_schedule(sched_id: str, request: Request):
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    r = await db.mail_report_schedules.delete_one({"id": sched_id, "owner_license_key": key})
    if r.deleted_count == 0:
        raise HTTPException(404, "Zamanlama bulunamadı")
    return {"ok": True, "deleted": sched_id}


@router.post("/{sched_id}/toggle")
async def toggle_schedule(sched_id: str, request: Request):
    """v43.91 — Pause/resume: active alanını flip'ler. Inactive olan loop tarafından atlanır."""
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    doc = await db.mail_report_schedules.find_one({"id": sched_id, "owner_license_key": key}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Zamanlama bulunamadı")
    new_state = not bool(doc.get("active", True))
    updates = {"active": new_state, "updated_at": _iso()}
    if new_state:
        # Yeniden aktifleştirirken next_run_at'i güncelle (geçmiş zaman ise ileri al)
        nr = _next_run(doc.get("day_of_week"), doc.get("hour", 8), doc.get("minute", 0))
        updates["next_run_at"] = nr.isoformat()
    await db.mail_report_schedules.update_one({"id": sched_id}, {"$set": updates})
    return {"ok": True, "id": sched_id, "active": new_state}


@router.post("/{sched_id}/run-now")
async def run_now(sched_id: str, request: Request):
    """Test için: zamanlamayı hemen çalıştır (email göndermeden dry-run)."""
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    sched = await db.mail_report_schedules.find_one({"id": sched_id, "owner_license_key": key}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Zamanlama bulunamadı")
    result = await _execute_schedule(sched, dry_run=True)
    return {"ok": True, "result": result}


@router.post("/{sched_id}/send-test")
async def send_test(sched_id: str, request: Request):
    """v43.94 — Gerçek gönderim testi: raporu hemen üretir ve recipient'a email atar."""
    key = _requester_key(request)
    if not key:
        raise HTTPException(401, "Lisans anahtarı gerekli")
    sched = await db.mail_report_schedules.find_one({"id": sched_id, "owner_license_key": key}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Zamanlama bulunamadı")
    result = await _execute_schedule(sched, dry_run=False)
    if result.get("ok"):
        # last_run bilgilerini güncelle (schedule ilerlemesin — next_run_at aynı kalsın)
        await db.mail_report_schedules.update_one(
            {"id": sched_id},
            {"$set": {"last_run_at": _iso(), "last_run_status": "test_ok",
                       "last_run_error": None},
              "$inc": {"run_count": 1}},
        )
    return {"ok": bool(result.get("ok")), "result": result}


async def _execute_schedule(sched: dict, dry_run: bool = False) -> dict:
    """Bir schedule için raporu üret ve email ile gönder."""
    from server import _send_email     # avoid circular import at module load
    try:
        data = await _collect_events(sched["email"], sched["direction"], sched["days"], limit=5000)
        fmt = sched.get("format", "pdf")
        if fmt == "pdf":
            content = _build_report_pdf(data)
            mime = "application/pdf"
            ext = "pdf"
        else:
            content = _build_report_xlsx(data)
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ext = "xlsx"

        sent_total = data["sent"]["summary"]["total"]
        recv_total = data["received"]["summary"]["total"]
        subj = f"[GökyüzüWebSpam] Mail Aktivite Raporu — {sched['email']} (son {sched['days']}g)"
        body = (
            f"Merhaba,\n\n"
            f"Zamanlanmış mail aktivite raporunuz ekte.\n\n"
            f"Email: {sched['email']}\n"
            f"Yön: {sched['direction']}\n"
            f"Kapsam: son {sched['days']} gün\n"
            f"Gönderilen: {sent_total} · Gelen: {recv_total}\n\n"
            f"— GökyüzüWebSpam"
        )
        fname_safe = sched["email"].replace("@", "_at_").replace("/", "_")[:60]
        attachment = {"filename": f"mail-report-{fname_safe}.{ext}", "content": content, "mime": mime}
        via = "dry_run"
        if not dry_run:
            try:
                ok, via = await _send_email(sched["recipient"], subj, body, attachments=[attachment])
                if not ok:
                    return {"ok": False, "error": f"Email gönderilemedi ({via})"}
            except TypeError:
                # Fallback: _send_email attachments desteklemiyorsa plain
                ok, via = await _send_email(sched["recipient"], subj, body + f"\n\n(Ek boyutu: {len(content)} byte)")
        return {"ok": True, "sent_via": via, "sent_total": sent_total, "received_total": recv_total,
                "content_bytes": len(content)}
    except Exception as e:
        log.error(f"Schedule execution failed: {e}")
        return {"ok": False, "error": str(e)}


async def _report_schedule_loop():
    """Her 5 dakikada bir schedule'ları tarar; next_run_at <= now olanları çalıştırır."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            due = await db.mail_report_schedules.find(
                {"active": True, "next_run_at": {"$lte": now.isoformat()}},
                {"_id": 0},
            ).to_list(50)
            for sched in due:
                result = await _execute_schedule(sched, dry_run=False)
                # Bir sonraki çalışma zamanı
                nr = _next_run(sched.get("day_of_week"), sched.get("hour", 8), sched.get("minute", 0))
                await db.mail_report_schedules.update_one(
                    {"id": sched["id"]},
                    {"$set": {
                        "last_run_at": _iso(),
                        "last_run_status": "ok" if result.get("ok") else "fail",
                        "last_run_error": None if result.get("ok") else result.get("error", "")[:200],
                        "next_run_at": nr.isoformat(),
                    }, "$inc": {"run_count": 1}},
                )
        except Exception as e:
            log.error(f"schedule_loop error: {e}")
        # 5 dakika bekle
        await asyncio.sleep(300)
