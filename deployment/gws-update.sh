#!/usr/bin/env bash
# ============================================================================
# GökyüzüWebSpam — Komple Sunucu Güncelleme Script'i (v43.33+)
# ============================================================================
# Bu script /usr/local/bin/gws-update olarak kurulur ve cron'dan veya manuel
# çağrıldığında UYGULAMANIN TÜM PARÇALARINI güncel tutar:
#
#   1. Git pull (GitHub main branch)
#   2. Backend Python bağımlılıkları (pip)
#   3. Frontend build (yarn install + build) — sadece kod değiştiyse
#   4. WHM Perl plugin dosyaları (whm-plugin/ → /var/cpanel/apps + /usr/local/lib/gws)
#   5. Milter/logtail systemd servisleri (varsa restart)
#   6. Backend supervisor restart
#   7. Cron entries (heartbeat + logtail + auto-update)
#   8. Sürüm bildirimi (VERSION dosyası, master_alerts'e broadcast)
#
# KULLANIM:
#   sudo gws-update           → sessiz mod, cron için ideal
#   sudo gws-update --verbose → detaylı log
#   sudo gws-update --force   → değişiklik yoksa da tüm adımları çalıştır
#   sudo gws-update --skip-frontend → sadece backend + plugin güncelle
#
# LOGLAR: /var/log/gokyuzuwebspam/update.log
# ============================================================================

set -eu

# ---------- Konfigürasyon ----------
APP_DIR="${GWS_APP_DIR:-/app}"
REPO_URL="${GWS_REPO_URL:-https://github.com/gokyuzuhosting/gokyuzuwebspam.git}"
BRANCH="${GWS_BRANCH:-main}"
LOG_DIR="/var/log/gokyuzuwebspam"
LOG_FILE="$LOG_DIR/update.log"
VERSION_FILE="$APP_DIR/VERSION"
STATE_FILE="/var/lib/gokyuzuwebspam/update-state.json"
LOCK_FILE="/var/run/gws-update.lock"

# Flags
VERBOSE=0
FORCE=0
SKIP_FRONTEND=0
SKIP_BACKEND=0
SKIP_PLUGIN=0

for arg in "$@"; do
    case "$arg" in
        --verbose|-v)        VERBOSE=1 ;;
        --force|-f)          FORCE=1 ;;
        --skip-frontend)     SKIP_FRONTEND=1 ;;
        --skip-backend)      SKIP_BACKEND=1 ;;
        --skip-plugin)       SKIP_PLUGIN=1 ;;
        --help|-h)
            grep '^#' "$0" | sed 's/^# \?//'
            exit 0 ;;
    esac
done

# ---------- Yardımcılar ----------
mkdir -p "$LOG_DIR" "$(dirname "$STATE_FILE")"

log()  { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" ; }
vlog() { [ "$VERBOSE" = "1" ] && log "$@" || echo "$*" >> "$LOG_FILE" ; }
err()  { echo "[$(date +'%Y-%m-%d %H:%M:%S')] ❌ $*" | tee -a "$LOG_FILE" >&2 ; }

# Lock (aynı anda 2 güncelleme çalışmasın)
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        err "Başka bir güncelleme zaten çalışıyor (PID $PID). Çıkılıyor."
        exit 1
    fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT INT TERM

# Sürüm oku
read_version_at() {
    local ref="$1"
    local v
    v=$(cd "$APP_DIR" 2>/dev/null && git show "${ref}:VERSION" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$v" ]; then
        v=$(cd "$APP_DIR" 2>/dev/null && git log -1 --pretty=%s "$ref" 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    fi
    [ -z "$v" ] && v="commit ${ref:0:8}"
    echo "$v"
}

# ============================================================================
# 1) GIT PULL
# ============================================================================
log "🌩  GökyüzüWebSpam Komple Güncelleme Başlıyor…"

cd "$APP_DIR" || { err "App dir bulunamadı: $APP_DIR"; exit 1; }

if [ ! -d ".git" ]; then
    err "Git repo değil. İlk kurulum için install.sh çalıştırın."
    exit 1
fi

CURRENT=$(git rev-parse HEAD)
CURRENT_VER=$(read_version_at HEAD)
log "🔍 Mevcut sürüm: $CURRENT_VER (${CURRENT:0:8})"

log "📥 GitHub'dan güncel kod alınıyor (branch: $BRANCH)…"
git fetch origin "$BRANCH" --quiet 2>&1 | tee -a "$LOG_FILE" || {
    err "Git fetch başarısız — internet bağlantısı veya SSH anahtar problemi olabilir."
    exit 1
}
LATEST=$(git rev-parse "origin/$BRANCH")
LATEST_VER=$(read_version_at "origin/$BRANCH")

if [ "$CURRENT" = "$LATEST" ] && [ "$FORCE" = "0" ]; then
    log "✓ $CURRENT_VER zaten güncel — güncelleme atlandı"
    # State güncelle (heartbeat için son check zamanı)
    echo "{\"last_check\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"version\":\"$CURRENT_VER\"}" > "$STATE_FILE"
    exit 0
fi

log "🔄 Yeni sürüm: $LATEST_VER (${LATEST:0:8})"

# Backup mevcut kod (rollback için)
BACKUP_DIR="/var/backups/gokyuzuwebspam"
mkdir -p "$BACKUP_DIR"
git stash push -m "auto-backup-$(date +%s)" >> "$LOG_FILE" 2>&1 || true

log "⬇  Kod indiriliyor…"
git reset --hard "origin/$BRANCH" >> "$LOG_FILE" 2>&1 || {
    err "Git reset başarısız"
    exit 1
}
log "✓ Kod indirildi"

# ============================================================================
# 2) BACKEND — Python paketleri
# ============================================================================
if [ "$SKIP_BACKEND" = "0" ]; then
    log "🐍 Backend Python paketleri kontrol ediliyor…"
    if [ -f "$APP_DIR/backend/requirements.txt" ]; then
        if git diff "$CURRENT" "$LATEST" --name-only 2>/dev/null | grep -q "backend/requirements.txt" || [ "$FORCE" = "1" ]; then
            log "📦 requirements.txt değişti → pip install…"
            pip install -q -r "$APP_DIR/backend/requirements.txt" 2>&1 | tee -a "$LOG_FILE" || err "pip install uyarıları var"
        else
            vlog "requirements.txt değişmemiş → pip atlandı"
        fi
    fi
fi

# ============================================================================
# 3) FRONTEND — yarn install + build
# ============================================================================
if [ "$SKIP_FRONTEND" = "0" ] && [ -d "$APP_DIR/frontend" ]; then
    FRONTEND_CHANGED=0
    if git diff "$CURRENT" "$LATEST" --name-only 2>/dev/null | grep -qE "^frontend/(package\.json|src/|public/)"; then
        FRONTEND_CHANGED=1
    fi
    if [ "$FRONTEND_CHANGED" = "1" ] || [ "$FORCE" = "1" ]; then
        log "⚛  Frontend değişti → yarn build…"
        cd "$APP_DIR/frontend"
        if git diff "$CURRENT" "$LATEST" --name-only 2>/dev/null | grep -q "frontend/package.json" || [ "$FORCE" = "1" ]; then
            yarn install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE" || err "yarn install uyarıları"
        fi
        # Prod deploylarda build çalışır; supervisor dev-server ile çalışıyorsa hot reload kullanır
        if [ -f "$APP_DIR/frontend/build" ] || grep -q '"build"' package.json; then
            yarn build 2>&1 | tee -a "$LOG_FILE" || err "yarn build uyarıları"
        fi
        cd "$APP_DIR"
    else
        vlog "Frontend değişmemiş → build atlandı"
    fi
fi

# ============================================================================
# 4) WHM PLUGIN — Perl script + AppConfig
# ============================================================================
if [ "$SKIP_PLUGIN" = "0" ] && [ -d "$APP_DIR/whm-plugin" ]; then
    log "🔌 WHM Plugin dosyaları güncelleniyor…"

    # v43.37 — Perl bağımlılıklarını denetle & otomatik kur
    #   heartbeat.pl / logtail için: JSON::XS, LWP::UserAgent, File::Slurp, Sys::Hostname
    #   İlk kurulumda cpanm yoksa cpan ile fallback.
    missing_perl=""
    for m in JSON::XS LWP::UserAgent File::Slurp; do
        perl -M"$m" -e 1 >/dev/null 2>&1 || missing_perl="$missing_perl $m"
    done
    if [ -n "$missing_perl" ]; then
        log "  ⏳ Eksik Perl modülleri:$missing_perl → kurulum başlıyor…"
        if command -v cpanm >/dev/null 2>&1; then
            cpanm --quiet --notest $missing_perl 2>&1 | tee -a "$LOG_FILE" || err "cpanm bazı modülleri kuramadı"
        elif command -v yum >/dev/null 2>&1; then
            yum install -y perl-JSON-XS perl-libwww-perl perl-File-Slurp 2>&1 | tee -a "$LOG_FILE" || err "yum install uyarı"
        elif command -v apt-get >/dev/null 2>&1; then
            apt-get install -y libjson-xs-perl libwww-perl libfile-slurp-perl 2>&1 | tee -a "$LOG_FILE" || err "apt-get install uyarı"
        else
            err "cpanm/yum/apt-get bulunamadı — Perl modüllerini elle kurun:$missing_perl"
        fi
    fi

    # Perl kütüphaneler
    if [ -d "$APP_DIR/whm-plugin/lib" ]; then
        mkdir -p /usr/local/lib/gws
        cp -a "$APP_DIR/whm-plugin/lib/." /usr/local/lib/gws/ 2>>"$LOG_FILE"
        log "  ✓ Perl kütüphaneleri: /usr/local/lib/gws/"
    fi

    # Script'ler (logtail, heartbeat, quarantine-prune)
    if [ -d "$APP_DIR/whm-plugin/scripts" ]; then
        for f in "$APP_DIR/whm-plugin/scripts"/*.pl; do
            [ -f "$f" ] || continue
            name=$(basename "$f")
            cp "$f" "/usr/local/bin/$name"
            chmod 755 "/usr/local/bin/$name"
            vlog "  ✓ /usr/local/bin/$name"
        done
    fi

    # WHM AppConfig kayıt dosyası
    if [ -f "$APP_DIR/whm-plugin/appconfig/mailshield.conf" ]; then
        cp "$APP_DIR/whm-plugin/appconfig/mailshield.conf" /var/cpanel/apps/mailshield.conf 2>/dev/null || true
        if [ -x /usr/local/cpanel/bin/register_appconfig ]; then
            /usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf 2>&1 | tee -a "$LOG_FILE" || true
            log "  ✓ WHM AppConfig kayıt edildi"
        fi
    fi

    # WHM CGI + template
    if [ -d "$APP_DIR/whm-plugin/whm" ]; then
        mkdir -p /usr/local/cpanel/whostmgr/docroot/cgi/mailshield
        cp -a "$APP_DIR/whm-plugin/whm/." /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/
        find /usr/local/cpanel/whostmgr/docroot/cgi/mailshield -name "*.cgi" -exec chmod 755 {} \;
        log "  ✓ WHM CGI dosyaları güncellendi"
    fi
fi

# ============================================================================
# 5) SYSTEMD SERVİSLERİ (varsa)
# ============================================================================
log "🚦 Systemd servisleri kontrol ediliyor…"
for svc in gws-milter gws-logtail gws-heartbeat; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\."; then
        if systemctl is-active --quiet "$svc"; then
            systemctl restart "$svc" 2>&1 | tee -a "$LOG_FILE" || err "$svc restart uyarısı"
            log "  ✓ $svc yeniden başlatıldı"
        else
            vlog "  ⚠ $svc aktif değil, atlandı"
        fi
    fi
done

# ============================================================================
# 6) BACKEND — supervisor restart
# ============================================================================
if [ "$SKIP_BACKEND" = "0" ] && command -v supervisorctl >/dev/null 2>&1; then
    log "🔁 Backend supervisor restart…"
    supervisorctl restart backend 2>&1 | tee -a "$LOG_FILE" || err "supervisor restart uyarısı"
    sleep 3
    if supervisorctl status backend 2>/dev/null | grep -q RUNNING; then
        log "  ✓ Backend RUNNING"
    else
        err "  ✗ Backend başlatılamadı — supervisor logu kontrol edin"
    fi
fi

# ============================================================================
# 7) CRON — Auto-update + heartbeat
# ============================================================================
log "⏰ Cron entries kontrol ediliyor…"
CRON_FILE="/etc/cron.d/gokyuzuwebspam-autoupdate"
if [ ! -f "$CRON_FILE" ]; then
    cat > "$CRON_FILE" <<'EOF'
# GökyüzüWebSpam — otomatik güncelleme + heartbeat
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
# Her 6 saatte bir güncelleme kontrol
0 */6 * * * root /usr/local/bin/gws-update >/dev/null 2>&1
# Heartbeat + sinyal polling her 15 dakikada
*/15 * * * * root /usr/local/bin/heartbeat.pl >/dev/null 2>&1
EOF
    chmod 644 "$CRON_FILE"
    log "  ✓ Cron kaydedildi: $CRON_FILE"
fi

# gws-update self-install
if [ ! -x "/usr/local/bin/gws-update" ] || [ "$FORCE" = "1" ]; then
    cp "$APP_DIR/deployment/gws-update.sh" /usr/local/bin/gws-update
    chmod 755 /usr/local/bin/gws-update
    log "  ✓ /usr/local/bin/gws-update güncellendi"
fi

# v43.37 — Systemd timer (opsiyonel, systemd varsa daha güvenilir cron alternatifi)
if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    if [ ! -f /etc/systemd/system/gws-update.service ]; then
        cat > /etc/systemd/system/gws-update.service <<'EOF'
[Unit]
Description=GokyuzuWebSpam Auto-Update Service
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/gws-update
User=root
StandardOutput=append:/var/log/gokyuzuwebspam/update.log
StandardError=append:/var/log/gokyuzuwebspam/update.log
EOF
        cat > /etc/systemd/system/gws-update.timer <<'EOF'
[Unit]
Description=GokyuzuWebSpam Auto-Update Timer (every 6 hours)
After=network-online.target

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Persistent=true
Unit=gws-update.service

[Install]
WantedBy=timers.target
EOF
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable --now gws-update.timer 2>&1 | tee -a "$LOG_FILE" || true
        log "  ✓ systemd timer aktif (gws-update.timer, 6 saatte bir)"
    fi
fi

# ============================================================================
# 8) STATE + Sürüm bildirimi
# ============================================================================
cat > "$STATE_FILE" <<EOF
{
  "last_check":   "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_update":  "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "previous_version": "$CURRENT_VER",
  "current_version":  "$LATEST_VER",
  "commit": "${LATEST:0:8}"
}
EOF

log ""
log "🎉 =========================================="
log "🎉 $LATEST_VER güncellemesi tamamlandı!"
log "🎉 (önceki: $CURRENT_VER)"
log "🎉 =========================================="
log ""
log "📝 Log: $LOG_FILE"
log "📊 State: $STATE_FILE"
