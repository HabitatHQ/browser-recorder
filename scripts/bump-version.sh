#!/usr/bin/env bash
# Bumps the extension version in package.json, commits, and tags.
# WXT reads the version from package.json automatically — no other files to update.
# Usage: ./scripts/bump-version.sh <patch|minor|major|x.y.z>

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Args ──────────────────────────────────────────────────────────────────────

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 1
fi

BUMP="$1"

# ── Compute new version ───────────────────────────────────────────────────────

CURRENT="$(node -p "require('./package.json').version")"

case "$BUMP" in
  patch|minor|major)
    NEW_VERSION="$(node -e "
      const [major, minor, patch] = '${CURRENT}'.split('.').map(Number);
      if ('${BUMP}' === 'major') console.log((major + 1) + '.0.0');
      else if ('${BUMP}' === 'minor') console.log(major + '.' + (minor + 1) + '.0');
      else console.log(major + '.' + minor + '.' + (patch + 1));
    ")"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW_VERSION="$BUMP"
    ;;
  *)
    echo "Error: argument must be patch, minor, major, or a version like 1.2.3" >&2
    exit 1
    ;;
esac

if [[ "$NEW_VERSION" == "$CURRENT" ]]; then
  echo "Version is already ${CURRENT} — nothing to do." >&2
  exit 1
fi

echo "→ ${CURRENT} → ${NEW_VERSION}"

# ── Guard: clean working tree ─────────────────────────────────────────────────

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty — commit or stash changes first." >&2
  exit 1
fi

# ── Update package.json ───────────────────────────────────────────────────────

node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Commit and tag ────────────────────────────────────────────────────────────

git add package.json
git commit -m "Bump version to ${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo "✓ committed and tagged v${NEW_VERSION}"
echo "  push with: git push && git push origin v${NEW_VERSION}"
