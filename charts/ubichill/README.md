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
├── instance   … Go / WebSocket。Ingress の /realtime/v1/ws で直接接続。既定 1 replica・Recreate（redis の Directory なら複数・RollingUpdate）
├── redis      … backend・instance の共有状態（リース等。部屋の状態は持たない）
└── postgresql … アプリ DB（同梱 or 外部）
```

デプロイ先のドメインや secret は本リポジトリには含めず、GitOps / Helm values 側で注入する。

Goは専用イメージ（`instanceRuntime.image`）で起動し、backendのイメージ・設定には依存しない。
状態がメモリにあるため、backendのデプロイや設定変更でGoを再起動させないためである。
ブラウザOriginは `instanceRuntime.origins`（未指定なら `https://<global.domain>`）、
切断猶予は `instanceRuntime.disconnectGrace` で指定する。
部屋の割り当て（Directory）は `instanceRuntime.directory`（既定 `memory`。backend にも同じ値を渡す）。`instanceRuntime.replicas`（既定 1）を 2 以上にするときだけ `redis` にする（`memory` のままでは描画で失敗する）。どの Pod に来た WebSocket も、各 Pod が部屋の owner の Pod へ Pod の IP で直接中継するので、Ingress・Service は 1 つのまま（Pod 間の Service は要らない）。中継用の口 `/realtime/v1/relay` は Ingress に出さず、管理トークンから派生した HMAC で Pod 間の接続を確かめる。
`redis` では backend が新しい部屋の置き場所を Redis の各 Pod の状態（`ready` で、部屋数が `instanceRuntime.maxRooms` 未満、接続数・部屋数の少ない順）から選び、その Pod へ直接作成を送る（Service の振り分けには任せない）。
更新は RollingUpdate（`maxSurge: 1`・`maxUnavailable: 0`）。古い Pod は SIGTERM で draining になって新しい部屋を断り、readiness（`/ready`）を落として、`instanceRuntime.drainTimeout` まで接続が抜けるのを待ってから残りの部屋を閉じる。閉じた部屋の参加者は繋ぎ直し、部屋は別の Pod に作り直される（中身はメモリなので失われる。今の再起動と同じ）。`memory` は新旧の Pod が並ぶと同じ部屋の owner が 2 つになるので Recreate のままで、待たずに閉じる。
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

## Go インスタンスの自動スケール（KEDA）

Go の Pod は `GET /metrics`（ポート `realtime`＝3002）で負荷を Prometheus の text 形式で出す。認証は無い。Ingress は `/realtime/v1/ws` だけを Go へ送るのでクラスタの外には出ず、中身は数だけ（部屋 ID・利用者 ID は出さない）。管理トークンで守ると Prometheus にそのトークンを渡すことになるので付けない。

| 指標（gauge） | 意味 |
|---|---|
| `ubichill_instance_active_rooms` | この Pod が owner の部屋の数 |
| `ubichill_instance_room_capacity` | 部屋の上限（`instanceRuntime.maxRooms`） |
| `ubichill_instance_room_capacity_available` | あと受けられる部屋の数。draining の間は 0 |
| `ubichill_instance_websocket_connections` | この Pod が持つ WebSocket。部屋の参加者（他の Pod から中継されたものを含む）＋他の Pod へ中継している接続。heartbeat の `connections` と同じ数え方 |
| `ubichill_instance_relay_connections` | 他の Pod の部屋へ中継している接続 |
| `ubichill_instance_draining` | SIGTERM のあと新しい部屋を断っている間は 1 |

中継された接続は、中継する Pod と owner の Pod の両方で数える（どちらも WebSocket を 1 本持つ）。利用者の数は `sum(websocket_connections) - sum(relay_connections)`。CPU・メモリは kube-prometheus-stack の cAdvisor（`container_cpu_usage_seconds_total` など）で見る。

```yaml
instanceRuntime:
  directory: redis               # 必須。memory では描画で失敗する
  metrics:
    serviceMonitor:
      enabled: true              # Prometheus Operator の CRD が要る
  autoscaling:
    enabled: true                # KEDA の CRD が要る
    maxReplicaCount: 5
    targetConnectionsPerPod: 200 # 負荷試験（#271）から
    targetRoomsPerPod: 800       # maxRooms 未満
    targetCPUPerPod: 600m        # 空なら CPU の trigger を作らない
    prometheus:
      serverAddress: http://prometheus-operated.monitoring.svc:9090
```

- どちらも既定は無効。CRD の無いクラスタで描画・適用が落ちない。
- `ScaledObject` は `minReplicaCount: 1`、**自動の scale-in は無効**（`scaleDown.selectPolicy: Disabled`）。HPA は消す Pod を部屋の有無で選べないため。
- 有効にすると Deployment に `replicas` を書かない（同期のたびに HPA の決めた台数へ戻さない）。`instanceRuntime.replicas` は使われない。
- trigger は接続数・部屋数・CPU の 3 つ。HPA は trigger ごとに台数を出して大きい方を取るので、1 つの指標（recording rule）にまとめない。どれも `AverageValue` で、台数は `ceil(合計 / 閾値)`。
  - `targetConnectionsPerPod`: 1 Pod に持たせたい `ubichill_instance_websocket_connections`。中継された接続は中継元と owner の両方で数えるので、Service に振り分けを任せた 2 Pod では利用者の約 1.5 倍になる。
    負荷試験（#271。CPU 上限 1 コア、1 部屋 10 人・カーソル 20Hz・3 割が操作）では 1 Pod の値が約 225 で CPU 約 640m・遅延 p95 約 30ms、約 375 で遅延が急に悪化した（p95 300ms 超）。既定の 200 はその手前。
  - `targetCPUPerPod`: 1 Pod の CPU の量（requests に対する割合ではない）。大人数の部屋は配信が人数の 2 乗で増え、接続数では負荷を測れないため。`resources.limits.cpu` より小さくする。
  - `targetRoomsPerPod`: 1 Pod に持たせたい部屋の数。`maxRooms` に達した Pod は新しい部屋を 503 で断るので、その手前で増やす（`maxRooms` 以上は描画で失敗する）。
  - HPA は 10% の許容幅を持つ。例: 1 Pod・閾値 200 なら接続数が 220 を超えたときに 2 台になる。
  - 既存の部屋は移さない。増えた Pod には、backend が接続数の少ない Pod を選ぶので新しい部屋が置かれる。
- 指標が取れない（ServiceMonitor が無い・Prometheus に届かない）ときは 0 とせず ScaledObject の失敗にする（`ignoreNullValues: "false"`）。台数はそのまま。
- 系列は `namespace` と ServiceMonitor が付ける `service` ラベル（`<fullname>-instance`）で選ぶ。別の方法で集めるなら `autoscaling.prometheus.selector` で指定する。

### 手動で縮める

自動では減らさない。減らすときは、部屋の少ない Pod を選んで消す（Pod ごとの `ubichill_instance_websocket_connections` を見る）。

1. 消す Pod に `controller.kubernetes.io/pod-deletion-cost=-1000` を付ける（ReplicaSet が先に消す。ベストエフォート）。
2. ScaledObject に `autoscaling.keda.sh/paused-replicas: "<今の台数 - 1>"` を付ける。KEDA が台数を固定し、Pod は SIGTERM で draining になり、`drainTimeout` まで接続が抜けるのを待ってから残りの部屋を閉じる（参加者は繋ぎ直し、部屋は別の Pod に作り直される）。
3. 消えたら `paused-replicas` を外す。scale-in が無効なので、指標が小さくても台数はそのまま。

### 本番で有効にする手順

1. クラスタに KEDA を入れる（home-manifests の `argocd-apps/keda.yaml`）。`v1beta1.external.metrics.k8s.io` の APIService が Available で、`scaledobjects.keda.sh` の CRD があることを確かめる。
2. `instanceRuntime.directory: redis`（`replicas: 1` のまま）で動かし、部屋の作成・入室・更新（RollingUpdate と drain）を確かめる。Redis の Secret は先に固定しておく（「Redis」）。
3. `instanceRuntime.metrics.serviceMonitor.enabled: true` だけを先に入れ、Prometheus で `ubichill_instance_active_rooms{namespace="ubichill",service="ubichill-instance"}` が取れることを確かめる。
4. 閾値を確かめ（既定は #271 の負荷試験から）、`instanceRuntime.autoscaling.enabled: true` と `maxReplicaCount` を入れる。Argo CD の Application には `apps/Deployment` の `/spec/replicas` を `ignoreDifferences` に足す（HPA が変えた台数を差分にしない）。
5. `kubectl get scaledobject,hpa -n ubichill` で `READY`・`ACTIVE` と HPA の指標が読めていることを確かめる。

## コントリビューション / ライセンス

コントリビューション手順はリポジトリルートの [README](../../README.md) と（追加予定の）`CONTRIBUTING.md` を参照。
ライセンスはリポジトリルートの `LICENSE` に従います。


### backend の Redis を有効にする前

R2 の共有レート制限・掃除・通知は、`backend.replicaCount: 1` でも `REDIS_URL` が設定されていれば Redis を使う。
本番の Argo CD では、R2 をデプロイする前に `redis.auth.existingSecret` と `existingSecretPasswordKey` を固定する。
Redis に認証できない間は新規ログインが 503 になり、掃除は停止する。`/health` の `redis: ready` と認証付き PING を確認してから進める。
