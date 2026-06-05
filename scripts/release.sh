#!/usr/bin/env bash
# Creates a GitHub release for the current package version.
# Usage: ./scripts/release.sh [--draft] [--notes "release notes"]
#
# Builds both browser targets, then creates (or updates) a GitHub release
# tagged v<version> and uploads the Chrome and Firefox zips as assets.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Parse args ────────────────────────────────────────────────────────────────

DRAFT_FLAG=""
NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft)
      DRAFT_FLAG="--draft"
      shift
      ;;
    --notes)
      NOTES="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--draft] [--notes \"release notes\"]" >&2
      exit 1
      ;;
  esac
done

# ── Version ───────────────────────────────────────────────────────────────────

VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"
TAG="v${VERSION}"

echo "→ version: ${VERSION}  tag: ${TAG}"

# ── Build ─────────────────────────────────────────────────────────────────────

echo "→ building Chrome + Firefox…"
pnpm package

CHROME_ZIP=".output/${NAME}-${VERSION}-chrome.zip"
FIREFOX_ZIP=".output/${NAME}-${VERSION}-firefox.zip"

for f in "$CHROME_ZIP" "$FIREFOX_ZIP"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: expected build artifact not found: $f" >&2
    exit 1
  fi
done

# ── GitHub auth ───────────────────────────────────────────────────────────────

gh auth switch --user npalladium

# ── Release ───────────────────────────────────────────────────────────────────

if gh release view "$TAG" --json tagName -q .tagName &>/dev/null; then
  echo "→ release ${TAG} already exists — uploading assets…"
  # Upload / overwrite assets on the existing release
  gh release upload "$TAG" "$CHROME_ZIP" "$FIREFOX_ZIP" --clobber
else
  echo "→ creating release ${TAG}…"
  # Build release notes: use --notes if supplied, otherwise generate from git log
  if [[ -z "$NOTES" ]]; then
    NOTES_FLAG="--generate-notes"
  else
    NOTES_FLAG="--notes=${NOTES}"
  fi

  # shellcheck disable=SC2086
  gh release create "$TAG" \
    $DRAFT_FLAG \
    $NOTES_FLAG \
    --title "${TAG}" \
    "$CHROME_ZIP" \
    "$FIREFOX_ZIP"
fi

echo "✓ done — https://github.com/npalladium/chrome-recorder/releases/tag/${TAG}"

