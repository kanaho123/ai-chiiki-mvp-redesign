#!/usr/bin/env bash
set -euo pipefail

# node_modules ボリュームの所有者をコンテナユーザーに合わせる
sudo chown -R node:node node_modules 2>/dev/null || true
# Vercel CLI のログイン情報ボリュームも同様
sudo chown -R node:node /home/node/.local/share/com.vercel.cli 2>/dev/null || true

# PostgreSQL クライアント（psql）
sudo apt-get update -y && sudo apt-get install -y --no-install-recommends postgresql-client && sudo rm -rf /var/lib/apt/lists/*

# pnpm を corepack 経由で有効化
sudo corepack enable

# Vercel CLI
npm install -g vercel@latest

# .env が無ければサンプルから作成
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

# package.json がある場合のみ依存をインストール（アプリ未作成の段階ではスキップ）
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then pnpm install; else npm install; fi
fi

echo "Dev Container の準備が完了しました。 node $(node -v) / psql $(psql --version | awk '{print $3}') / vercel $(vercel --version 2>/dev/null | tail -n1)"
