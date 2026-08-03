"""Engines koleksiyonundaki eski unique index'i (sadece `name`) kompozit
`(name, owner_license_key)` unique index ile değiştirir. Böylece hem master
template hem her bayinin kendi engine kaydı yan yana durabilir."""
import asyncio
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient

env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

async def main():
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    # Mevcut index'i bul
    for ix in await db.engines.index_information().__await__() if False else await db.engines.list_indexes().to_list(50):
        print(f"existing index: {ix.get('name')} keys={ix.get('key')} unique={ix.get('unique', False)}")
    # Eski name_1 unique index'ini kaldır
    try:
        await db.engines.drop_index("name_1")
        print("✓ dropped name_1 unique index")
    except Exception as e:
        print(f"skip drop name_1: {e}")
    # Yeni kompozit unique index
    try:
        await db.engines.create_index(
            [("name", 1), ("owner_license_key", 1)], unique=True, name="name_owner_unique",
        )
        print("✓ created name_owner_unique composite index")
    except Exception as e:
        print(f"index create failed: {e}")

asyncio.run(main())
