# Go インスタンスの負荷試験

dev 環境の Go（WebSocket）に、繰り返し同じ条件で負荷をかけ、結果を Prometheus → Grafana で見る手順。KEDA の閾値（`targetConnectionsPerPod` など。[charts/ubichill/README.md](../../charts/ubichill/README.md) の「Go インスタンスの自動スケール」）と、1 部屋の人数の上限を決めるために使う。

負荷生成器は [charts/ubichill-loadtest](../../charts/ubichill-loadtest/README.md)（Helm chart）。`helm install` 1 回が試験 1 回（Job）。Argo CD には載せない。

## 前提

- dev 環境（namespace `ubichill-dev`、release `ubichill-dev`）。Go の Service は `ubichill-dev-instance:3002`、管理トークンは Secret `ubichill-dev-backend-secrets` の `INSTANCE_ADMIN_TOKEN`。
- Prometheus Operator（kube-prometheus-stack）が `ubichill-dev` の PodMonitor を拾う設定になっていること。Go 側は `instanceRuntime.metrics.serviceMonitor.enabled: true`（負荷を受ける側の `ubichill_instance_*` が無いと比べられない）。
- 生成器を載せるノードに `ubichill.com/loadgen=true` のラベル。生成器は攻撃対象（Go の Pod）と**別のノード**で動かす。同じノードに載せると CPU を取り合い、Go の遅延が生成器の分だけ悪く見える。
- kubectl の context が自宅のクラスタ（dev）であること。`kubectl config current-context` で確かめる。

```sh
kubectl config current-context
kubectl get nodes -l ubichill.com/loadgen=true
kubectl -n ubichill-dev get secret ubichill-dev-backend-secrets -o jsonpath='{.data.INSTANCE_ADMIN_TOKEN}' | wc -c   # 空でない
```

## 走らせ方

共通の引数を変数にしておく。`scenario.name` は指標の `scenario` ラベルになり、Grafana で走りを選ぶ鍵になるので走りごとに変える（英数字・`-_.`）。

```sh
COMMON=(
  -n ubichill-dev
  --set target.instanceUrl=http://ubichill-dev-instance:3002
  --set target.adminTokenSecret.name=ubichill-dev-backend-secrets
  --set 'nodeSelector.ubichill\.com/loadgen=true'
)
```

### 1. 小さな通し（chart と経路の確認）

2 部屋 × 5 人 = 10 接続、1 分。部屋の作成・入室・カーソル・`entity:patch`・`state:update`・削除が全部通ることを見る。

```sh
helm install lt-smoke charts/ubichill-loadtest "${COMMON[@]}" \
  --set scenario.name=smoke-$(date +%m%d-%H%M) \
  --set scenario.roomsPerWorker=2 --set scenario.usersPerRoom=5 \
  --set scenario.durationSeconds=60 --set scenario.rampSeconds=5
kubectl -n ubichill-dev logs -f job/lt-smoke-ubichill-loadtest
```

ログは 10 秒ごとに JSON 1 行（`connected`・`joinFail`・`sentPerSec`・`cursorP95Ms`・`patch` など）。`joinFail` が 0 で `patch.ok` が増えていれば経路は正しい。

### 2. 1 部屋 10 人で 1000 接続（KEDA の接続数の閾値）

worker 2 つ × 50 部屋 × 10 人。カーソル 20Hz・3 割が操作（#271 と同じ条件）。5 分かけて増やし、10 分保つ。

```sh
helm install lt-1000 charts/ubichill-loadtest "${COMMON[@]}" \
  --set scenario.name=rooms10x100-$(date +%m%d-%H%M) \
  --set workers=2 --set scenario.roomsPerWorker=50 --set scenario.usersPerRoom=10 \
  --set scenario.cursorHz=20 --set scenario.activeRatio=0.3 \
  --set scenario.rampSeconds=300 --set scenario.durationSeconds=900
```

接続が Service で 2 つ以上の Go の Pod に散るので、`ubichill_instance_websocket_connections` の合計は利用者の約 1.5 倍になる（中継された接続は両方の Pod で数える）。見たいのは、Pod あたりの接続数に対する CPU と `cursor_latency_seconds` の p95 の変化。

### 3. 大人数の部屋（1 部屋 50 人）

配信は人数の 2 乗で増えるので、接続数が同じでも負荷が違う。worker 1 つ × 4 部屋 × 50 人 = 200 接続。

```sh
helm install lt-big charts/ubichill-loadtest "${COMMON[@]}" \
  --set scenario.name=room50-$(date +%m%d-%H%M) \
  --set scenario.roomsPerWorker=4 --set scenario.usersPerRoom=50 --set scenario.maxUsersPerRoom=60 \
  --set scenario.cursorHz=20 --set scenario.activeRatio=0.3 \
  --set scenario.rampSeconds=120 --set scenario.durationSeconds=600
```

1 部屋 100 人なら `usersPerRoom=100 maxUsersPerRoom=110`。`entity:patch` の `migrating` / `timeout` が増え始める人数が、その条件での上限の目安。

## 見方

Grafana のダッシュボード「Ubichill / Load test」: <https://grafana.youkan.uk/d/ubichill-loadtest>。`scenario` 変数で走りを選ぶ。

| 見るもの | 指標 |
|---|---|
| 接続の増え方・落ち | `ubichill_loadtest_clients{state}`（`joined` が計画どおり増え、`closed` が試験中に増えない） |
| 入室の失敗 | `rate(ubichill_loadtest_join_failures_total[1m])` by `reason`。`instance_unavailable` は部屋の割り当て（Directory）か 503、`ticket_invalid` は世代のずれ |
| カーソルの遅延 | `histogram_quantile(0.95, sum(rate(ubichill_loadtest_cursor_latency_seconds_bucket[1m])) by (le))`。各部屋の 1 人目 → 2 人目（同じ worker の時計）。Service の振り分けで半数ほどが中継を挟む |
| 状態を変える要求 | `ubichill_loadtest_requests_total{event,result}`。`migrating` は引っ越し中、`timeout` は Go が詰まっている |
| 切断 | `ubichill_loadtest_disconnects_total{code}`。試験中の 1006 は Go 側の切断、`notices_total{kind="disconnect"}` は drain の予告 |
| 受ける側 | `ubichill_instance_websocket_connections`・`ubichill_instance_relay_connections`・`container_cpu_usage_seconds_total`（Go の Pod） |

生成器自身の CPU（`container_cpu_usage_seconds_total{container="loadgen"}`）が limits に張り付いていたら、遅延は生成器の詰まりを含む。`workers` を増やして 1 Pod の接続を減らす。

ログだけで見るなら `kubectl -n ubichill-dev logs job/<release>-ubichill-loadtest | jq -c 'select(.type=="summary")'`。

## ユーザー体験が変わらないことの確認

負荷の前と負荷の最中に、同じスモークを走らせて所要時間と結果を比べる（[packages/e2e/README.md](../../packages/e2e/README.md)）。

```sh
# 負荷の前
time mise exec -- pnpm smoke https://dev.ubichill.com --suite=all --report=/tmp/smoke-before.json
# 負荷の最中（ランプが終わってから）
time mise exec -- pnpm smoke https://dev.ubichill.com --suite=all --report=/tmp/smoke-during.json
```

API の段（入室 → `cursor:moved` → `state:changed`）が落ちない・各段の時間が目に見えて伸びない（目安: 2 倍以内）ことを見る。ブラウザの段は画面の描画まで含むので、伸びが大きければ Go ではなく backend・frontend の方も疑う。

## 片付け

```sh
helm uninstall lt-1000 -n ubichill-dev
```

Job は時間切れで自分の部屋を消して終わる。`helm uninstall` や `kubectl delete job` で途中で止めても、SIGTERM で接続を閉じ、部屋を消す（`terminationGracePeriodSeconds: 30`）。残った部屋は管理 API で確かめる。

```sh
kubectl -n ubichill-dev exec deploy/ubichill-dev-backend -- \
  sh -c 'wget -qO- --header="Authorization: Bearer $INSTANCE_ADMIN_TOKEN" http://ubichill-dev-instance:3002/realtime/v1/instances' | jq '.instances[] | select(.id | startswith("loadtest-")) | .id'
```

終わった Pod は `ttlSecondsAfterFinished`（既定 1 時間）でログごと消える。

## 注意

- **本番の namespace では走らせない。** chart は `target.instanceUrl` が本番の Service 名 `ubichill-instance` そのものを向いていると描画で失敗する（`ubichill-dev-instance` やプレビューの名前は通る）。namespace の間違いは守れないので、`-n ubichill-dev` を毎回確かめる。
- 閉じた部屋の ID は Go が 2 分間作り直させない。Job の Pod 名の乱数で避けているので、同じ release 名で `helm uninstall` → `helm install` を続けても衝突しない。
- Go の Pod を KEDA で増やす試験なら、`ubichill-dev` の `instanceRuntime.autoscaling.enabled` と `directory: redis` を先に確かめる。1 Pod・`directory: memory` では部屋は全部その Pod に載る。
- 生成器 1 Pod あたりの接続は 1000 程度まで（limits 1 コア）。それ以上は `workers` を増やす。
