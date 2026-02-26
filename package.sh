#!/usr/bin/env bash
# Build a zip of the extension for Chrome Web Store or sideloading.
set -e
cd "$(dirname "$0")"
VERSION=$(grep -o '"version": *"[^"]*"' manifest.json | sed 's/.*"\([^"]*\)" *$/\1/')
OUT="LinkedIn-JD-Extractor-${VERSION}.zip"
rm -f "$OUT"
zip -r "$OUT" \
  manifest.json \
  popup.html popup.css popup.js \
  content.js content-styles.css \
  settings.html settings.css settings.js \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  -x "*.DS_Store" -x "*node_modules*"
echo "Created $OUT"
