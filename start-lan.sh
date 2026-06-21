#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules/express ]; then
  echo "初回: npm install 中..."
  npm install
fi
echo ""
echo "  早押しクイズ LAN 版（Chromebook / Linux）"
echo "  このターミナルを閉じると終了します"
echo ""
node server.js
