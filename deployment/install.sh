#!/usr/bin/env bash
# ============================================================================
# GökyüzüWebSpam · Self-Host Kurulum Scripti
# Kullanım: sudo bash install.sh
# Ubuntu 22.04+ / Debian 12+ / AlmaLinux 9+
# ============================================================================

set -e
cd "$(dirname "$0")"

# ---- Renk ----
G="\033[0;32m"; Y="\033[1;33m"; R="\033[0;31m"; NC="\033[0m"

log() { echo -e "${G}[+]${NC} $1"; }
warn() { echo -e "${Y}[!]${NC} $1"; }
err() { echo -e "${R}[✗]${NC} $1" >&2; exit 1; }

[ "$EUID" -eq 0 ] || err "Bu script root olarak çalıştırılmalı: sudo bash install.sh"

# ---- Docker kur ----
if ! command -v docker &>/dev/null; then
    log "Docker kuruluyor..."
    curl -fsSL https://get.docker.com | sh
fi
if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
    log "Docker Compose plugin kuruluyor..."
    apt-get install -y docker-compose-plugin 2>/dev/null || \
        curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
            -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
fi

# ---- .env kontrol ----
if [ ! -f "backend.env" ]; then
    err "backend.env bulunamadı. Örnek dosyayı düzenleyip tekrar deneyin."
fi

# ---- Dizinleri hazırla ----
log "Veri dizinleri hazırlanıyor..."
mkdir -p data/mongo data/mongo-config data/uploads data/certs

# ---- Self-signed sertifika (Let's Encrypt gelene kadar) ----
if [ ! -f "data/certs/fullchain.pem" ]; then
    warn "SSL sertifikası yok, geçici self-signed oluşturuluyor..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -keyout data/certs/privkey.pem \
        -out data/certs/fullchain.pem \
        -subj "/CN=panel.gokyuzuhosting.com" 2>/dev/null
    warn "Certbot ile gerçek SSL almak için: certbot certonly --standalone -d panel.gokyuzuhosting.com"
fi

# ---- Compose başlat ----
log "Docker container'ları build ediliyor + başlatılıyor..."
docker compose up -d --build 2>/dev/null || docker-compose up -d --build

# ---- Durum ----
sleep 8
log "Kurulum tamamlandı! Durum:"
docker compose ps 2>/dev/null || docker-compose ps

echo ""
log "🎉 Panel: https://panel.gokyuzuhosting.com"
log "📊 Backend API: https://panel.gokyuzuhosting.com/api/health"
log "🔍 Log takibi: docker compose logs -f backend"
echo ""
warn "İlk kurulumda MongoDB boş — mevcut Emergent verilerinizi taşımak için:"
warn "   1. Emergent'te: bash scripts/dump-db.sh"
warn "   2. Sunucuna aktarın: scp gws-backup.gz kullanici@89.19.15.58:/tmp/"
warn "   3. Bu sunucuda: bash scripts/restore-db.sh /tmp/gws-backup.gz"
