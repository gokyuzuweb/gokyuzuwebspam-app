import asyncio
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient

env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

async def m():
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    d = await db.licenses.find_one({}, {"_id": 0, "valid_until": 1, "expires_at": 1, "license_key": 1, "customer_email": 1, "plan": 1})
    print("license sample:", d)
    n_ea = await db.licenses.count_documents({"expires_at": {"$exists": True}})
    n_vu = await db.licenses.count_documents({"valid_until": {"$exists": True}})
    print(f"expires_at exists in {n_ea}, valid_until exists in {n_vu}")

asyncio.run(m())
