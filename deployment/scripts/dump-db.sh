#!/usr/bin/env bash
# Emergent üzerindeki MongoDB'yi dump al — kendi sunucuna taşımak için
# Kullanım: bash dump-db.sh
set -e
MONGO_URL="${MONGO_URL:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-test_database}"
OUT="gws-backup-$(date +%Y%m%d-%H%M%S).gz"

echo "[+] MongoDB dump: $DB_NAME → $OUT"
mongodump --uri="$MONGO_URL" --db="$DB_NAME" --archive="$OUT" --gzip
echo "[+] Tamamlandı: $OUT"
echo "[+] Sunucunuza aktarın: scp $OUT root@89.19.15.58:/tmp/"
echo "[+] Sunucunuzda geri yükleme için: bash restore-db.sh /tmp/$OUT"
