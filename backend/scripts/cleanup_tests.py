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
    r1 = await db.rules.delete_many({"name": {"$in": ["BAYİ-TEST", "MASTER-FOR-BAYI"]}})
    r2 = await db.settings.delete_many({"_key": {"$regex": "^policy:"}})
    print(f"cleaned {r1.deleted_count} test rules, {r2.deleted_count} bayi policy docs")

asyncio.run(main())
