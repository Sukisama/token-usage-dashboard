#!/bin/bash
# Token 用量看板启动脚本
# 用法：绑定到快捷键（Raycast / Alfred / macOS Shortcuts）

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=7373

# Check if server is already running
if ! curl -s "http://localhost:${PORT}/api/summary" > /dev/null 2>&1; then
  cd "$PROJECT_DIR" || exit 1
  nohup node server.js > /tmp/token-usage-dashboard.log 2>&1 &
  sleep 1
fi

open "http://localhost:${PORT}"
