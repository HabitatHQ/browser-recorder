#!/usr/bin/env bash
# Publishes the extension to the Chrome Web Store via the CWS API.
#
# Prerequisites (one-time, see README "Publishing"):
#   - The item already exists in the store (first upload is manual).
#   - You have OAuth credentials + a refresh token with CWS API access.
#
# Secrets are read from an env file (default .env.publish, gitignored) or the
# environment. Required:
#   CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
#
# Usage:
#   ./scripts/publish-chrome.sh            # upload as a draft (review manually)
#   ./scripts/publish-chrome.sh --publish  # upload and submit for publication
#   CWS_ENV_FILE=.env.prod ./scripts/publish-chrome.sh --publish

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Args ──────────────────────────────────────────────────────────────────────

AUTO_PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --publish) AUTO_PUBLISH=1 ;;
    *) echo "Unknown option: $arg" >&2
       echo "Usage: $0 [--publish]" >&2
       exit 1 ;;
  esac
done

# ── Load secrets ──────────────────────────────────────────────────────────────

ENV_FILE="${CWS_ENV_FILE:-.env.publish}"
if [[ -f "$ENV_FILE" ]]; then
  echo "→ loading credentials from ${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090  # path is user-configurable via CWS_ENV_FILE
  source "$ENV_FILE"
  set +a
fi

MISSING=0
for var in CWS_EXTENSION_ID CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: ${var} is not set (env or ${ENV_FILE})." >&2
    MISSING=1
  fi
done
if [[ "$MISSING" -ne 0 ]]; then
  echo "See .env.publish.example for the expected variables." >&2
  exit 1
fi

# ── Build (if needed) ─────────────────────────────────────────────────────────

VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"
ZIP=".output/${NAME}-${VERSION}-chrome-cws.zip"

if [[ ! -f "$ZIP" ]]; then
  echo "→ ${ZIP} not found — building it…"
  ./scripts/build-cws.sh
fi

# ── Upload + (optional) publish ────────────────────────────────────────────────

ACTION_ARGS=()
if [[ "$AUTO_PUBLISH" -eq 1 ]]; then
  echo "→ uploading ${ZIP} and submitting for publication…"
  ACTION_ARGS+=(--auto-publish)
else
  echo "→ uploading ${ZIP} as a draft (not publishing)…"
fi

npx --yes chrome-webstore-upload-cli@3 upload \
  --source "$ZIP" \
  --extension-id "$CWS_EXTENSION_ID" \
  --client-id "$CWS_CLIENT_ID" \
  --client-secret "$CWS_CLIENT_SECRET" \
  --refresh-token "$CWS_REFRESH_TOKEN" \
  "${ACTION_ARGS[@]+"${ACTION_ARGS[@]}"}"

if [[ "$AUTO_PUBLISH" -eq 1 ]]; then
  echo "✓ submitted v${VERSION} for review — it goes live after approval."
else
  echo "✓ uploaded v${VERSION} as a draft — publish from the dashboard or re-run with --publish."
fi
