#!/usr/bin/env bash
#
# INTERNAL E2E HARNESS — maintainer-only. Not part of the action's public surface.
#
# Runs the Bitbucket entry (src/bitbucket.js — no bundle needed) against the local mock backend
# exactly as a Bitbucket pipeline would (inputs via env vars). Exercises two paths:
#   1) named env vars (APIKEY/BLUEPRINT/VERSION/ARTIFACTS)
#   2) the DEPLOY_MANIFEST one-JSON path (everything in a single object)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8798}"

node "$HERE/mock-backend.js" "$PORT" &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
sleep 1

echo "--- (1) Bitbucket entry: named env vars ---"
APIKEY="test-api-key-1234" \
TRIGGER_ENVIRONMENT="http://127.0.0.1:$PORT" \
BLUEPRINT="web-prod" \
VERSION="2.5.0" \
ARTIFACTS='{"app-bundle":"https://ci.example.com/app-2.5.0.zip"}' \
BITBUCKET_COMMIT="deadbeefcafe" \
BITBUCKET_BRANCH="main" \
  node "$ROOT/src/bitbucket.js"

echo "--- (2) Bitbucket entry: everything via DEPLOY_MANIFEST ---"
APIKEY="test-api-key-1234" \
TRIGGER_ENVIRONMENT="http://127.0.0.1:$PORT" \
DEPLOY_MANIFEST='{"blueprint":"web-prod","version":"4.2.1","artifacts":{"app-bundle":"https://ci.example.com/app-4.2.1.zip"},"release":{"name":"Web 4.2.1","description":"manifest build"}}' \
  node "$ROOT/src/bitbucket.js"

echo "E2E OK (bitbucket)"
