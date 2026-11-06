# ubichill-loadtest

実際の利用者と同じ経路（ログイン → インスタンスを作る・探す → 参加情報 → WebSocket → 操作 → 退室）の負荷試験。[k6](https://grafana.com/docs/k6/latest/)（v2.3.0）を [k6-operator](https://github.com/grafana/k6-operator)（v1.6 以上）の `TestRun` で走らせ、結果を Prometheus の remote write で出す。`helm install` 1 回が試験 1 回で、`helm uninstall` で片付ける。Argo CD には載せない。

走らせ方・見方・指標の名前・注意は [docs/operations/load-testing.md](../../docs/operations/load-testing.md)。

```sh
helm install lt-smoke charts/ubichill-loadtest -n ubichill-dev \
  --set testid=smoke-$(date +%m%d-%H%M) \
  --set scenario.rooms=2 --set scenario.usersPerRoom=5 \
  --set scenario.rampSeconds=10 --set scenario.holdSeconds=60
```

## 中身

| リソース | 役割 |
|---|---|
| ConfigMap | k6 の script（`scripts/*.ts`。テストは載せない）。k6 は TypeScript をそのまま読む |
| TestRun `<release>-ubichill-loadtest` | 利用者の負荷（`LT_SCENARIO=users`）。runner は `parallelism` 個で、部屋を runner ごとに分けて持つ |
| TestRun `<release>-ubichill-loadtest-browser` | `browser.enabled` のときだけ。画面の体験の確認（`LT_SCENARIO=browser`、Chromium、runner 1 つ） |

## script（`scripts/`）

| ファイル | 役割 | k6 への依存 |
|---|---|---|
| `main.ts` | 入口。options・setup（backend とワールドの確認）・`users`・`browserJourney` | あり |
| `config.ts` | env（`LT_*`）→ 設定、検査（本番を向いた値を断る）、k6 の options | なし |
| `plan.ts` | runner の番号（`--execution-segment`）・利用者 → 部屋・役割・アカウント・部屋の印 | なし |
| `protocol.ts` | フレーム・応答の分類・再試行の判断・遅延・URL・Cookie・API の応答の読み取り | なし |
| `api.ts` | backend の API（ログイン・登録・インスタンス・参加情報） | `k6/http` |
| `session.ts` | 1 人の WebSocket（入室・カーソル・`entity:patch`・`state:update`・退室） | `k6/websockets`・`k6/timers` |
| `users.ts` | 1 人の利用者の流れ | `k6/execution` |
| `browser.ts` | 画面の通し | `k6/browser` |
| `metrics.ts` | custom 指標 | `k6/metrics` |

k6 に依存しない部分は vitest で確かめる（`*.test.ts`。`mise exec -- pnpm test` に含まれる）。型は `@types/k6`（`mise exec -- pnpm --filter @ubichill/loadtest typecheck`）。

```sh
mise exec -- pnpm exec vitest run charts/ubichill-loadtest
mise exec -- pnpm --filter @ubichill/loadtest typecheck
helm lint charts/ubichill-loadtest --set testid=ci
mise exec -- pnpm check:loadtest-chart          # 本番を向いた値で描画が落ちること・対象の URL
docker run --rm -v "$PWD/charts/ubichill-loadtest/scripts:/s:ro" -w /s grafana/k6:2.3.0 inspect -e LT_TESTID=x main.ts
```

ローカルの backend・Go に向けて通すこともできる（Docker の k6 から手元のポートへは `--network host` か `host.docker.internal`）。

```sh
docker run --rm --network host -v "$PWD/charts/ubichill-loadtest/scripts:/s:ro" -w /s \
  -e LT_TESTID=local -e LT_ORIGIN=http://localhost:3000 -e LT_API_BASE=http://localhost:3001 \
  -e LT_ROOMS=2 -e LT_USERS_PER_ROOM=4 -e LT_RAMP_SECONDS=4 -e LT_HOLD_SECONDS=15 \
  grafana/k6:2.3.0 run main.ts
```

backend は `SKIP_EMAIL_VERIFICATION=true`・`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`・`INSTANCE_CREATE_LIMIT_PER_HOUR`（部屋の数より大きく）で起動しておく。画面の通しは `LT_SCENARIO=browser` と `grafana/k6:2.3.0-with-browser`。

## values

| キー | 既定 | 意味 |
|---|---|---|
| `testid` | （必須） | 走りの名前。全指標の `testid` タグ |
| `target.release` | `ubichill-dev` | 対象の ubichill の release（Service 名の元）。`ubichill` は描画で失敗する |
| `target.origin` | `https://dev.ubichill.com` | 画面のオリジン（Origin ヘッダー・ブラウザの開き先・参加情報の相対 URL の基準） |
| `target.via` | `cluster` | `cluster`: backend と Go の Service へ直接。`public`: origin のまま Cloudflare を通す |
| `target.backendUrl` / `instanceUrl` | `http://<release>-backend:3001` / `http://<release>-instance:3002` | `via=cluster` のときの向け先 |
| `target.worldId` | `default` | 入るワールド（1 部屋の人数は `capacity.max` まで。同梱のワールドは 20） |
| `scenario.rooms` / `usersPerRoom` | 10 / 10 | 部屋の数（`parallelism` で割り切れること）と 1 部屋の人数 |
| `scenario.maxUsersPerRoom` | `usersPerRoom` | インスタンスの定員（`settings.maxUsers`） |
| `scenario.cursorHz` / `activeRatio` | 20 / 0.3 | カーソルの頻度と、送る利用者の割合 |
| `scenario.patchIntervalSeconds` | 5 | `entity:patch`（1 人目）・`state:update`（1・2 人目）の間隔。0 で送らない |
| `scenario.cursorBatch` | false | `world:join` で `features: ["cursors:batch"]` を宣言し、`cursors:moved` を受ける |
| `scenario.rampSeconds` / `holdSeconds` | 60 / 300 | 利用者を増やし切るまでの時間と、そのあと保つ時間 |
| `accounts.offset` / `password` | 0 / `loadtest-dev-password` | アカウント `loadtest_<offset + n>` の番号の起点と共通のパスワード |
| `parallelism` | 1 | runner の数 |
| `runner.image` | `grafana/k6:2.3.0` | |
| `runner.resources` | requests 500m/512Mi、limits 2/2Gi | |
| `runner.nodeSelector` | `ubichill.com/loadgen: "true"` | 攻撃対象と別のノードに載せる |
| `runner.tolerations` / `affinity` | 空 | |
| `browser.enabled` | false | 画面の体験の確認の TestRun を足す |
| `browser.image` | `grafana/k6:2.3.0-with-browser` | |
| `browser.vus` / `pauseSeconds` | 1 / 30 | 画面を通す人数と、1 回ごとの休み |
| `browser.startSeconds` / `durationSeconds` | `rampSeconds` / `holdSeconds` | 始める時刻と長さ |
| `browser.resources` / `nodeSelector` | requests 1/1Gi、limits 2/2Gi / `runner.nodeSelector` | |
| `output.prometheus.enabled` | true | `--out experimental-prometheus-rw` |
| `output.prometheus.serverUrl` | `http://prometheus-operated.monitoring.svc:9090/api/v1/write` | |
| `output.prometheus.trendStats` | `p(50),p(95),p(99),max` | Trend を出す統計 |
| `output.prometheus.nativeHistogram` | false | Trend を native histogram（`k6_<name>_seconds`）で送る |
| `output.prometheus.pushInterval` | `5s` | |
| `testRun.cleanup` | 空 | `post` なら終わったときに TestRun ごと消す |
