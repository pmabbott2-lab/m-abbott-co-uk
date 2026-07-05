#!/usr/bin/env bash
# Local hot-reload dev server (port 8081) — does NOT affect the stable public site on 8080.
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
echo "Dev server: http://localhost:8081 (local only — public site stays on 8080)"
exec npx vite dev --port 8081 --strictPort
