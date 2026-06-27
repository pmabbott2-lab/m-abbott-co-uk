#!/usr/bin/env bash
# One-time Mac setup: Node.js + dependencies + env check
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

ensure_nvm() {
  if command -v node >/dev/null 2>&1; then
    return 0
  fi
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    return 0
  fi
  warn "Node.js not found — installing nvm + Node 22 LTS…"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
}

load_node() {
  # shellcheck disable=SC1091
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
  if ! command -v node >/dev/null 2>&1; then
    nvm install 22
    nvm use 22
    nvm alias default 22
  else
    NODE_VER="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [ "$NODE_VER" -lt 20 ]; then
      warn "Node $(node -v) is old; installing Node 22…"
      nvm install 22
      nvm use 22
    fi
  fi
  info "Node $(node -v) · npm $(npm -v)"
}

ensure_shell_profile() {
  local line='export NVM_DIR="$HOME/.nvm"'
  local load='[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"'
  if [ -f "$HOME/.zshrc" ] && grep -q 'NVM_DIR' "$HOME/.zshrc"; then
    return 0
  fi
  {
    echo ""
    echo "# Node Version Manager (FactFind setup)"
    echo "$line"
    echo "$load"
  } >> "$HOME/.zshrc"
  info "Added nvm to ~/.zshrc (open a new terminal or run: source ~/.zshrc)"
}

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    warn "Created .env from .env.example — add your keys before running the interview."
  fi
  # Server routes read SUPABASE_PUBLISHABLE_KEY (not VITE_*)
  if ! grep -q '^SUPABASE_PUBLISHABLE_KEY=' .env 2>/dev/null; then
    VITE_KEY="$(grep '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2- | tr -d '"')"
    VITE_URL="$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
    if [ -n "$VITE_KEY" ]; then
      {
        echo ""
        echo "SUPABASE_PUBLISHABLE_KEY=$VITE_KEY"
        [ -n "$VITE_URL" ] && echo "SUPABASE_URL=$VITE_URL"
      } >> .env
      info "Added server-side Supabase vars to .env"
    fi
  fi
  if ! grep -q '^VITE_APP_URL=.\+' .env 2>/dev/null; then
    echo "VITE_APP_URL=http://localhost:8080" >> .env
    info "Set VITE_APP_URL=http://localhost:8080 for local auth redirects"
  fi
  if ! grep -q '^OPENAI_API_KEY=.\+' .env 2>/dev/null; then
    warn "OPENAI_API_KEY is missing in .env — voice (TTS/STT) will fail until you add it."
    warn "  https://platform.openai.com/api-keys  (or run: npm run set-openai-key)"
  fi
  if ! grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\+' .env 2>/dev/null; then
    warn "SUPABASE_SERVICE_ROLE_KEY is missing — local password reset (on-screen link) will not work."
    warn "  Supabase Dashboard → Settings → API → service_role key"
  fi
}

install_deps() {
  info "Installing npm dependencies…"
  npm install
}

check_env_ready() {
  echo ""
  echo "Environment checklist:"
  for var in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_APP_URL; do
    if grep -q "^${var}=.\+" .env 2>/dev/null; then
      info "$var is set"
    else
      warn "$var is missing"
    fi
  done
  if grep -q '^OPENAI_API_KEY=.\+' .env 2>/dev/null; then
    info "OPENAI_API_KEY is set"
  else
    warn "OPENAI_API_KEY is missing (required for voice interview)"
  fi
  if grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\+' .env 2>/dev/null; then
    info "SUPABASE_SERVICE_ROLE_KEY is set"
  else
    warn "SUPABASE_SERVICE_ROLE_KEY is missing (required for local password reset)"
  fi
}

main() {
  echo "Setting up FactFind for local development…"
  echo ""
  ensure_nvm
  load_node
  ensure_shell_profile
  ensure_env
  install_deps
  check_env_ready
  echo ""
  info "Setup complete. Start the app with:"
  echo "  cd \"$ROOT\""
  echo "  npm run dev"
  echo ""
  echo "Then open the URL shown (usually http://localhost:8080)"
  echo ""
  warn "Apply DB schema if not done yet:"
  echo "  npm run bootstrap:supabase"
  echo "  (or paste supabase/bootstrap-from-scratch.sql in the Supabase SQL editor)"
}

main "$@"
