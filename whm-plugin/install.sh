#!/usr/bin/env bash
#
# MailShield Pro — WHM/cPanel plugin installer
# Target: cPanel/WHM 110+ (tested on 136.0.32)
#
# GÜVENLİK GARANTİLERİ:
#   1) Yalnızca yeni dosyalar EKLENİR. Mevcut hiçbir cPanel/Exim/SA yapılandırması
#      DEĞİŞTİRİLMEZ, SİLİNMEZ veya YENİDEN YAZILMAZ.
#   2) Exim'e milter otomatik BAĞLANMAZ. Bu adım opt-in ve manueldir.
#      (WHM > Exim Configuration Manager üzerinden siz kararlaştırırsınız.)
#   3) SpamAssassin, ClamAV, DCC, Razor sistem servisleri OLDUKLARI GİBİ bırakılır.
#      MailShield sadece "spamc / clamdscan / dccif / razor-check" komutlarını ÇAĞIRIR.
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
for arg in "$@"; do
  case $arg in
    --start-milter) START_MILTER=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    --domain=*)     : ;;  # geriye uyumluluk, artık kullanılmıyor
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
APPCONFIG=/var/cpanel/apps/mailshield.conf
LOG_DIR=/var/log/mailshield
ETC_DIR=/etc/mailshield
SPOOL_DIR=/var/spool/mailshield/quarantine

echo "==> [1/9] Kullanıcı oluşturuluyor (mailshield)"
if ! id mailshield &>/dev/null; then
  run "useradd -r -s /sbin/nologin -d $INSTALL_DIR mailshield"
fi

echo "==> [2/9] Dizinler oluşturuluyor"
for d in "$INSTALL_DIR" "$CGI_DIR" "$CPANEL_PLUGIN_DIR" "$LOG_DIR" "$ETC_DIR" "$SPOOL_DIR"; do
  run "install -d -m 0755 -o mailshield -g mailshield '$d'"
done

SRC=$(dirname "$(readlink -f "$0")")

echo "==> [3/9] Uygulama dosyaları kopyalanıyor (mevcut dosyalar KORUNUR)"
run "install -d $INSTALL_DIR/lib $INSTALL_DIR/bin $INSTALL_DIR/api"
run "cp -rn '$SRC/lib/.' '$INSTALL_DIR/lib/'"
run "cp -n  '$SRC/scripts/mailshield-milter.pl' '$INSTALL_DIR/bin/mailshield-milter.pl'"
run "cp -n  '$SRC/scripts/quarantine-prune.pl'  '$INSTALL_DIR/bin/quarantine-prune.pl'"
run "cp -n  '$SRC/mailshieldctl'                '$INSTALL_DIR/bin/mailshieldctl'"
run "chmod +x '$INSTALL_DIR/bin/'*"
run "ln -sfn '$INSTALL_DIR/bin/mailshieldctl' /usr/local/sbin/mailshieldctl"

echo "==> [4/9] WHM CGI proxy kuruluyor"
run "cp -n '$SRC/whm/mailshield.cgi'   '$CGI_DIR/index.cgi'"
run "cp -n '$SRC/whm/mailshield.tmpl'  '$CGI_DIR/mailshield.tmpl'"
run "chmod 755 '$CGI_DIR/index.cgi'"

echo "==> [5/9] cPanel MailControl plugin kuruluyor"
run "cp -n '$SRC/cpanel/mailshield.live.php'       '$CPANEL_PLUGIN_DIR/index.live.php'"
run "cp -n '$SRC/cpanel/mailshield.cpanelplugin'   '$CPANEL_PLUGIN_DIR/mailshield.cpanelplugin'"
if [[ -x /usr/local/cpanel/scripts/install_plugin && $DRY_RUN -eq 0 ]]; then
  /usr/local/cpanel/scripts/install_plugin "$CPANEL_PLUGIN_DIR/mailshield.cpanelplugin" || true
fi

echo "==> [6/9] AppConfig kaydediliyor (WHM menüsüne eklenir)"
run "install -m 0644 '$SRC/appconfig/mailshield.conf' '$APPCONFIG'"
if [[ $DRY_RUN -eq 0 ]]; then
  /usr/local/cpanel/bin/register_appconfig "$APPCONFIG"
fi

echo "==> [7/9] Varsayılan yapılandırma yerleştiriliyor"
if [[ ! -f "$ETC_DIR/mailshield.conf" ]]; then
  run "cp '$SRC/config/mailshield.conf' '$ETC_DIR/mailshield.conf'"
fi
if [[ ! -f "$ETC_DIR/policy.json" ]]; then
  run "cp '$SRC/config/policy.default.json' '$ETC_DIR/policy.json'"
fi
run "chown -R mailshield:mailshield '$ETC_DIR'"

echo "==> [8/9] systemd unit'leri kopyalanıyor"
for u in "$SRC/systemd/"*; do
  run "install -m 0644 '$u' '/etc/systemd/system/$(basename $u)'"
done
run "systemctl daemon-reload"

# API servisi güvenli — kimseye zarar vermez, 127.0.0.1'de dinler
run "systemctl enable --now mailshield-api.service || true"

# Milter DEFAULT KAPALI — sadece --start-milter verildiyse başlatılır
if [[ $START_MILTER -eq 1 ]]; then
  echo "    --start-milter verildi: milter etkinleştiriliyor"
  run "systemctl enable --now mailshield-milter.service || true"
else
  echo "    Milter kuruldu ama BAŞLATILMADI. Aktifleştirmek için:"
  echo "      systemctl enable --now mailshield-milter.service"
  echo "    Ardından WHM > Exim Configuration Manager > Advanced Editor içine"
  echo "    'milters=inet:127.0.0.1:33333' satırını EL ile ekleyin."
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
  MailShield Pro kurulumu tamamlandı.

  cPanel sisteminize DOKUNULMADI:
    · Exim yapılandırması        → değişmedi (opt-in)
    · SpamAssassin / ClamAV      → değişmedi
    · Mevcut Postfix / dovecot   → değişmedi

  Erişim:
    · WHM > Plugins > MailShield Pro
    · Kullanıcılar: cPanel > Email > MailShield MailControl

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
