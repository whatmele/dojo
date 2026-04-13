#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release-npm.sh [version]

Examples:
  bash scripts/release-npm.sh
  bash scripts/release-npm.sh 0.1.1

Behavior:
  - optionally bumps package.json/package-lock.json to the given version
  - verifies npm login
  - runs tests, build, and pack preview
  - publishes the package to npm
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 1 ]]; then
  usage
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Release aborted: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

TARGET_VERSION="${1:-}"
if [[ -n "$TARGET_VERSION" ]]; then
  npm version "$TARGET_VERSION" --no-git-tag-version
fi

PACKAGE_NAME="$(node -p "require('./package.json').name")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"

echo "Releasing ${PACKAGE_NAME}@${PACKAGE_VERSION}"

NPM_CACHE_DIR="${NPM_CACHE_DIR:-/tmp/dojo-npm-cache}"
export npm_config_cache="$NPM_CACHE_DIR"

npm whoami >/dev/null
npm test
npm run build
npm run pack:preview
npm publish --access public

echo
echo "Published ${PACKAGE_NAME}@${PACKAGE_VERSION}"
