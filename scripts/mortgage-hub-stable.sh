#!/usr/bin/env bash
# Stable Mortgage Hub: production server + ngrok. Safe to run repeatedly.
# Installed to ~/bin via scripts/install-stable-site.sh

set -uo pipefail

APP_PORT=8080
PUBLIC_URL="https://another-selector-ranged.ngrok-free.dev"
NGROK="$HOME/bin/ngrok"
POLICY="$HOME/ngrok-policy.yml"
LOG="/tmp/m-abbott-site"
PROJECT="${MORTGAGE_HUB_PROJECT:-$HOME/Projects/m-abbott-co-uk-main}"

mkdir -p "$LOG"

load_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
}

load_env() {
  if [[ -f "$PROJECT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT/.env"
    set +a
  fi
}

wait_for_port() {
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

app_running() {
  lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t >/dev/null 2>&1
}

ngrok_running() {
  pgrep -f "another-selector-ranged.ngrok-free.dev" >/dev/null 2>&1
}

start_app() {
  if app_running; then
    return 0
  fi
  if [[ ! -d "$PROJECT" ]]; then
    echo "Project not found at $PROJECT" >>"$LOG/stable.err"
    return 1
  fi
  load_node
  load_env
  cd "$PROJECT"

  if [[ ! -f dist/server/server.js ]]; then
    echo "Building production app…" >>"$LOG/stable.log"
    npm run build >>"$LOG/build.log" 2>&1 || return 1
  fi

  echo "$(date '+%F %T') starting production server" >>"$LOG/stable.log"
  nohup npx vite preview --port "$APP_PORT" --host 0.0.0.0 >>"$LOG/prod.log" 2>&1 &
  echo $! >"$LOG/prod.pid"
  disown -h "$!" 2>/dev/null || true
  wait_for_port
}

start_ngrok() {
  if ngrok_running; then
    return 0
  fi
  if [[ ! -x "$NGROK" ]]; then
    echo "ngrok missing at $NGROK" >>"$LOG/stable.err"
    return 1
  fi
  echo "$(date '+%F %T') starting ngrok" >>"$LOG/stable.log"
  nohup "$NGROK" http --url="$PUBLIC_URL" "$APP_PORT" --traffic-policy-file "$POLICY" >>"$LOG/ngrok.log" 2>&1 &
  echo $! >"$LOG/ngrok.pid"
  disown -h "$!" 2>/dev/null || true
  sleep 2
}

case "${1:-start}" in
  start)
    start_app && start_ngrok
    ;;
  ensure)
    start_app || true
    start_ngrok || true
    ;;
  stop)
    [[ -f "$LOG/prod.pid" ]] && kill "$(cat "$LOG/prod.pid")" 2>/dev/null || true
    [[ -f "$LOG/ngrok.pid" ]] && kill "$(cat "$LOG/ngrok.pid")" 2>/dev/null || true
    pkill -f "vite preview --port ${APP_PORT}" 2>/dev/null || true
    pkill -f "another-selector-ranged.ngrok-free.dev" 2>/dev/null || true
    lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
    rm -f "$LOG/prod.pid" "$LOG/ngrok.pid"
    ;;
  rebuild)
    "$0" stop
    sleep 1
    load_node
    cd "$PROJECT" && rm -rf dist node_modules/.vite && npm run build >>"$LOG/build.log" 2>&1
    "$0" start
    ;;
  status)
    echo -n "app: "; app_running && echo "up" || echo "down"
    echo -n "ngrok: "; ngrok_running && echo "up" || echo "down"
    curl -sf -o /dev/null -w "http:%{http_code}\n" "http://127.0.0.1:${APP_PORT}/" 2>/dev/null || echo "http:fail"
    ;;
  *)
    echo "Usage: $0 {start|ensure|stop|rebuild|status}"
    exit 1
    ;;
esac
