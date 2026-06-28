#!/usr/bin/env bash
#
# INTERNAL E2E HARNESS — maintainer-only. Not part of the action's public surface.
#
# Runs the built action (dist/index.js) against the local mock backend exactly as GitHub Actions
# would (inputs via INPUT_* env vars), then asserts a CREATED response. Mirrors the real flow:
# workflow -> action -> backend.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8799}"

if [ ! -f "$ROOT/dist/index.js" ]; then
  echo "dist/index.js not found — run 'npm run build' first." >&2
  exit 1
fi

node "$HERE/mock-backend.js" "$PORT" &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
sleep 1

OUT_FILE="$(mktemp)"
export GITHUB_OUTPUT="$OUT_FILE"
export GITHUB_SHA="deadbeefcafe"
export GITHUB_REF_NAME="main"

# GitHub Actions passes `with:` inputs as INPUT_<UPPERCASED NAME>.
export INPUT_APIKEY="test-api-key-1234"
export INPUT_LYNXSERVER="http://127.0.0.1:$PORT"
export INPUT_BLUEPRINT="web-prod"
export INPUT_VERSION="2.5.0"
export INPUT_ARTIFACTS='{"app-bundle":"https://ci.example.com/app-2.5.0.zip"}'

echo "--- running action against mock backend ---"
node "$ROOT/dist/index.js"

echo "--- action outputs (\$GITHUB_OUTPUT) ---"
cat "$OUT_FILE"

if grep -q "CREATED" "$OUT_FILE"; then
  echo "E2E OK"
else
  echo "E2E FAIL: expected CREATED in outputs" >&2
  exit 1
fi
