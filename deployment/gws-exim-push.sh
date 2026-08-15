#!/bin/bash
# ============================================================================
# gws-exim-push — Docker-hosted GökyüzüWebSpam paneli için Exim log tailer
# ---------------------------------------------------------------------------
# Sunucuda (ns1.gokyuzuhosting.com gibi) crontab -e ile her 5 dakikada bir
# çalışacak şekilde eklenir. /var/log/exim_mainlog dosyasını son okunan
# pozisyondan itibaren parse eder ve panele push eder.
#
# Panel URL: PANEL_URL env veya /etc/gws-exim-push.conf
# License:   LICENSE_KEY env veya conf dosyasından
#
# Bu script Perl gerektirmez, sadece bash + curl + awk kullanır.
#
# Kurulum:
#   curl -o /usr/local/bin/gws-exim-push https://panel.gokyuzuhosting.com/tools/gws-exim-push.sh
#   chmod +x /usr/local/bin/gws-exim-push
#   echo 'PANEL_URL=https://panel.gokyuzuhosting.com' > /etc/gws-exim-push.conf
#   echo 'LICENSE_KEY=MS-C02AB012652A4FE692D69676' >> /etc/gws-exim-push.conf
#   # Cron entry:
#   (crontab -l 2>/dev/null; echo '*/5 * * * * /usr/local/bin/gws-exim-push >/dev/null 2>&1') | crontab -
# ============================================================================
set -euo pipefail

# ------ Config ------
CONF="/etc/gws-exim-push.conf"
if [ -f "$CONF" ]; then
    # shellcheck disable=SC1090
    . "$CONF"
fi
PANEL_URL="${PANEL_URL:-https://panel.gokyuzuhosting.com}"
LICENSE_KEY="${LICENSE_KEY:-}"
EXIM_LOG="${EXIM_LOG:-/var/log/exim_mainlog}"
STATE_DIR="${STATE_DIR:-/var/lib/gws-exim-push}"
BATCH_MAX="${BATCH_MAX:-500}"

mkdir -p "$STATE_DIR"
mkdir -p /var/log/gws-exim-push
LOG="/var/log/gws-exim-push/push.log"

log_line() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"
}

# ------ Validate ------
if [ -z "$LICENSE_KEY" ]; then
    log_line "FATAL: LICENSE_KEY yok. $CONF dosyasına LICENSE_KEY=MS-... ekleyin."
    exit 1
fi
if [ ! -r "$EXIM_LOG" ]; then
    log_line "FATAL: $EXIM_LOG okunamıyor. Root yetkisi ve dosya varlığını kontrol edin."
    exit 1
fi

# ------ Get checkpoint from panel ------
CHECKPOINT_FILE="$STATE_DIR/checkpoint"
if [ -f "$CHECKPOINT_FILE" ]; then
    LAST_POS=$(cat "$CHECKPOINT_FILE" 2>/dev/null || echo "0")
else
    LAST_POS=0
fi
# Backup: panel'den de al (state dosyası kaybolursa)
REMOTE_POS=$(curl -sSf --max-time 8 \
    "$PANEL_URL/api/outbound/exim-log-checkpoint?license_key=$LICENSE_KEY" \
    2>/dev/null | grep -oE '"last_position":[0-9]+' | grep -oE '[0-9]+$' || echo "0")
if [ "$REMOTE_POS" -gt "$LAST_POS" ]; then
    LAST_POS="$REMOTE_POS"
fi

# ------ File size check ------
FILE_SIZE=$(stat -c%s "$EXIM_LOG" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -lt "$LAST_POS" ]; then
    # Log rotate olmuş, baştan başla
    log_line "Log rotated (size=$FILE_SIZE < pos=$LAST_POS), reset to 0"
    LAST_POS=0
fi

if [ "$FILE_SIZE" -eq "$LAST_POS" ]; then
    log_line "No new data (pos=$LAST_POS, size=$FILE_SIZE)"
    exit 0
fi

# ------ Read delta ------
DELTA=$(dd if="$EXIM_LOG" bs=1 skip="$LAST_POS" 2>/dev/null || true)
NEW_POS=$FILE_SIZE

# ------ Parse Exim log lines ------
# Format:
#   2026-08-15 14:34:56 1uHqCk-000123-A2 <= sender@x.com H=... U=user P=esmtp S=12345 T="Subject"
#   2026-08-15 14:34:57 1uHqCk-000123-A2 => recipient@y.com R=dnslookup T=remote_smtp
#   ** rcpt R=router: bounced

TMP=$(mktemp)
trap "rm -f $TMP" EXIT

# Awk ile parse: <= line'ları hafızada tut, => veya ** line'da JSON üret
echo "$DELTA" | awk -v batch_max="$BATCH_MAX" '
BEGIN {
    count = 0
    first = 1
    print "["
}
function j(s) {
    # Basit JSON escape — çift tırnak, backslash, newline
    gsub(/\\/, "\\\\", s)
    gsub(/"/, "\\\"", s)
    gsub(/\r/, "", s)
    gsub(/\n/, " ", s)
    gsub(/\t/, " ", s)
    return s
}
/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/ {
    if (count >= batch_max) next
    date = $1
    time = $2
    mid = $3
    dir = $4
    ts = date "T" time "+00:00"

    if (dir == "<=") {
        # arrival: kaydet
        sender = $5
        user = ""
        size = 0
        subj = ""
        for (i = 6; i <= NF; i++) {
            if ($i ~ /^U=/)   { user = substr($i, 3) }
            if ($i ~ /^S=/)   { size = substr($i, 3) + 0 }
            if ($i ~ /^T=/) {
                # T="Subject" — kalan alanları birleştir
                subj_start = i
                subj_str = ""
                for (k = i; k <= NF; k++) subj_str = subj_str " " $k
                # T=" ile başlıyorsa
                if (subj_str ~ /T="/) {
                    match(subj_str, /T="[^"]*"/)
                    if (RLENGTH > 0) {
                        subj = substr(subj_str, RSTART + 3, RLENGTH - 4)
                    }
                }
                break
            }
        }
        # in_flight[mid] = ts|sender|user|size|subject
        in_flight[mid] = ts "|" sender "|" user "|" size "|" subj
    }
    else if (dir == "=>" || dir == "->" || dir == "**" || dir == "==") {
        rcpt = $5
        if (!(mid in in_flight)) next
        n = split(in_flight[mid], parts, "|")
        s_ts    = parts[1]
        s_from  = parts[2]
        s_user  = parts[3]
        s_size  = parts[4]
        s_subj  = parts[5]
        # Only outbound: U= dolu olmalı
        if (s_user == "") next
        action = (dir == "**" ? "bounce" : (dir == "==" ? "defer" : "accept"))
        # emit JSON
        if (!first) print ","
        first = 0
        printf "{\"exim_mid\":\"%s\",\"ts\":\"%s\",\"from_addr\":\"%s\",\"from_user\":\"%s\",\"to_addr\":\"%s\",\"subject\":\"%s\",\"size_bytes\":%s,\"verdict\":\"clean\",\"total_score\":0,\"action\":\"%s\"}",
            j(mid), j(s_ts), j(s_from), j(s_user), j(rcpt), j(s_subj), s_size, action
        count++
    }
}
END {
    print ""
    print "]"
    print "COUNT:" count > "/dev/stderr"
}
' 2> "$TMP.count" > "$TMP.events"

EVENT_COUNT=$(grep -oE 'COUNT:[0-9]+' "$TMP.count" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")

if [ "$EVENT_COUNT" -eq 0 ]; then
    log_line "Parsed 0 outbound events from $((NEW_POS - LAST_POS)) bytes (no U= tagged mail)"
    echo "$NEW_POS" > "$CHECKPOINT_FILE"
    exit 0
fi

# ------ Build payload ------
HOSTNAME=$(hostname)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
EVENTS_JSON=$(cat "$TMP.events")

PAYLOAD=$(cat <<EOF
{"license_key":"$LICENSE_KEY","hostname":"$HOSTNAME","server_ip":"$SERVER_IP","events":$EVENTS_JSON,"checkpoint_position":$NEW_POS}
EOF
)

# ------ Push to panel ------
RESP=$(curl -sSf --max-time 30 \
    -H "Content-Type: application/json" \
    -X POST "$PANEL_URL/api/outbound/exim-log-push" \
    -d "$PAYLOAD" 2>&1 || echo "ERROR")

if echo "$RESP" | grep -q '"ok":true'; then
    INSERTED=$(echo "$RESP" | grep -oE '"inserted":[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "?")
    UPDATED=$(echo "$RESP" | grep -oE '"updated":[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "?")
    log_line "OK · parsed=$EVENT_COUNT · inserted=$INSERTED · updated=$UPDATED · pos=$NEW_POS"
    echo "$NEW_POS" > "$CHECKPOINT_FILE"
else
    log_line "FAIL: $RESP"
    exit 1
fi
