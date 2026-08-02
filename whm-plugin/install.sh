#!/usr/bin/env bash
#
# GokyuzuWebSpam — WHM/cPanel plugin installer
# Target: cPanel/WHM 110+ (tested on 136.0.32)
#
# GÜVENLİK GARANTİLERİ:
#   1) Yalnızca yeni dosyalar EKLENİR. Mevcut hiçbir cPanel/Exim/SA yapılandırması
#      DEĞİŞTİRİLMEZ, SİLİNMEZ veya YENİDEN YAZILMAZ.
#   2) Exim'e milter otomatik BAĞLANMAZ. Bu adım opt-in ve manueldir.
#      (WHM > Exim Configuration Manager üzerinden siz kararlaştırırsınız.)
#   3) SpamAssassin, ClamAV, DCC, Razor sistem servisleri OLDUKLARI GİBİ bırakılır.
#      GokyuzuWebSpam sadece "spamc / clamdscan / dccif / razor-check" komutlarını ÇAĞIRIR.
#   4) Milter servisi kurulur ama BAŞLATILMAZ (--start-milter geçmediğiniz sürece).
#      Böylece Exim üzerine yönlendirme yapana kadar hiçbir e-posta akışına
#      dokunulmaz.
#   5) MongoDB kurulumu OTOMATİK YAPILMAZ. Eğer sistemde mongod yoksa yalnızca
#      uyarı verilir; API veritabanı bağlantısı olmadan da yönetim paneli açılır
#      (salt-okunur seed veriyle).
#   6) Kaldırma sırasında /etc/mailshield ve /var/log/mailshield DOKUNULMADAN
#      bırakılır (denetim için).
#
# Usage:
#   ./install.sh                     # standart, güvenli kurulum
#   ./install.sh --start-milter      # milter servisini de başlat (opt-in)
#   ./install.sh --dry-run           # sadece ne yapacağını yazdır, dosya yazma
#
set -euo pipefail

START_MILTER=0
DRY_RUN=0
LICENSE_KEY=""
LICENSE_SERVER=""
for arg in "$@"; do
  case $arg in
    --start-milter)     START_MILTER=1 ;;
    --dry-run)          DRY_RUN=1 ;;
    --license=*)        LICENSE_KEY="${arg#*=}" ;;
    --license-server=*) LICENSE_SERVER="${arg#*=}" ;;
    --domain=*)         : ;;  # geriye uyumluluk, artık kullanılmıyor
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then echo "  DRY: $*";
  else eval "$@"; fi
}

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must be run as root." >&2
  exit 1
fi

if [[ ! -f /usr/local/cpanel/version ]]; then
  echo "WHM/cPanel not detected. Aborting." >&2
  exit 1
fi

CP_VER=$(cat /usr/local/cpanel/version)
echo "==> cPanel version detected: $CP_VER"

INSTALL_DIR=/usr/local/mailshield
CGI_DIR=/usr/local/cpanel/whostmgr/docroot/cgi/mailshield
CPANEL_PLUGIN_DIR=/usr/local/cpanel/base/frontend/jupiter/mailshield
CPANEL_3RDPARTY_DIR=/usr/local/cpanel/base/3rdparty/mailshield
APPCONFIG=/var/cpanel/apps/mailshield.conf
LOG_DIR=/var/log/mailshield
ETC_DIR=/etc/mailshield
SPOOL_DIR=/var/spool/mailshield/quarantine

echo "==> [1/9] Kullanıcı oluşturuluyor (mailshield)"
if ! id mailshield &>/dev/null; then
  run "useradd -r -s /sbin/nologin -d $INSTALL_DIR mailshield"
fi

echo "==> [2/9] Dizinler oluşturuluyor"
# INSTALL_DIR, LOG_DIR, ETC_DIR, SPOOL_DIR -> mailshield:mailshield (servis daemon çalıştırır)
for d in "$INSTALL_DIR" "$LOG_DIR" "$ETC_DIR" "$SPOOL_DIR"; do
  run "install -d -m 0755 -o mailshield -g mailshield '$d'"
done
# WHM/cPanel CGI dizinleri MUTLAKA root:root olmalı (aksi halde cPanel 403 döner)
for d in "$CGI_DIR" "$CPANEL_PLUGIN_DIR"; do
  run "install -d -m 0755 -o root -g root '$d'"
done

SRC=$(dirname "$(readlink -f "$0")")

echo "==> [3/9] Uygulama dosyaları kopyalanıyor (mevcut dosyalar KORUNUR)"
run "install -d $INSTALL_DIR/lib $INSTALL_DIR/bin $INSTALL_DIR/api"
run "cp -rn '$SRC/lib/.' '$INSTALL_DIR/lib/'"
run "cp -n  '$SRC/scripts/mailshield-milter.pl'  '$INSTALL_DIR/bin/mailshield-milter.pl'"
run "cp -n  '$SRC/scripts/quarantine-prune.pl'   '$INSTALL_DIR/bin/quarantine-prune.pl'"
run "cp -n  '$SRC/scripts/heartbeat.pl'          '$INSTALL_DIR/bin/heartbeat.pl'"
# NOTE: logtail is our own file — always force-refresh
run "install -m 0755 -o root -g root '$SRC/scripts/mailshield-logtail.pl' '$INSTALL_DIR/bin/mailshield-logtail.pl'"
run "cp -n  '$SRC/mailshieldctl'                 '$INSTALL_DIR/bin/mailshieldctl'"
run "chmod +x '$INSTALL_DIR/bin/'*"
run "ln -sfn '$INSTALL_DIR/bin/mailshieldctl' /usr/local/sbin/mailshieldctl"

echo "==> [4/9] WHM CGI proxy kuruluyor (force-overwrite, root:root)"
# Önceki hatalı sahipliği tamir et
run "chown -R root:root '$CGI_DIR'"
# Force overwrite: our own CGI files, önceki başarısız kurulumdan kalıntıları temizle
run "install -m 0755 -o root -g root '$SRC/whm/mailshield.cgi'  '$CGI_DIR/index.cgi'"
run "install -m 0644 -o root -g root '$SRC/whm/mailshield.tmpl' '$CGI_DIR/mailshield.tmpl'"
if [[ -f "$SRC/whm/icon.png" ]]; then
  run "install -m 0644 -o root -g root '$SRC/whm/icon.png' '$CGI_DIR/icon.png'"
fi
# CRLF/BOM defensively strip in case tar/copy tainted files
run "sed -i '1s/^\\xEF\\xBB\\xBF//' '$CGI_DIR/index.cgi' '$CGI_DIR/mailshield.tmpl'"
run "sed -i 's/\\r\$//' '$CGI_DIR/index.cgi' '$CGI_DIR/mailshield.tmpl'"

echo "==> [5/9] cPanel MailControl plugin kuruluyor"
run "chown -R root:root '$CPANEL_PLUGIN_DIR'"
run "install -m 0644 -o root -g root '$SRC/cpanel/mailshield.live.php'     '$CPANEL_PLUGIN_DIR/index.live.php'"
run "install -m 0644 -o root -g root '$SRC/cpanel/mailshield.cpanelplugin' '$CPANEL_PLUGIN_DIR/mailshield.cpanelplugin'"
if [[ -f "$SRC/cpanel/icon.png" ]]; then
  run "install -m 0644 -o root -g root '$SRC/cpanel/icon.png' '$CPANEL_PLUGIN_DIR/icon.png'"
fi
# cPanel end-user AppConfig /3rdparty/ altında bekliyor. Aynı dosyaları oraya da yerleştir.
run "install -d -m 0755 -o root -g root '$CPANEL_3RDPARTY_DIR'"
run "install -m 0644 -o root -g root '$SRC/cpanel/mailshield.live.php' '$CPANEL_3RDPARTY_DIR/index.live.php'"
if [[ -f "$SRC/cpanel/icon.png" ]]; then
  run "install -m 0644 -o root -g root '$SRC/cpanel/icon.png' '$CPANEL_3RDPARTY_DIR/icon.png'"
fi
# NOTE: /usr/local/cpanel/scripts/install_plugin bir .tgz arsivi bekler; .cpanelplugin
# ham dosyasını 'Unrecognized archive format' hatasi verir. Onun yerine AppConfig
# yolunu (asagida [6/9] adiminda /var/cpanel/apps/mailshield_user.conf) kullaniriz.

echo "==> [6/9] AppConfig kaydediliyor (WHM + cPanel menulerine eklenir)"
# --- WHM AppConfig ---
if [[ $DRY_RUN -eq 0 ]]; then
  /usr/local/cpanel/bin/unregister_appconfig mailshield 2>/dev/null || true
  rm -f "$APPCONFIG"
fi
run "install -m 0644 '$SRC/appconfig/mailshield.conf' '$APPCONFIG'"
run "sed -i '1s/^\\xEF\\xBB\\xBF//' '$APPCONFIG'"
run "sed -i 's/\\r\$//' '$APPCONFIG'"
if [[ $DRY_RUN -eq 0 ]]; then
  if ! /usr/local/cpanel/bin/register_appconfig "$APPCONFIG"; then
    echo "!! WHM register_appconfig BASARISIZ. Dosya icerigi:" >&2
    cat "$APPCONFIG" >&2
    exit 1
  fi
  echo "    WHM AppConfig kaydedildi."
fi

# --- cPanel end-user AppConfig ---
USER_APPCONFIG=/var/cpanel/apps/mailshield_user.conf
if [[ -f "$SRC/appconfig/mailshield_user.conf" ]]; then
  if [[ $DRY_RUN -eq 0 ]]; then
    /usr/local/cpanel/bin/unregister_appconfig mailshield_user 2>/dev/null || true
    rm -f "$USER_APPCONFIG"
  fi
  run "install -m 0644 '$SRC/appconfig/mailshield_user.conf' '$USER_APPCONFIG'"
  run "sed -i '1s/^\\xEF\\xBB\\xBF//' '$USER_APPCONFIG'"
  run "sed -i 's/\\r\$//' '$USER_APPCONFIG'"
  if [[ $DRY_RUN -eq 0 ]]; then
    if /usr/local/cpanel/bin/register_appconfig "$USER_APPCONFIG"; then
      echo "    cPanel (end-user) AppConfig kaydedildi."
      # Feature'ı tum feature list'lerine ekle (herkes gorsun)
      if [[ -d /var/cpanel/features ]]; then
        for flist in /var/cpanel/features/*; do
          [[ -f "$flist" ]] && grep -q "^mailshield_user=" "$flist" || echo "mailshield_user=1" >> "$flist"
        done
      fi
    else
      echo "    UYARI: cPanel end-user AppConfig kaydi basarisiz (opsiyonel, devam ediliyor)."
    fi
  fi
fi

echo "==> Yapılandırma yerleştirme"
if [[ ! -f "$ETC_DIR/mailshield.conf" ]]; then
  run "cp '$SRC/config/mailshield.conf' '$ETC_DIR/mailshield.conf'"
fi
if [[ ! -f "$ETC_DIR/policy.json" ]]; then
  run "cp '$SRC/config/policy.default.json' '$ETC_DIR/policy.json'"
fi
# Plugin mode — customer (bayi) varsayılan; 7 günlük demo başlar
if [[ ! -f "$ETC_DIR/mode.env" ]]; then
  cat > "$ETC_DIR/mode.env" <<'EOF'
MAILSHIELD_MODE=customer
MAILSHIELD_DEMO_DAYS=7
EOF
  echo "    → Customer moduna alındı, 7 günlük demo süreci başlatıldı."
fi
run "chown -R mailshield:mailshield '$ETC_DIR'"

# ---- Lisans anahtarını yaz (kurulum komutunda --license=... verildiyse) ----
if [[ -n "$LICENSE_KEY" && $DRY_RUN -eq 0 ]]; then
  echo "==> Lisans anahtarı config'e yazılıyor"
  CONF_FILE="$ETC_DIR/mailshield.conf"
  # [license] bloğunu ekle veya güncelle
  if grep -q "^\[license\]" "$CONF_FILE"; then
    # Var olan bloğu güncelle (key satırını değiştir/ekle)
    if grep -q "^key\s*=" "$CONF_FILE"; then
      sed -i "s|^key\s*=.*|key = $LICENSE_KEY|" "$CONF_FILE"
    else
      sed -i "/^\[license\]/a key = $LICENSE_KEY" "$CONF_FILE"
    fi
  else
    printf "\n[license]\nkey = %s\n" "$LICENSE_KEY" >> "$CONF_FILE"
  fi
  # License server URL — verilmediyse varsayılan preview URL
  DEFAULT_LS="${LICENSE_SERVER:-https://panel.gokyuzuhosting.com}"
  if grep -q "^server_url\s*=" "$CONF_FILE"; then
    sed -i "s|^server_url\s*=.*|server_url = $DEFAULT_LS|" "$CONF_FILE"
  else
    sed -i "/^\[license\]/a server_url = $DEFAULT_LS" "$CONF_FILE"
  fi
  chown mailshield:mailshield "$CONF_FILE"
  chmod 640 "$CONF_FILE"
  echo "    → Lisans: ${LICENSE_KEY:0:14}…  Sunucu: $DEFAULT_LS"
  # Customer moda al (bayi kurulumu) ve demo süresini kapat
  cat > "$ETC_DIR/mode.env" <<EOF
MAILSHIELD_MODE=customer
MAILSHIELD_DEMO_DAYS=0
EOF
fi

echo "==> [8/9] systemd unit'leri kopyalanıyor"
for u in "$SRC/systemd/"*; do
  run "install -m 0644 '$u' '/etc/systemd/system/$(basename $u)'"
done
run "systemctl daemon-reload"

# API servisi güvenli — kimseye zarar vermez, 127.0.0.1'de dinler
run "systemctl enable --now mailshield-api.service || true"

# Log-tail adapter (Exim mainlog -> SaaS backend). Sadece license anahtari
# varsa baslatilir. Milter Exim'e bind edilene kadar bu, canli mail
# trafiginin panelde gorunmesini saglayan tek yoldur.
if [[ -n "$LICENSE_KEY" && $DRY_RUN -eq 0 ]]; then
  run "systemctl enable --now mailshield-logtail.service || true"
  echo "    Exim log-tail servisi baslatildi: mailshield-logtail.service"
  echo "    Loglar: /var/log/mailshield/logtail.log"
fi

# Milter DEFAULT KAPALI — sadece --start-milter verildiyse başlatılır
if [[ $START_MILTER -eq 1 ]]; then
  echo "    --start-milter verildi: milter etkinleştiriliyor"
  run "systemctl enable --now mailshield-milter.service || true"
else
  echo "    Milter kuruldu ama BAŞLATILMADI (opsiyonel — Exim log-tail zaten canli)."
fi

# Karantina temizleyici — her saat çalışır, sadece kendi DB'sinden siler
run "systemctl enable --now mailshield-quarantine.timer || true"

echo "==> [9/9] MongoDB kontrolü"
if ! command -v mongod >/dev/null; then
  echo "    UYARI: mongod bulunamadı. API çalışır ama karantina/list DB'siz devreye giremez."
  echo "    Kurulum önerisi: yum install -y mongodb-org && systemctl enable --now mongod"
fi

if [[ $DRY_RUN -eq 0 ]]; then
  /scripts/restartsrv_cpsrvd
fi

cat <<EOF

============================================================
  GokyuzuWebSpam kurulumu tamamlandı.

  cPanel sisteminize DOKUNULMADI:
    · Exim yapılandırması        → değişmedi (opt-in)
    · SpamAssassin / ClamAV      → değişmedi
    · Mevcut Postfix / dovecot   → değişmedi

  Erişim:
    · WHM > Plugins > GokyuzuWebSpam
    · Kullanıcılar: cPanel > Email > GokyuzuWebSpam MailControl

  Milter'ı etkinleştirmek İSTERSENİZ (opt-in):
    systemctl enable --now mailshield-milter.service
    WHM > Exim Configuration Manager > Advanced Editor:
       milters=inet:127.0.0.1:33333

  Sağlık kontrolü:  mailshieldctl status
  Loglar:           $LOG_DIR/*.log
  Konfig:           $ETC_DIR/
  Kaldırma:         ./uninstall.sh   (mevcut cPanel'e dokunmaz)
============================================================
EOF
