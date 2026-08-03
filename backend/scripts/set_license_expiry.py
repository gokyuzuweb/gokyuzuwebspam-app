"""Test için: kurulu plugin license'ının valid_until'ini yakın bir tarihe çeker,
sonra renewal-info + banner'ı canlı görebilirsiniz. Sonra geri döndürür."""
import asyncio, sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

async def main(days=10, restore=False):
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    # Plugin state'inden hangi lisans yüklü olduğunu bul
    ps = await db.settings.find_one({"_key": "plugin_state"}, {"_id": 0})
    lk = ps.get("license_key") if ps else None
    if not lk:
        print("no license installed"); return
    lic = await db.licenses.find_one({"license_key": lk}, {"_id": 0})
    if not lic:
        print(f"license doc missing for {lk}"); return
    if restore:
        new_vu = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
    else:
        new_vu = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    await db.licenses.update_one({"license_key": lk}, {"$set": {"valid_until": new_vu}})
    # plugin_state cache'i de güncelle
    await db.settings.update_one({"_key": "plugin_state"}, {"$set": {"license_expires": new_vu}})
    print(f"license {lk[:12]}... valid_until → {new_vu} (days={days if not restore else 365})")

if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    restore = "--restore" in sys.argv
    asyncio.run(main(days, restore))
