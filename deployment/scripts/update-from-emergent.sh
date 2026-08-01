#!/usr/bin/env bash
# Emergent'ten en son kodu senin sunucuna çek
# Kullanım: bash update-from-emergent.sh
# Bu script'i cron'a bağla: 0 3 * * * bash /opt/gws/deployment/scripts/update-from-emergent.sh
set -e
cd "$(dirname "$0")/.."

echo "[+] Emergent'ten en son kod çekiliyor..."
# Emergent Save-to-GitHub → bu repo → git pull
if [ -d "../.git" ]; then
    git -C .. fetch origin main
    git -C .. reset --hard origin/main
    echo "[+] Kod güncellendi. Container'lar yeniden build ediliyor..."
    docker compose build --pull backend frontend
    docker compose up -d
    echo "[+] Güncelleme tamamlandı."
else
    echo "[!] .git bulunamadı. Manuel: cd /opt/gws && git clone <REPO_URL> ."
fi
