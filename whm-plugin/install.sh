#!/usr/bin/env bash
#
# MailShield Pro — WHM/cPanel plugin installer
# Target: cPanel/WHM 110+ (tested on 136.0.32)
#
# Usage:  ./install.sh --domain=mailshield.example.com
#
set -euo pipefail

DOMAIN=""
for arg in "$@"; do
  case $arg in
    --domain=*) DOMAIN="${arg#*=}" ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

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

echo "==> Creating directories"
install -d -m 0755 "$INSTALL_DIR" "$CGI_DIR" "$CPANEL_PLUGIN_DIR" "$LOG_DIR" "$ETC_DIR"
install -d -m 0755 "$INSTALL_DIR/api" "$INSTALL_DIR/lib" "$INSTALL_DIR/bin"

SRC=$(dirname "$(readlink -f "$0")")

echo "==> Copying application files"
cp -r "$SRC/lib/"* "$INSTALL_DIR/lib/"
cp -r "$SRC/scripts/"* "$INSTALL_DIR/bin/"
cp "$SRC/mailshieldctl" "$INSTALL_DIR/bin/mailshieldctl"
chmod +x "$INSTALL_DIR/bin/"*
ln -sf "$INSTALL_DIR/bin/mailshieldctl" /usr/local/sbin/mailshieldctl

echo "==> Installing WHM CGI proxy"
cp "$SRC/whm/mailshield.cgi" "$CGI_DIR/index.cgi"
cp "$SRC/whm/mailshield.tmpl" "$CGI_DIR/mailshield.tmpl"
chmod 755 "$CGI_DIR/index.cgi"

echo "==> Installing cPanel MailControl plugin"
cp "$SRC/cpanel/mailshield.live.php" "$CPANEL_PLUGIN_DIR/index.live.php"
cp "$SRC/cpanel/mailshield.cpanelplugin" "$CPANEL_PLUGIN_DIR/mailshield.cpanelplugin"
if [[ -x /usr/local/cpanel/scripts/install_plugin ]]; then
  /usr/local/cpanel/scripts/install_plugin "$CPANEL_PLUGIN_DIR/mailshield.cpanelplugin" || true
fi

echo "==> Registering AppConfig"
install -m 0644 "$SRC/appconfig/mailshield.conf" "$APPCONFIG"
/usr/local/cpanel/bin/register_appconfig "$APPCONFIG"

echo "==> Installing default configuration"
if [[ ! -f "$ETC_DIR/mailshield.conf" ]]; then
  cp "$SRC/config/mailshield.conf" "$ETC_DIR/mailshield.conf"
fi
if [[ ! -f "$ETC_DIR/policy.json" ]]; then
  cp "$SRC/config/policy.default.json" "$ETC_DIR/policy.json"
fi

echo "==> Installing systemd units"
cp "$SRC/systemd/"* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mailshield-api.service      || true
systemctl enable --now mailshield-milter.service   || true
systemctl enable --now mailshield-quarantine.timer || true

echo "==> Ensuring MongoDB is running"
if ! command -v mongod >/dev/null; then
  echo "MongoDB not found. Please install mongodb-org (see docs/INSTALL.md)." >&2
fi

echo "==> Restarting cpsrvd so plugin appears in WHM"
/scripts/restartsrv_cpsrvd

cat <<EOF

============================================================
  MailShield Pro installation complete.
  Log in to WHM and open:  Plugins → MailShield Pro
  cPanel users:            Email → MailShield MailControl

  Optional: attach the milter to Exim
     WHM → Exim Configuration Manager → Advanced Editor
     Add: milters=inet:127.0.0.1:33333

  Health check:  mailshieldctl status
  Logs:          $LOG_DIR/*.log
  Config:        $ETC_DIR/
============================================================
EOF
