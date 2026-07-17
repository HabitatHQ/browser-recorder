#!/usr/bin/env bash
# Bumps the version, tags it, and pushes the branch + tag.
#
# The pushed v* tag triggers the Release workflow
# (.github/workflows/release.yml), which builds both browser targets and
# creates the GitHub release with the zips attached. To build + release from
# your machine instead, run scripts/release.sh directly. Chrome Web Store
# upload stays manual (scripts/publish-chrome.sh).
#
# Usage: ./scripts/bump-and-push.sh <patch|minor|major|x.y.z>

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Args ──────────────────────────────────────────────────────────────────────

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 1
fi

BUMP="$1"

# ── Require clean tree ────────────────────────────────────────────────────────

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty — commit or stash changes first." >&2
  exit 1
fi

# ── Bump version (commits + tags locally) ────────────────────────────────────

./scripts/bump-version.sh "$BUMP"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# ── Push branch + tag ─────────────────────────────────────────────────────────

echo "→ pushing branch and tag ${TAG}…"
git push
git push origin "$TAG"

echo "✓ pushed ${TAG} — the Release workflow (.github/workflows/release.yml)"
echo "  will build both targets and create the GitHub release."
