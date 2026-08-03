import asyncio, os, uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

# Read env manually
env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

async def main():
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    reseller = await db.resellers.find_one({}, {"license_key": 1})
    if not reseller:
        print("no reseller"); return
    lk = reseller["license_key"]
    now = datetime.now(timezone.utc)
    docs = []
    for i in range(15):
        docs.append({"id": str(uuid.uuid4()), "license_key": lk, "verdict": "spam", "ts": (now - timedelta(minutes=i)).isoformat()})
    for i in range(5):
        docs.append({"id": str(uuid.uuid4()), "license_key": lk, "verdict": "virus", "ts": (now - timedelta(minutes=i+15)).isoformat()})
    for i in range(2):
        docs.append({"id": str(uuid.uuid4()), "license_key": lk, "verdict": "phish", "ts": (now - timedelta(minutes=i+20)).isoformat()})
    for i in range(3):
        docs.append({"id": str(uuid.uuid4()), "license_key": lk, "verdict": "clean", "ts": (now - timedelta(minutes=i+25)).isoformat()})
    await db.mail_events.insert_many(docs)
    print(f"seeded {len(docs)} events for {lk}")

asyncio.run(main())
