#!/bin/bash
# ============================================================================
# GökyüzüWebSpam Auto-Update Script
# ----------------------------------------------------------------------------
# Bu scripti sunucunuzun /opt/gokyuzuwebspam-app/ dizinine koyun.
# Preview'da "Save to Github" bastıktan sonra sunucuda şunu çalıştırın:
#   bash /opt/gokyuzuwebspam-app/auto-update.sh
#
# Veya cron ile her 5dk'da otomatik çektirmek için:
#   */5 * * * * root /opt/gokyuzuwebspam-app/auto-update.sh >> /var/log/gws-update.log 2>&1
#
# Ya da webhook için: GitHub → Settings → Webhooks → POST https://gokyuzuhosting.com/hook/update
# ============================================================================

set -e

APP_DIR="/opt/gokyuzuwebspam-app"
LOG_FILE="/var/log/gws-update.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$APP_DIR" || { log "❌ App dir bulunamadı: $APP_DIR"; exit 1; }

# ---------------------------------------------------------------------------
# v43.22 — İnsan-okuyabilir sürüm adı (git commit yerine)
# VERSION dosyası (repo kökünde) → "v43.22" gibi bir string tutar.
# Yoksa fallback olarak son commit mesajından "v43.xx" pattern'ini yakalar,
# o da yoksa kısa commit hash'e düşer.
# ---------------------------------------------------------------------------
read_version_at() {
    # $1 = commit-ish (HEAD, origin/main, vs.)
    local ref="$1"
    local v
    v=$(git show "${ref}:VERSION" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$v" ]; then
        v=$(git log -1 --pretty=%s "$ref" 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    fi
    if [ -z "$v" ]; then
        v="commit ${ref:0:8}"
    fi
    echo "$v"
}

# 1. Son commit'i al
CURRENT=$(git rev-parse HEAD)
CURRENT_VER=$(read_version_at HEAD)
log "🔍 Mevcut sürüm: $CURRENT_VER (${CURRENT:0:8})"

# 2. GitHub'dan yeni sürüm var mı?
git fetch origin main --quiet
LATEST=$(git rev-parse origin/main)
LATEST_VER=$(read_version_at origin/main)

if [ "$CURRENT" = "$LATEST" ]; then
    log "✓ $CURRENT_VER zaten güncel — güncelleme yok"
    exit 0
fi

log "🔄 Yeni sürüm bulundu: $LATEST_VER (${LATEST:0:8})"

# 2b. Yerel conflict'leri temizle (sunucuda manuel edit varsa)
if ! git diff --quiet HEAD; then
    log "⚠ Yerel değişiklikler tespit edildi, otomatik stash'leniyor..."
    git stash push -m "auto-update-stash-$(date +%s)" --quiet || true
    log "✓ Yerel değişiklikler geçici olarak saklandı (git stash list ile görebilirsiniz)"
fi

# 3. Pull et
if ! git pull origin main --quiet; then
    log "❌ Pull hatası — manuel müdahale gerekiyor"
    log "   Denemek için: cd $APP_DIR && git status"
    exit 1
fi
log "✓ Kod indirildi"

# 3b. Perl logtail script'ini /usr/local/mailshield/bin/'e kopyala + systemd restart
# (Docker dışı, host üzerinde çalışan Perl daemon — auto-update sırasında elle atlanmaması için)
PERL_SRC="$APP_DIR/whm-plugin/scripts/mailshield-logtail.pl"
PERL_DST="/usr/local/mailshield/bin/mailshield-logtail.pl"
if [ -f "$PERL_SRC" ]; then
    if ! cmp -s "$PERL_SRC" "$PERL_DST" 2>/dev/null; then
        log "🔄 Perl logtail script değişmiş, güncelleniyor..."
        mkdir -p /usr/local/mailshield/bin
        cp -f "$PERL_SRC" "$PERL_DST"
        chmod +x "$PERL_DST"
        # Perl syntax kontrolü — bozuk script sistemi kilitler
        if perl -c "$PERL_DST" 2>&1 | grep -qi "syntax ok"; then
            log "✓ Perl script kopyalandı ve syntax kontrol OK"
            if systemctl is-active --quiet mailshield-logtail 2>/dev/null; then
                systemctl restart mailshield-logtail
                log "✓ mailshield-logtail servisi restart edildi"
            fi
        else
            log "❌ Perl syntax hatası, script kopyalanmadı — logu kontrol edin"
            perl -c "$PERL_DST" 2>&1 | tail -5 | tee -a "$LOG_FILE"
        fi
    else
        log "✓ Perl logtail script zaten güncel"
    fi
fi

# 4. Docker rebuild
cd deployment
docker compose up -d --build > /tmp/compose-build.log 2>&1
if [ $? -eq 0 ]; then
    log "✓ Docker container'lar güncellendi"
else
    log "❌ Docker build hatası — /tmp/compose-build.log kontrol edin"
    exit 1
fi

# 5. Health check — retry ile (Docker cold-start için sabırlı)
# Container up olduktan sonra uvicorn'un binding yapması 3-15sn alabilir.
# Localhost'ta bakıyoruz çünkü SSL/DNS/reverse-proxy gecikmesi olmasın.
API_URL="http://127.0.0.1:8001/api/stats/overview"
MAX_TRIES=12         # 12 × 3sn = 36sn max bekleme
SLEEP_BETWEEN=3
API_OK=0
sleep 4              # ilk grace period (uvicorn binding için)
for i in $(seq 1 $MAX_TRIES); do
    HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$API_URL" || echo "000")
    if [ "$HTTP" = "200" ]; then
        log "✓ API canlı (deneme $i/$MAX_TRIES · HTTP 200)"
        API_OK=1
        break
    fi
    if [ $i -lt $MAX_TRIES ]; then
        sleep $SLEEP_BETWEEN
    fi
done
if [ $API_OK -eq 0 ]; then
    log "⚠ API $((MAX_TRIES * SLEEP_BETWEEN + 4))sn içinde HTTP 200 vermedi — kontrol: docker logs --tail=50 gws-backend"
fi

# ---------------------------------------------------------------------------
# v43.60 — WHM Plugin CGI badge refresh
# ---------------------------------------------------------------------------
# WHM plugin dosyası Docker DIŞINDA yaşar. gws-update sadece Docker'ı yeniler,
# CGI badge (v43.xx) eski kalır → kullanıcı v43.56 görmeye devam eder.
# Bu adım /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi'yi de günceller.
CGI_DST="/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi"
if [ -d "$(dirname $CGI_DST)" ] && command -v curl >/dev/null 2>&1; then
    log "🔄 WHM plugin CGI güncelleniyor…"
    TARBALL=$(mktemp --suffix=.tgz)
    if curl -sSL --max-time 30 "http://127.0.0.1:8001/api/plugin/download" -o "$TARBALL" 2>/dev/null; then
        TMP_EXTRACT=$(mktemp -d)
        if tar -xzf "$TARBALL" -C "$TMP_EXTRACT" 2>/dev/null; then
            NEW_CGI=$(find "$TMP_EXTRACT" -name "mailshield.cgi" -type f 2>/dev/null | head -1)
            if [ -n "$NEW_CGI" ] && [ -f "$NEW_CGI" ]; then
                if ! cmp -s "$NEW_CGI" "$CGI_DST" 2>/dev/null; then
                    install -m 0755 "$NEW_CGI" "$CGI_DST" 2>/dev/null && \
                        log "✓ WHM CGI güncellendi → $CGI_DST" || \
                        log "⚠ WHM CGI kopyalanamadı (izin?)"
                else
                    log "✓ WHM CGI zaten güncel"
                fi
            else
                log "⚠ Tarball'da mailshield.cgi bulunamadı"
            fi
        fi
        rm -rf "$TMP_EXTRACT"
    else
        log "⚠ Plugin tarball indirilemedi"
    fi
    rm -f "$TARBALL"
else
    log "ℹ WHM CGI dizini yok (bu sunucu WHM değil?) → CGI adımı atlandı"
fi

# ---------------------------------------------------------------------------
# v43.60 — Simple-push daemon otomatik kurulum / güncelleme
# ---------------------------------------------------------------------------
# Sunucuda gws-simple-push kurulu değilse VEYA systemd timer aktif değilse
# gws-update sırasında otomatik yeniden kur. Kullanıcı manuel adım atlamak
# zorunda kalmasın (v43.58 install-simple-push endpoint'ini kullanır).
if [ -r /etc/gws-exim-push.conf ]; then
    . /etc/gws-exim-push.conf 2>/dev/null || true
fi
MASTER_KEY="${LICENSE_KEY:-}"
if [ -z "$MASTER_KEY" ] && [ -f /root/.gws-license ]; then
    MASTER_KEY=$(cat /root/.gws-license 2>/dev/null | tr -d '[:space:]')
fi
if [ -n "$MASTER_KEY" ] && command -v systemctl >/dev/null 2>&1; then
    TIMER_ACTIVE=$(systemctl is-active gws-simple-push.timer 2>/dev/null || echo "inactive")
    SCRIPT_MISSING=0
    [ ! -x /usr/local/bin/gws-simple-push ] && SCRIPT_MISSING=1
    if [ "$TIMER_ACTIVE" != "active" ] || [ "$SCRIPT_MISSING" -eq 1 ]; then
        log "🔄 Simple-push timer aktif değil ($TIMER_ACTIVE) — yeniden kurulum yapılıyor…"
        if curl -sSf --max-time 30 "http://127.0.0.1:8001/api/tools/install-simple-push.sh?license_key=$MASTER_KEY" -o /tmp/gws-install-simple.sh 2>/dev/null; then
            bash /tmp/gws-install-simple.sh >> "$LOG_FILE" 2>&1 && \
                log "✓ Simple-push timer kuruldu / güncellendi" || \
                log "⚠ Simple-push kurulum başarısız — /var/log/gws-update.log kontrol edin"
            rm -f /tmp/gws-install-simple.sh
        fi
    else
        log "✓ Simple-push timer aktif (LICENSE_KEY=${MASTER_KEY:0:8}…)"
    fi
fi

# 6. Yayınlanan sürümü bayilere duyur
# (Panelden manuel yapın veya API ile otomatize edin — aşağı bkz.)

log "🎉 $LATEST_VER güncellemesi tamamlandı! (önceki: $CURRENT_VER)"
