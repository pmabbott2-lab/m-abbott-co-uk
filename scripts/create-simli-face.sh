#!/usr/bin/env bash
# Create a Simli "Trinity" face (faceId) for Susan from src/assets/susan.png.
#
# Trinity = Simli's single-image photoreal face model. Run this once after you
# have a Simli API key; it uploads the portrait, then polls until the face is
# ready and prints the faceId to put in .env as SIMLI_FACE_ID.
#
# Docs:
#   POST https://api.simli.ai/faces/trinity            (multipart image upload)
#   GET  https://api.simli.ai/faces/trinity/generation_status?face_id=...
#
# Usage:
#   SIMLI_API_KEY=sk_... bash scripts/create-simli-face.sh
#   # or, if SIMLI_API_KEY is already in .env, just:
#   bash scripts/create-simli-face.sh
#
# Optional overrides:
#   IMAGE=/path/to/face.png FACE_NAME=susan bash scripts/create-simli-face.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
IMAGE="${IMAGE:-$ROOT/src/assets/susan.png}"
FACE_NAME="${FACE_NAME:-susan}"
API="https://api.simli.ai"

# Pull SIMLI_API_KEY from .env if not already exported.
if [ -z "${SIMLI_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  SIMLI_API_KEY="$(grep -E '^SIMLI_API_KEY=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true)"
fi

if [ -z "${SIMLI_API_KEY:-}" ]; then
  echo "ERROR: SIMLI_API_KEY is not set. Get one at https://app.simli.com and either"
  echo "       export it or add it to .env, then re-run this script." >&2
  exit 1
fi

if [ ! -f "$IMAGE" ]; then
  echo "ERROR: image not found at $IMAGE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "NOTE: 'jq' not found — raw JSON will be printed. Install jq for nicer output." >&2
fi

echo "Uploading $IMAGE to Simli (face_name=$FACE_NAME) ..."
CREATE_RESP="$(curl -sS -X POST \
  "$API/faces/trinity?face_name=$FACE_NAME" \
  -H "x-simli-api-key: $SIMLI_API_KEY" \
  -F "image=@$IMAGE")"

echo "Create response: $CREATE_RESP"

# The response includes the new faceId (key name has varied across versions:
# face_id / faceId / character_uid). Grab whichever is present.
extract_face_id() {
  if command -v jq >/dev/null 2>&1; then
    echo "$1" | jq -r '.face_id // .faceId // .character_uid // .id // empty' 2>/dev/null || true
  else
    echo "$1" | grep -oE '"(face_id|faceId|character_uid|id)"[[:space:]]*:[[:space:]]*"[^"]+"' \
      | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]+)"/\1/' || true
  fi
}

FACE_ID="$(extract_face_id "$CREATE_RESP")"

if [ -z "$FACE_ID" ]; then
  echo ""
  echo "Could not auto-detect the faceId from the response above."
  echo "Copy it manually and set SIMLI_FACE_ID in .env."
  exit 0
fi

echo ""
echo "faceId: $FACE_ID"
echo "Polling generation status (Trinity faces take ~1-3 min) ..."

for i in $(seq 1 60); do
  STATUS_RESP="$(curl -sS -X GET \
    "$API/faces/trinity/generation_status?face_id=$FACE_ID" \
    -H "x-simli-api-key: $SIMLI_API_KEY")"
  echo "  [$i] $STATUS_RESP"
  if echo "$STATUS_RESP" | grep -qiE '"(status|state)"[[:space:]]*:[[:space:]]*"(completed|complete|ready|done|success)"'; then
    echo ""
    echo "✓ Face ready."
    break
  fi
  if echo "$STATUS_RESP" | grep -qiE '"(status|state)"[[:space:]]*:[[:space:]]*"(failed|error)"'; then
    echo ""
    echo "✗ Generation failed — see response above." >&2
    exit 1
  fi
  sleep 5
done

echo ""
echo "Add these to your .env, then restart the dev server:"
echo "  SIMLI_API_KEY=\"$SIMLI_API_KEY\""
echo "  SIMLI_FACE_ID=\"$FACE_ID\""
echo "  VITE_REALTIME_AVATAR=true"
