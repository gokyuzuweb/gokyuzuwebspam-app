"""v43.99.13 — Kurulum Rehberi Video URL Yönetimi.

Master, 8 kurulum adımı için YouTube veya MP4 URL'leri panelden düzenleyebilir.
URL'ler `settings` koleksiyonunda `_key='install_videos'` altında saklanır.
Herkes GET yapabilir (public panel içeriği), sadece Master PUT yapabilir.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]
MASTER_LICENSE_KEY = os.environ.get("MASTER_LICENSE_KEY", "")

router = APIRouter(prefix="/install-videos", tags=["install-videos"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_master(request: Request) -> bool:
    k = request.headers.get("x-master-key") or ""
    return bool(MASTER_LICENSE_KEY and k == MASTER_LICENSE_KEY)


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "") or ""
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "")


DEFAULT_VIDEOS = {str(i): {"youtube": "", "mp4": ""} for i in range(1, 9)}


@router.get("")
async def get_videos():
    """Herkese açık: 8 adımın video URL'lerini döner."""
    doc = await db.settings.find_one({"_key": "install_videos"}, {"_id": 0, "_key": 0}) or {}
    videos = doc.get("videos") or DEFAULT_VIDEOS
    # 8 adım hepsi dolu mu garanti
    for i in range(1, 9):
        videos.setdefault(str(i), {"youtube": "", "mp4": ""})
    return {
        "videos": videos,
        "updated_at": doc.get("updated_at"),
        "updated_by_ip": doc.get("updated_by_ip"),
    }


class VideoURL(BaseModel):
    youtube: str = Field("", max_length=500)
    mp4: str = Field("", max_length=500)


class InstallVideosIn(BaseModel):
    # Anahtarlar "1".."8"
    videos: dict[str, VideoURL]


@router.put("")
async def put_videos(payload: InstallVideosIn, request: Request):
    """Master: video URL'lerini günceller."""
    if not _is_master(request):
        raise HTTPException(403, "Sadece master")

    # YouTube URL'lerini otomatik embed formatına çevir
    normalized = {}
    for k, v in payload.videos.items():
        yt = (v.youtube or "").strip()
        # youtube.com/watch?v=XYZ → youtube.com/embed/XYZ
        if yt and "watch?v=" in yt:
            vid = yt.split("watch?v=")[-1].split("&")[0]
            yt = f"https://www.youtube.com/embed/{vid}"
        # youtu.be/XYZ → youtube.com/embed/XYZ
        elif yt and "youtu.be/" in yt:
            vid = yt.split("youtu.be/")[-1].split("?")[0]
            yt = f"https://www.youtube.com/embed/{vid}"
        normalized[k] = {"youtube": yt, "mp4": (v.mp4 or "").strip()}

    await db.settings.update_one(
        {"_key": "install_videos"},
        {"$set": {
            "_key": "install_videos",
            "videos": normalized,
            "updated_at": _iso(),
            "updated_by_ip": _client_ip(request),
        }},
        upsert=True,
    )

    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "install_videos_updated",
            "actor_ip": _client_ip(request),
            "details": {"step_count": len(normalized),
                        "with_youtube": sum(1 for v in normalized.values() if v["youtube"]),
                        "with_mp4": sum(1 for v in normalized.values() if v["mp4"])},
            "at": _iso(), "severity": "info",
        })
    except Exception:
        pass

    return {"ok": True, "videos": normalized}
