#!/usr/bin/env bash
# Paste your OPENAI_API_KEY into .env (key is hidden while typing)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

echo ""
echo "Where to find OPENAI_API_KEY:"
echo "  1. Open https://platform.openai.com/api-keys"
echo "  2. Sign in to your OpenAI account"
echo "  3. Click 'Create new secret key'"
echo "  4. Copy the key (starts with sk-...)"
echo ""
echo "Do NOT paste the key in chat — only here in your terminal."
echo ""

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

read -r -s -p "Paste OPENAI_API_KEY and press Enter: " KEY
echo ""

if [ -z "$KEY" ]; then
  echo "No key entered. Aborting."
  exit 1
fi

if grep -q '^OPENAI_API_KEY=' "$ENV_FILE"; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=\"$KEY\"|" "$ENV_FILE"
  else
    sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=\"$KEY\"|" "$ENV_FILE"
  fi
else
  echo "OPENAI_API_KEY=\"$KEY\"" >> "$ENV_FILE"
fi

# Remove legacy Lovable key line if present
if grep -q '^LOVABLE_API_KEY=' "$ENV_FILE" 2>/dev/null; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' '/^LOVABLE_API_KEY=/d' "$ENV_FILE"
  else
    sed -i '/^LOVABLE_API_KEY=/d' "$ENV_FILE"
  fi
fi

echo "✓ OPENAI_API_KEY saved to .env"
echo ""
echo "Restart the dev server:"
echo "  cd \"$ROOT\" && npm run dev"
