#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "→ 构建项目..."
npm run build

echo "→ 链接到全局..."
npm unlink -g dojo-cli 2>/dev/null || true
npm link

echo ""
echo "✔ 完成！可直接使用 dojo 命令"
dojo --version
