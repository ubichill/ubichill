# Ubichill

2Dメタバース風（作業通話・コワーキング）Webアプリケーションです。
Misskeyのようなpnpm workspaceによるモノリポ構成を採用しています。

## プロジェクト構成

```
ubichill/
├── packages/
│   ├── shared/   # 共通の型定義・定数 (@ubichill/shared)
│   ├── backend/  # Express + Socket.io サーバー (@ubichill/backend)
│   └── frontend/ # Next.js + Tailwind CSS フロントエンド (@ubichill/frontend)
```

## 技術スタック

- **言語**: TypeScript
- **パッケージマネージャ**: pnpm
- **フロントエンド**: Next.js (App Router), Tailwind CSS, Socket.io Client
- **バックエンド**: Node.js, Express, Socket.io
- **インフラ**: Docker, Kubernetes (k3s想定)

## セットアップ手順

### 前提条件
- Node.js (v18以上推奨)
- pnpm (v8以上)
- Docker (コンテナで実行する場合)

### ローカル開発 (pnpm)

依存関係のインストール:
```bash
pnpm install
```

開発サーバーの起動 (Frontend: 3000, Backend: 3001):
```bash
pnpm dev
```

### Docker開発

Docker Composeを使用して開発環境を立ち上げます:
```bash
docker-compose up --build
```
これで `http://localhost:3000` にアクセスできます。

## AIアシスタントの方へ
このリポジトリのコードを編集・生成する際は、`AI_INSTRUCTIONS.md` を必ず参照してください。
