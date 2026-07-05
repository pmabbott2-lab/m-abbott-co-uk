#!/usr/bin/env bash
# Keeps the app + ngrok running. Used by the macOS LaunchAgent (install-site-service.sh).

set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/m-abbott-site"
mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

while true; do
  app_up=false
  ngrok_up=false

  if lsof -iTCP:8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    app_up=true
  fi
  if pgrep -f "another-selector-ranged.ngrok-free.dev" >/dev/null 2>&1; then
    ngrok_up=true
  fi

  if [[ "$app_up" == false || "$ngrok_up" == false ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') restarting (app=$app_up ngrok=$ngrok_up)"
    SITE_WATCH=1 bash "$PROJECT_DIR/scripts/start-site.sh" >>"$LOG_DIR/watch.log" 2>&1 || true
  fi

  sleep 30
done
