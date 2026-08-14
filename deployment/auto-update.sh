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

# 6. Yayınlanan sürümü bayilere duyur
# (Panelden manuel yapın veya API ile otomatize edin — aşağı bkz.)

log "🎉 $LATEST_VER güncellemesi tamamlandı! (önceki: $CURRENT_VER)"
