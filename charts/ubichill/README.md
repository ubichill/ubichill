# Ubichill Helm Chart

Ubichill（Frontend + SNS Backend + Go Instance + Redis + PostgreSQL）を Kubernetes にデプロイするための単一 Helm チャートです。第三者 mod のバックエンドは各 mod の運営者が独立してホストし、この chart はデプロイしません（Host は mod のバックエンドと直接通信せず、mod の worker が、ユーザーから許可された場合に限り、自分のバックエンドへ直接 fetch します）。

## クイックスタート

```bash
helm repo add ubichill https://ubichill.github.io/ubichill
helm repo update

helm install ubichill ubichill/ubichill \
  --namespace ubichill --create-namespace \
  --set global.domain=<your-domain> \
  --set backend.secretEnv.BETTER_AUTH_SECRET=<random-secret> \
  --set redis.auth.password=<random-secret>
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
  enabled: true                  # backend と instance の共有状態。同梱の Valkey（下の「Redis」）
  auth:
    password: ""                 # password か existingSecret が要る
    existingSecret: ""           # 本番は指定を推奨（下の「Redis」）
    existingSecretPasswordKey: ""
postgresql:
  enabled: true                  # 同梱 PostgreSQL（persistence.enabled で永続/揮発を切替）
```

## Redis

backend と instance には、同じ接続先を次の環境変数で渡す（`ubichill.redis.env` が両方を組み立てる）。

- `redis.enabled=true`: 同梱の Redis（Valkey。下の「同梱の Redis（Valkey）」）を使う。
- `redis.enabled=false` かつ `redis.external.url`: 外部の Redis を使う。パスワードは `redis.external.existingSecret` の `redis.external.existingSecretPasswordKey`（既定 `redis-password`）。同梱の Redis は何も描画しない。
- どちらも無い: 渡さない。backend も instance も Redis なしで動く。
- 両方を指定すると描画で失敗する。`backend.env.REDIS_URL` での指定は instance に届かないので使わない。

| 環境変数 | 値 |
|---|---|
| `REDIS_URL` | 同梱: `redis://<release>-redis-master:6379`、外部: `redis.external.url`（パスワードは入れない） |
| `REDIS_PASSWORD` | 同梱: chart が作る Secret `<release>-redis` の `redis-password` を `secretKeyRef` で参照。`redis.auth.existingSecret` があればその Secret の `redis.auth.existingSecretPasswordKey`（既定 `redis-password`）。`redis.auth.enabled=false` なら渡さない。外部の Redis は `redis.external.existingSecret` があるときだけ |

`redis.auth.enabled`（既定 true）のときは `redis.auth.password` か `redis.auth.existingSecret` が要る。どちらも無いと描画で失敗する
（Bitnami の subchart のように乱数で作ると、Argo CD のように `lookup` できない描画では同期のたびにパスワードが変わるため）。
GitOps では Secret を自分で作って `redis.auth.existingSecret` を指定する。`existingSecret` の値を変えたら、Valkey・backend・instance の Pod を再起動する（chart からは中身が見えず、自動では再起動しない）。

Redis が落ちても backend の `/health` は 200 のままで（`redis: "unavailable"` を載せる）、Pod は再起動しない。
Redis に頼る機能ごとの、落ちたときの振る舞いは `docs/design/instance-scaling.md` の「Redis が使えないとき」に決めてある。どの機能も、Redis が落ちたからといってプロセス内のリースなどに切り替えない。

### 同梱の Redis（Valkey）

Bitnami の redis subchart はやめ、chart 自身のテンプレート（`templates/redis/`）で [Valkey](https://valkey.io)（Linux Foundation、BSD、Redis 7.2 互換）を動かす。
Bitnami は `docker.io/bitnami/*` の版付きのタグを消し、更新され続ける `latest` しか残っていないため。

- イメージは公式の `docker.io/valkey/valkey:<版>-alpine` を版で固定する（`latest`・空のタグは描画で失敗）。`redis.image.digest`（`sha256:...`）を指定すると digest で引く。exporter は作者の公式 `docker.io/oliver006/redis_exporter`（Valkey 対応）を版で固定する。
- Bitnami のイメージ（`repository` に `bitnami` を含む）を `redis.image`・`redis.metrics.image` に指定すると描画で失敗する。Bitnami の subchart 向けに書いた値が残っていると、存在しないタグを引いて Pod が起動しないため。
- go-redis（Go）・`@redis/client`（backend）・Lua（`EVAL`/`EVALSHA`）・Pub/Sub はそのまま使える（Valkey 8.1 は `redis_version:7.2.4` を名乗る）。
- 1 replica の StatefulSet `<release>-redis-valkey`。Service は Bitnami と同じ `<release>-redis-master`（6379）と `<release>-redis-headless`、exporter を使うときは `<release>-redis-metrics`（9121）。
- AOF（`appendonly yes`・`appendfsync everysec`。RDB のスナップショットは取らない）を `/data` に置く。`redis.master.persistence.enabled=false` なら emptyDir（Pod を作り直すと消える）。
- 非 root（uid 999）・`readOnlyRootFilesystem`・capabilities をすべて落とす。イメージの entrypoint（root で chown してから降格する）は通さず `valkey-server` を直接起動する。
- readiness は `valkey-cli ping` が `PONG`、liveness は `PONG` か `LOADING`（AOF の読み込み中は再起動しない）。

**`maxmemory` と `maxmemory-policy`。** 既定は `maxmemory` = `redis.master.resources.limits.memory` の 75%（例: 512Mi → 384mb、1Gi → 768mb）、`maxmemory-policy noeviction`。

- `maxmemory` はデータしか数えず、AOF の書き直しの fork（copy-on-write）・Pub/Sub の出力バッファ・断片化は含まない。上限いっぱいにすると、先にコンテナが OOMKill される（Bitnami の時の設定は上限 512Mi に `maxmemory 512mb` だった）。
- `noeviction` にするのは、追い出しでリースや部屋の割り当てを期限より前に消すと、別の Pod が owner を取れてしまい、fencing の前提（期限までは旧 owner だけが持つ）が崩れるため。`volatile-lru` も期限付きのキー（リース・割り当て・レート制限のカウンタ）だけを追い出すので同じ問題がある。`allkeys-lru`（Bitnami の時の設定）は期限の無い `ubi:cluster:gen` まで消しうる。
- 満杯のときは書き込みがエラーになり、各機能は「Redis が使えない」と同じ扱いになる（レート制限は通す、部屋は止まる）。正しさより先に可用性を落とす。中身は部屋・在席・リースだけなので、満杯になるなら上限を上げる。

| key | 既定 | 互換 | 説明 |
|---|---|---|---|
| `redis.enabled` | `true` | 互換 | |
| `redis.auth.enabled` | `true` | 互換 | |
| `redis.auth.password` | `""` | 互換 | chart が Secret `<release>-redis`（キー `redis-password`）を作る |
| `redis.auth.existingSecret` / `existingSecretPasswordKey` | `""` | 互換 | キーの既定は `redis-password` |
| `redis.external.url` / `existingSecret` / `existingSecretPasswordKey` | `""` | 互換 | |
| `redis.fullnameOverride` / `nameOverride` | なし | 互換 | Service・Secret の名前の元 |
| `redis.master.service.ports.redis` | `6379` | 互換 | Service のポート |
| `redis.master.persistence.enabled` / `storageClass` / `size` | `true` / `""` / `2Gi` | 互換 | `storageClass: "-"` で `storageClassName: ""` |
| `redis.master.persistence.accessModes` | `[ReadWriteOnce]` | 互換 | |
| `redis.master.resources` | 上限 512Mi・500m | 互換 | `maxmemory` の元 |
| `redis.master.nodeSelector` / `affinity` / `tolerations` | 空 | 互換 | |
| `redis.master.podSecurityContext` / `containerSecurityContext` | 非 root・readOnly | 互換（中身は Kubernetes の形そのまま） | |
| `redis.metrics.enabled` / `resources` | `false` | 互換 | exporter の sidecar |
| `redis.metrics.serviceMonitor.enabled` / `interval` | `false` / `30s` | 互換 | Prometheus Operator の CRD が要る |
| `redis.metrics.serviceMonitor.labels` | `{}` | 新規 | Bitnami の `additionalLabels` も読む |
| `redis.image.repository` / `tag` / `digest` / `pullPolicy` | `docker.io/valkey/valkey` / `8.1.11-alpine` / `""` | 意味が変わる | Bitnami の `registry` は無視 |
| `redis.metrics.image.repository` / `tag` / `digest` | `docker.io/oliver006/redis_exporter` / `v1.96.0` / `""` | 意味が変わる | |
| `redis.config.maxmemory` | `""`（上限の 75%） | 新規 | |
| `redis.config.maxmemoryPolicy` | `noeviction` | 新規 | |
| `redis.config.appendfsync` | `everysec` | 新規 | |
| `redis.config.extra` | `""` | 新規 | `valkey.conf` に足す行 |
| `redis.networkPolicy.enabled` / `metricsFrom` | `false` / `[]` | 新規 | 6379 を同じリリースの backend・instance の Pod だけに開ける。9121 は `metricsFrom`（空なら同じ namespace） |

無視される Bitnami の key（書いても効かない）: `architecture`、`redis.global.*`、`image.registry`、`commonConfiguration`、`master.configuration`、`master.count`、`replica.*`、`sentinel.*`、`master.persistence.existingClaim`、`master.persistentVolumeClaimRetentionPolicy`、`metrics.serviceMonitor.namespace` など、上の表に無いもの。トップの `global.imageRegistry` も Valkey・exporter のイメージには効かない（ubichill 自身のイメージと PostgreSQL の subchart には効く）。

### Bitnami の subchart からの移行（本番）

Argo CD の `ubichill`（本番）と `ubichill-dev` は `targetRevision: main` なので、**この chart が main に入った時点で移行が始まる**。夜間（利用者の少ない時間）にマージする。

移行で起きること:

1. Argo CD が新しい StatefulSet `ubichill-redis-valkey` を作り、Bitnami の StatefulSet `ubichill-redis-master` と ConfigMap・ServiceAccount・PDB・NetworkPolicy を prune する。Service `ubichill-redis-master` は名前・ポートが同じまま、selector だけが Valkey の Pod に替わる（backend・instance の `REDIS_URL` は変わらず、再起動もしない）。
2. StatefulSet の名前と PVC（`redis-data-ubichill-redis-master-0` → `data-ubichill-redis-valkey-0`）が変わるので、**Redis の中身は消える**。
   - Valkey が ready になるまで（PVC の作成とイメージの取得。目安 1〜2 分）Redis は使えない。その間はレート制限を通し、ログインは 503、掃除は止まる。`directory: redis` の Go は約 10 秒で部屋を止める。
   - 戻ると `ubi:cluster:gen` が新しい値になり、Go は持っている部屋をすべて捨てて接続を閉じる。参加者は再接続し、部屋は作り直される（部屋の中身はもともとメモリだけで、再起動と同じ）。
   - レート制限のカウンタは 0 に戻る。空インスタンスの復旧猶予（`ubi:absent:*`）も数え直しになる。
   - **ログインのセッションは消えない。** better-auth のセッション・検証トークンは Postgres（`sessions` テーブル）にあり、Redis には レート制限（`customStorage`）しか置いていない（`secondaryStorage` は使っていない）。
3. 全体の目安: マージから Argo CD の同期まで数分、Redis が使えない時間 1〜2 分、部屋の作り直しは参加者の再接続しだい。

home-manifests 側の変更:

- 本番 `argocd-apps/ubichill.yaml`: 変更不要（`redis.auth.existingSecret`・`existingSecretPasswordKey`・`master.persistence.storageClass` はそのまま効く）。メモリの上限は values-prod.yaml の 1Gi なので `maxmemory 768mb` になる。
- dev `argocd-apps/ubichill-dev.yaml`: `redis.metrics.image`（`bitnamilegacy/redis-exporter`）を消す。残すと描画で失敗し、dev の同期が止まる（Bitnami の Redis はそのまま動き続ける）。**この chart のマージの後に入れる。** 先に消すと Bitnami の subchart の既定の exporter（版付きタグが消えている）を引いて、dev の Redis の Pod が起動しなくなる。
- プレビューの ApplicationSet: 変更不要（`redis.auth.password` と `master.persistence.enabled: false` はそのまま効く）。
- `ignoreDifferences` の Deployment の securityContext の項は StatefulSet には効かない（Valkey の securityContext は chart の値のまま同期される）。

移行のあとの片付け（クラスタで手で行う。`kubectl config current-context` で対象を確かめてから）:

1. `kubectl get statefulset,pod -n ubichill -l app.kubernetes.io/name=redis` で Bitnami の Pod が残っていないことを確かめる。
2. Bitnami の PVC は StatefulSet を消しても残る（retention policy は無効）。`kubectl delete pvc -n ubichill redis-data-ubichill-redis-master-0`。dev は `redis-data-ubichill-dev-redis-master-0`。
3. StorageClass の `reclaimPolicy` が `Retain` なら、`Released` になった PV も消す。

戻すときは chart の変更を main で revert する。戻しても中身は引き継がれず、部屋はもう一度作り直される。

### PostgreSQL（今後）

PostgreSQL もまだ Bitnami の subchart で、イメージは `docker.io/bitnami/postgresql:latest` に頼っている（Redis と同じく版付きのタグが消えている）。ただし Postgres は消えてはいけないデータを持つので、Redis のように作り直しでは移せず、データの移行（ダンプと復元、または論理レプリケーション）が要る。別の作業として扱う。候補は [CloudNativePG](https://cloudnative-pg.io)（CNCF。公式の PostgreSQL イメージ、オブジェクトストレージへのバックアップと PITR、メジャー版の更新を operator が扱う）。

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

# 依存 subchart（bitnami postgresql）を取得
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
├── redis      … Valkey。backend・instance の共有状態（リース等。部屋の状態は持たない）
└── postgresql … アプリ DB（同梱 or 外部）
```

デプロイ先のドメインや secret は本リポジトリには含めず、GitOps / Helm values 側で注入する。

Goは専用イメージ（`instanceRuntime.image`）で起動し、backendのイメージ・設定には依存しない。
状態がメモリにあるため、backendのデプロイや設定変更でGoを再起動させないためである。
ブラウザOriginは `instanceRuntime.origins`（未指定なら `https://<global.domain>`）、
切断猶予は `instanceRuntime.disconnectGrace` で指定する。
部屋の割り当て（Directory）は `instanceRuntime.directory`（既定 `memory`。backend にも同じ値を渡す）。`instanceRuntime.replicas`（既定 1）を 2 以上にするときだけ `redis` にする（`memory` のままでは描画で失敗する）。どの Pod に来た WebSocket も、各 Pod が部屋の owner の Pod へ Pod の IP で直接中継するので、Ingress・Service は 1 つのまま（Pod 間の Service は要らない）。中継用の口 `/realtime/v1/relay` は Ingress に出さず、管理トークンから派生した HMAC で Pod 間の接続を確かめる。
`redis` では backend が新しい部屋の置き場所を Redis の各 Pod の状態（`ready` で、部屋数が `instanceRuntime.maxRooms` 未満、接続数・部屋数の少ない順）から選び、その Pod へ直接作成を送る（Service の振り分けには任せない）。
更新は RollingUpdate（`maxSurge: 1`・`maxUnavailable: 0`）。古い Pod は SIGTERM で draining になって新しい部屋を断り、readiness（`/ready`）を落とす。作られてから `instanceRuntime.migrateAfter`（既定 3h）を過ぎた部屋は新しい Pod へ引っ越し（クライアントは繋ぎ直さない）、若い部屋は空になるか 3h に達するまで待つ。直接繋いでいるクライアントは `instanceRuntime.drainTimeout`（既定 24h）まで中継し続ける（下の「自動で縮める」）。古い Pod は最長で drainTimeout の間残る。上限で残った部屋の参加者は繋ぎ直し、部屋は別の Pod に作り直される（中身はメモリなので失われる）。`memory` は新旧の Pod が並ぶと同じ部屋の owner が 2 つになるので Recreate のままで、待たずに閉じる。
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

| 指標 | 種類 | 意味 |
|---|---|---|
| `ubichill_instance_active_rooms` | gauge | この Pod が owner の部屋の数 |
| `ubichill_instance_room_capacity` | gauge | 部屋の上限（`instanceRuntime.maxRooms`） |
| `ubichill_instance_room_capacity_available` | gauge | あと受けられる部屋の数。draining の間と、接続数が `maxConnections` の 9 割に達している間は 0 |
| `ubichill_instance_websocket_connections` | gauge | この Pod が持つ WebSocket。部屋の参加者（他の Pod から中継されたものを含む）＋他の Pod へ中継している接続。heartbeat の `connections` と同じ数え方 |
| `ubichill_instance_connection_capacity` | gauge | 接続数の上限（`instanceRuntime.maxConnections`）。0 は無制限 |
| `ubichill_instance_relay_connections` | gauge | 他の Pod の部屋へ中継している接続 |
| `ubichill_instance_draining` | gauge | SIGTERM のあと新しい部屋を断っている間は 1 |
| `ubichill_instance_rejected_joins_total{reason="connection_limit"}` | counter | 接続数の上限で断った `world:join`（直接・中継の両方）の数 |

中継された接続は、中継する Pod と owner の Pod の両方で数える（どちらも WebSocket を 1 本持つ）。利用者の数は `sum(websocket_connections) - sum(relay_connections)`。CPU・メモリは kube-prometheus-stack の cAdvisor（`container_cpu_usage_seconds_total` など）で見る。

### 接続数の上限（`maxConnections`）

KEDA が増やすまでの間に 1 Pod が飽和すると、延長の goroutine が遅れて部屋が自己停止し、全員が切断される。`instanceRuntime.maxConnections`（`--max-connections`、既定 0＝無制限）で 1 Pod の接続数（`websocket_connections` と同じ単位）を抑える。

- 上限の 9 割から新しい部屋を受けない（作成・引っ越しを 503、heartbeat の `full`、`room_capacity_available` を 0）。backend は別の Pod に部屋を置く。持っている部屋には残りの 1 割で人が入れる。
- 上限に達したら新しい参加者の入室を `instance_unavailable` で断る。クライアントはチケットを取り直して入り直す（Service が別の Pod に当てれば、そこから中継で入れる。owner が上限なら入れない）。入室中の接続は切らない。
- draining にはしない。`/ready` も落とさない。KEDA の接続数・部屋数の query は draining の Pod を除くので、draining にすると飽和した Pod の負荷が scale-out に効かなくなる。
- `autoscaling.targetConnectionsPerPod` は `maxConnections` の 9 割未満にする（描画で確かめる）。新しい部屋を断り始めてから増やすと、増えるまでの間は新しい部屋を作れない。
- 値の目安: #271（まとめ送りの前。CPU 上限 1 コア、1 部屋 10 人・カーソル 20Hz・3 割が操作）では 1 Pod の `websocket_connections` が約 375 で遅延 p95 が 300ms を超えた。まとめ送り（`cursors:batch`）で 1 部屋 10 人・3 人が動く配信の CPU は約 4 割減った（Go のベンチマーク）ので、上限は k6 で測り直してから決める。決めるまでは例えば `maxConnections: 400`（新しい部屋は 360 で止まる）・`targetConnectionsPerPod: 200` のように、飽和の手前で止める値にする。

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
- `ScaledObject` は `minReplicaCount: 1`。scale-in はゆっくり行う（既定: `stabilizationWindowSeconds: 900`、10 分に 1 Pod。`autoscaling.scaleDown` で変える。`scaleDown.enabled: false` で無効）。縮め方は下の「自動で縮める」。
- 有効にすると Deployment に `replicas` を書かない（同期のたびに HPA の決めた台数へ戻さない）。`instanceRuntime.replicas` は使われない。
- trigger は接続数・部屋数・CPU の 3 つ。HPA は trigger ごとに台数を出して大きい方を取るので、1 つの指標（recording rule）にまとめない。どれも `AverageValue` で、台数は `ceil(合計 / 閾値)`。
  - `targetConnectionsPerPod`: 1 Pod に持たせたい `ubichill_instance_websocket_connections`。中継された接続は中継元と owner の両方で数えるので、Service に振り分けを任せた 2 Pod では利用者の約 1.5 倍になる。
    負荷試験（#271。CPU 上限 1 コア、1 部屋 10 人・カーソル 20Hz・3 割が操作）では 1 Pod の値が約 225 で CPU 約 640m・遅延 p95 約 30ms、約 375 で遅延が急に悪化した（p95 300ms 超）。既定の 200 はその手前。
  - `targetCPUPerPod`: 1 Pod の CPU の量（requests に対する割合ではない）。大人数の部屋は配信が人数の 2 乗で増え、接続数では負荷を測れないため。`resources.limits.cpu` より小さくする。
  - `targetRoomsPerPod`: 1 Pod に持たせたい部屋の数。`maxRooms` に達した Pod は新しい部屋を 503 で断るので、その手前で増やす（`maxRooms` 以上は描画で失敗する）。
  - HPA は 10% の許容幅を持つ。例: 1 Pod・閾値 200 なら接続数が 220 を超えたときに 2 台になる。
  - 増やしたときは既存の部屋は移さない。増えた Pod には、backend が接続数の少ない Pod を選ぶので新しい部屋が置かれる。
- 接続数・部屋数の query は draining の Pod を除く（`sum(X{sel} unless on(pod) (ubichill_instance_draining{sel} == 1))`）。除かないと、止めている Pod に残った接続が残りの Pod の平均に足され、縮めた直後に増やし直す。CPU の trigger は cAdvisor の値なので除けない（止めている Pod の CPU も平均に入る）。
- 指標が取れない（ServiceMonitor が無い・Prometheus に届かない）ときは 0 とせず ScaledObject の失敗にする（`ignoreNullValues: "false"`）。台数はそのまま。全部の Pod が draining の一瞬（1 Pod の停止中）も結果が空になり、同じく台数はそのまま。
- 系列は `namespace` と ServiceMonitor が付ける `service` ラベル（`<fullname>-instance`）で選ぶ。別の方法で集めるなら `autoscaling.prometheus.selector` で指定する。draining の除外は `pod` ラベル（ServiceMonitor が付ける）で突き合わせる。

### 自動で縮める

HPA が台数を減らすと、ReplicaSet は `controller.kubernetes.io/pod-deletion-cost` の小さい Pod から消す。Go は自分の Pod にこの注釈を書く（値 = 直接繋いでいるクライアント数 + 自分が owner の部屋の参加者数。変わったときだけ、最短 30 秒おき）。書くために、`autoscaling.enabled` のときだけ ServiceAccount・Role（pods の patch）・RoleBinding を作り、`POD_NAMESPACE` を Downward API で渡す。書けなくても動作は続ける（警告は 10 分に 1 回）。

Go の権限は 2 段で絞る。Role は namespace の pods の `patch` だけ（Pod 名は起動ごとに変わるので `resourceNames` では絞れない）。その上で `ValidatingAdmissionPolicy`（`autoscaling.deletionCostPolicy.enabled`、既定 true、Kubernetes 1.30 以上）が、この ServiceAccount からの更新を「同じ release の instance の Pod」「変わるのは pod-deletion-cost の注釈だけ（ほかの注釈・ラベル・finalizer・ownerReferences・spec は同じ）」に限る。Go が乗っ取られても、できるのは同じ Deployment の Pod の消される順を変えることだけになる。policy は cluster-scoped なので名前に namespace を含める。無いクラスタでは `deletionCostPolicy.enabled: false` にする（Role だけになる）。

消された Pod は SIGTERM で次のように止まる。

1. draining になり、新しい部屋を断る（readiness 503・`state: draining`）。中継しかしていなくなっても draining のまま。
2. 持っている部屋のうち、空になったものは今までどおり閉じる（backend の掃除か、最後の Close）。作られてから `migrateAfter`（既定 3h）未満の部屋は待つ。過ぎても参加者の居る部屋は、別の Pod（ready・空きあり・接続の少ない順）へ**引っ越す**。クライアントは繋ぎ直さない（エンティティ・共有状態・参加者を引き継ぎ、入退室の通知も出ない）。
3. 部屋が無くなっても、この Pod に直接繋いでいるクライアント（今は新しい owner へ中継しているだけ）が居る間は止まらない。上限は `drainTimeout`（既定 24h。1 日続く部屋があるため）。上限の `disconnectNotice`（既定 10m）前に、直接繋いでいるクライアントへ `server:notice`（`{"kind":"disconnect","at":<切る時刻の epoch ms>}`）を送る。
4. `terminationGracePeriodSeconds` は空なら `drainTimeout` + 30 秒（既定で 86430）。明示すると、それより先に Pod が強制終了され、引っ越しや中継の途中で切れる。

縮めたくない時間帯は ScaledObject に `autoscaling.keda.sh/paused-replicas` を付けて台数を固定する。

### 本番で有効にする手順

1. クラスタに KEDA を入れる（home-manifests の `argocd-apps/keda.yaml`）。`v1beta1.external.metrics.k8s.io` の APIService が Available で、`scaledobjects.keda.sh` の CRD があることを確かめる。
2. `instanceRuntime.directory: redis`（`replicas: 1` のまま）で動かし、部屋の作成・入室・更新（RollingUpdate と drain）を確かめる。Redis の Secret は先に固定しておく（「Redis」）。
3. `instanceRuntime.metrics.serviceMonitor.enabled: true` だけを先に入れ、Prometheus で `ubichill_instance_active_rooms{namespace="ubichill",service="ubichill-instance"}` が取れることを確かめる。
4. 閾値を確かめ（既定は #271 の負荷試験から）、`instanceRuntime.autoscaling.enabled: true` と `maxReplicaCount` を入れる。Argo CD の Application には `apps/Deployment` の `/spec/replicas` を `ignoreDifferences` に足す（HPA が変えた台数を差分にしない）。
5. `kubectl get scaledobject,hpa -n ubichill` で `READY`・`ACTIVE` と HPA の指標が読めていることを確かめる。

## 環境（本番・dev・プレビュー）

| | 本番 `ubichill` | dev `ubichill-dev` | プレビュー `preview-pr-<n>` |
|---|---|---|---|
| 値 | `values.yaml` + `values-prod.yaml` | `values.yaml` + `values-dev.yaml`（+ 本番と同じ構成を Application 側で重ねる） | `values-dev.yaml` + PR の `values-preview.yaml` |
| イメージ | `vX.Y.Z`（release） | `main-<sha>`（main の最新。Image Updater が追う） | `sha-<PR の sha>` |
| DB・Redis | 永続 | 永続（PR と違い消えない） | 消える |
| `NODE_ENV` | production | development（メール確認なし・未署名の同梱ワールド可） | development |
| Go | redis・KEDA（増減） | 本番と同じ。生成器と別ノード（`instanceRuntime.affinity`） | redis・2 Pod |
| 用途 | | 負荷試験・スケールの評価（`docs/operations/load-testing.md`） | PR の確認 |

Application の定義は home-manifests（`argocd-apps/ubichill.yaml`・`ubichill-dev.yaml`・`ubichill-preview.yaml`）。dev の Go を負荷の生成器と別のノードに置くには `instanceRuntime.affinity` に `requiredDuringSchedulingIgnoredDuringExecution` でノードのラベル（例: `ubichill.com/loadgen` が無いノード）を指定する。

## コントリビューション / ライセンス

コントリビューション手順はリポジトリルートの [README](../../README.md) と（追加予定の）`CONTRIBUTING.md` を参照。
ライセンスはリポジトリルートの `LICENSE` に従います。


### backend の Redis を有効にする前

R2 の共有レート制限・掃除・通知は、`backend.replicaCount: 1` でも `REDIS_URL` が設定されていれば Redis を使う。
本番の Argo CD では、R2 をデプロイする前に `redis.auth.existingSecret` と `existingSecretPasswordKey` を固定する。
Redis に認証できない間は新規ログインが 503 になり、掃除は停止する。`/health` の `redis: ready` と認証付き PING を確認してから進める。
