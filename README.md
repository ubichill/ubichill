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
- **フロントエンド**: Next.js (App Router), Panda CSS, Socket.io Client
- **バックエンド**: Node.js, Express, Socket.io
- **インフラ**: DevContainer, Docker, Kubernetes (k3s想定)

## セットアップ手順

### 前提条件
- Docker Desktop or Docker Engine
- VS Code + Dev Containers extension

### 開発環境の起動

1. VS Code でこのリポジトリを開きます。
2. 左下の "><" アイコンをクリックするか、コマンドパレットから **Dev Containers: Reopen in Container** を選択します。
3. コンテナがビルドされ、環境が立ち上がります。
4. ターミナルで `pnpm dev` を実行すると、Frontend (3000) と Backend (3001) が起動します。

### ローカル開発

依存関係のインストール:
```bash
pnpm install
```

開発サーバーの起動:
```bash
pnpm dev
```

## AIアシスタントの方へ
このリポジトリのコードを編集・生成する際は、`.agent/workflows/ai-guidelines.md` を必ず参照してください。
