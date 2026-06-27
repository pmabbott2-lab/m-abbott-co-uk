#!/usr/bin/env bash
# Bootstrap Supabase for FactFind (schema + auth URL config).
# Usage:
#   npm run bootstrap:supabase
#
# Optional env vars (add to .env):
#   SUPABASE_ACCESS_TOKEN   — from https://supabase.com/dashboard/account/tokens
#   SUPABASE_DB_PASSWORD    — Database password from Project Settings → Database
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }
step()  { echo -e "\n${BLUE}→${NC} $*"; }

load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
}

get_project_ref() {
  local ref="${SUPABASE_PROJECT_ID:-${VITE_SUPABASE_PROJECT_ID:-}}"
  if [ -z "$ref" ] && [ -n "${SUPABASE_URL:-}" ]; then
    ref="$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')"
  fi
  echo "$ref"
}

configure_auth_urls() {
  local ref="$1"
  local token="${SUPABASE_ACCESS_TOKEN:-}"

  if [ -z "$token" ]; then
    warn "SUPABASE_ACCESS_TOKEN not set — configure auth URLs manually:"
    echo "  https://supabase.com/dashboard/project/${ref}/auth/url-configuration"
    echo "  Site URL:        http://localhost:8080"
    echo "  Redirect URLs:   http://localhost:8080/**"
    return 0
  fi

  step "Configuring auth Site URL and redirect URLs via Management API…"
  local payload
  payload=$(cat <<'JSON'
{
  "site_url": "http://localhost:8080",
  "uri_allow_list": "http://localhost:8080/**,http://127.0.0.1:8080/**"
}
JSON
)

  local http_code
  http_code=$(curl -sS -o /tmp/supabase-auth-config.json -w "%{http_code}" \
    -X PATCH "https://api.supabase.com/v1/projects/${ref}/config/auth" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  if [ "$http_code" = "200" ]; then
    info "Auth URLs updated (site_url=http://localhost:8080)"
  else
    warn "Auth config API returned HTTP ${http_code}:"
    cat /tmp/supabase-auth-config.json 2>/dev/null || true
    warn "Set URLs manually in the dashboard."
  fi
}

run_sql_via_psql() {
  local ref="$1"
  local password="${SUPABASE_DB_PASSWORD:-}"

  if [ -z "$password" ]; then
    return 1
  fi

  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not installed — paste SQL manually (see below)."
    return 1
  fi

  local host="db.${ref}.supabase.co"
  local conn="postgresql://postgres.${ref}:${password}@${host}:5432/postgres?sslmode=require"

  step "Applying bootstrap SQL via psql…"
  PGPASSWORD="$password" psql "$conn" -v ON_ERROR_STOP=1 -f supabase/bootstrap-from-scratch.sql
  info "Database schema applied"
  return 0
}

print_manual_sql_steps() {
  local ref="$1"
  echo ""
  warn "Apply database schema manually:"
  echo "  1. Open https://supabase.com/dashboard/project/${ref}/sql/new"
  echo "  2. Paste contents of: supabase/bootstrap-from-scratch.sql"
  echo "  3. Click Run"
}

verify_api_keys() {
  step "Checking .env keys…"
  local missing=0
  for var in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY; do
    if [ -z "${!var:-}" ]; then
      warn "$var is missing"
      missing=1
    fi
  done
  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    warn "SUPABASE_SERVICE_ROLE_KEY is missing — add from Dashboard → Settings → API"
    missing=1
  fi
  if [ "$missing" -eq 0 ]; then
    info "Core Supabase env vars look set"
  fi
}

print_new_project_steps() {
  echo ""
  echo "To use a brand-new Supabase project:"
  echo "  1. Create project at https://supabase.com/dashboard"
  echo "  2. Copy API keys into .env (see .env.example)"
  echo "  3. Re-run: npm run bootstrap:supabase"
}

main() {
  echo "FactFind Supabase bootstrap"
  echo "==========================="
  load_env

  local ref
  ref="$(get_project_ref)"
  if [ -z "$ref" ]; then
    fail "Could not detect project ref. Set SUPABASE_PROJECT_ID or SUPABASE_URL in .env"
  fi
  info "Project ref: ${ref}"

  verify_api_keys

  if ! run_sql_via_psql "$ref"; then
    print_manual_sql_steps "$ref"
  fi

  configure_auth_urls "$ref"

  print_new_project_steps

  echo ""
  info "Next: restart dev server and test sign-up at http://localhost:8080/auth"
}

main "$@"
