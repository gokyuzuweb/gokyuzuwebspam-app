#!/usr/bin/env bash
# Backup'ı kendi sunucundaki Mongo container'ına geri yükle
# Kullanım: bash restore-db.sh /tmp/gws-backup.gz
set -e
[ -z "$1" ] && { echo "Kullanım: bash restore-db.sh <backup.gz>"; exit 1; }
BACKUP="$1"
DB_NAME="${DB_NAME:-gws_master}"

echo "[+] Backup restore: $BACKUP → $DB_NAME"
docker exec -i gws-mongo mongorestore \
    --archive --gzip \
    --nsFrom="test_database.*" --nsTo="$DB_NAME.*" \
    --drop < "$BACKUP"
echo "[+] Geri yükleme tamamlandı"
echo "[+] Doğrulama: docker exec -it gws-mongo mongosh $DB_NAME --eval 'db.mail_events.countDocuments()'"
