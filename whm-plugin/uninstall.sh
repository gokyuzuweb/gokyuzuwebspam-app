#!/usr/bin/env bash
#
# GokyuzuWebSpam — uninstaller
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "uninstall.sh must be run as root." >&2
  exit 1
fi

APPCONFIG=/var/cpanel/apps/mailshield.conf
if [[ -f "$APPCONFIG" ]]; then
  /usr/local/cpanel/bin/unregister_appconfig mailshield || true
  rm -f "$APPCONFIG"
fi

systemctl disable --now mailshield-api.service      || true
systemctl disable --now mailshield-milter.service   || true
systemctl disable --now mailshield-quarantine.timer || true
rm -f /etc/systemd/system/mailshield-*.service
rm -f /etc/systemd/system/mailshield-*.timer
systemctl daemon-reload

rm -rf /usr/local/mailshield
rm -rf /usr/local/cpanel/whostmgr/docroot/cgi/mailshield
rm -rf /usr/local/cpanel/base/frontend/jupiter/mailshield
rm -f  /usr/local/sbin/mailshieldctl

echo "GokyuzuWebSpam removed."
echo "Note: /etc/mailshield/ and /var/log/mailshield/ are preserved for review."
echo "Delete manually if no longer needed."
