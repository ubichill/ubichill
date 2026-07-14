# Ubichill Helm Chart

Ubichill（Frontend + Backend + Redis + PostgreSQL + modバックエンド）を Kubernetes に
デプロイするための単一 Helm チャートです。modのバックエンド（例: video-player の yt-dlp）は
別チャートではなく、この chart の `modBackends` で一緒にデプロイします。

## クイックスタート

```bash
helm repo add ubichill https://ubichill.github.io/ubichill
helm repo update

helm install ubichill ubichill/ubichill \
  --namespace ubichill --create-namespace \
  --set global.domain=<your-domain> \
  --set backend.secretEnv.BETTER_AUTH_SECRET=<random-secret>
```

- `global.domain` から **Ingress ホスト / `CORS_ORIGIN` / `BETTER_AUTH_URL`** が導出される（必須）。
- DB は同梱の PostgreSQL がパスワードを自動生成するため指定不要（自前 DB を使うなら
  `postgresql.auth.password` か `postgresql.auth.existingSecret`）。スキーマは backend Pod の
  **migrate init container** が起動時に適用する。
- メール認証を使うなら `backend.secretEnv.RESEND_API_KEY` と `backend.env.MAIL_FROM`、
  使わないなら `backend.env.SKIP_EMAIL_VERIFICATION=true`。

環境別 values の例は [`values-dev.yaml`](values-dev.yaml) / [`values-prod.yaml`](values-prod.yaml) を参照。

## 主な設定

```yaml
global:
  domain: "example.com"          # 必須。Ingress host / CORS / auth URL の元
  imagePullPolicy: Always

backend:
  image:
    repository: ghcr.io/ubichill/ubichill-backend
    tag: latest                  # 本番は :vX.Y.Z など不変タグ推奨
  existingSecret: ""             # BETTER_AUTH_SECRET / RESEND_API_KEY をまとめた Secret
  env:
    SKIP_EMAIL_VERIFICATION: "false"
    MAIL_FROM: "Ubichill <noreply@example.com>"

frontend:
  image:
    repository: ghcr.io/ubichill/ubichill-frontend
    tag: latest

redis:
  enabled: true                  # 共有キャッシュ
postgresql:
  enabled: true                  # 同梱 PostgreSQL（persistence.enabled で永続/揮発を切替）

# modバックエンド（この chart 内でデプロイ）
modBackends:
  - id: video-player
    image:
      repository: ghcr.io/ubichill/video-player-backend
      tag: latest
    port: 8000
    pathPrefix: /mods/video-player/api
```

## 開発・検証

```bash
git clone https://github.com/ubichill/ubichill
cd ubichill

# 依存 subchart（bitnami postgresql / redis）を取得
helm dependency build charts/ubichill

# lint / テンプレート確認（必須値はダミーで注入）
helm lint charts/ubichill -f charts/ubichill/values-dev.yaml --set global.domain=dev.example
helm template t charts/ubichill -f charts/ubichill/values-dev.yaml --set global.domain=dev.example
```

CI でも PR 時に `charts/**` の lint / template を検証する（[helm-ci.yml](../../.github/workflows/helm-ci.yml)）。

## アーキテクチャ

```
Kubernetes (namespace)
├── frontend   … Vite CSR（React）を nginx で配信。/api・/socket.io は backend へ proxy
├── backend    … Node.js + Socket.IO。起動時に migrate init container が DB スキーマ適用
├── modBackends[] … 各modの API（例: video-player = yt-dlp backend）
├── redis      … 共有キャッシュ
└── postgresql … アプリ DB（同梱 or 外部）
```

デプロイ先のドメインや secret は本リポジトリには含めず、GitOps / Helm values 側で注入する。

## コントリビューション / ライセンス

コントリビューション手順はリポジトリルートの [README](../../README.md) と（追加予定の）`CONTRIBUTING.md` を参照。
ライセンスはリポジトリルートの `LICENSE` に従います。
