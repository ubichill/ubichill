# Ubichill

2Dメタバース風（作業通話・コワーキング）Webアプリケーションです。
Misskeyのようなpnpm workspaceによるモノリポ構成を採用しています。

## プロジェクト構成

```
ubichill/
├── packages/
│   ├── shared/   # 共通の型定義・定数 (@ubichill/shared)
│   ├── backend/  # Express + Socket.io サーバー (@ubichill/backend)
│   └── frontend/ # Next.js + Panda CSS フロントエンド (@ubichill/frontend)
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

## Kubernetes デプロイメント

### 📦 Helm Charts

UbichillアプリケーションはHelmチャートとして公開されており、Kubernetes環境に簡単にデプロイできます。

#### リポジトリ追加
```bash
# Ubichill Helm リポジトリを追加
helm repo add ubichill https://ubichill.github.io/ubichill
helm repo update
```

#### 利用可能なチャート
- `ubichill/ubichill` - メインアプリケーション (Frontend + Backend + Redis + PostgreSQL)
- `ubichill/video-player` - Video Playerプラグイン (yt-dlp backend)

#### デプロイ例

**開発環境:**
```bash
# メインアプリケーション
helm install ubichill-dev ubichill/ubichill \
  --version 0.1.0 \
  --namespace ubichill \
  --create-namespace \
  --set redis.enabled=true \
  --set postgresql.enabled=false

# Video Playerプラグイン
helm install video-player-dev ubichill/video-player \
  --version 0.1.0 \
  --namespace ubichill \
  --set backend.image.tag=latest
```

**本番環境:**
```bash
# メインアプリケーション
helm install ubichill-prod ubichill/ubichill \
  --version 0.1.0 \
  --namespace ubichill \
  --create-namespace \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/ubichill/values-prod.yaml

# Video Playerプラグイン
helm install video-player-prod ubichill/video-player \
  --version 0.1.0 \
  --namespace ubichill \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/video-player/values-prod.yaml
```

#### 設定のカスタマイズ

独自の設定ファイルを作成することもできます：

```yaml
# my-values.yaml
backend:
  replicaCount: 2
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    
frontend:
  replicaCount: 3
  env:
    NEXT_PUBLIC_API_URL: "https://api.example.com"

redis:
  enabled: true
  master:
    persistence:
      size: 2Gi
```

```bash
helm install ubichill-custom ubichill/ubichill -f my-values.yaml
```

### 🚀 ArgoCD GitOps

本プロジェクトはArgoCD GitOpsでの自動デプロイにも対応しています。
`k8s/argocd/` ディレクトリにApplication manifestが含まれています。

## プラグインアーキテクチャ

Ubichillはマイクロサービス・プラグインアーキテクチャを採用しており、各プラグインは独立してデプロイ可能です：

### Video Player Plugin
- **技術**: Python FastAPI + yt-dlp
- **機能**: YouTube動画再生、ライブストリーミング、HLS対応
- **デプロイ**: 独立したHelmチャート

### 共有インフラ
- **Redis**: プラグイン間でのキャッシュ共有
- **PostgreSQL**: データ永続化 (オプション)

## AIアシスタントの方へ
このリポジトリのコードを編集・生成する際は、`.agent/workflows/ai-guidelines.md` を必ず参照してください。
