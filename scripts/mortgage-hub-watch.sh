#!/usr/bin/env bash
# Background watchdog — restarts production server + ngrok if either drops.
# Installed via: npm run install:stable (from the project folder).

set -uo pipefail
LOG="/tmp/m-abbott-site"
mkdir -p "$LOG"

# Prevent Mac sleep while this runs (stops when you log out).
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dims &
  echo $! >"$LOG/caffeinate.pid"
fi

"$HOME/bin/mortgage-hub-stable.sh" start >>"$LOG/watch.log" 2>&1 || true

while true; do
  if ! curl -sf "http://127.0.0.1:8080/" >/dev/null 2>&1 || \
     ! pgrep -f "another-selector-ranged.ngrok-free.dev" >/dev/null 2>&1; then
    echo "$(date '+%F %T') restart triggered" >>"$LOG/watch.log"
    "$HOME/bin/mortgage-hub-stable.sh" ensure >>"$LOG/watch.log" 2>&1 || true
  fi
  sleep 30
done
