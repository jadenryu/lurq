#!/usr/bin/env bash
# Regenerate src/app/opengraph-image.jpg, the card X, Slack and LinkedIn show for
# a link to the site, from the live landing page.
#
# The card is a picture of the hero, so it dates: re-run this after the version
# chip, the headline, or anything else above the fold changes.
#
#   apps/web/scripts/capture-og-image.sh [url]
set -euo pipefail

URL="${1:-https://www.lurq.run/}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
WEB="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$WEB/src/app/opengraph-image.jpg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Reduced motion renders the hero's entrance animations at their final frame;
# without it the capture lands mid-fade, with the buttons and scan box missing.
# `--timeout` is a plain wait, because Chrome's virtual time never settles on a
# page with a looping marquee. Signed out, which is what a visitor sees.
"$CHROME" --headless=new --user-data-dir="$TMP/profile" --no-first-run --disable-gpu \
  --hide-scrollbars --force-prefers-reduced-motion --force-device-scale-factor=2 \
  --window-size=1710,951 --timeout=10000 --screenshot="$TMP/page.png" "$URL" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 45); do [ -s "$TMP/page.png" ] && break; sleep 1; done
sleep 1
kill "$pid" 2>/dev/null || true
[ -s "$TMP/page.png" ] || { echo "capture failed: no screenshot from $URL" >&2; exit 1; }

# 1710x951 CSS px at 2x is 3420x1902. A large card is 1.91:1, so 1796px tall:
# 20px above the nav, the rest below the logo row. Written at 2x, 2400x1260.
cd "$WEB"
node -e '
  const sharp = require("sharp");
  sharp(process.argv[1])
    .extract({ left: 0, top: 20, width: 3420, height: 1796 })
    .resize(2400, 1260)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(process.argv[2])
    .then((i) => console.log(`wrote ${process.argv[2]} (${i.width}x${i.height}, ${Math.round(i.size / 1024)}KB)`));
' "$TMP/page.png" "$OUT"
