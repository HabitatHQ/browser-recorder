#!/usr/bin/env bash
# Builds the Chrome Web Store zip.
#
# Unlike the GitHub-release build, this strips the manifest `key` (via
# CWS_BUILD=1 — see wxt.config.ts). The store assigns its own public key/ID, and
# a baked-in `key` that doesn't match makes uploads fail. The local-unpacked
# builds keep the `key` so their extension ID stays stable across reloads.
#
# Output: .output/<name>-<version>-chrome-cws.zip
#
# Note: this rebuilds .output/chrome-mv3 WITHOUT the key. Run `pnpm build`
# afterward if you want to reload the keyed (stable-ID) unpacked dev build.
#
# Usage: ./scripts/build-cws.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"

DEFAULT_ZIP=".output/${NAME}-${VERSION}-chrome.zip"
CWS_ZIP=".output/${NAME}-${VERSION}-chrome-cws.zip"

echo "→ building Chrome Web Store zip for ${NAME} v${VERSION} (no manifest key)…"

# WXT always emits the chrome zip as <name>-<version>-chrome.zip; we rename it so
# it can't be confused with the key-bearing release zip from scripts/release.sh.
CWS_BUILD=1 pnpm wxt zip

if [[ ! -f "$DEFAULT_ZIP" ]]; then
  echo "Error: expected build artifact not found: $DEFAULT_ZIP" >&2
  exit 1
fi

mv -f "$DEFAULT_ZIP" "$CWS_ZIP"

echo "✓ ${CWS_ZIP}"
