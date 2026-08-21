#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  GökyüzüWebSpam — Hotfix v43.99.24
#  Tenant Isolation Fix (Master Data Leak on Customer WHM)
#
#  Kullanım:  bash <(curl -sk https://panel.gokyuzuhosting.com/downloads/hotfix-v43.99.24.sh)
#
#  Ne yapar:
#    · MASTER sunucuda:   backend + frontend patch + restart
#    · MÜŞTERİ sunucuda:  WHM CGI patch + license temizlik
# ══════════════════════════════════════════════════════════════════════

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }

# Kendini kontrol: master mı müşteri mi?
IS_MASTER=0
if [ -f /opt/gokyuzuwebspam-app/backend/.env ] && grep -q "MASTER_HOST=panel.gokyuzuhosting.com" /opt/gokyuzuwebspam-app/backend/.env 2>/dev/null; then
    IS_MASTER=1
    info "MASTER sunucu tespit edildi"
elif [ -f /var/cpanel/version ] && [ -d /var/cpanel ]; then
    info "MÜŞTERİ (WHM) sunucu tespit edildi"
else
    error "Ne master ne müşteri sunucusu — bu script sadece GokyuzuWebSpam sunucularında çalışır"
fi

# ═══════════════════════════════════════════════════════════
# MÜŞTERİ SUNUCU FIX
# ═══════════════════════════════════════════════════════════
if [ $IS_MASTER -eq 0 ]; then
    CGI_PATH="/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi"
    if [ ! -f "$CGI_PATH" ]; then
        error "WHM CGI bulunamadı: $CGI_PATH — GokyuzuWebSpam kurulu değil mi?"
    fi

    info "Backup alınıyor: ${CGI_PATH}.pre-hotfix"
    cp "$CGI_PATH" "${CGI_PATH}.pre-hotfix"

    info "Yeni CGI indiriliyor..."
    curl -sk "https://panel.gokyuzuhosting.com/downloads/mailshield.cgi-v43.99.24" -o "$CGI_PATH.new"
    if [ ! -s "$CGI_PATH.new" ] || ! head -1 "$CGI_PATH.new" | grep -q perl; then
        error "CGI indirilemedi veya bozuk"
    fi
    mv "$CGI_PATH.new" "$CGI_PATH"
    chmod 755 "$CGI_PATH"
    chown root:root "$CGI_PATH"
    info "CGI güncellendi ✓"

    # Master key temizle (varsa)
    if [ -f /etc/mailshield/mailshield.conf ]; then
        # Master key kalıntısı (MS-C02AB...) varsa uyar
        if grep -q "MS-C02AB012652A4FE692D69676" /etc/mailshield/mailshield.conf 2>/dev/null; then
            warn "Master anahtarınız (MS-C02AB012...) müşteri config'inde bulundu!"
            warn "Bu güvenlik açığı — kendi bayı lisansınızla yeniden kurun:"
            warn "  1) rm /etc/mailshield/mailshield.conf"
            warn "  2) Master panelde YENİ bayi lisansı oluşturun"
            warn "  3) bash install.sh --license=MS-YENI-BAYI"
        fi
    fi

    info "systemd services zaten güncel (patch sadece CGI'de)"
    info "Iframe cache temizle: tarayıcıda WHM'i incognito'da aç"
    echo ""
    info "🎉 MÜŞTERİ hotfix tamam. Test:"
    echo "     https://$(hostname -I | awk '{print $1}'):2087 → Plugins → GokyuzuWebSpam"
    echo "     (İncognito pencerede test edin, Ctrl+Shift+N)"
    exit 0
fi

# ═══════════════════════════════════════════════════════════
# MASTER SUNUCU FIX
# ═══════════════════════════════════════════════════════════
APP_DIR="/opt/gokyuzuwebspam-app"
[ -d "$APP_DIR" ] || error "APP_DIR bulunamadı: $APP_DIR"
cd "$APP_DIR"

info "Backend patch: server.py::dashboard_top_domains tenant scope"
BACKEND_SERVER="$APP_DIR/backend/server.py"
if grep -q 'lic_filter = {} if master else {}' "$BACKEND_SERVER"; then
    # Python patch via sed
    cp "$BACKEND_SERVER" "$BACKEND_SERVER.pre-hotfix"
    python3 << 'PYEOF'
import re
path = "/opt/gokyuzuwebspam-app/backend/server.py"
src = open(path).read()
old = '''async def dashboard_top_domains(limit: int = 5, request: Request = None):
    """Dashboard widget: son 24 saatte en aktif alan adları + mail trafiği."""
    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    # Master iseniz tenant filtresi yok, değilseniz kendi license'ınız
    master = ((request.headers.get("x-master-key") or "").strip() if request else "").startswith("MS-")
    lic_filter = {} if master else {}  # events endpoint ile aynı davranış'''
new = '''async def dashboard_top_domains(limit: int = 5, request: Request = None, license_key: str = None):
    """Dashboard widget: son 24 saatte en aktif alan adları + mail trafiği."""
    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    # v43.99.24 — Doğru tenant scope
    scope = await _tenant_scope(request, license_key)
    owner = scope["owner_license_key"]
    lic_filter = {"license_key": owner} if owner else ({} if scope["is_master"] else {"license_key": "__none__"})'''
if old in src:
    src = src.replace(old, new)
    open(path, "w").write(src)
    print("✓ Backend patched")
else:
    print("⚠ Backend already patched or code changed")
PYEOF
else
    warn "Backend zaten patch'lenmiş görünüyor (skip)"
fi

info "Frontend patch: App.js license_key query param handler"
FRONTEND_APP="$APP_DIR/frontend/src/App.js"
if ! grep -q "v43.99.24 — BAYI/MÜŞTERİ query parametresi" "$FRONTEND_APP"; then
    curl -sk "https://panel.gokyuzuhosting.com/downloads/App.js-v43.99.24.patch" -o /tmp/App.js.patch
    if [ -s /tmp/App.js.patch ]; then
        cp "$FRONTEND_APP" "$FRONTEND_APP.pre-hotfix"
        python3 /tmp/App.js.patch "$FRONTEND_APP" && info "✓ Frontend patched"
    else
        warn "Frontend patch dosyası indirilmedi (opsiyonel)"
    fi
fi

info "WHM CGI güncelleniyor (master için de)"
curl -sk "https://panel.gokyuzuhosting.com/downloads/mailshield.cgi-v43.99.24" \
    -o "$APP_DIR/whm-plugin/whm/mailshield.cgi"
chmod 755 "$APP_DIR/whm-plugin/whm/mailshield.cgi"

info "Frontend yeniden derleniyor (~40 sn)..."
cd "$APP_DIR/frontend"
docker exec $(docker ps -q --filter name=gws-frontend 2>/dev/null || echo "") sh -c "cd /app/frontend && yarn build" 2>/dev/null || {
    warn "Docker exec olmadı, manuel build gerekir"
}

info "Backend restart"
docker compose -f "$APP_DIR/deployment/docker-compose.yml" restart backend

info "🎉 MASTER hotfix tamam"
info "Şimdi müşteri sunucusuna geçin, aynı komutu orada çalıştırın:"
echo "     bash <(curl -sk https://panel.gokyuzuhosting.com/downloads/hotfix-v43.99.24.sh)"
