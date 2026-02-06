# Ubichill Helm Charts

本リポジトリのHelmチャートを使用してUbichillアプリケーションとプラグインをKubernetesにデプロイできます。

## 📦 利用可能なチャート

- **ubichill** - メインアプリケーション (Frontend + Backend + Redis + PostgreSQL)
- **video-player** - Video Playerプラグイン (yt-dlp backend)

## 🚀 クイックスタート

### 1. Helmリポジトリ追加
```bash
helm repo add ubichill https://ubichill.github.io/ubichill
helm repo update
```

### 2. 本体アプリケーションのデプロイ
```bash
# 開発環境
helm install ubichill-dev ubichill/ubichill \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/ubichill/values-dev.yaml \
  --namespace ubichill --create-namespace

# 本番環境
helm install ubichill-prod ubichill/ubichill \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/ubichill/values-prod.yaml \
  --namespace ubichill --create-namespace
```

### 3. Video Playerプラグインのデプロイ
```bash
# 開発環境
helm install video-player-dev ubichill/video-player \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/video-player/values-dev.yaml \
  --namespace ubichill

# 本番環境  
helm install video-player-prod ubichill/video-player \
  --values https://raw.githubusercontent.com/ubichill/ubichill/main/charts/video-player/values-prod.yaml \
  --namespace ubichill
```

## ⚙️ カスタマイゼーション

### Ubichill メインアプリケーション

主要な設定項目：

```yaml
backend:
  replicaCount: 3
  image:
    repository: "ubichill-backend"
    tag: "stable"
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 8

frontend:
  replicaCount: 3
  image:
    repository: "ubichill-frontend" 
    tag: "stable"

redis:
  enabled: true  # 共有キャッシュ

postgresql:
  enabled: true  # 本番環境では推奨
```

### Video Player プラグイン

主要な設定項目：

```yaml
backend:
  replicaCount: 2
  image:
    repository: "ubichill-video-player-backend"
    tag: "latest"
  
  # 内部スケーリングAPI (オプション)
  env:
    INTERNAL_API_TOKEN: "your-secret-token"
```

## 🔧 開発者向け

### ローカル開発
```bash
# チャートをローカルで使用
git clone https://github.com/ubichill/ubichill
cd ubichill

# 開発環境デプロイ
helm install ubichill-dev ./charts/ubichill -f charts/ubichill/values-dev.yaml
helm install video-player-dev ./charts/video-player -f charts/video-player/values-dev.yaml
```

### チャートのテスト
```bash
# バリデーション
helm lint charts/ubichill/
helm lint charts/video-player/

# テンプレート確認
helm template test-release charts/ubichill/ -f charts/ubichill/values-dev.yaml
```

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────┐
│                 Kubernetes                   │
│  ┌─────────────────────────────────────────┐ │
│  │           Ubichill Namespace           │ │
│  │                                       │ │
│  │  ┌──────────────┐  ┌─────────────────┐ │ │
│  │  │   Frontend   │  │     Backend     │ │ │
│  │  │   (Next.js)  │◄─┤   (Node.js)    │ │ │
│  │  └──────────────┘  └─────────────────┘ │ │
│  │           │                │          │ │
│  │           └─────────┬──────┘          │ │
│  │                     ▼                 │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │          Shared Redis              │ │ │
│  │  │        (Cross-Plugin Cache)        │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                     ▲                 │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │       Video Player Plugin         │ │ │
│  │  │        (yt-dlp Backend)           │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                       │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │         PostgreSQL                │ │ │
│  │  │      (Optional - Production)      │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## 🤝 コントリビューション

1. フォークしてください
2. フィーチャーブランチを作成：`git checkout -b feature/amazing-feature`
3. 変更をコミット：`git commit -m 'Add amazing feature'`
4. プッシュ：`git push origin feature/amazing-feature`
5. プルリクエストを作成

## 📝 ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。