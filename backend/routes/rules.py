"""
Rules Routes — extracted from monolithic server.py (v1.5 refactor).

/rules CRUD endpoint'leri. Multi-tenant scope helper'ları (_tenant_scope,
_require_feature, IMPERSONATE_COOKIE) hâlâ server.py'de — burada
`get_server_helpers()` factory ile lazy-load edilir. Böylece dairesel import
oluşmaz, ancak server.py'nin import edilmesi tamamlandıktan sonra çalışır
(startup akışında router register edildikten sonra istekler zaten geliyor).

NOT: `Rule` ve `ActivityLog` model'leri de server.py'de tanımlıdır. Burada
inline pydantic RuleIn kullanıyoruz + doc oluşturmak için manuel dict.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from deps import db


router = APIRouter(tags=["rules"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _helpers():
    """Lazy-load server.py helpers (_tenant_scope, _require_feature).
    Import edildikten sonra bu fonksiyonlar her request için mevcuttur."""
    from server import _tenant_scope, _require_feature  # type: ignore
    return _tenant_scope, _require_feature


class RuleIn(BaseModel):
    name: str
    pattern: str
    score: float
    target: Literal["subject", "body", "header", "from", "any"] = "any"
    enabled: bool = True
    description: Optional[str] = ""


@router.get("/rules")
async def rules_get(request: Request, license_key: Optional[str] = None):
    _tenant_scope, _ = _helpers()
    scope = await _tenant_scope(request, license_key)
    q: dict = {}
    if scope["is_master"]:
        if scope["owner_license_key"]:
            q = {"owner_license_key": scope["owner_license_key"]}
    else:
        q = {"owner_license_key": scope["owner_license_key"]}
    return await db.rules.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/rules")
async def rules_add(rule: RuleIn, request: Request, license_key: Optional[str] = None):
    _tenant_scope, _require_feature = _helpers()
    scope = await _tenant_scope(request, license_key)
    if not scope["is_master"] and not scope["owner_license_key"]:
        raise HTTPException(403, "Kural eklemek için lisans gerekli")
    if not scope["is_master"]:
        await _require_feature(scope, "custom_rules")
    doc = rule.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = _iso()
    doc["owner_license_key"] = scope["owner_license_key"]
    await db.rules.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


async def _authorize_rule_action(rule_id: str, request: Request, license_key: Optional[str]) -> dict:
    _tenant_scope, _require_feature = _helpers()
    scope = await _tenant_scope(request, license_key)
    rule = await db.rules.find_one({"id": rule_id}, {"_id": 0})
    if not rule:
        raise HTTPException(404, "Kural bulunamadı")
    if scope["is_master"]:
        return rule
    if not scope["owner_license_key"] or rule.get("owner_license_key") != scope["owner_license_key"]:
        raise HTTPException(403, "Bu kural sizin lisansınıza ait değil")
    await _require_feature(scope, "custom_rules")
    return rule


@router.put("/rules/{rule_id}")
async def rules_update(rule_id: str, rule: RuleIn, request: Request, license_key: Optional[str] = None):
    existing = await _authorize_rule_action(rule_id, request, license_key)
    upd = rule.model_dump()
    upd["owner_license_key"] = existing.get("owner_license_key", "")
    r = await db.rules.update_one({"id": rule_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"updated": True}


@router.post("/rules/{rule_id}/update")
async def rules_update_post(rule_id: str, rule: RuleIn, request: Request, license_key: Optional[str] = None):
    return await rules_update(rule_id, rule, request, license_key)


@router.delete("/rules/{rule_id}")
async def rules_delete(rule_id: str, request: Request, license_key: Optional[str] = None):
    await _authorize_rule_action(rule_id, request, license_key)
    r = await db.rules.delete_one({"id": rule_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kural bulunamadı")
    return {"deleted": True}


@router.post("/rules/{rule_id}/delete")
async def rules_delete_post(rule_id: str, request: Request, license_key: Optional[str] = None):
    return await rules_delete(rule_id, request, license_key)
