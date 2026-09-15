#!/usr/bin/env bash
# Deploy / update Mortgage Hub on the production VPS (mymortgagehub.uk).
# Run ON THE SERVER from the app directory, e.g.:
#   cd /var/www/mymortgagehub && bash scripts/deploy-mymortgagehub.sh
#   # or: npm run deploy:mymortgagehub
#
# First go-live baseline tag: restore-point-2026-09-15-hub-telephony
# Ongoing work: MYMORTGAGEHUB_BRANCH=targeted-features bash scripts/deploy-mymortgagehub.sh
#
# Does not change how you develop on your Mac with Cursor.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICE="${MYMORTGAGEHUB_SERVICE:-mymortgagehub}"
BRANCH="${MYMORTGAGEHUB_BRANCH:-}"

echo "==> Deploying Mortgage Hub from $ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and set APP_BASE_URL=https://mymortgagehub.uk"
  exit 1
fi

if ! grep -q 'APP_BASE_URL=https://mymortgagehub.uk' .env; then
  echo "WARNING: APP_BASE_URL does not look like https://mymortgagehub.uk"
  echo "         Check .env before going live."
fi

if [[ -n "$BRANCH" ]]; then
  echo "==> Checking out branch: $BRANCH"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  echo "==> Pulling current branch: $(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only
fi

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

if [[ ! -f dist/server/server.js ]]; then
  echo "Build did not produce dist/server/server.js — aborting restart"
  exit 1
fi

if systemctl list-unit-files "${SERVICE}.service" >/dev/null 2>&1; then
  echo "==> Restarting ${SERVICE}"
  sudo systemctl restart "$SERVICE"
  sleep 2
  sudo systemctl --no-pager --full status "$SERVICE" || true
else
  echo "==> No systemd unit '${SERVICE}' found."
  echo "    Start manually for a smoke test:"
  echo "      npm run serve:prod"
  echo "    Then install deploy/mymortgagehub.service for always-on."
fi

echo "==> Done. Check https://mymortgagehub.uk/auth"
