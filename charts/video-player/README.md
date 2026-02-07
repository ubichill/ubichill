# Video Player Helm Chart

Ubichill Video Player Plugin の Kubernetes デプロイメント用 Helm チャート

## 特徴

- 🎬 **YouTube動画/ライブ配信再生**: yt-dlp統合
- 🔄 **自動スケーリング**: HPA + アプリ内部制御
- 💾 **Redis統合**: オプショナルキャッシュ機能
- 🔒 **セキュリティ**: RBAC + セキュリティコンテキスト
- 📈 **モニタリング**: Prometheus統合対応
- 🌐 **マルチAZ対応**: ノードアフィニティ設定

## クイックスタート

### 1. 基本インストール

```bash
helm install video-player ./charts/video-player
```

### 2. Redis付きインストール

```bash
helm install video-player ./charts/video-player \
  --set redis.enabled=true
```

### 3. 本番環境用設定

```bash
helm install video-player ./charts/video-player \
  -f ./charts/video-player/values-prod.yaml
```

## 設定値

### 基本設定

| Parameter | Default | Description |
|-----------|---------|-------------|
| `backend.enabled` | `true` | バックエンド有効化 |
| `backend.replicaCount` | `3` | レプリカ数 |
| `backend.image.repository` | `ubichill/video-player-backend` | イメージリポジトリ |
| `backend.image.tag` | `latest` | イメージタグ |

### スケーリング設定

| Parameter | Default | Description |
|-----------|---------|-------------|
| `backend.autoscaling.enabled` | `true` | HPA有効化 |
| `backend.autoscaling.minReplicas` | `2` | 最小レプリカ数 |
| `backend.autoscaling.maxReplicas` | `10` | 最大レプリカ数 |
| `backend.autoscaling.targetCPUUtilizationPercentage` | `70` | CPU閾値 |

### Redis設定

| Parameter | Default | Description |
|-----------|---------|-------------|
| `redis.enabled` | `false` | Redis有効化 |
| `redis.master.persistence.enabled` | `true` | 永続化有効化 |
| `redis.master.resources.limits.memory` | `256Mi` | メモリ制限 |

## 内部スケーリングAPI

アプリケーション内部からスケーリングを制御するAPIが利用可能です。

### エンドポイント

#### スケーリング状況確認
```bash
GET /api/internal/scaling/status
```

#### 手動スケール
```bash
POST /api/internal/scaling/deployment/scale
{
  "replicas": 5
}
```

#### HPA制限更新
```bash
PATCH /api/internal/scaling/hpa
{
  "min_replicas": 3,
  "max_replicas": 15
}
```

#### バーストモード
```bash
POST /api/internal/scaling/burst
{
  "duration_minutes": 10
}
```

### 認証

内部API用トークンを設定：

```yaml
backend:
  env:
    INTERNAL_API_TOKEN: "your-secure-token"
```

API呼び出し時にヘッダーに含める：
```bash
curl -H "Authorization: Bearer your-secure-token" \
  http://service/api/internal/scaling/status
```

## デプロイメント例

### 開発環境

```bash
# 開発用設定でデプロイ
helm install video-player-dev ./charts/video-player \
  -f ./charts/video-player/values-dev.yaml \
  --set backend.image.tag=dev
```

### ステージング環境

```bash
helm install video-player-staging ./charts/video-player \
  --set backend.replicaCount=2 \
  --set redis.enabled=true \
  --set backend.image.tag=staging
```

### 本番環境

```bash
helm install video-player-prod ./charts/video-player \
  -f ./charts/video-player/values-prod.yaml \
  --set backend.image.tag=v1.0.0
```

## アップグレード

```bash
# チャートバージョンアップ
helm upgrade video-player ./charts/video-player \
  -f ./charts/video-player/values-prod.yaml

# 設定変更
helm upgrade video-player ./charts/video-player \
  --reuse-values \
  --set backend.autoscaling.maxReplicas=20
```

## トラブルシューティング

### スケーリング権限エラー

RBAC設定を確認：
```bash
kubectl describe role video-player-backend-scaling
kubectl describe rolebinding video-player-backend-scaling
```

### Redis接続エラー

Redis Podの状態確認：
```bash
kubectl get pods -l app.kubernetes.io/name=redis
kubectl logs -l app.kubernetes.io/name=redis
```

### HPA動作確認

```bash
kubectl describe hpa video-player-backend
kubectl get hpa video-player-backend -w
```

## モニタリング

Prometheus ServiceMonitor有効化：
```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
```

主要メトリクス：
- `http_requests_total`: リクエスト数
- `http_request_duration_seconds`: レスポンス時間
- `kubernetes_pod_restarts_total`: Pod再起動数

## セキュリティ

### RBAC
- 最小権限の原則
- Deployment/HPA操作のみ許可
- 名前空間内リソースに限定

### セキュリティコンテキスト
- 非root実行
- 読み取り専用ルートファイルシステム
- 権限昇格無効化

### ネットワークポリシー
外部通信制限例：
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: video-player-netpol
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: video-player
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: TCP
      port: 443  # HTTPS only
```