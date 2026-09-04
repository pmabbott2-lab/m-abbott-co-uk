#!/usr/bin/env bash
# Stable Mortgage Hub: production server + ngrok. Safe to run repeatedly.
# Installed to ~/bin via scripts/install-stable-site.sh

set -uo pipefail

APP_PORT=8080
MOCKUP_PORT=8081
PROXY_PORT=8090
MOCKUP_DIR="marketing/mortgage-hub-website"
PUBLIC_URL="https://another-selector-ranged.ngrok-free.dev"
USE_DEMO_PROXY="${MORTGAGE_USE_DEMO_PROXY:-1}"
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

mockup_running() {
  lsof -iTCP:"$MOCKUP_PORT" -sTCP:LISTEN -t >/dev/null 2>&1
}

proxy_running() {
  lsof -iTCP:"$PROXY_PORT" -sTCP:LISTEN -t >/dev/null 2>&1
}

stop_demo_proxy() {
  [[ -f "$LOG/proxy.pid" ]] && kill "$(cat "$LOG/proxy.pid")" 2>/dev/null || true
  pkill -f "mortgage-demo-proxy.mjs" 2>/dev/null || true
  lsof -iTCP:"$PROXY_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
  for _ in $(seq 1 15); do
    proxy_running || return 0
    sleep 1
  done
  echo "port :$PROXY_PORT still in use after stop_demo_proxy" >>"$LOG/stable.err"
}

start_demo_proxy() {
  if [[ "$USE_DEMO_PROXY" != "1" ]]; then
    return 0
  fi
  if [[ ! -f "$PROJECT/scripts/mortgage-demo-proxy.mjs" ]]; then
    echo "demo proxy script missing at $PROJECT/scripts/mortgage-demo-proxy.mjs" >>"$LOG/stable.err"
    return 1
  fi
  load_node
  # Proxy forwards to the hub — don't start until the app is listening.
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    echo "hub not ready on :$APP_PORT — skipping demo proxy" >>"$LOG/stable.err"
    return 1
  fi
  if proxy_running && curl -sf "http://127.0.0.1:${PROXY_PORT}/" >/dev/null 2>&1; then
    return 0
  fi
  stop_demo_proxy
  echo "$(date '+%F %T') starting demo proxy on 127.0.0.1:$PROXY_PORT" >>"$LOG/stable.log"
  nohup node "$PROJECT/scripts/mortgage-demo-proxy.mjs" >>"$LOG/proxy.log" 2>&1 &
  echo $! >"$LOG/proxy.pid"
  disown -h "$!" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if proxy_running && curl -sf "http://127.0.0.1:${PROXY_PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -f "$LOG/proxy.pid" ]] && ! kill -0 "$(cat "$LOG/proxy.pid")" 2>/dev/null; then
      echo "demo proxy process exited early" >>"$LOG/stable.err"
      tail -5 "$LOG/proxy.log" >>"$LOG/stable.err" 2>/dev/null || true
      return 1
    fi
    sleep 1
  done
  echo "demo proxy failed to start" >>"$LOG/stable.err"
  if curl -sf "http://127.0.0.1:${PROXY_PORT}/" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

needs_production_build() {
  [[ ! -f dist/server/server.js ]] && return 0
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) -newer dist/server/server.js -print -quit 2>/dev/null | grep -q .
}

# True when the running preview process is older than the current dist (stale CSS/JS hashes → unstyled UI).
dist_newer_than_running_app() {
  [[ -f dist/server/server.js ]] || return 1
  if [[ -f "$LOG/prod.pid" ]]; then
    [[ dist/server/server.js -nt "$LOG/prod.pid" ]] && return 0
  fi
  # Fallback: HTML from a quick curl would 404 the stylesheet — check disk vs last known.
  local live_css
  live_css="$(curl -sf --max-time 2 "http://127.0.0.1:${APP_PORT}/" 2>/dev/null | python3 -c 'import sys,re; m=re.search(r"styles-[A-Za-z0-9_-]+\.css", sys.stdin.read()); print(m.group(0) if m else "")' 2>/dev/null || true)"
  if [[ -n "$live_css" ]] && [[ ! -f "dist/client/assets/$live_css" ]]; then
    return 0
  fi
  return 1
}

stop_app_preview() {
  [[ -f "$LOG/prod.pid" ]] && kill "$(cat "$LOG/prod.pid")" 2>/dev/null || true
  pkill -f "vite preview --port ${APP_PORT}" 2>/dev/null || true
  lsof -iTCP:"$APP_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
  # Wait until the port is free so a new preview does not race the old process.
  for _ in $(seq 1 20); do
    app_running || break
    sleep 0.5
  done
  rm -f "$LOG/prod.pid"
}

start_mockup() {
  if mockup_running; then
    return 0
  fi
  if [[ ! -d "$PROJECT/$MOCKUP_DIR" ]]; then
    echo "Mockup dir not found at $PROJECT/$MOCKUP_DIR" >>"$LOG/stable.err"
    return 1
  fi
  load_node
  cd "$PROJECT"
  echo "$(date '+%F %T') starting mockup site on :$MOCKUP_PORT" >>"$LOG/stable.log"
  nohup npx --yes serve "$MOCKUP_DIR" -l "$MOCKUP_PORT" --no-clipboard >>"$LOG/mockup.log" 2>&1 &
  echo $! >"$LOG/mockup.pid"
  disown -h "$!" 2>/dev/null || true
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:${MOCKUP_PORT}/" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

start_app() {
  if [[ ! -d "$PROJECT" ]]; then
    echo "Project not found at $PROJECT" >>"$LOG/stable.err"
    return 1
  fi
  load_node
  load_env
  cd "$PROJECT"

  local rebuilt=0
  if needs_production_build; then
    echo "$(date '+%F %T') building production app (missing or stale dist)" >>"$LOG/stable.log"
    npm run build >>"$LOG/build.log" 2>&1 || return 1
    rebuilt=1
  fi

  if app_running; then
    if [[ "$rebuilt" -eq 1 ]] || dist_newer_than_running_app; then
      echo "$(date '+%F %T') restarting app (rebuild or stale dist vs running process)" >>"$LOG/stable.log"
      stop_app_preview
    else
      return 0
    fi
  fi

  echo "$(date '+%F %T') starting production server" >>"$LOG/stable.log"
  nohup npx vite preview --port "$APP_PORT" --host 0.0.0.0 --strictPort >>"$LOG/prod.log" 2>&1 &
  echo $! >"$LOG/prod.pid"
  # Touch pid after start so mtime reflects this process (used for stale-dist detection).
  touch "$LOG/prod.pid"
  disown -h "$!" 2>/dev/null || true
  if ! wait_for_port; then
    echo "$(date '+%F %T') app failed to become ready on :$APP_PORT" >>"$LOG/stable.err"
    return 1
  fi

  # Guardrail: linked stylesheet must exist on disk (prevents "formatting gone" after rebuild).
  local css
  css="$(curl -sf --max-time 3 "http://127.0.0.1:${APP_PORT}/" | python3 -c 'import sys,re; m=re.search(r"styles-[A-Za-z0-9_-]+\.css", sys.stdin.read()); print(m.group(0) if m else "")' 2>/dev/null || true)"
  if [[ -n "$css" ]] && [[ ! -f "dist/client/assets/$css" ]]; then
    echo "$(date '+%F %T') stylesheet mismatch ($css missing) — forcing rebuild+restart" >>"$LOG/stable.err"
    stop_app_preview
    npm run build >>"$LOG/build.log" 2>&1 || return 1
    nohup npx vite preview --port "$APP_PORT" --host 0.0.0.0 --strictPort >>"$LOG/prod.log" 2>&1 &
    echo $! >"$LOG/prod.pid"
    touch "$LOG/prod.pid"
    disown -h "$!" 2>/dev/null || true
    wait_for_port
  fi
}

ngrok_upstream() {
  if [[ "$USE_DEMO_PROXY" == "1" ]] && proxy_running; then
    echo "127.0.0.1:${PROXY_PORT}"
  else
    echo "127.0.0.1:${APP_PORT}"
  fi
}

start_ngrok() {
  local ngrok_target
  ngrok_target="$(ngrok_upstream)"
  if ngrok_running; then
    if [[ -f "$LOG/ngrok.target" ]] && [[ "$(cat "$LOG/ngrok.target")" == "$ngrok_target" ]]; then
      return 0
    fi
    if [[ "$USE_DEMO_PROXY" == "1" ]] && ! proxy_running; then
      echo "proxy down — restarting ngrok on hub only" >>"$LOG/stable.err"
      ngrok_target="127.0.0.1:${APP_PORT}"
    fi
    [[ -f "$LOG/ngrok.pid" ]] && kill "$(cat "$LOG/ngrok.pid")" 2>/dev/null || true
    pkill -f "another-selector-ranged.ngrok-free.dev" 2>/dev/null || true
    sleep 2
  fi
  if [[ ! -x "$NGROK" ]]; then
    echo "ngrok missing at $NGROK" >>"$LOG/stable.err"
    return 1
  fi
  echo "$(date '+%F %T') starting ngrok -> :$ngrok_target" >>"$LOG/stable.log"
  nohup "$NGROK" http --url="$PUBLIC_URL" "$ngrok_target" --traffic-policy-file "$POLICY" >>"$LOG/ngrok.log" 2>&1 &
  echo $! >"$LOG/ngrok.pid"
  echo "$ngrok_target" >"$LOG/ngrok.target"
  disown -h "$!" 2>/dev/null || true
  sleep 2
}

case "${1:-start}" in
  start)
    start_app && start_mockup
    if [[ "$USE_DEMO_PROXY" == "1" ]]; then
      start_demo_proxy || echo "$(date '+%F %T') demo proxy start failed" >>"$LOG/stable.err"
    fi
    start_ngrok
    ;;
  ensure)
    start_app || true
    start_mockup || true
    if [[ "$USE_DEMO_PROXY" == "1" ]]; then
      start_demo_proxy || true
    fi
    start_ngrok || true
    # If ngrok points at proxy but proxy is down, fall back to hub.
    if [[ -f "$LOG/ngrok.target" ]] && [[ "$(cat "$LOG/ngrok.target")" == "127.0.0.1:${PROXY_PORT}" ]] && ! proxy_running; then
      echo "$(date '+%F %T') proxy missing — switching ngrok to hub" >>"$LOG/stable.err"
      start_ngrok
    fi
    ;;
  stop)
    stop_app_preview
    stop_demo_proxy
    [[ -f "$LOG/mockup.pid" ]] && kill "$(cat "$LOG/mockup.pid")" 2>/dev/null || true
    [[ -f "$LOG/ngrok.pid" ]] && kill "$(cat "$LOG/ngrok.pid")" 2>/dev/null || true
    pkill -f "another-selector-ranged.ngrok-free.dev" 2>/dev/null || true
    lsof -iTCP:"$MOCKUP_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
    pkill -f "serve $MOCKUP_DIR" 2>/dev/null || true
    rm -f "$LOG/prod.pid" "$LOG/mockup.pid" "$LOG/proxy.pid" "$LOG/ngrok.pid"
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
    echo -n "mockup: "; mockup_running && echo "up" || echo "down"
    echo -n "proxy: "; proxy_running && echo "up" || echo "down"
    echo -n "ngrok: "; ngrok_running && echo "up" || echo "down"
    echo "marketing: ${PUBLIC_URL}/mortgageeasy/"
    curl -sf -o /dev/null -w "http:%{http_code}\n" "http://127.0.0.1:${APP_PORT}/" 2>/dev/null || echo "http:fail"
    curl -sf -o /dev/null -w "mockup:%{http_code}\n" "http://127.0.0.1:${MOCKUP_PORT}/" 2>/dev/null || echo "mockup:fail"
    curl -sf -o /dev/null -w "proxy:%{http_code}\n" "http://127.0.0.1:${PROXY_PORT}/" 2>/dev/null || echo "proxy:fail"
    [[ -f "$LOG/ngrok.target" ]] && echo "ngrok_target: $(cat "$LOG/ngrok.target")"
    ;;
  *)
    echo "Usage: $0 {start|ensure|stop|rebuild|status}"
    exit 1
    ;;
esac
