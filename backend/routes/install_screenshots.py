"""v43.99.18 — Kurulum Rehberi PDF için ekran görüntüsü yönetimi.

Master 8 adım için WHM/panel ekran görüntülerini yükleyebilir.
Görseller /app/uploads/install_screenshots/step-{N}.png olarak saklanır.
PDF üretimi bu dosyaları varsa mockup yerine kullanır.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/install-screenshots", tags=["install-screenshots"])

UPLOAD_DIR = Path("/app/uploads/install_screenshots")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXT = {"png", "jpg", "jpeg", "webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5 MB


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


def _is_master(request: Request) -> bool:
    k = request.headers.get("x-master-key") or ""
    return bool(MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY)


@router.get("")
async def list_screenshots():
    """Herkese açık: 8 adım için yüklenmiş ekran görüntülerini listeler.
    URL'ler /api/install-screenshots/file/{step_id} — kendi backend endpoint'imiz serve eder."""
    result = {}
    for i in range(1, 9):
        for ext in ["png", "jpg", "jpeg", "webp"]:
            fp = UPLOAD_DIR / f"step-{i}.{ext}"
            if fp.exists():
                result[str(i)] = {
                    "url": f"/api/install-screenshots/file/{i}",
                    "size_kb": round(fp.stat().st_size / 1024, 1),
                    "ext": ext,
                    "uploaded_at": datetime.fromtimestamp(
                        fp.stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
                break
    return {"screenshots": result, "count": len(result)}


@router.get("/file/{step_id}")
async def serve_screenshot(step_id: int):
    """Yüklenmiş ekran görüntüsünü döner (public)."""
    from fastapi.responses import FileResponse
    if not (1 <= step_id <= 8):
        raise HTTPException(400, "step_id 1-8")
    for ext in ALLOWED_EXT:
        fp = UPLOAD_DIR / f"step-{step_id}.{ext}"
        if fp.exists():
            media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}[ext]
            return FileResponse(fp, media_type=media, headers={"Cache-Control": "public, max-age=300"})
    raise HTTPException(404, "Bu adım için henüz görüntü yüklenmedi")


@router.post("/upload")
async def upload_screenshot(
    request: Request,
    step_id: int = Form(...),
    file: UploadFile = File(...),
):
    """Master: bir adım için ekran görüntüsü yükler."""
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

    # Aynı adım için diğer format dosyalarını sil
    for e in ALLOWED_EXT:
        old = UPLOAD_DIR / f"step-{step_id}.{e}"
        if old.exists() and e != ext:
            old.unlink()

    target = UPLOAD_DIR / f"step-{step_id}.{ext}"
    target.write_bytes(contents)

    # PDF cache'i geçersiz kıl (yeni resmi bekleyeceğiz)
    for lang_suf in ["", "-EN", "-AR"]:
        for cache_dir in ["/app", "/app/backend"]:
            cache = Path(f"{cache_dir}/GokyuzuWebSpam-Kurulum-Rehberi-v43.99{lang_suf}.pdf")
            if cache.exists():
                try: cache.unlink()
                except Exception: pass

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

    deleted = False
    for ext in ALLOWED_EXT:
        fp = UPLOAD_DIR / f"step-{step_id}.{ext}"
        if fp.exists():
            fp.unlink()
            deleted = True

    if not deleted:
        raise HTTPException(404, "Silinecek dosya yok")

    # Cache'i geçersiz kıl
    for lang_suf in ["", "-EN", "-AR"]:
        for cache_dir in ["/app", "/app/backend"]:
            cache = Path(f"{cache_dir}/GokyuzuWebSpam-Kurulum-Rehberi-v43.99{lang_suf}.pdf")
            if cache.exists():
                try: cache.unlink()
                except Exception: pass

    return {"ok": True, "step_id": step_id}
