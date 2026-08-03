"""Migration: engines koleksiyonundaki eski (scope'suz) kayıtlara
`owner_license_key: ""` field'ı ekler → master global template olurlar.
Bayi ilk kez /api/engines çağırdığında bu template'den kendi kopyasını
seed'ler. Idempotent."""
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

    # Engines
    r1 = await db.engines.update_many(
        {"owner_license_key": {"$exists": False}},
        {"$set": {"owner_license_key": ""}},
    )
    print(f"engines: {r1.modified_count} rows tagged as master template")

    # Rules (backfill)
    r2 = await db.rules.update_many(
        {"owner_license_key": {"$exists": False}},
        {"$set": {"owner_license_key": ""}},
    )
    print(f"rules: {r2.modified_count} rows tagged as master template")

    # Settings 'policy' key: master template olarak kalsın; bayi lisansı
    # olan başka bir policy dokümanı yoksa yeni key formatı 'policy:{license_key}'
    # ilk çağrıda oluşacak.
    p = await db.settings.count_documents({"_key": "policy"})
    print(f"settings.policy master key: {p} row(s) (unchanged)")

asyncio.run(main())
