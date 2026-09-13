"""v43.99.18 — Kurulum Rehberi PDF için ekran görüntüsü yönetimi.

Master 8 adım için WHM/panel ekran görüntülerini yükleyebilir.
v44.00.13 — Görseller MongoDB `install_screenshots` koleksiyonunda base64
olarak saklanır (pod-ephemeral disk yerine — deploy-safe).
PDF üretimi bu binary'leri varsa mockup yerine kullanır.
"""
from __future__ import annotations
import base64
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/install-screenshots", tags=["install-screenshots"])

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp"}
_MEDIA = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5 MB


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


def _is_master(request: Request) -> bool:
    k = request.headers.get("x-master-key") or ""
    return bool(MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY)


async def _invalidate_pdf_cache():
    # PDF cache doc'ları MongoDB'de tutuluyorsa geçersiz kıl (v44.00.13 sonrası)
    try:
        await db.pdf_cache.delete_many({"key": {"$regex": "^install-guide-"}})
    except Exception:
        pass


@router.get("")
async def list_screenshots():
    """Herkese açık: 8 adım için yüklenmiş ekran görüntülerini listeler."""
    result = {}
    async for doc in db.install_screenshots.find({}, {"data_b64": 0}):
        sid = str(doc.get("step_id"))
        result[sid] = {
            "url": f"/api/install-screenshots/file/{sid}",
            "size_kb": doc.get("size_kb", 0),
            "ext": doc.get("ext", "png"),
            "uploaded_at": doc.get("uploaded_at"),
        }
    return {"screenshots": result, "count": len(result)}


@router.get("/file/{step_id}")
async def serve_screenshot(step_id: int):
    """Yüklenmiş ekran görüntüsünü döner (public)."""
    if not (1 <= step_id <= 8):
        raise HTTPException(400, "step_id 1-8")
    doc = await db.install_screenshots.find_one({"step_id": step_id})
    if not doc:
        raise HTTPException(404, "Bu adım için henüz görüntü yüklenmedi")
    try:
        raw = base64.b64decode(doc["data_b64"])
    except Exception:
        raise HTTPException(500, "Bozuk kayıt")
    return Response(
        content=raw,
        media_type=_MEDIA.get(doc.get("ext", "png"), "image/png"),
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.post("/upload")
async def upload_screenshot(
    request: Request,
    step_id: int = Form(...),
    file: UploadFile = File(...),
):
    """Master: bir adım için ekran görüntüsü yükler (MongoDB'ye kaydeder)."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    if not (1 <= step_id <= 8):
        raise HTTPException(400, "step_id 1-8 arasında olmalı")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Desteklenen: {', '.join(ALLOWED_EXT)}")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(413, f"Max {MAX_SIZE // 1024 // 1024} MB")
    if len(contents) < 100:
        raise HTTPException(400, "Dosya çok küçük veya boş")

    await db.install_screenshots.update_one(
        {"step_id": step_id},
        {"$set": {
            "step_id": step_id,
            "ext": ext,
            "size_kb": round(len(contents) / 1024, 1),
            "data_b64": base64.b64encode(contents).decode("ascii"),
            "uploaded_at": _iso(),
        }},
        upsert=True,
    )

    await _invalidate_pdf_cache()

    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "install_screenshot_uploaded",
            "actor_ip": _client_ip(request),
            "details": {"step_id": step_id, "ext": ext, "size_kb": round(len(contents)/1024, 1)},
            "at": _iso(), "severity": "info",
        })
    except Exception:
        pass

    return {
        "ok": True,
        "step_id": step_id,
        "url": f"/api/install-screenshots/file/{step_id}",
        "size_kb": round(len(contents) / 1024, 1),
    }


@router.delete("/{step_id}")
async def delete_screenshot(step_id: int, request: Request):
    """Master: bir adım'ın ekran görüntüsünü siler."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")
    if not (1 <= step_id <= 8):
        raise HTTPException(400, "step_id 1-8")

    r = await db.install_screenshots.delete_one({"step_id": step_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Silinecek kayıt yok")

    await _invalidate_pdf_cache()
    return {"ok": True, "step_id": step_id}
