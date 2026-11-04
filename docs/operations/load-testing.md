# 負荷試験（k6）

dev 環境に、実際の利用者と同じ経路（ログイン → インスタンスを作る・探す → 参加情報 → WebSocket → 操作 → 退室）で負荷をかけ、結果を Prometheus（remote write）→ Grafana で見る手順。KEDA の閾値（[charts/ubichill/README.md](../../charts/ubichill/README.md) の「Go インスタンスの自動スケール」）と、1 部屋の人数の上限を決めるために使う。

負荷は [k6](https://grafana.com/docs/k6/latest/)（v2.3.0）で、[k6-operator](https://github.com/grafana/k6-operator) の `TestRun` として走らせる。`TestRun` と script の ConfigMap は [charts/ubichill-loadtest](../../charts/ubichill-loadtest/README.md)（Helm chart）が作る。`helm install` 1 回が試験 1 回。Argo CD には載せない。

## 何をするか

1 回の iteration が 1 人の利用者。`scenario.rampSeconds` の間に `rooms × usersPerRoom` 人を均等に始め、各自が「開始 + ramp + hold」まで部屋に居て退室する。

1. アカウント `loadtest_<n>`（`loadtest+<n>@example.com`）でログインする。無ければ `POST /api/v1/users/register` で登録してからログインする（dev は `SKIP_EMAIL_VERIFICATION=true` で即時）。dev の DB は消えないので、次の走りでは使い回す。
2. 部屋の 1 人目が、ワールド（既定 `default`）で `POST /api/v1/instances` を作る。部屋の印（`access.tags` の `lt<走りの名前のハッシュ>r<部屋番号>`）を付ける。2 人目以降は、ロビーでワールドを選んだときと同じ `GET /api/v1/instances?worldId=` から印で探す（1 人目が作るまで 1 秒ごとに、最大 60 秒）。
3. `POST /api/v1/instances/:id/join` で `{token, url}` を取り、WebSocket で `world:join` → `world:snapshot`。`ticket_invalid`・`instance_unavailable` は Host と同じく参加情報を取り直して 2 回まで入り直す。試験の途中にサーバーから切られたら 1 秒後に繋ぎ直す。
4. 部屋の中:
   - `activeRatio`（既定 3 割）の人が `cursorHz`（既定 20Hz）で `cursor:move`。1 人目は x に時刻、y に印（-1）を入れ、2 人目が `cursor:moved`（`cursorBatch` なら `cursors:moved` のまとめ送りも）で受けて遅延を測る。同じ部屋の人は同じ runner（Pod）に置くので、同じ時計で測れる。
   - 1 人目が `entity:create` した box に `patchIntervalSeconds`（既定 5 秒）ごとに `entity:patch`。1・2 人目が同じ間隔で同じキーに `state:update`（`expectedRevision` 付き。競合を数える）。
   - `code: "migrating"` の応答は 500ms 後に送り直す（3 回まで）。`server:notice`・`session:replaced`・`instance:closing` と切断（close code）を数える。
5. 時間が来たら `world:leave`。1 人目は 3 秒待ってから `DELETE /api/v1/instances/:id`（空になれば backend の掃除でも消えるので、404 は失敗にしない）。

管理 API・管理トークンは使わない。

`browser.enabled=true` なら、別の `TestRun`（Chromium、runner 1 つ）で 1〜2 人が画面で「ログイン → ロビーにワールドが出る → インスタンスを作って入る → pen の Worker が描画する」を繰り返し、各段の時間と web vitals を指標にする（手順とセレクタは [packages/e2e](../../packages/e2e/README.md) のブラウザのスモークと同じ）。

## 前提

- dev 環境（namespace `ubichill-dev`、release `ubichill-dev`）。kubectl の context が自宅のクラスタであること（`kubectl config current-context`）。
- **k6-operator**（v1.6 以上。`TestRun` の `spec.args` を使う）と CRD `testruns.k6.io` が入っていること（home-manifests の `argocd-apps/k6-operator.yaml`）。
- **Prometheus の remote write の受け口**（`--web.enable-remote-write-receiver`）が有効で、`http://prometheus-operated.monitoring.svc:9090/api/v1/write` に届くこと（home-manifests の `apps/prometheus/values.yaml`）。受ける側の指標（`ubichill_instance_*`・Redis・cAdvisor）は今までどおり ServiceMonitor で集める。
- runner を載せるノードに `ubichill.com/loadgen=true` のラベル。runner は攻撃対象（Go の Pod）と**別のノード**で動かす（dev の Go は affinity でこのラベルのノードを避ける）。同じノードだと CPU を取り合い、Go の遅延が runner の分だけ悪く見える。
- dev の backend の env:
  - `INSTANCE_CREATE_LIMIT_PER_HOUR` を部屋の数より大きく（例 `5000`）。既定は 1 IP・1 時間 10 件で、runner の Pod は IP が少ない（Cloudflare 経由なら全員が自宅の 1 IP）ので、部屋を 10 個作ったところで 429 になる。本番（`NODE_ENV=production`）では既定より大きくすると backend が起動しない。
  - `RATE_LIMIT_MAX_REQUESTS`（dev は 10000 / 15 分 / IP）。1 人あたり 2〜4 回（登録・一覧・参加情報・削除。`/api/auth` は数えない）なので 1000 人の走りで約 3000。15 分の間に何度も走らせて 429 が出たら上げる。
  - better-auth のレート制限（ログインは 10 秒 3 回 / IP など）は `NODE_ENV=development` の dev では効かない（`lib/auth.ts` の `authRateLimitEnabled`）。dev を production で動かすなら試験は通らない。
  - `SKIP_EMAIL_VERIFICATION=true`・`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`（`default` が一覧に出る）。

```sh
kubectl config current-context
kubectl get crd testruns.k6.io
kubectl get nodes -l ubichill.com/loadgen=true
```

## 走らせ方

`testid` は全指標の `testid` タグになり、Grafana で走りを選ぶ鍵になるので走りごとに変える（英数字・`-_.`）。

```sh
COMMON=(-n ubichill-dev)
```

対象は既定でクラスタの中から直接（`target.via=cluster`: backend は `http://ubichill-dev-backend:3001`、WebSocket は参加情報の URL のホストを `http://ubichill-dev-instance:3002` に置き換える）。`target.via=public` なら公開 URL（`https://dev.ubichill.com`）のまま Cloudflare を通す。既定をクラスタの中にしているのは、Cloudflare を通すと Cloudflare のレート制限・帯域・接続の上限まで測ることになり、Go と backend の限界と見分けられないため。Cloudflare を含めた経路を見たいときだけ `public` にする（全員が自宅の 1 IP から出るので、backend の 1 IP あたりの制限にも当たりやすい）。

### 1. 小さな通し（chart と経路の確認）

2 部屋 × 5 人 = 10 人、増やすのに 10 秒、1 分保つ。ログイン・部屋の作成・入室・カーソル・`entity:patch`・`state:update`・退室・削除が全部通ることを見る。

```sh
helm install lt-smoke charts/ubichill-loadtest "${COMMON[@]}" \
  --set testid=smoke-$(date +%m%d-%H%M) \
  --set scenario.rooms=2 --set scenario.usersPerRoom=5 \
  --set scenario.rampSeconds=10 --set scenario.holdSeconds=60
kubectl -n ubichill-dev get testrun
kubectl -n ubichill-dev logs -f -l app.kubernetes.io/instance=lt-smoke,ubichill.com/loadtest-role=users
```

runner のログの最後に k6 の要約が出る。`ubichill_join_failures` が出ておらず、`ubichill_joined` が 10、`ubichill_requests` が増えていれば経路は正しい。

### 2. 1 部屋 10 人で 1000 人（KEDA の接続数の閾値）

100 部屋 × 10 人、runner 2 つ（部屋は runner の数で割り切れること）。カーソル 20Hz・3 割が操作（#271 と同じ条件）。5 分かけて増やし、10 分保つ。

```sh
helm install lt-1000 charts/ubichill-loadtest "${COMMON[@]}" \
  --set testid=rooms10x100-$(date +%m%d-%H%M) \
  --set parallelism=2 --set scenario.rooms=100 --set scenario.usersPerRoom=10 \
  --set scenario.cursorHz=20 --set scenario.activeRatio=0.3 \
  --set scenario.rampSeconds=300 --set scenario.holdSeconds=600
```

接続は Service で 2 つ以上の Go の Pod に散るので、`ubichill_instance_websocket_connections` の合計は利用者の約 1.5 倍になる（中継された接続は両方の Pod で数える）。見たいのは、Pod あたりの接続数に対する CPU と `ubichill_cursor_latency` の p95 の変化。

### 3. 大人数の部屋（1 部屋 50 人）

配信は人数の 2 乗で増えるので、接続数が同じでも負荷が違う。4 部屋 × 50 人 = 200 人。

```sh
helm install lt-big charts/ubichill-loadtest "${COMMON[@]}" \
  --set testid=room50-$(date +%m%d-%H%M) \
  --set scenario.rooms=4 --set scenario.usersPerRoom=50 \
  --set target.worldId=<capacity.max が 50 以上のワールド> \
  --set scenario.rampSeconds=120 --set scenario.holdSeconds=600
```

**同梱のワールドの定員（`capacity.max`）はどれも 20 人**で、backend は `maxUsers` をそれに丸める。setup が定員を確かめ、足りなければ走らせる前に止める。50 人の部屋には `capacity.max` の大きいワールド（URL のワールドでもよい）を `target.worldId` に指定する。`entity:patch` の `migrating` / `timeout` が増え始める人数が、その条件での上限の目安。

### 4. 画面の体験の確認を負荷と同時に

どれかの走りに `--set browser.enabled=true` を足す。利用者を増やし切ったところ（既定 `browser.startSeconds` = `rampSeconds`）から `holdSeconds` の間、1 人（`browser.vus`）が画面の通しを 30 秒おきに繰り返す。画面は Cloudflare を通した公開 URL（`target.origin`）で開く。

```sh
helm install lt-1000 charts/ubichill-loadtest "${COMMON[@]}" \
  --set testid=rooms10x100-ui-$(date +%m%d-%H%M) \
  --set parallelism=2 --set scenario.rooms=100 --set scenario.usersPerRoom=10 \
  --set scenario.rampSeconds=300 --set scenario.holdSeconds=600 \
  --set browser.enabled=true
```

比べる相手として、負荷の無いときに同じ設定で `scenario.rooms=1 --set scenario.usersPerRoom=1 --set browser.enabled=true --set browser.startSeconds=0` を走らせておく。各段の時間が目に見えて伸びない（目安: 2 倍以内）ことを見る。`render`（入室から描画まで）だけ伸びるなら Go、`login`・`lobby` も伸びるなら backend・frontend を疑う。

## 見方

Grafana のダッシュボード「Ubichill / Load test」: <https://grafana.youkan.uk/d/ubichill-loadtest>。`testid` 変数で走りを選ぶ。

| 見るもの | 式の例 |
|---|---|
| 部屋に居る人数 | `sum(k6_ubichill_joined_total{testid="$testid"}) - sum(k6_ubichill_left_total{testid="$testid"})` |
| 入れなかった人 | `sum by (stage, reason) (k6_ubichill_join_failures_total{testid="$testid"})`。`create` の `rate_limited` は `INSTANCE_CREATE_LIMIT_PER_HOUR`、`join` の `instance_unavailable` は部屋の割り当て（Directory）か 503、`ticket_invalid` は世代のずれ |
| カーソルの遅延 | `max by (instance_id) (k6_ubichill_cursor_latency_p95{testid="$testid"})`（秒） |
| 状態を変える要求 | `sum by (event, result) (rate(k6_ubichill_requests_total{testid="$testid"}[1m]))`。`migrating` は引っ越し中、`timeout` は Go が詰まっている、`conflict` は書き合い |
| 切断 | `sum by (code) (k6_ubichill_disconnects_total{testid="$testid", by="server"})`。退室のあとの切断（`by="client"`、Go が閉じるので code 1006）は数えなくてよい。`k6_ubichill_notices_total{kind="disconnect"}` は drain の予告 |
| API | `k6_http_req_duration_p95{testid="$testid"}` by `name`、`k6_http_req_failed_rate` |
| 画面の体験 | `k6_ubichill_browser_step_duration_p95{testid="$testid"}` by `step`、`k6_browser_web_vital_lcp_p95`、`k6_ubichill_browser_failures_total` |
| 受ける側 | `ubichill_instance_websocket_connections`・`ubichill_instance_relay_connections`・`container_cpu_usage_seconds_total`（Go・backend の Pod） |

Trend の `_p50`・`_p95`・`_p99`・`_max` は **runner ごと（`instance_id` ラベル）・試験の始めからの累積**の値。runner をまたいで足し合わせられないので `max by (instance_id)` などで並べて見る。時間の窓で分位を取りたいときは `output.prometheus.nativeHistogram=true` にする（Prometheus 側で native histogram の受け入れが要る。名前は `k6_<name>_seconds` になり、`histogram_quantile(0.95, sum(rate(k6_ubichill_cursor_latency_seconds{testid="$testid"}[1m])))` で引ける。`_p95` などの gauge は出なくなる）。

runner 自身の CPU（`container_cpu_usage_seconds_total{container="k6"}`、`ubichill.com/loadtest-role` ラベルの Pod）が limits に張り付いていたら、遅延は runner の詰まりを含む。`parallelism` を増やして 1 Pod の人数を減らす。

## 指標の名前

remote write では名前の前に `k6_` が付く。Counter は `_total`、Rate は `_rate`、Trend は `K6_PROMETHEUS_RW_TREND_STATS`（既定 `p(50),p(95),p(99),max`）ごとに `_p50`・`_p95`・`_p99`・`_max` の gauge になる（時間は秒に直る）。native histogram にすると時間の Trend は `k6_<name>_seconds`（時間でない Trend は `k6_<name>`）。

全指標に付くラベル: `testid`（走りの名前）、`scenario`（`users` / `browser`）、`instance_id`（runner の番号）・`testrun_name`（k6-operator が付ける）。

### k6 の組み込み

| remote write の名前 | 型 | 中身・ラベル |
|---|---|---|
| `k6_vus` / `k6_vus_max` | gauge | 動いている VU（= 部屋に向かっている・居る利用者）/ 用意した VU |
| `k6_iterations_total` / `k6_dropped_iterations_total` | counter | 終わった利用者 / VU が足りず始められなかった利用者（0 のはず） |
| `k6_iteration_duration_{p50,p95,p99,max}` | trend | 利用者 1 人の時間（ほぼ ramp + hold） |
| `k6_http_reqs_total` | counter | `name`（`POST /api/v1/instances/:id/join` など。ID は入れない）・`method`・`status` |
| `k6_http_req_duration_{p50,p95,p99,max}` | trend | 同上。ほかに `k6_http_req_{blocked,connecting,tls_handshaking,sending,waiting,receiving}_*` |
| `k6_http_req_failed_rate` | rate | 2xx・3xx 以外と接続の失敗（アカウントが無いときのログインの 401、削除の 404 は数えない） |
| `k6_data_sent_total` / `k6_data_received_total` | counter | バイト（HTTP と WebSocket） |
| `k6_ws_sessions_total` | counter | 開いた WebSocket（`name="WS /realtime/v1/ws"`・`status`） |
| `k6_ws_connecting_{p50,p95,p99,max}` | trend | WebSocket の handshake |
| `k6_ws_session_duration_{p50,p95,p99,max}` | trend | WebSocket を開いていた時間 |
| `k6_ws_msgs_sent_total` / `k6_ws_msgs_received_total` | counter | フレームの数 |
| `k6_browser_web_vital_{lcp,fcp,inp,ttfb}_{p50,p95,p99,max}` | trend | web vitals（秒） |
| `k6_browser_web_vital_cls_{p50,p95,p99,max}` | trend | CLS（単位なし） |
| `k6_browser_http_req_duration_{p50,p95,p99,max}` / `k6_browser_http_req_failed_rate` | trend / rate | 画面が出した要求 |
| `k6_browser_data_sent_total` / `k6_browser_data_received_total` | counter | 画面の送受信のバイト |

### custom（`charts/ubichill-loadtest/scripts/metrics.ts`）

| remote write の名前 | 型 | 中身・ラベル |
|---|---|---|
| `k6_ubichill_cursor_latency_{p50,p95,p99,max}` | trend | 部屋の 1 人目の `cursor:move` が 2 人目に `cursor:moved` / `cursors:moved` で届くまで（秒） |
| `k6_ubichill_join_duration_{p50,p95,p99,max}` | trend | WebSocket を開き始めてから `world:snapshot` まで |
| `k6_ubichill_ready_duration_{p50,p95,p99,max}` | trend | 利用者が始めてから（ログイン・部屋を作る/探す・参加情報を含む）`world:snapshot` まで。繋ぎ直しでは繋ぎ直しから |
| `k6_ubichill_joined_total` / `k6_ubichill_left_total` | counter | `world:snapshot` まで届いた回数 / 部屋を出た回数（差が今の人数） |
| `k6_ubichill_join_failures_total` | counter | `stage` = `account` / `create` / `discover` / `ticket` / `join`、`reason`（`rate_limited`・`not_found`・`status_<n>`・`ticket_invalid`・`instance_unavailable`・`rejected`・`timeout`・`connect_failed` など） |
| `k6_ubichill_requests_total` | counter | `event` = `entity:create` / `entity:patch` / `state:update`、`result` = `ok` / `migrating` / `conflict` / `error` / `timeout`（送り直しも 1 回と数える） |
| `k6_ubichill_disconnects_total` | counter | `code`（close code）、`by` = `server`（試験の途中に切られた）/ `client`（退室・入室の失敗で自分から閉じた） |
| `k6_ubichill_reconnects_total` | counter | 途中で切られて繋ぎ直した。`code` |
| `k6_ubichill_notices_total` | counter | `kind` = `server:notice` の kind（`disconnect` など）/ `session_replaced` / `instance_closing` |
| `k6_ubichill_instance_ops_total` | counter | `op` = `create` / `delete`、`result` = `ok` / `rate_limited` / `not_found` / `error` |
| `k6_ubichill_browser_step_duration_{p50,p95,p99,max}` | trend | 画面の各段。`step` = `login` / `lobby` / `enter` / `render` |
| `k6_ubichill_browser_journey_duration_{p50,p95,p99,max}` | trend | ログインの画面を開いてから描画まで |
| `k6_ubichill_browser_failures_total` | counter | 画面の通しの失敗。`step`（`account` を含む） |

## 片付け

```sh
helm uninstall lt-1000 -n ubichill-dev
```

`TestRun`（と runner・starter・initializer の Pod）と ConfigMap が消える。利用者は時間が来れば退室し、部屋の 1 人目がインスタンスを消す。途中で止めたとき（`helm uninstall`）に残ったインスタンスは、空になれば backend の掃除（`INSTANCE_EMPTY_TIMEOUT_MS`）で消える。`testRun.cleanup=post` なら終わったときに k6-operator が `TestRun` ごと消す（runner のログも消える）。

アカウント `loadtest_*`・`loadtest_web*` は消さない（次の走りで使い回す）。

## 注意

- **本番では走らせない。** chart は namespace・release が `ubichill`、`target.origin` が `ubichill.com`、backend / Go の URL が本番の Service 名（`ubichill-backend`・`ubichill-instance`）なら描画で失敗する。script（`config.ts`）も同じ検査をして、当たれば k6 が始まらない。namespace の間違いは `-n ubichill-dev` を毎回確かめる。
- 1 アカウント 1 接続（後から入った方が残り、前の接続は `session:replaced` で切られる）。同時に 2 つ走らせるときは `accounts.offset` をずらす（例: 2 つ目は `--set accounts.offset=100000`）。
- 部屋の数は `parallelism` で割り切れること（同じ部屋の人を同じ runner に置き、遅延を同じ時計で測るため）。chart と setup の両方で確かめる。
- k6-operator は `setup()` を runner ごとに走らせる。setup は backend と ワールドを確かめるだけで、アカウントの用意は各利用者が始めるときにする（ログインの負荷もランプに乗る）。
- Go の Pod を KEDA で増やす試験なら、`ubichill-dev` の `instanceRuntime.autoscaling.enabled` と `directory: redis` を先に確かめる。1 Pod・`directory: memory` では部屋は全部その Pod に載る。
- runner 1 Pod あたり 1000 人・20Hz 程度まで（limits 2 コア）。CPU が張り付くなら `parallelism` を増やす。
