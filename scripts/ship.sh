#!/usr/bin/env bash
# Bumps the version, builds both targets, pushes, and creates a GitHub release.
# Usage: ./scripts/ship.sh <patch|minor|major|x.y.z> [--draft] [--notes "release notes"]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Args ──────────────────────────────────────────────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <patch|minor|major|x.y.z> [--draft] [--notes \"release notes\"]" >&2
  exit 1
fi

BUMP="$1"
shift
RELEASE_ARGS=("$@")

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

# ── Build + release ───────────────────────────────────────────────────────────

./scripts/release.sh "${RELEASE_ARGS[@]+"${RELEASE_ARGS[@]}"}"
