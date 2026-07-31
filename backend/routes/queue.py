"""
Exim mail queue management (list + bulk actions).

WHM sunucusunda `exiqgrep -a` / `exim -Mrm` / `exim -M` çağrıları gerçek çalışır.
Preview / dev ortamında mock kuyruk oluşur (mail_events'ten türetilir) — böylece UI eksiksiz test edilir.
"""
from __future__ import annotations
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(prefix="/queue", tags=["queue"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_exim() -> bool:
    return bool(shutil.which("exim") and shutil.which("exiqgrep"))


async def _mock_queue(license_key: Optional[str], limit: int) -> list[dict]:
    """Kuyruk için mock data — son 20 spam/high_spam eventi Exim-tarzı row olarak döner."""
    q = {"verdict": {"$in": ["spam", "high_spam", "virus", "blocked"]}}
    if license_key:
        q["license_key"] = license_key
    rows = []
    cursor = db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit)
    async for e in cursor:
        rows.append({
            "mid": e.get("exim_mid") or f"1t{(e.get('id') or '')[:6]}-XXX",
            "age": "12m",
            "size": e.get("scores", {}).get("size") or 8192,
            "from_addr": e.get("from_addr") or "(bilinmiyor)",
            "to_addr": e.get("to_addr") or "(bilinmiyor)",
            "subject": e.get("subject") or "(konusuz)",
            "verdict": e.get("verdict"),
            "score": e.get("total_score") or 0,
            "frozen": (e.get("verdict") == "high_spam"),
            "attempts": 1,
            "spooled_at": e.get("ingested_at") or _iso(),
        })
    return rows


def _parse_exiqgrep(output: str) -> list[dict]:
    """`exiqgrep -a -f` output parser — bir satır: '20m  8K  1tSXKZ-000abc-XX <alice@ex.com> bob@ex.com'"""
    items = []
    for line in output.splitlines():
        parts = line.strip().split()
        if len(parts) < 4:
            continue
        try:
            items.append({
                "age": parts[0], "size": parts[1], "mid": parts[2],
                "from_addr": parts[3].strip("<>"),
                "to_addr": " ".join(parts[4:]).strip("<>") if len(parts) > 4 else "-",
                "subject": "(exim mid)",
                "verdict": "queued", "score": 0, "frozen": False,
                "attempts": 1, "spooled_at": _iso(),
            })
        except Exception:
            continue
    return items


@router.get("")
async def list_queue(
    license_key: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    only_frozen: bool = False,
):
    """Kuyruktaki mailleri listele.  Gerçek ortam: exiqgrep. Aksi: mock."""
    if _has_exim():
        try:
            args = ["exiqgrep", "-a"]
            if only_frozen:
                args.append("-z")
            r = subprocess.run(args, capture_output=True, timeout=5, text=True)
            if r.returncode == 0:
                items = _parse_exiqgrep(r.stdout)[:limit]
                return {"items": items, "source": "exim", "count": len(items)}
        except Exception:
            pass
    items = await _mock_queue(license_key, limit)
    if only_frozen:
        items = [i for i in items if i.get("frozen")]
    return {"items": items, "source": "mock", "count": len(items)}


@router.get("/stats")
async def queue_stats(license_key: Optional[str] = None):
    """Kuyruk özet: total, frozen, delay > 4h, retries."""
    if _has_exim():
        try:
            r = subprocess.run(["exim", "-bpc"], capture_output=True, timeout=5, text=True)
            total = int((r.stdout or "0").strip() or "0")
            rz = subprocess.run(["exim", "-bpr"], capture_output=True, timeout=5, text=True)
            frozen = sum(1 for _l in (rz.stdout or "").splitlines() if "*** frozen ***" in _l)
            return {"total": total, "frozen": frozen, "source": "exim"}
        except Exception:
            pass
    items = await _mock_queue(license_key, 500)
    return {
        "total": len(items),
        "frozen": sum(1 for i in items if i.get("frozen")),
        "high_spam": sum(1 for i in items if i.get("verdict") == "high_spam"),
        "source": "mock",
    }


class QueueAction(BaseModel):
    license_key: Optional[str] = None
    mids: list[str] = Field(..., min_length=1, max_length=500)
    action: str = Field(..., pattern="^(remove|deliver|retry|freeze|thaw|bounce)$")
    forward_to: Optional[str] = None  # for `deliver` with recipient override


def _exim_cmd_for(action: str) -> Optional[list[str]]:
    return {
        "remove":  ["exim", "-Mrm"],   # kuyruktan sil
        "deliver": ["exim", "-M"],     # zorla teslim
        "retry":   ["exim", "-Mc"],    # yeni deneme
        "freeze":  ["exim", "-Mf"],    # dondur
        "thaw":    ["exim", "-Mt"],    # çöz
        "bounce":  ["exim", "-Mg"],    # geri döndür
    }.get(action)


@router.post("/bulk")
async def bulk_action(payload: QueueAction):
    """Kuyruk üzerinde toplu işlem. Gerçek exim varsa çağırır, aksi halde audit log'a yazar."""
    results = []
    real = _has_exim()
    base = _exim_cmd_for(payload.action)
    if not base:
        raise HTTPException(400, f"Desteklenmeyen aksiyon: {payload.action}")
    for mid in payload.mids:
        entry = {"mid": mid, "action": payload.action}
        if real:
            try:
                r = subprocess.run([*base, mid], capture_output=True, timeout=8, text=True)
                entry["ok"] = r.returncode == 0
                entry["out"] = (r.stdout or r.stderr or "").strip()[:200]
            except Exception as ex:
                entry["ok"] = False
                entry["out"] = f"{type(ex).__name__}: {ex}"
        else:
            entry["ok"] = True
            entry["out"] = "mock (WHM ortaminda calisir)"
        results.append(entry)
        await db.queue_audit.insert_one({
            "license_key": payload.license_key,
            "mid": mid, "action": payload.action, "ok": entry["ok"],
            "forward_to": payload.forward_to,
            "created_at": _iso(),
            "output": entry["out"],
        })
    ok = sum(1 for r in results if r["ok"])
    return {"ok": True, "processed": len(results), "success": ok, "failed": len(results) - ok,
            "source": "exim" if real else "mock", "results": results}


@router.get("/audit")
async def audit_log(license_key: Optional[str] = None, limit: int = Query(50, ge=1, le=200)):
    q = {"license_key": license_key} if license_key else {}
    rows = await db.queue_audit.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}
