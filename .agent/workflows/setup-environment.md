---
description: 開発環境のセットアップと起動
---
# 開発環境セットアップ

このワークフローは、Ubichillの開発環境をセットアップし、起動するための手順です。

## 前提条件

- Node.js (v18+)
- pnpm (v8+)
- Docker (オプション)

## 手順

1. 依存関係のインストール
   ```bash
   // turbo
   pnpm install
   ```

2. 開発サーバーの起動 (ローカル)
   frontend (3000) と backend (3001) を同時に起動します。
   ```bash
   // turbo
   pnpm dev
   ```

   または、Dockerを使用して起動する場合:
   ```bash
   // turbo
   docker-compose up --build
   ```

3. 動作確認
   ブラウザで `http://localhost:3000` にアクセスしてください。
