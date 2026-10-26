#!/usr/bin/env bash
# 一键启动（macOS / Linux）：检查 Node、安装依赖、准备 .env、启动服务
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 18 或更高版本：https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ 当前 Node 版本为 $(node -v)，需要 18 或更高版本"
  exit 1
fi

[ -d node_modules ] || { echo "📦 正在安装依赖…"; npm install --no-audit --no-fund; }
[ -f .env ] || cp .env.example .env

echo "🚀 启动中：http://localhost:${PORT:-3000}"
npm start
