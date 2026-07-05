#!/usr/bin/env bash
# Start Mortgage Hub locally and expose it via your fixed ngrok URL.
# Safe to run repeatedly — skips anything already running.

set -euo pipefail
cd "$(dirname "$0")/.."

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

APP_PORT=8080
PUBLIC_URL="https://another-selector-ranged.ngrok-free.dev"
NGROK_BIN="${NGROK_BIN:-$HOME/bin/ngrok}"
if [[ ! -x "$NGROK_BIN" && -x "$HOME/bin/ngrok" ]]; then
  NGROK_BIN="$HOME/bin/ngrok"
fi
POLICY_FILE="${HOME}/ngrok-policy.yml"
LOG_DIR="/tmp/m-abbott-site"
mkdir -p "$LOG_DIR"

wait_for_port() {
  local port=$1
  for _ in $(seq 1 45); do
    if curl -sf "http://localhost:${port}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✓ App already running on http://localhost:${APP_PORT}"
else
  echo "Starting app (npm run dev)…"
  (
    cd "$(pwd)"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
    exec npm run dev
  ) >"$LOG_DIR/dev.log" 2>&1 &
  echo $! >"$LOG_DIR/dev.pid"
  if ! wait_for_port "$APP_PORT"; then
    echo "✗ App did not start. Last lines of log:"
    tail -20 "$LOG_DIR/dev.log" || true
    exit 1
  fi
  echo "✓ App running on http://localhost:${APP_PORT}"
fi

if pgrep -f "another-selector-ranged.ngrok-free.dev" >/dev/null 2>&1; then
  echo "✓ ngrok tunnel already running"
else
  if [[ ! -x "$NGROK_BIN" ]]; then
    echo "✗ ngrok not found at $NGROK_BIN"
    echo "  Install ngrok or set NGROK_BIN to the full path."
    exit 1
  fi
  echo "Starting ngrok tunnel…"
  (
    exec "$NGROK_BIN" http \
      --url="$PUBLIC_URL" \
      "$APP_PORT" \
      --traffic-policy-file "$POLICY_FILE"
  ) >"$LOG_DIR/ngrok.log" 2>&1 &
  echo $! >"$LOG_DIR/ngrok.pid"
  sleep 2
  echo "✓ ngrok started"
fi

echo ""
echo "Your site:"
echo "  Public:  $PUBLIC_URL"
echo "  Local:   http://localhost:${APP_PORT}"
echo ""
echo "IMPORTANT — first visit in a browser:"
echo "  ngrok shows a warning page. Click the blue \"Visit Site\" button."
echo "  You only need to do this once per browser."
echo ""
echo "Keep this Mac awake while others use the site."
echo "Logs: $LOG_DIR/dev.log and $LOG_DIR/ngrok.log"

# Open in default browser (macOS) — skip when the watch service is restarting us
if [[ "$(uname -s)" == "Darwin" && -z "${SITE_WATCH:-}" ]]; then
  open "$PUBLIC_URL" 2>/dev/null || true
fi
