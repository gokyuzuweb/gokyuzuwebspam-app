"""
GökyüzüWebSpam Standalone License Server (v2.0 — Redis-backed cluster-ready)
============================================================================
Bir önceki v1.0 sürümü ile geriye uyumludur (aynı /v1/* endpoint'ler). Ek olarak:

- Redis üzerinden dağıtık **rate limiting** (INCR + EXPIRE) — DDoS koruması
- Redis üzerinden **license verify cache** (60s TTL) — sıcak yolda DB yükünü azaltır
- Redis üzerinden **replica coordination**: replica_id header'ı X-Replica-Id ile döner,
  aynı replica ID varsa istekler stateless olduğu için bir sonraki replica'ya geçer
- **/v2/cluster/health** endpoint'i: bu instance'ın ve peer'ların durumunu döner
- Redis'e ulaşılamazsa graceful degradation (Mongo-only mode)

Prod'da 3+ replica arkasında ingress/HAProxy round-robin yapar; bu servis stateless'tır.
Preview'de 2 replica çalıştırırız: port 8002 (primary) + 8003 (secondary). Ana backend
`PUBLIC_LICENSE_SERVER_URL` env üzerinden bunlar arasında rastgele/round-robin seçim yapar.
"""
from __future__ import annotations
import os
import uuid
import socket
import asyncio
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Header, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
try:
    import redis.asyncio as aioredis  # noqa
except Exception:
    aioredis = None  # graceful degradation

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
ADMIN_API_KEY = os.environ.get("LICENSE_SERVER_ADMIN_KEY", "gws-license-admin-key")
REDIS_URL = os.environ.get("LICENSE_SERVER_REDIS_URL", "redis://localhost:6379/0")
REPLICA_ID = os.environ.get("LICENSE_SERVER_REPLICA_ID") or f"replica-{socket.gethostname()}-{os.getpid()}"
RATE_LIMIT_PER_MIN = int(os.environ.get("LICENSE_SERVER_RATE_LIMIT", "120"))
VERIFY_CACHE_TTL = int(os.environ.get("LICENSE_SERVER_CACHE_TTL", "60"))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Redis lazy singleton
_redis = None


async def get_redis():
    global _redis
    if _redis is None and aioredis is not None:
        try:
            _redis = aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
            await _redis.ping()
        except Exception:
            _redis = None
    return _redis


app = FastAPI(title="GökyüzüWebSpam License Server", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def cluster_middleware(request: Request, call_next):
    """Stamp responses with X-Replica-Id and enforce distributed rate limit."""
    # Rate limit: per-license-key (from body/query) OR per-IP fallback
    r = await get_redis()
    if r is not None:
        key = request.headers.get("x-license-key") or request.query_params.get("license_key")
        ip = request.client.host if request.client else "unknown"
        bucket = f"rl:{key or ip}:{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}"
        try:
            n = await r.incr(bucket)
            if n == 1:
                await r.expire(bucket, 65)
            if n > RATE_LIMIT_PER_MIN:
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=429, content={"error": "rate_limited", "limit_per_min": RATE_LIMIT_PER_MIN})
        except Exception:
            pass  # degrade
    response = await call_next(request)
    response.headers["X-Replica-Id"] = REPLICA_ID
    response.headers["X-Server-Version"] = "2.0.0"
    return response


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- Models -----------------------------------------------------------------
class HeartbeatIn(BaseModel):
    license_key: str
    server_ip: str
    hostname: Optional[str] = ""
    plugin_version: Optional[str] = ""
    engines_active: List[str] = Field(default_factory=list)
    scanned_last_hour: int = 0


class HeartbeatOut(BaseModel):
    ok: bool
    status: str
    message: str = ""
    valid_until: Optional[str] = None
    latest_version: Optional[str] = None
    server_time: str = Field(default_factory=_iso)
    replica_id: str = REPLICA_ID


class RevokeIn(BaseModel):
    license_key: str
    reason: str = ""


# ---- Endpoints --------------------------------------------------------------
@app.get("/v1/health")
async def health():
    r = await get_redis()
    redis_ok = False
    if r:
        try:
            pong = await r.ping()
            redis_ok = bool(pong)
        except Exception:
            redis_ok = False
    return {
        "service": "gws-license-server",
        "version": "2.0.0",
        "replica_id": REPLICA_ID,
        "redis": {"connected": redis_ok, "url": REDIS_URL if redis_ok else None},
        "time": _iso(),
    }


@app.get("/v2/cluster/health")
async def cluster_health():
    """Reports all known replica heartbeats via Redis 'replica:*' keys."""
    r = await get_redis()
    replicas = []
    if r:
        try:
            # Refresh own heartbeat (10s TTL)
            await r.setex(f"replica:{REPLICA_ID}", 30, _iso())
            async for k in r.scan_iter("replica:*", count=100):
                v = await r.get(k)
                replicas.append({"replica_id": k.split(":", 1)[1], "last_seen": v})
        except Exception as e:
            return {"error": str(e), "self": REPLICA_ID}
    return {
        "self": REPLICA_ID,
        "replicas": replicas,
        "cluster_size": len(replicas),
        "healthy": len(replicas) > 0,
    }


async def _check_and_maybe_cache(license_key: str, server_ip: str) -> Optional[dict]:
    """Return cached verify decision if present (Redis)."""
    r = await get_redis()
    if not r:
        return None
    try:
        cache_key = f"verify:{license_key}:{server_ip}"
        v = await r.get(cache_key)
        if v:
            import json
            return json.loads(v)
    except Exception:
        return None
    return None


async def _cache_verify(license_key: str, server_ip: str, payload: dict):
    r = await get_redis()
    if not r:
        return
    try:
        import json
        await r.setex(f"verify:{license_key}:{server_ip}", VERIFY_CACHE_TTL, json.dumps(payload))
    except Exception:
        pass


async def _invalidate_verify(license_key: str):
    r = await get_redis()
    if not r:
        return
    try:
        async for k in r.scan_iter(f"verify:{license_key}:*", count=100):
            await r.delete(k)
    except Exception:
        pass


@app.post("/v1/heartbeat", response_model=HeartbeatOut)
async def heartbeat(payload: HeartbeatIn, request: Request):
    """Called by WHM plugin heartbeat daemon every ~5 minutes."""
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    if not lic:
        await db.license_violations.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "reason": "unknown_license_key",
            "at": _iso(),
            "replica_id": REPLICA_ID,
        })
        return HeartbeatOut(ok=False, status="unknown", message="Lisans anahtarı bilinmiyor")

    if not lic.get("active", True):
        return HeartbeatOut(ok=False, status="expired", message="Lisans devre dışı", valid_until=lic.get("valid_until"))

    try:
        vu = datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00"))
        if vu < datetime.now(timezone.utc):
            return HeartbeatOut(ok=False, status="expired",
                                message="Lisans süresi dolmuş — /shop üzerinden yenileyin",
                                valid_until=lic["valid_until"])
    except Exception:
        pass

    allowed_ips = lic.get("ip_addresses") or lic.get("allowed_ips") or []
    if allowed_ips and payload.server_ip not in allowed_ips:
        await db.license_violations.insert_one({
            "id": str(uuid.uuid4()),
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "reason": "ip_mismatch",
            "allowed_ips": allowed_ips,
            "at": _iso(),
            "replica_id": REPLICA_ID,
        })
        return HeartbeatOut(
            ok=False, status="violation",
            message=f"IP {payload.server_ip} bu lisans için yetkili değil",
            valid_until=lic.get("valid_until"),
        )

    if not allowed_ips:
        await db.licenses.update_one(
            {"license_key": payload.license_key},
            {"$set": {"ip_addresses": [payload.server_ip]}},
        )
        await _invalidate_verify(payload.license_key)

    await db.license_heartbeats.update_one(
        {"license_key": payload.license_key},
        {"$set": {
            "license_key": payload.license_key,
            "server_ip": payload.server_ip,
            "hostname": payload.hostname or "",
            "plugin_version": payload.plugin_version or "",
            "engines_active": payload.engines_active,
            "scanned_last_hour": payload.scanned_last_hour,
            "last_seen_at": _iso(),
            "last_replica_id": REPLICA_ID,
        }},
        upsert=True,
    )

    manifest = await db.version_manifest.find_one({}, {"_id": 0}) or {}
    return HeartbeatOut(
        ok=True, status="active", message="OK",
        valid_until=lic.get("valid_until"),
        latest_version=manifest.get("latest_version"),
    )


@app.get("/v1/verify")
async def verify(license_key: str, server_ip: str):
    """Idempotent verify with Redis cache (60s TTL). Falls back to Mongo if cache miss."""
    cached = await _check_and_maybe_cache(license_key, server_ip)
    if cached:
        cached["cache_hit"] = True
        cached["replica_id"] = REPLICA_ID
        return cached

    lic = await db.licenses.find_one({"license_key": license_key}, {"_id": 0})
    result: dict
    if not lic:
        result = {"valid": False, "reason": "unknown_key"}
    elif not lic.get("active", True):
        result = {"valid": False, "reason": "inactive"}
    else:
        try:
            vu = datetime.fromisoformat(lic["valid_until"].replace("Z", "+00:00"))
            if vu < datetime.now(timezone.utc):
                result = {"valid": False, "reason": "expired", "valid_until": lic["valid_until"]}
            else:
                allowed = lic.get("ip_addresses") or lic.get("allowed_ips") or []
                if allowed and server_ip not in allowed:
                    result = {"valid": False, "reason": "ip_mismatch", "allowed_count": len(allowed)}
                else:
                    result = {
                        "valid": True,
                        "plan": lic.get("plan", "pro"),
                        "valid_until": lic["valid_until"],
                        "customer_name": lic.get("customer_name", ""),
                    }
        except Exception:
            result = {"valid": False, "reason": "invalid_date"}

    await _cache_verify(license_key, server_ip, result)
    result["cache_hit"] = False
    result["replica_id"] = REPLICA_ID
    return result


@app.post("/v1/revoke")
async def revoke(payload: RevokeIn, x_admin_key: Optional[str] = Header(default=None)):
    if x_admin_key != ADMIN_API_KEY:
        raise HTTPException(401, "X-Admin-Key gerekli")
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı")
    await db.licenses.update_one(
        {"license_key": payload.license_key},
        {"$set": {"active": False, "revoked_at": _iso(), "revoke_reason": payload.reason}},
    )
    await _invalidate_verify(payload.license_key)
    return {"revoked": True, "license_key": payload.license_key, "replica_id": REPLICA_ID}


@app.on_event("startup")
async def register_replica():
    """Register self in Redis for cluster discovery."""
    async def _tick():
        while True:
            r = await get_redis()
            if r:
                try:
                    await r.setex(f"replica:{REPLICA_ID}", 30, _iso())
                except Exception:
                    pass
            await asyncio.sleep(10)
    asyncio.create_task(_tick())
