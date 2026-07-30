"""
Reseller / sub-account routes (v1.4).

Each reseller is a paying customer (identified by license_key) with a set of
sub-accounts (cPanel-style usernames + emails). Reseller JWT auth restricts
what quarantine / lists / etc. rows they can see (owner_username = one of their
sub-accounts). Seller is unrestricted; sub-accounts scope filtering is
enforced at query time.

Endpoints:
  POST /reseller/auth/register  — reseller creates their portal account
  POST /reseller/auth/login     — returns JWT (subject = license_key)
  GET  /reseller/me             — returns reseller profile + subaccounts
  POST /reseller/subaccounts    — add sub-account
  DEL  /reseller/subaccounts/{id}
  PUT  /reseller/subaccounts/{id}
  GET  /reseller/quarantine     — scoped quarantine (JWT required)
  GET  /reseller/lists          — scoped whitelist/blacklist (JWT required)
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import jwt
import bcrypt
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field, EmailStr
from deps import db

router = APIRouter(prefix="/reseller", tags=["reseller"])

JWT_SECRET = os.environ.get("RESELLER_JWT_SECRET", "gws-reseller-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_HOURS = 24


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- Models -----------------------------------------------------------------
class ResellerRegister(BaseModel):
    license_key: str
    email: EmailStr
    password: str = Field(min_length=8)
    company: Optional[str] = ""


class ResellerLogin(BaseModel):
    email: EmailStr
    password: str


class SubAccount(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reseller_id: str = ""
    username: str
    email: EmailStr
    domain: str = ""
    quota_daily: int = 5000
    created_at: str = Field(default_factory=_iso)
    active: bool = True


class SubAccountCreate(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    email: EmailStr
    domain: str = ""
    quota_daily: int = 5000


class SubAccountUpdate(BaseModel):
    email: Optional[EmailStr] = None
    domain: Optional[str] = None
    quota_daily: Optional[int] = None
    active: Optional[bool] = None


# ---- Auth helpers -----------------------------------------------------------
def _make_token(reseller_id: str, license_key: str) -> str:
    payload = {
        "sub": reseller_id,
        "lic": license_key,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_reseller(authorization: Optional[str] = Header(default=None)) -> dict:
    """Extract reseller from `Authorization: Bearer <jwt>`."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token gerekli")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token süresi doldu")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Geçersiz token")
    r = await db.resellers.find_one({"id": claims.get("sub")}, {"_id": 0})
    if not r or not r.get("active", True):
        raise HTTPException(401, "Bayi bulunamadı ya da devre dışı")
    return r


# ---- Auth endpoints ---------------------------------------------------------
@router.post("/auth/register")
async def register(payload: ResellerRegister):
    # Validate license exists and is not seed/demo
    lic = await db.licenses.find_one({"license_key": payload.license_key}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Lisans anahtarı bulunamadı — önce /shop üzerinden satın alın")
    if not lic.get("active", True):
        raise HTTPException(403, "Bu lisans devre dışı")
    # Enforce single reseller per license
    existing = await db.resellers.find_one({"license_key": payload.license_key}, {"_id": 0})
    if existing:
        raise HTTPException(409, "Bu lisans için zaten bir bayi hesabı var — giriş yapın")
    # Enforce unique email
    if await db.resellers.find_one({"email": payload.email.lower()}, {"_id": 0}):
        raise HTTPException(409, "Bu e-posta zaten kayıtlı")
    pwd_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    rid = str(uuid.uuid4())
    doc = {
        "id": rid,
        "license_key": payload.license_key,
        "email": payload.email.lower(),
        "password_hash": pwd_hash,
        "company": payload.company or lic.get("customer_name", ""),
        "plan": lic.get("plan", "pro"),
        "created_at": _iso(),
        "active": True,
    }
    await db.resellers.insert_one(doc)
    token = _make_token(rid, payload.license_key)
    return {"token": token, "reseller_id": rid, "plan": doc["plan"]}


@router.post("/auth/login")
async def login(payload: ResellerLogin):
    r = await db.resellers.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not r or not bcrypt.checkpw(payload.password.encode(), r["password_hash"].encode()):
        raise HTTPException(401, "Geçersiz e-posta veya şifre")
    if not r.get("active", True):
        raise HTTPException(403, "Hesabınız devre dışı")
    token = _make_token(r["id"], r["license_key"])
    return {"token": token, "reseller_id": r["id"], "plan": r.get("plan", "pro"), "company": r.get("company", "")}


@router.get("/me")
async def me(reseller: dict = Depends(current_reseller)):
    subs = await db.subaccounts.find({"reseller_id": reseller["id"]}, {"_id": 0}).to_list(500)
    # Attach live license
    lic = await db.licenses.find_one({"license_key": reseller["license_key"]}, {"_id": 0}) or {}
    return {
        "reseller": {
            "id": reseller["id"],
            "email": reseller["email"],
            "company": reseller.get("company", ""),
            "plan": reseller.get("plan", "pro"),
            "license_key": reseller["license_key"],
            "valid_until": lic.get("valid_until"),
        },
        "subaccounts": subs,
        "quota": {
            "max_subaccounts": {"starter": 5, "pro": 50, "enterprise": 999}.get(reseller.get("plan", "pro"), 50),
            "current": len(subs),
        },
    }


# ---- Sub-account CRUD -------------------------------------------------------
@router.get("/subaccounts")
async def list_subs(reseller: dict = Depends(current_reseller)):
    return await db.subaccounts.find({"reseller_id": reseller["id"]}, {"_id": 0}).to_list(500)


@router.post("/subaccounts")
async def add_sub(payload: SubAccountCreate, reseller: dict = Depends(current_reseller)):
    # Enforce plan quota
    quota = {"starter": 5, "pro": 50, "enterprise": 999}.get(reseller.get("plan", "pro"), 50)
    existing_count = await db.subaccounts.count_documents({"reseller_id": reseller["id"]})
    if existing_count >= quota:
        raise HTTPException(403, f"Plan kotanız dolu ({quota}). Planı yükseltmeyi düşünün.")
    # Enforce unique username within reseller
    if await db.subaccounts.find_one({"reseller_id": reseller["id"], "username": payload.username}):
        raise HTTPException(409, "Bu kullanıcı adı zaten kayıtlı")
    sub = SubAccount(reseller_id=reseller["id"], **payload.model_dump())
    await db.subaccounts.insert_one(sub.model_dump())
    return sub.model_dump()


@router.put("/subaccounts/{sid}")
async def update_sub(sid: str, payload: SubAccountUpdate, reseller: dict = Depends(current_reseller)):
    existing = await db.subaccounts.find_one({"id": sid, "reseller_id": reseller["id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Alt hesap bulunamadı")
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    await db.subaccounts.update_one({"id": sid}, {"$set": upd})
    return await db.subaccounts.find_one({"id": sid}, {"_id": 0})


@router.delete("/subaccounts/{sid}")
async def del_sub(sid: str, reseller: dict = Depends(current_reseller)):
    res = await db.subaccounts.delete_one({"id": sid, "reseller_id": reseller["id"]})
    if not res.deleted_count:
        raise HTTPException(404, "Alt hesap bulunamadı")
    return {"deleted": True}


# ---- Scoped quarantine + lists ---------------------------------------------
async def _scoped_recipients(reseller: dict) -> List[str]:
    """Return list of email addresses / usernames this reseller may see rows for."""
    subs = await db.subaccounts.find({"reseller_id": reseller["id"]}, {"_id": 0}).to_list(500)
    emails = [s["email"] for s in subs]
    users = [s["username"] for s in subs]
    return emails + users


@router.get("/quarantine")
async def scoped_quarantine(reseller: dict = Depends(current_reseller), limit: int = 200):
    scope = await _scoped_recipients(reseller)
    if not scope:
        return []
    q = {"$or": [
        {"recipient": {"$in": scope}},
        {"owner_username": {"$in": scope}},
    ]}
    return await db.quarantine.find(q, {"_id": 0}).sort("received_at", -1).to_list(limit)


@router.get("/lists")
async def scoped_lists(reseller: dict = Depends(current_reseller)):
    """Return this reseller's own whitelist/blacklist entries only.
    Global (owner=None) entries are NOT included — resellers manage their own.
    """
    q = {"owner_reseller_id": reseller["id"]}
    return await db.lists.find(q, {"_id": 0}).to_list(500)


class ListEntry(BaseModel):
    type: str  # whitelist | blacklist
    value: str
    comment: str = ""


@router.post("/lists")
async def add_list_entry(payload: ListEntry, reseller: dict = Depends(current_reseller)):
    if payload.type not in ("whitelist", "blacklist"):
        raise HTTPException(400, "type: whitelist|blacklist olmalı")
    doc = {
        "id": str(uuid.uuid4()),
        "type": payload.type,
        "value": payload.value.strip().lower(),
        "comment": payload.comment,
        "owner_reseller_id": reseller["id"],
        "date": _iso(),
    }
    await db.lists.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/lists/{lid}")
async def del_list_entry(lid: str, reseller: dict = Depends(current_reseller)):
    res = await db.lists.delete_one({"id": lid, "owner_reseller_id": reseller["id"]})
    if not res.deleted_count:
        raise HTTPException(404, "Kayıt bulunamadı")
    return {"deleted": True}
