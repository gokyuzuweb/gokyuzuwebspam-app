#!/usr/bin/env bash
# ============================================================================
# GökyüzüWebSpam — İlk Kurulum: Docker Klasörünü GitHub'a Bağla
# ----------------------------------------------------------------------------
# Bu script SADECE İLK SEFER çalıştırılır. Sunucunuzda /opt/gokyuzuwebspam-app/
# klasörü Docker ile çalışıyor ama git repo bağlanmamış. Bu script:
#   1) Mevcut kodu güvenli şekilde yedekler (/opt/gokyuzuwebspam-app.backup-XXX)
#   2) GitHub repo'yu klonlar (ya da mevcut klasörü git repo'ya çevirir)
#   3) auto-update.sh dosyasını /opt/gokyuzuwebspam-app/ içine kopyalar
#   4) Docker container'ları yeniden inşa eder
#
# KULLANIM (sunucuda tek satırla):
#   bash <(curl -sL https://raw.githubusercontent.com/KULLANICI/REPO/main/deployment/first-time-github-setup.sh) https://github.com/KULLANICI/REPO.git
#
# YA DA MANUEL:
#   cd /root
#   wget https://raw.githubusercontent.com/KULLANICI/REPO/main/deployment/first-time-github-setup.sh
#   bash first-time-github-setup.sh https://github.com/KULLANICI/REPO.git
# ============================================================================

set -e

REPO_URL="${1:-}"
APP_DIR="/opt/gokyuzuwebspam-app"
BRANCH="${2:-main}"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${G}[✓]${NC} $1"; }
warn() { echo -e "${Y}[!]${NC} $1"; }
err()  { echo -e "${R}[✗]${NC} $1" >&2; exit 1; }
info() { echo -e "${B}[ℹ]${NC} $1"; }

if [ -z "$REPO_URL" ]; then
    err "Kullanım: bash $0 https://github.com/KULLANICI/REPO.git [branch]"
fi

[ "$EUID" -eq 0 ] || err "Root olarak çalıştırın: sudo bash $0 $REPO_URL"

info "Repo URL:  $REPO_URL"
info "Branch:    $BRANCH"
info "Hedef Dir: $APP_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1) Yedekle
# ---------------------------------------------------------------------------
if [ -d "$APP_DIR" ]; then
    BACKUP_DIR="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
    log "Mevcut kod yedekleniyor → $BACKUP_DIR"

    # Container'ları durdur (data volume'leri korunur)
    if [ -f "$APP_DIR/deployment/docker-compose.yml" ]; then
        cd "$APP_DIR/deployment"
        docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
        cd -
    fi

    # data/ klasörünü hariç tut (MongoDB verileri, upload'lar)
    if [ -d "$APP_DIR/deployment/data" ]; then
        DATA_KEEP=$(mktemp -d)
        mv "$APP_DIR/deployment/data" "$DATA_KEEP/data"
        log "Veri klasörü geçici olarak saklandı: $DATA_KEEP/data"
    fi

    mv "$APP_DIR" "$BACKUP_DIR"
    log "Yedek tamamlandı."
fi

# ---------------------------------------------------------------------------
# 2) GitHub'dan klonla
# ---------------------------------------------------------------------------
log "GitHub'dan repo klonlanıyor..."
git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
log "Klonlama tamamlandı."

# ---------------------------------------------------------------------------
# 3) Veri klasörünü geri koy
# ---------------------------------------------------------------------------
if [ -n "${DATA_KEEP:-}" ] && [ -d "$DATA_KEEP/data" ]; then
    mkdir -p "$APP_DIR/deployment"
    mv "$DATA_KEEP/data" "$APP_DIR/deployment/data"
    rmdir "$DATA_KEEP" 2>/dev/null || true
    log "MongoDB verileri geri konuldu: $APP_DIR/deployment/data"
fi

# ---------------------------------------------------------------------------
# 4) .env dosyalarını eski yedekten kopyala (varsa)
# ---------------------------------------------------------------------------
if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
    for envf in "backend/.env" "frontend/.env" "deployment/backend.env" "deployment/frontend.env"; do
        if [ -f "$BACKUP_DIR/$envf" ] && [ ! -f "$APP_DIR/$envf" ]; then
            cp "$BACKUP_DIR/$envf" "$APP_DIR/$envf"
            log ".env kopyalandı: $envf"
        fi
    done
fi

# ---------------------------------------------------------------------------
# 5) auto-update.sh dosyasını executable yap
# ---------------------------------------------------------------------------
if [ -f "$APP_DIR/deployment/auto-update.sh" ]; then
    cp "$APP_DIR/deployment/auto-update.sh" "$APP_DIR/auto-update.sh"
    chmod +x "$APP_DIR/auto-update.sh"
    log "auto-update.sh /opt/gokyuzuwebspam-app/ altına kopyalandı."
fi

# ---------------------------------------------------------------------------
# 6) Docker container'ları başlat
# ---------------------------------------------------------------------------
cd "$APP_DIR/deployment"
log "Docker container'ları inşa ediliyor (5-10 dk sürebilir)..."
docker compose up -d --build 2>&1 | tail -20

sleep 5
log "Container durumları:"
docker compose ps

# ---------------------------------------------------------------------------
# 7) Health check
# ---------------------------------------------------------------------------
sleep 5
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:8001/api/stats/overview" || echo "000")
if [ "$HTTP" = "200" ]; then
    log "✓ Backend HTTP 200 — API canlı"
else
    warn "Backend henüz cevap vermiyor (HTTP $HTTP) — 30sn sonra tekrar test edin: docker logs gws-backend"
fi

echo ""
log "🎉 =========================================="
log "🎉 Kurulum tamamlandı!"
log "🎉 =========================================="
info "Yedek burada: ${BACKUP_DIR:-yok}"
info ""
info "Bundan sonra güncelleme için sadece:"
info "  cd $APP_DIR && bash auto-update.sh"
info ""
info "Otomatik güncelleme (cron) için:"
info "  echo '*/5 * * * * root bash $APP_DIR/auto-update.sh >> /var/log/gws-update.log 2>&1' > /etc/cron.d/gws-autoupdate"
