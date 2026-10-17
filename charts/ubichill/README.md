# Ubichill Helm Chart

Ubichill（Frontend + SNS Backend + Go Instance + Redis + PostgreSQL）を Kubernetes にデプロイするための単一 Helm チャートです。第三者 mod のバックエンドは各 mod の運営者が独立してホストし、この chart はデプロイしません（Host は mod のバックエンドと直接通信せず、mod の worker が、ユーザーから許可された場合に限り、自分のバックエンドへ直接 fetch します）。

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
  enabled: true                  # backend と instance の共有状態（下の「Redis」）
  auth:
    existingSecret: ""           # 本番は指定を推奨（下の「Redis」）
    existingSecretPasswordKey: ""
postgresql:
  enabled: true                  # 同梱 PostgreSQL（persistence.enabled で永続/揮発を切替）
```

## Redis

backend と instance には、同じ接続先を次の環境変数で渡す（`ubichill.redis.env` が両方を組み立てる）。

- `redis.enabled=true`: 同梱の subchart を使う。
- `redis.enabled=false` かつ `redis.external.url`: 外部の Redis を使う。パスワードは `redis.external.existingSecret` の `redis.external.existingSecretPasswordKey`（既定 `redis-password`）。
- どちらも無い: 渡さない。backend も instance も Redis なしで動く。
- 両方を指定すると描画で失敗する。`backend.env.REDIS_URL` での指定は instance に届かないので使わない。

| 環境変数 | 値 |
|---|---|
| `REDIS_URL` | subchart: `redis://<release>-redis-master:6379`、外部: `redis.external.url`（パスワードは入れない） |
| `REDIS_PASSWORD` | subchart の Secret `<release>-redis` の `redis-password` を `secretKeyRef` で参照。`redis.auth.existingSecret` があればその Secret の `redis.auth.existingSecretPasswordKey`（既定 `redis-password`）。`redis.auth.enabled=false` なら渡さない。外部の Redis は `redis.external.existingSecret` があるときだけ |

`redis.auth.existingSecret` を指定しないと、Bitnami の subchart はパスワードを描画のたびに乱数で作り、
既存の Secret はクラスタを `lookup` して引き継ぐ。ArgoCD のように `lookup` できない描画では、
描画のたびにパスワードが変わり、Redis の Pod も再起動する（backend・instance は古いパスワードのまま繋がらなくなる）。
GitOps では Secret を自分で作って `redis.auth.existingSecret` を指定する。

Redis が落ちても backend の `/health` は 200 のままで（`redis: "unavailable"` を載せる）、Pod は再起動しない。
Redis に頼る機能ごとの、落ちたときの振る舞いは `docs/design/instance-scaling.md` の「Redis が使えないとき」に決めてある。どの機能も、Redis が落ちたからといってプロセス内のリースなどに切り替えない。

## backend の複数レプリカ

`backend.replicaCount` で台数を変えられる。**既定は 1 のままにする。** 2 以上にする条件は次のとおり。

1. Redis があること（`redis.enabled` か `redis.external.url`）。無いまま 2 以上を指定すると描画で失敗する。
2. DB 側の作業が入っていること。入るまでは 1 台で動かす。
   - インスタンスの作成時刻（`created_at`）が `timestamptz` になっていること。今の reaper は、作りたてのインスタンスの猶予を作成した backend のプロセス内の時刻で数え、ほかの backend が作ったものは `created_at` で数える。型がずれていると、作りたてのインスタンスを消してしまう。
   - 登録の仮データ（OTP）が DB にあること。今はプロセス内にあるので、登録と確認が別の backend に振られると確認に失敗する。

Redis で揃えるもの（Redis なしの 1 台では今までどおりプロセス内で動く）:

| 対象 | 揃え方 | Redis が落ちている間 |
|---|---|---|
| HTTP のレート制限（全体・インスタンス作成・サービストークン・外部の作品の再確認） | `rate-limit-redis`（`ubi:rl:<limiter>:`） | 制限せずに通す（警告は limiter ごとに 1 回） |
| better-auth のレート制限 | `rateLimit.customStorage`（`ubi:auth-rl:`）。`secondaryStorage` は使わない（セッション・検証トークンの保存先まで Redis に移るため） | 制限せずに通す。ただしログイン（`/api/auth/sign-in/email`）は 503 で断る |
| 空インスタンスの掃除・期限切れの CLI 認可の掃除 | リース `ubi:lease:reaper` を持つ 1 台だけが動かす。復旧猶予の起点は `ubi:absent:<instanceId>` | 掃除しない |
| ワールドの解決・外部ワールド・連合のフォロー・公開のお気に入り・外部の作品の確認のキャッシュ | Pub/Sub `ubi:ch:backend` で捨てさせる。届かなくても各キャッシュの期限（5 分以内。お気に入りは 3 分、外部の作品は 10 分）で揃う | 知らせは届かず、期限で揃う |

**揃わないもの: ワールドの並び順（`PUT /api/v1/worlds/order` の `reorderWorlds`）。** プロセス内にあり、知らせも送らないので、並べ替えた backend にしか効かず、再起動で消える。DB 側の作業で Postgres に移す。

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
├── frontend   … Vite CSR（React）を BFF で配信
├── backend    … SNS・認証の Node.js API。Ingress の /api で接続。起動時に DB スキーマ適用
├── instance   … Go / WebSocket。Ingress の /realtime/v1/ws で直接接続。1 replica・Recreate
├── redis      … backend・instance の共有状態（リース等。部屋の状態は持たない）
└── postgresql … アプリ DB（同梱 or 外部）
```

デプロイ先のドメインや secret は本リポジトリには含めず、GitOps / Helm values 側で注入する。

Goは専用イメージ（`instanceRuntime.image`）で起動し、backendのイメージ・設定には依存しない。
状態がメモリにあるため、backendのデプロイや設定変更でGoを再起動させないためである。
ブラウザOriginは `instanceRuntime.origins`（未指定なら `https://<global.domain>`）、
切断猶予は `instanceRuntime.disconnectGrace` で指定する。
部屋の割り当て（Directory）は `instanceRuntime.directory`（既定 `memory`）。`replicas` を 2 以上にするときだけ `redis` にする。
`redis` は Redis の可用性が部屋の可用性の上限になる（Redis が約 10 秒以上落ちると全部屋が止まる）ので、先に Redis の Secret を固定しておく（下の「Redis」）。Ingressが公開するのはWebSocketの
`/realtime/v1/ws` だけで、管理API（`/realtime/v1/instances`）はクラスタ内からのみ到達できる。
管理トークンは既定でbackend Secretの `BETTER_AUTH_SECRET`（32文字以上）を参照する。専用のSecretを使うには
`instanceRuntime.existingSecret` / `instanceRuntime.secretKey` を指定する。existingSecretを使う場合、
トークンを変えたら backend と instance の Pod を再起動する。
参加チケットの署名鍵は管理トークンから派生する（全 Pod・再起動の前後で同じ鍵）。専用の鍵を使う場合は
instance に `INSTANCE_TICKET_KEY`（32 文字以上）を渡す。
Goを外部で運用する場合は `instanceRuntime.enabled=false` とし、backend.envの
`INSTANCE_RUNTIME_URL` / `INSTANCE_PUBLIC_URL` を外部サーバーに合わせる。
状態はメモリのみで、再起動時に初期状態へ戻る。詳細は [運用手順](../../services/instance/README.md)。

## コントリビューション / ライセンス

コントリビューション手順はリポジトリルートの [README](../../README.md) と（追加予定の）`CONTRIBUTING.md` を参照。
ライセンスはリポジトリルートの `LICENSE` に従います。


### backend の Redis を有効にする前

R2 の共有レート制限・掃除・通知は、`backend.replicaCount: 1` でも `REDIS_URL` が設定されていれば Redis を使う。
本番の Argo CD では、R2 をデプロイする前に `redis.auth.existingSecret` と `existingSecretPasswordKey` を固定する。
Redis に認証できない間は新規ログインが 503 になり、掃除は停止する。`/health` の `redis: ready` と認証付き PING を確認してから進める。
