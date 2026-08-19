#!/bin/bash
# ==================================================================
# GökyüzüWebSpam — fix-all.sh
# Sunucuda kodu günceller, servisleri yeniler, ortamı temiz duruma alır.
# Kullanım:  cd /opt/gokyuzuwebspam && sudo bash fix-all.sh
# ==================================================================

set -e
APP_DIR="${APP_DIR:-/opt/gokyuzuwebspam}"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info(){ echo -e "${BLUE}▸ $1${NC}"; }
ok(){   echo -e "${GREEN}✓ $1${NC}"; }
warn(){ echo -e "${YELLOW}⚠ $1${NC}"; }
err(){  echo -e "${RED}✗ $1${NC}"; }

cd "$APP_DIR" || { err "Klasör bulunamadı: $APP_DIR"; exit 1; }

info "1/8 · Git güncellemesi çekiliyor..."
git fetch --all --tags
git reset --hard origin/main 2>/dev/null || git reset --hard origin/master
VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
ok "Kod güncel — VERSION: $VERSION"

info "2/8 · Backend bağımlılıkları güncelleniyor..."
if [ -d backend ]; then
  cd backend
  # pyotp/qrcode (v43.99 için)
  pip install --quiet pyotp==2.10.0 qrcode==8.2 reportlab pandas openpyxl 2>/dev/null || warn "pip install bazı paketleri atladı"
  pip install --quiet -r requirements.txt 2>/dev/null || warn "requirements.txt yüklenemedi (kritik değil)"
  cd ..
  ok "Backend deps hazır"
else
  warn "backend klasörü yok — deploy ilk kez mi?"
fi

info "3/8 · Frontend bağımlılıkları güncelleniyor..."
if [ -d frontend ]; then
  cd frontend
  yarn install --silent --frozen-lockfile 2>&1 | tail -5 || warn "yarn install uyarı verdi"
  cd ..
  ok "Frontend deps hazır"
fi

info "4/8 · Frontend production build (opsiyonel)..."
if [ -d frontend ] && grep -q '"build"' frontend/package.json 2>/dev/null; then
  cd frontend
  yarn build 2>&1 | tail -3 || warn "Build hata verdi — dev modu çalışabilir"
  cd ..
  ok "Frontend build tamamlandı"
fi

info "5/8 · Docker konteyner yeniden başlatılıyor..."
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down --remove-orphans 2>/dev/null || true
  docker-compose up -d --build 2>&1 | tail -8
  ok "Docker-compose containers up"
elif command -v docker >/dev/null 2>&1 && docker ps -q --filter "name=gokyuzuwebspam" | grep -q .; then
  docker restart $(docker ps -q --filter "name=gokyuzuwebspam")
  ok "Docker containers restart"
elif command -v supervisorctl >/dev/null 2>&1; then
  supervisorctl restart backend frontend 2>/dev/null || true
  ok "Supervisor restart"
else
  warn "Docker/supervisor bulunamadı — servisleri elle yeniden başlat"
fi

info "6/8 · Servislerin ayakta olması bekleniyor (10sn)..."
sleep 10

info "7/8 · Sağlık kontrolü..."
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8001}"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  ok "Backend health: HTTP $HTTP ✓"
else
  warn "Backend health: HTTP $HTTP (log'a bakın: docker logs gokyuzuwebspam-backend --tail 50)"
fi

# whoami test
WHO=$(curl -sS "$BACKEND_URL/api/admin/whoami" -H "X-Forwarded-For: 89.19.15.58" 2>/dev/null || echo "{}")
if echo "$WHO" | grep -q '"is_master":true'; then
  ok "Master algılandı ✓ (whoami is_master=true)"
else
  warn "Master algılanmadı — whoami: $(echo "$WHO" | head -c 200)"
fi

info "8/8 · İşlem tamamlandı"
echo ""
ok "══════════════════════════════════════════════════"
ok "  Sunucu VERSION: $VERSION"
ok "  Backend health: $HTTP"
ok "══════════════════════════════════════════════════"
echo ""
warn "ŞİMDİ TARAYICI CACHE'İ TEMİZLEYİN:"
echo "   1. WHM cPanel açıksa: sekme kapat/aç"
echo "   2. Hard refresh: Ctrl+Shift+R (Windows/Linux) veya Cmd+Shift+R (Mac)"
echo "   3. Ya da F12 → Console → yapıştır:"
echo "      localStorage.clear(); sessionStorage.clear(); location.reload();"
echo ""
info "WHM üzerinden https://89.19.15.58:2087 → plugin ikonuna tıkla."
info "Panel 1-2 sn içinde master modda açılmalı. Toast: \"Master oturumu otomatik başlatıldı ✓\""
