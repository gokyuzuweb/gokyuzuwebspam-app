"""
Tenant izolasyon ortak modülü.

`server.py::_tenant_scope` ve `routes/queue.py::_resolve_tenant` daha önce
kod tekrarı yapıyordu. Şimdi tek kaynak: `resolve_tenant_scope()`.

Kullanım::

    from tenant import resolve_tenant_scope
    scope = await resolve_tenant_scope(request, license_key_arg)
    # scope = {
    #     "is_master": bool,
    #     "owner_license_key": str,  # bayi lisansı VEYA "" (master herşey) VEYA "__none__" (izole)
    # }

Kurallar (öncelik sırası):
1. `x-master-key` header VEYA `gws_master_session` cookie → is_master=True.
   `license_key_arg` verildiyse (ve master key değilse) drill-down key olarak
   kullanılır (`owner_license_key=<arg>`), aksi halde owner_license_key="".
2. `license_key_arg == MASTER_KEY` VE client IP == MASTER_IP → is_master=True
   (legacy WHM plugin akışı, IP guard ile query-string escalation önlenir).
3. `license_key_arg` verilmişse `db.licenses` collection'da doğrula. Var ise
   bayi olarak kabul edilir; `owner_license_key=<arg>`.
4. Fallback: WHM plugin'in kendi `plugin_state.main` state'i. Bu SaaS master
   ortamında master lisansını içerdiği için, ancak master_key ile eşleşmiyorsa
   bayi olarak kabul edilir.
5. Hiçbiri eşleşmiyorsa → `owner_license_key="__none__"` (izole, hiç veri görmez).
"""
from __future__ import annotations
import os
from typing import Optional
from fastapi import Request

# Constants
QUEUE_SOURCE_VALUES = ("db", "exim", "exim+db", "mock")  # /api/queue* response.source geçerli değerleri


async def resolve_tenant_scope(
    request: Request,
    license_key_arg: Optional[str],
    db,
) -> dict:
    """Bkz. modül docstring'i.

    `db` async Motor bağlantısı — çağıran yerden geçirilir (server.py'nin `db`
    global'ı veya `deps.db`). Bu sayede modül loop-free / test edilebilir."""
    master_env = os.environ.get("MASTER_LICENSE_KEY", "")
    master_ip_env = os.environ.get("MASTER_IP", "")
    hdr = request.headers.get("x-master-key") or ""
    cookie = request.cookies.get("gws_master_session") or ""

    # 1) Master via header/cookie
    if master_env and (hdr == master_env or cookie == master_env):
        target = (
            license_key_arg
            if (license_key_arg and license_key_arg != master_env)
            else ""
        )
        return {"is_master": True, "owner_license_key": target}

    # 2) Legacy WHM plugin: license_key_arg = master_env AND IP eşleşiyor
    if master_env and license_key_arg == master_env:
        xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        client_ip = xff or (request.client.host if request.client else "")
        if master_ip_env and client_ip == master_ip_env:
            return {"is_master": True, "owner_license_key": ""}

    # 3) Bayi: license_key_arg VEYA X-Master-Key header (bayi kendi anahtarını header'da yollar)
    candidate = (license_key_arg or hdr or "").strip()
    if candidate and candidate != master_env and candidate.startswith("MS-"):
        lic_doc = await db.licenses.find_one(
            {"license_key": candidate},
            {"_id": 0, "license_key": 1, "status": 1, "license_type": 1},
        )
        if lic_doc:
            return {"is_master": False, "owner_license_key": candidate}

    # 4) Fallback: WHM plugin_state (kendi sunucusundaki bayi plugin için)
    st = await db.plugin_state.find_one({"_id": "main"}, {"_id": 0, "license_key": 1}) or {}
    lk = st.get("license_key") or ""
    if lk and lk != master_env:
        return {"is_master": False, "owner_license_key": lk}

    # 5) Hiçbir eşleşme yok → izole
    return {"is_master": False, "owner_license_key": "__none__"}
