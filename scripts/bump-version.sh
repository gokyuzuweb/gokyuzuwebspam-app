#!/usr/bin/env bash
# GökyüzüWebSpam — tek komutla VERSION bump helper
#
# Kullanim:
#   scripts/bump-version.sh v44.00.54
#   scripts/bump-version.sh 44.00.54    # v prefix otomatik eklenir
#
# Ne yapar:
#   1. `/app/VERSION`, `/app/backend/VERSION`, `/app/whm-plugin/VERSION` bumplar
#   2. `backend/server.py::_PACKAGE_VERSION` fallback'ini gunceller
#   3. Yeni surumu README-tipi ozet gosterir
#   4. Emergent "Save to Github" + "Deploy" adimlarini hatirlatir
#
# Post-bump: Kullanici Emergent panelinden `Save to Github` -> `Deploy` yapmali.
# Bu script deploy TETIKLEMEZ (Emergent platform kisiti — sadece kullanici
# UI'dan yapabilir). Ama version drift'i imkansiz hale getirir.

set -e

if [[ $# -lt 1 ]]; then
  echo "Kullanim: $0 <vXX.YY.ZZ>"
  echo "Ornek:   $0 v44.00.54"
  exit 1
fi

NEW="$1"
# v prefix normalize
[[ "$NEW" != v* ]] && NEW="v$NEW"

if ! [[ "$NEW" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "HATA: gecersiz surum format. Beklenen: vXX.YY.ZZ"
  echo "  Verilen: $NEW"
  exit 1
fi

echo "==> VERSION bump: $NEW"

# 1) 3 VERSION dosyasi
for f in /app/VERSION /app/backend/VERSION /app/whm-plugin/VERSION; do
  echo "$NEW" > "$f"
  echo "    ✓ $f"
done

# 2) server.py hardcoded fallback
SERVER_PY="/app/backend/server.py"
if grep -q '_PACKAGE_VERSION = ' "$SERVER_PY"; then
  sed -i -E "s/_PACKAGE_VERSION = \"v[0-9]+\.[0-9]+\.[0-9]+\"/_PACKAGE_VERSION = \"$NEW\"/" "$SERVER_PY"
  CURR=$(grep -oE '_PACKAGE_VERSION = "v[0-9]+\.[0-9]+\.[0-9]+"' "$SERVER_PY" | head -1)
  echo "    ✓ $SERVER_PY :: $CURR"
else
  echo "    ⚠ $SERVER_PY icinde _PACKAGE_VERSION bulunamadi"
fi

# 3) Drift kontrol
echo ""
echo "==> Dogrulama"
for f in /app/VERSION /app/backend/VERSION /app/whm-plugin/VERSION; do
  V=$(cat "$f")
  MARK="✓"
  [[ "$V" != "$NEW" ]] && MARK="✗"
  echo "    $MARK $f = $V"
done

echo ""
echo "==> Sonraki adimlar"
echo "  1. Test: cd /app/backend && python -m pytest tests/test_v44_00_50_version_consistency.py -v"
echo "  2. Emergent panelinde 'Save to Github' → yeni commit"
echo "  3. Emergent panelinde 'Deploy' → panel.gokyuzuhosting.com'u guncel surume cikar"
echo "  4. Bayi sunuculari: sudo gwsm-update"
echo ""
echo "TAMAM. Yeni surum: $NEW"
