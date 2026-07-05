#!/usr/bin/env bash
# Stop the local dev server and ngrok tunnel for this project.

set -euo pipefail

APP_PORT=8080
LOG_DIR="/tmp/m-abbott-site"

if [[ -f "$LOG_DIR/dev.pid" ]]; then
  kill "$(cat "$LOG_DIR/dev.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/dev.pid"
fi

if [[ -f "$LOG_DIR/ngrok.pid" ]]; then
  kill "$(cat "$LOG_DIR/ngrok.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/ngrok.pid"
fi

pkill -f "another-selector-ranged.ngrok-free.dev" 2>/dev/null || true

if lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t | xargs kill 2>/dev/null || true
fi

echo "Stopped local site processes on port ${APP_PORT}."
