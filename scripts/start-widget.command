#!/bin/bash
# Launch the Electron floating-orb widget (falls back to nothing if not installed).
cd "$(dirname "$0")/.." || exit 1
if [ -x "./node_modules/.bin/electron" ]; then
  nohup ./node_modules/.bin/electron desktop/main.js > /tmp/token-widget.log 2>&1 &
else
  # legacy fallback: lightweight python widget
  nohup python3 scripts/desktop-widget.py > /tmp/token-widget.log 2>&1 &
fi
exit
