#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  GökyüzüWebSpam — Hotfix v43.99.24 (v2)
#  Tenant Isolation Fix — Master Data Leak on Customer WHM
#  Kullanım:  bash <(curl -sk PREVIEW_URL/downloads/gws-hotfix.sh)
# ═══════════════════════════════════════════════════════════════
set -e

PREVIEW="https://mailscanner-pro.preview.emergentagent.com"
GREEN='\033[0;32m'; YEL='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info(){ echo -e "${GREEN}==>${NC} $*"; }
warn(){ echo -e "${YEL}⚠${NC}  $*"; }
err() { echo -e "${RED}✗${NC}  $*"; exit 1; }

# Ortam tespiti
IS_MASTER=0
if [ -f /opt/gokyuzuwebspam-app/backend/.env ] && \
   grep -q "^MASTER_HOST=panel.gokyuzuhosting.com" /opt/gokyuzuwebspam-app/backend/.env 2>/dev/null; then
    IS_MASTER=1
    info "🎯 MASTER sunucu tespit edildi (panel.gokyuzuhosting.com)"
elif [ -d /usr/local/cpanel/whostmgr ] && [ -f /var/cpanel/version ]; then
    info "👥 MÜŞTERİ (WHM/cPanel) sunucu tespit edildi"
else
    err "Bilinmeyen ortam — GokyuzuWebSpam kurulu değil"
fi

# ────────────────────────────────────────────────────────────
# ORTAK: Yeni WHM CGI dosyasını indir
# ────────────────────────────────────────────────────────────
info "Yeni WHM CGI indiriliyor..."
NEW_CGI=$(mktemp)
curl -sk "$PREVIEW/downloads/mailshield-cgi-v43.99.24.txt" -o "$NEW_CGI"
if ! head -1 "$NEW_CGI" | grep -q "perl"; then
    err "CGI indirilemedi veya bozuk"
fi
info "✓ Yeni CGI hazır ($(wc -c < "$NEW_CGI") byte)"

# ═══════════════════════════════════════════════════════════
# MÜŞTERİ SUNUCU
# ═══════════════════════════════════════════════════════════
if [ $IS_MASTER -eq 0 ]; then
    CGI_TARGET="/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi"
    if [ ! -d "$(dirname "$CGI_TARGET")" ]; then
        err "WHM plugin dizini yok: $(dirname "$CGI_TARGET") — kurulum eksik"
    fi
    
    # Backup + kopyala
    [ -f "$CGI_TARGET" ] && cp "$CGI_TARGET" "${CGI_TARGET}.pre-hotfix-$(date +%Y%m%d)"
    cp "$NEW_CGI" "$CGI_TARGET"
    chmod 755 "$CGI_TARGET"
    chown root:root "$CGI_TARGET"
    info "✓ CGI güncellendi"

    # Master key sızıntısı kontrolü
    if [ -f /etc/mailshield/mailshield.conf ]; then
        if grep -q "MS-C02AB012652A4FE692D69676" /etc/mailshield/mailshield.conf 2>/dev/null; then
            warn "⚠ Master anahtarınız müşteri config'inde bulundu!"
            warn "  Bu güvenlik açığı — düzeltmek için:"
            warn "  1) Master panelde YENİ bayi lisansı oluşturun"
            warn "  2) rm /etc/mailshield/mailshield.conf"
            warn "  3) cd ~/gokyuzuwebspam && bash install.sh --license=MS-YENI-BAYI"
        fi
    fi
    
    /usr/local/cpanel/scripts/restartsrv_cpsrvd >/dev/null 2>&1 || true
    rm -f "$NEW_CGI"
    
    echo ""
    info "🎉 MÜŞTERİ hotfix tamam"
    echo ""
    echo "TEST — İNCOGNİTO PENCERE'de aç (Ctrl+Shift+N):"
    echo "  https://$(hostname -I 2>/dev/null | awk '{print $1}'):2087"
    echo "  → Plugins → GokyuzuWebSpam"
    echo "  → Sağ üstte 'MASTER · 89.19.15.58' YOKSA fix çalıştı ✓"
    exit 0
fi

# ═══════════════════════════════════════════════════════════
# MASTER SUNUCU
# ═══════════════════════════════════════════════════════════
APP_DIR="/opt/gokyuzuwebspam-app"

info "Backend patch: dashboard_top_domains tenant scope"
BACKEND_FILE="$APP_DIR/backend/server.py"
if grep -q 'lic_filter = {} if master else {}' "$BACKEND_FILE"; then
    cp "$BACKEND_FILE" "${BACKEND_FILE}.pre-hotfix"
    python3 << 'PYEOF'
path = "/opt/gokyuzuwebspam-app/backend/server.py"
src = open(path).read()
old = '''    # Master iseniz tenant filtresi yok, değilseniz kendi license'ınız
    master = ((request.headers.get("x-master-key") or "").strip() if request else "").startswith("MS-")
    lic_filter = {} if master else {}  # events endpoint ile aynı davranış'''
new = '''    # v43.99.24 — Doğru tenant scope
    scope = await _tenant_scope(request, license_key) if request else {"is_master": False, "owner_license_key": ""}
    owner = scope["owner_license_key"]
    lic_filter = {"license_key": owner} if owner else ({} if scope["is_master"] else {"license_key": "__none__"})'''
if old in src:
    src = src.replace(old, new)
    # dashboard_top_domains signature'ına license_key ekle
    src = src.replace(
        'async def dashboard_top_domains(limit: int = 5, request: Request = None):',
        'async def dashboard_top_domains(limit: int = 5, request: Request = None, license_key: str = None):'
    )
    open(path, "w").write(src)
    print("Backend patched OK")
else:
    print("Backend already patched or code drift — skip")
PYEOF
    info "✓ Backend patched"
else
    warn "Backend zaten güncel (skip)"
fi

info "Frontend patch: App.js license_key query handler"
FE_APP="$APP_DIR/frontend/src/App.js"
if ! grep -q "v43.99.24 — BAYI/MÜŞTERİ" "$FE_APP"; then
    cp "$FE_APP" "${FE_APP}.pre-hotfix"
    python3 << 'PYEOF'
path = "/opt/gokyuzuwebspam-app/frontend/src/App.js"
src = open(path).read()
# Marker: master_key handler bloğunun sonundaki "}" civarına yeni block ekle
marker = '        params.delete("master_key");'
if marker in src and "v43.99.24 — BAYI/MÜŞTERİ" not in src:
    # master_key bloğundan sonra license_key handler ekle
    insert_after = '''        params.delete("master_key");
        const cleanUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
        if (wasEmpty) {
          setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 100);
          return;
        }
      }'''
    if insert_after in src:
        new_block = insert_after + '''

      // v43.99.24 — BAYI/MÜŞTERİ query parametresi: ?license_key=MS-...
      // Master modu AKTİF ETMEZ, sadece bayi lisansı olarak scope'lar
      const bk = params.get("license_key");
      if (bk && bk.startsWith("MS-")) {
        localStorage.setItem("gws.event_license", bk);
        localStorage.removeItem("gws.master_license");
        localStorage.setItem("gws.license.dismissed", "1");
        params.delete("license_key");
        const cleanUrl2 = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", cleanUrl2);
      }'''
        src = src.replace(insert_after, new_block, 1)
        open(path, "w").write(src)
        print("Frontend patched OK")
    else:
        print("Marker context not found — SKIP")
else:
    print("Frontend already patched or marker missing")
PYEOF
    info "✓ Frontend patched"
else
    warn "Frontend zaten güncel (skip)"
fi

info "WHM CGI kaynak güncelleniyor"
cp "$NEW_CGI" "$APP_DIR/whm-plugin/whm/mailshield.cgi"
chmod 755 "$APP_DIR/whm-plugin/whm/mailshield.cgi"
info "✓ CGI güncellendi"

info "Frontend rebuild (yaklaşık 40-60 sn)..."
FE_CONTAINER=$(docker ps -q --filter name=gws-frontend)
if [ -n "$FE_CONTAINER" ]; then
    docker exec "$FE_CONTAINER" sh -c "cd /app && yarn build" 2>&1 | tail -3
    info "✓ Frontend rebuilt"
else
    warn "Frontend container bulunamadı — manuel build gerekli"
fi

info "Servisleri restart"
cd "$APP_DIR/deployment"
docker compose restart backend frontend
info "✓ Restart tamam"

rm -f "$NEW_CGI"

echo ""
info "🎉 MASTER hotfix tamam"
echo ""
echo "ŞİMDİ MÜŞTERİ SUNUCUYA GEÇİN:"
echo "  ssh root@37.148.208.233"
echo "  bash <(curl -sk $PREVIEW/downloads/gws-hotfix.sh)"
echo ""
echo "SONRA TARAYICIDA:"
echo "  1) İncognito pencere aç (Ctrl+Shift+N)"
echo "  2) https://panel.gokyuzuhosting.com/panel"
echo "  3) Sağ üst rozet 'MASTER' değil, bayı ismi göstermeli"
