# ubichill-loadtest

Go インスタンス（WebSocket）の負荷試験。`helm install` 1 回が試験 1 回（Job）で、`helm uninstall` で片付ける。Argo CD には載せない。走らせ方・見方・注意は [docs/operations/load-testing.md](../../docs/operations/load-testing.md)。

## 中身

| リソース | 役割 |
|---|---|
| ConfigMap | 生成器 `files/loadgen.mjs`（依存なし。Node 22+ の組み込み WebSocket と fetch） |
| Job | `parallelism` = `completions` = `workers`。`backoffLimit: 0`・`restartPolicy: Never`・`ttlSecondsAfterFinished` |
| PodMonitor | `:9400/metrics` を Prometheus に集めさせる（`podMonitor.enabled`。CRD の無いクラスタでは false） |

worker（Pod）1 つが `scenario.roomsPerWorker` 個の部屋を作り、各部屋に `scenario.usersPerRoom` 人を入れる。部屋は管理 API（`PUT /realtime/v1/instances/{id}`）で作り、応答の `addr`（owner の Pod）にチケットと削除を送る。利用者は `target.instanceUrl` の `/realtime/v1/ws` に繋ぐので、Service の振り分けで半数ほどが別の Pod への中継になる（本番と同じ経路）。

```sh
helm install lt-smoke charts/ubichill-loadtest -n ubichill-dev \
  --set target.instanceUrl=http://ubichill-dev-instance:3002 \
  --set target.adminTokenSecret.name=ubichill-dev-secrets \
  --set scenario.name=smoke --set scenario.roomsPerWorker=2 --set scenario.usersPerRoom=5 \
  --set scenario.durationSeconds=60 \
  --set 'nodeSelector.ubichill\.com/loadgen=true'
```

## values

| キー | 既定 | 意味 |
|---|---|---|
| `target.instanceUrl` | （必須） | Go の Service。管理 API と WS の両方。本番の Service 名 `ubichill-instance` そのものを向くと描画で失敗する |
| `target.adminTokenSecret.name` / `.key` | （必須）/ `INSTANCE_ADMIN_TOKEN` | 管理トークンを持つ既存の Secret。ubichill chart なら `<release>-backend-secrets` |
| `scenario.name` | `default` | 指標の `scenario` ラベル |
| `scenario.roomsPerWorker` / `usersPerRoom` | 10 / 10 | worker ごとの部屋数と部屋の人数 |
| `scenario.maxUsersPerRoom` | `usersPerRoom + 5` | 部屋の定員 |
| `scenario.cursorHz` / `activeRatio` | 20 / 0.3 | カーソルの頻度と、送る利用者の割合 |
| `scenario.durationSeconds` / `rampSeconds` | 300 / 30 | 試験の長さと、接続を増やし切るまでの時間 |
| `scenario.patchIntervalSeconds` | 5 | 各部屋の 1 人が `entity:patch` を送る間隔。0 で送らない |
| `scenario.holdSeconds` | 30 | 時間切れのあと `/metrics` を残す時間（終わった直後の値を Prometheus に拾わせる） |
| `workers` | 1 | Pod の数。接続の総数は `workers × roomsPerWorker × usersPerRoom` |
| `image.repository` / `tag` | `node` / `24-alpine` | 生成器のイメージ |
| `resources` | requests 200m/128Mi、limits 1/512Mi | 1 Pod で 1000 接続・20Hz なら limits 1 コアで足りる |
| `nodeSelector` / `affinity` / `tolerations` | 空 | 攻撃対象と別のノードに載せる。例: `nodeSelector: { ubichill.com/loadgen: "true" }` |
| `podMonitor.enabled` / `interval` / `labels` | true / 15s / 空 | PodMonitor |

## 指標（`ubichill_loadtest_*`、すべて `scenario` ラベル付き）

Grafana のダッシュボード「Ubichill / Load test」が参照するので、名前とラベルは変えない。

| 指標 | 型 | ラベル |
|---|---|---|
| `info` | gauge | `rooms_per_worker` `users_per_room` `cursor_hz` `active_ratio`（値は 1） |
| `clients` | gauge | `state` = `connecting` / `joined` / `closed` |
| `rooms` | gauge | 作れた部屋 |
| `join_failures_total` | counter | `reason` = `timeout` / `ticket_invalid` / `instance_unavailable` / `other` |
| `frames_sent_total` / `frames_received_total` | counter | `event`（応答は `reply`） |
| `cursor_latency_seconds` | histogram | 各部屋の 1 人目の `cursor:move` が 2 人目に `cursor:moved` で届くまで |
| `join_seconds` | histogram | WS を開き始めてから `world:snapshot` まで |
| `requests_total` | counter | `event` = `entity:create` / `entity:patch` / `state:update`、`result` = `ok` / `migrating` / `conflict` / `error` / `timeout` |
| `disconnects_total` | counter | `code`（WS の close code） |
| `notices_total` | counter | `kind`（`server:notice`） |

histogram の bucket は 0.005 0.01 0.025 0.05 0.1 0.25 0.5 1 2.5 5（秒）。

## 生成器の試験

純粋な計算（設定・ランプ・部屋 ID・ヒストグラム・遅延・指標の描画）は `files/loadgen.test.mjs` で確かめる。

```sh
mise exec -- pnpm test:loadgen
helm lint charts/ubichill-loadtest --set target.instanceUrl=http://ubichill-dev-instance:3002 --set target.adminTokenSecret.name=x
```

ローカルの Go に向けて通すこともできる（管理トークンは 32 文字以上）。

```sh
INSTANCE_ADMIN_TOKEN=local-admin-token-0123456789abcdefghij INSTANCE_ADVERTISE_ADDR=127.0.0.1:3102 \
  go -C services/instance run ./cmd/instance --listen 127.0.0.1:3102 &
LOADTEST_INSTANCE_URL=http://127.0.0.1:3102 LOADTEST_ADMIN_TOKEN=local-admin-token-0123456789abcdefghij \
  LOADTEST_ROOMS_PER_WORKER=2 LOADTEST_USERS_PER_ROOM=4 LOADTEST_DURATION_SECONDS=20 LOADTEST_RAMP_SECONDS=2 \
  node charts/ubichill-loadtest/files/loadgen.mjs
curl -s localhost:9400/metrics | grep -v ' 0$'
```

閉じた部屋の ID は Go が 2 分間作り直させない（`retiredFor`）。Pod の中では Pod 名の乱数で避け、外では `POD_NAME` が無ければ乱数を使う。
