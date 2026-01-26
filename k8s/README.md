# Kubernetes環境変数設定例

このディレクトリには本番環境用の設定が含まれています。
開発環境やステージング環境で使用する場合は、ConfigMapの値を適宜変更してください。

## ファイル構成

- `configmap.yaml` - 環境変数の設定（ConfigMap）
- `deployment.yaml` - バックエンド・フロントエンドのDeploymentとService
- `ingress.yaml` - Ingressルーティング設定

## 環境変数のカスタマイズ

### バックエンド環境変数

`configmap.yaml` の `ubichill-backend-config` セクションを編集:

```yaml
CORS_ORIGIN: "https://ubichill.youkan.uk"  # フロントエンドのURL
RATE_LIMIT_WINDOW_MS: "900000"             # 15分
RATE_LIMIT_MAX_REQUESTS: "100"             # 100リクエスト/15分
```

### フロントエンド環境変数

`configmap.yaml` の `ubichill-frontend-config` セクションを編集:

```yaml
NEXT_PUBLIC_API_URL: "https://ubichill.youkan.uk"  # APIのURL
```

## デプロイ手順

```bash
# 1. ConfigMapを適用
kubectl apply -f k8s/configmap.yaml

# 2. DeploymentとServiceを適用
kubectl apply -f k8s/deployment.yaml

# 3. Ingressを適用
kubectl apply -f k8s/ingress.yaml

# 4. 設定変更を反映（ConfigMap更新後）
kubectl rollout restart deployment/ubichill-backend -n ubichill
kubectl rollout restart deployment/ubichill-frontend -n ubichill
```

## 環境変数の確認

```bash
# ConfigMapの内容を確認
kubectl get configmap ubichill-backend-config -n ubichill -o yaml
kubectl get configmap ubichill-frontend-config -n ubichill -o yaml

# Podの環境変数を確認
kubectl exec -it deployment/ubichill-backend -n ubichill -- env | grep -E "CORS|PORT|RATE"
```
