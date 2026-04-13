#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${1:-@whatmele/dojo}"
REQUIRED_NODE="20.19.2"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node ${REQUIRED_NODE}+ first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node ${REQUIRED_NODE}+ first." >&2
  exit 1
fi

CURRENT_NODE="$(node -p "process.versions.node")"
LOWEST="$(printf '%s\n%s\n' "$REQUIRED_NODE" "$CURRENT_NODE" | sort -V | head -n1)"
if [[ "$LOWEST" != "$REQUIRED_NODE" ]]; then
  echo "Node ${CURRENT_NODE} detected. Please upgrade to Node ${REQUIRED_NODE}+." >&2
  exit 1
fi

echo "Installing ${PACKAGE_NAME} globally..."
npm install -g "$PACKAGE_NAME"

echo
echo "Dojo installed successfully."
echo "Version: $(dojo --version)"
echo
echo "Quick start:"
echo "  dojo create my-workspace"
echo "  cd my-workspace"
echo "  dojo start"
