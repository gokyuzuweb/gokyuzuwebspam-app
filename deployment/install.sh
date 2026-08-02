#!/usr/bin/env bash
# ============================================================================
# GökyüzüWebSpam · Tam Otomatik Sunucu Kurulumu
# ----------------------------------------------------------------------------
# Sıfır Ubuntu 22.04+ sunucusunda çalışır. Docker + Nginx + SSL + Cron dahil.
#
# KULLANIM:
#   ssh root@SUNUCU_IP
#   git clone https://github.com/USER/REPO.git /opt/gokyuzuwebspam-app
#   cd /opt/gokyuzuwebspam-app/deployment
#   sudo bash install.sh
# ============================================================================

set -e

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${G}[✓]${NC} $1"; }
warn() { echo -e "${Y}[!]${NC} $1"; }
err()  { echo -e "${R}[✗]${NC} $1" >&2; exit 1; }
info() { echo -e "${B}[ℹ]${NC} $1"; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ "$EUID" -eq 0 ] || err "Bu script root olarak çalıştırılmalı: sudo bash $0"

clear
echo -e "${B}╔══════════════════════════════════════════════╗${NC}"
echo -e "${B}║   GökyüzüWebSpam — Tam Otomatik Kurulum      ║${NC}"
echo -e "${B}╚══════════════════════════════════════════════╝${NC}"
echo ""

read -p "🌐 Domain (örn: gokyuzuhosting.com): " DOMAIN
[ -z "$DOMAIN" ] && err "Domain zorunlu!"

read -p "📧 SSL için e-posta: " EMAIL
[ -z "$EMAIL" ] && err "E-posta zorunlu!"

read -p "🔐 Master Lisans (boş = otomatik üret): " MASTER_LICENSE
[ -z "$MASTER_LICENSE" ] && MASTER_LICENSE="MS-$(openssl rand -hex 12 | tr 'a-f' 'A-F')"

read -p "⚙️  Otomatik güncelleme cron aktif olsun mu? (E/H) [E]: " ENABLE_CRON
ENABLE_CRON="${ENABLE_CRON:-E}"

SERVER_IP=$(curl -s -m 5 ifconfig.me || curl -s -m 5 ipinfo.io/ip || hostname -I | awk '{print $1}')

echo ""
info "───────────────── AYARLAR ─────────────────"
info "Domain:      $DOMAIN"
info "IP:          $SERVER_IP"
info "E-posta:     $EMAIL"
info "Master Key:  $MASTER_LICENSE"
info "App Dir:     $APP_DIR"
info "Cron:        $ENABLE_CRON"
info "───────────────────────────────────────────"
echo ""
read -p "Devam edilsin mi? (E/H) [E]: " CONFIRM
[ "$CONFIRM" = "H" ] && exit 0

log "Sistem paketleri güncelleniyor..."
apt-get update -qq && apt-get upgrade -y -qq

log "Docker + Nginx + Certbot + Git kuruluyor..."
apt-get install -y -qq \
    docker.io docker-compose-plugin git nginx \
    certbot python3-certbot-nginx \
    curl wget ufw jq openssl 2>&1 | tail -3 || true

systemctl enable --now docker

log "Firewall (UFW) yapılandırılıyor..."
ufw --force default deny incoming > /dev/null
ufw --force default allow outgoing > /dev/null
ufw --force allow 22/tcp > /dev/null
ufw --force allow 80/tcp > /dev/null
ufw --force allow 443/tcp > /dev/null
ufw --force enable > /dev/null

log ".env dosyaları oluşturuluyor..."
cat > "$APP_DIR/backend/.env" << EOF
MONGO_URL=mongodb://mongo:27017
DB_NAME=gokyuzuwebspam_prod
MASTER_HOST=$DOMAIN
MASTER_IP=$SERVER_IP
MASTER_LICENSE_KEY=$MASTER_LICENSE
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://gokyuzubilgisayar.com
EOF

cat > "$APP_DIR/frontend/.env" << EOF
REACT_APP_BACKEND_URL=https://$DOMAIN
EOF

log "Docker container'lar build + start..."
cd "$APP_DIR/deployment"
[ -f docker-compose.yml ] || err "docker-compose.yml yok"

mkdir -p data/mongo data/uploads data/certs
docker compose up -d --build 2>&1 | tail -15

log "Container'ların ayağa kalkması bekleniyor..."
for i in {1..30}; do
    if docker compose ps 2>/dev/null | grep -qE "Up|running"; then
        log "Container'lar çalışıyor"
        break
    fi
    sleep 2
done

log "Nginx yapılandırılıyor..."
cat > /etc/nginx/sites-available/gokyuzuwebspam << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 25M;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300;
    }

    location /dist/ {
        alias $APP_DIR/dist/;
        autoindex off;
        add_header Cache-Control "public, max-age=3600";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 300;
    }
}
EOF

ln -sf /etc/nginx/sites-available/gokyuzuwebspam /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

log "SSL sertifikası alınıyor (Let's Encrypt)..."
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos --email "$EMAIL" --redirect 2>&1 | tail -5; then
    log "SSL kuruldu · HTTPS aktif"
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
    fi
else
    warn "SSL alınamadı — DNS yayılmasını bekleyip elle deneyin:"
    warn "   certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

if [[ "$ENABLE_CRON" =~ ^[Ee]$ ]]; then
    log "Otomatik güncelleme cron kuruluyor..."
    chmod +x "$APP_DIR/deployment/auto-update.sh" 2>/dev/null || true
    if ! crontab -l 2>/dev/null | grep -q "auto-update.sh"; then
        (crontab -l 2>/dev/null; echo "*/5 * * * * bash $APP_DIR/deployment/auto-update.sh >> /var/log/gws-update.log 2>&1") | crontab -
        log "Her 5 dakikada bir GitHub'dan otomatik senkronize edecek"
    fi
fi

log "MongoDB otomatik yedek cron..."
mkdir -p /var/backups/mongo
cat > /usr/local/bin/mongo-backup.sh << BACKUP
#!/bin/bash
cd $APP_DIR/deployment
DATE=\$(date +%F-%H%M)
docker compose exec -T mongo mongodump --archive --gzip --db=gokyuzuwebspam_prod > /var/backups/mongo/backup-\$DATE.gz 2>/dev/null
find /var/backups/mongo -name "backup-*.gz" -mtime +14 -delete
BACKUP
chmod +x /usr/local/bin/mongo-backup.sh
if ! crontab -l 2>/dev/null | grep -q "mongo-backup"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/mongo-backup.sh >> /var/log/mongo-backup.log 2>&1") | crontab -
fi

cat > /etc/logrotate.d/gokyuzuwebspam << 'EOF'
/var/log/gws-update.log
/var/log/mongo-backup.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    create 0644 root root
}
EOF

cat > /root/gokyuzuwebspam-credentials.txt << EOF
=========================================
  GökyüzüWebSpam · Kurulum Bilgileri
=========================================
Kurulum Tarihi: $(date '+%Y-%m-%d %H:%M:%S')

🌐 Panel URL:      https://$DOMAIN/panel
🔐 Master Lisans:  $MASTER_LICENSE
📧 Admin E-posta:  $EMAIL
📁 App Dizini:     $APP_DIR

Bu bilgileri güvenli bir yere kopyalayın!
=========================================
EOF
chmod 600 /root/gokyuzuwebspam-credentials.txt

echo ""
echo -e "${G}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${G}║           ✓ KURULUM TAMAMLANDI!                    ║${NC}"
echo -e "${G}╚════════════════════════════════════════════════════╝${NC}"
echo ""
info "🌐 Panel:         https://$DOMAIN/panel"
info "🔧 API Health:    https://$DOMAIN/api/version/current"
info "🔐 Master Key:    $MASTER_LICENSE"
info "📁 App Dir:       $APP_DIR"
info "📄 Kimlik dosya:  /root/gokyuzuwebspam-credentials.txt"
echo ""
info "📊 Yararlı komutlar:"
echo "   docker compose -f $APP_DIR/deployment/docker-compose.yml ps"
echo "   docker compose -f $APP_DIR/deployment/docker-compose.yml logs -f"
echo "   bash $APP_DIR/deployment/auto-update.sh"
echo "   crontab -l"
echo ""
warn "🚨 Master Key'i kaybetmeyin — panel erişimi için tek yol!"
echo ""
info "📖 Sonraki adımlar:"
echo "   1. Tarayıcıda https://$DOMAIN/panel açın"
echo "   2. Master Key ile giriş yapın"
echo "   3. Notifications → Admin e-postanızı ekleyin"
echo "   4. Lisans Yönetimi → Bayilerinizi ekleyin"
echo ""
