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

# 1. Son commit'i al
CURRENT=$(git rev-parse HEAD)
log "🔍 Mevcut commit: ${CURRENT:0:8}"

# 2. GitHub'dan yeni sürüm var mı?
git fetch origin main --quiet
LATEST=$(git rev-parse origin/main)

if [ "$CURRENT" = "$LATEST" ]; then
    log "✓ Zaten güncel — güncelleme yok"
    exit 0
fi

log "🔄 Yeni sürüm bulundu: ${LATEST:0:8}"

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

# 5. Health check
sleep 8
if curl -sf https://gokyuzuhosting.com/api/version/current > /dev/null; then
    log "✓ API canlı → https://gokyuzuhosting.com/api/version/current"
else
    log "⚠ API yanıt vermiyor — servisleri kontrol edin: docker compose ps"
fi

# 6. Yayınlanan sürümü bayilere duyur
# (Panelden manuel yapın veya API ile otomatize edin — aşağı bkz.)

log "🎉 Güncelleme başarılı!"
