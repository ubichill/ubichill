# インスタンスと backend の水平スケール（Photon 型・Redis・KEDA）

対象ブランチ: `docs/db-redesign`（[db-redesign.md](./db-redesign.md) と同じ PR）。実装は「PR の分け方」ごとに分ける。

## 方針

- 1 つの部屋（インスタンス）の状態と WebSocket 接続は、**同じ Go Pod** が持つ。1 Pod は複数の部屋を担当できる。
- 部屋の中の操作と配信は、今の Go の `Room` の中で完結させる。Redis Pub/Sub は通さない。
- Redis は、部屋 ID → 担当 Pod の Directory、Pod の生存、owner のリースと世代（fencing）、在席、backend の共有状態に使う。
- KEDA は Pod 数の調整だけを担う。部屋の配置・WebSocket の振り分け・障害からの復旧は Ubichill が実装する。
- `minReplicaCount: 1`。自動の scale-in は K2 で有効にした（「自動の scale-in（K2）」）。消す Pod は `pod-deletion-cost` で選ばせ、消される Pod は部屋の owner を別の Pod へ引っ越してから止まる（クライアントは繋ぎ直さない）。
- 単体モード（`--guests`・テスト・Redis なし）は、メモリ実装で今のまま動かす。
- **部屋の割り当てを Redis で共有するのは `INSTANCE_DIRECTORY=redis`（chart の `instanceRuntime.directory`）を明示したときだけ。既定はメモリ**（G1）。1 Pod では共有する相手がおらず、Redis の可用性が部屋の可用性の上限になるだけなので、replicas を 2 以上にするときだけ redis にする。

### edge / owner + Pub/Sub 案をやめた理由

- 状態を変える RPC を Pub/Sub で送ると、「要求が消えた」と「処理後に応答だけ消えた」を区別できない。どちらもタイムアウトに見え、再送の可否を決められない。
- 部屋の中の通信が Pod をまたぎ、Redis を 2 回通る。速度を重視する前提に合わない。
- 1 部屋の接続数が 1 Pod の限界を超えたときだけ必要になる。負荷試験でその限界に当たったら K3 で検討する。

## 構成

```
Client ──HTTP──▶ backend（認証・入室判定・配置・チケット）──▶ PostgreSQL
                     │
                     ▼
               Redis（Directory・リース・世代・在席）
                     ▲
Client ──WS──▶ Ingress ──▶ WS Router ──(roomId の owner へ)──▶ Go Pod A（部屋 1, 2）
                                                              Go Pod B（部屋 3）
Prometheus ──▶ KEDA ──▶ HPA ──▶ Go Deployment
```

### WS Router

- Ingress や Service の通常の負荷分散、単純なコンシステントハッシュでは、動的に決まる owner と一致しない。KEDA で増減する Deployment は Pod 名が変わるので、Pod ごとの Service も作れない。
- **最初は Go の Pod 自身が Router を兼ねる。** 接続を受けた Pod は、`world:join` のチケットから roomId と epoch を読み、Directory の owner が自分なら処理し、違えば owner の内部アドレスへ WebSocket をプロキシする。新しい部品は要らない。
- 欠点: プロキシしている Pod を落とすと、その Pod 経由の接続も切れる（scale-in・drain の対象が増える）。G2 の負荷試験で問題になれば、同じバイナリを `--router` で動かす状態のない Deployment に分ける。Router は自由に増減でき、部屋を持たない。
- Router は Upgrade の時点で 1 回だけ Directory を引く。owner が交代したら旧 owner が接続を閉じ、クライアントは新しいチケットで繋ぎ直す（今の `ticket_invalid` / `instance_unavailable` からの復旧の経路をそのまま使う）。scale-in の引っ越し（K2）だけは、旧 owner が中継元に `relay:migrate` を送り、中継元が新しい owner へ繋ぎ直す（クライアントは繋ぎ直さない）。
- TLS は今のまま Ingress で終端する。Pod 間は内部ネットワークの平文の WebSocket。

## Redis Directory

| キー | 内容 | TTL |
|---|---|---|
| `ubi:cluster:gen` | クラスタの世代 ID（最初の Pod が `SET NX` で置くランダムな値） | なし |
| `ubi:node:<nodeId>` | `{addr, startedAt, state: ready/draining, rooms, connections, capacity}` | 15 秒（5 秒ごとに更新） |
| `ubi:room:<roomId>` | `{node, epoch, token}`（owner のリース） | 15 秒（owner が 5 秒ごとに延長） |
| `ubi:room:epoch:<roomId>` | owner の世代。交代のたびに INCR | 最後の延長から 25 時間（最長のチケット＝ゲストの 24 時間より長くし、作り直した部屋の epoch が巻き戻らないようにする。G1） |
| `ubi:presence:<roomId>` | `{members, emptySince}`（表示用の近似値） | 15 秒 |
| `ubi:absent:<roomId>` | owner が見つからなくなった最初の時刻（reaper の復旧猶予） | なし（部屋が見つかったら DEL） |
| `ubi:rooms` | 部屋 ID の集合（期限切れの参照は reaper が掃除する） | なし |

- `nodeId` は Pod 名に起動ごとの乱数を足したもの（再起動した Pod を別のノードとして扱う）。
- 部屋 ID が `epoch:` で始まるものは拒否する（`ubi:room:epoch:` のキーと衝突するため。G1）。
- 在席は表示用の近似値。入室の許可と定員の最終判定は owner が行う。

### owner のリースと世代（fencing）

- **割り当て**（Lua で原子的に行う）: `ubi:room:<roomId>` が無ければ、`epoch = INCR ubi:room:epoch:<roomId>` と新しい `token`（乱数）で `ubi:room:<roomId>` を `PX` 付きで作り、`{node, epoch, token}` を返す。あれば今の値を返す。同時に作られても owner は 1 つになる。
- **更新・解放**（Lua）: `token` が一致するときだけ TTL を延ばす・消す。
- **世代**: owner が交代するたびに epoch が増える。比べるときは `(cluster gen, epoch)` の組で比べる。
  - チケットに `(gen, epoch)` を入れ、owner は自分の世代と一致しないチケットを拒否する。
  - backend から owner への管理 API（作成・チケット発行・終了）も `(gen, epoch)` を付け、一致しなければ 409 を返す。
  - チケットの署名鍵は R1 から全 Pod・再起動をまたいで同じなので、世代を入れないと、同じ部屋 ID で作り直された部屋に前の部屋のチケットが通る（特に期限 24 時間のゲストのチケット）。ゲストの再接続（`resumeToken`）も、世代が違えば新しいゲスト ID を発行する。
- **旧 owner の自己停止**: owner は、最後に更新が成功した**要求を送った時刻**から `TTL − 余裕`（例: 15 秒 − 5 秒）を過ぎたら、その部屋の状態変更と入室を止め、接続を閉じる。時刻は monotonic clock で測る。基準を応答を受けた時刻にすると、Redis の応答が遅れたときに、旧 owner と新 owner が同時に動く隙間ができる。
- **副作用のある処理**（部屋の終了・エンティティの永続化など、外に影響するもの）は、実行の直前に「自分のリースがまだ有効か」を確かめる。
- **Redis が全部消えたとき**: `ubi:cluster:gen` が消えるか変わる。各 Pod は heartbeat で変化を見つけたら、持っている部屋をすべて捨てて接続を閉じる。新しい gen で部屋を割り当て直す。世代を Postgres に持つ必要はない（部屋はもともと一時的なもの）。

## Redis が使えないとき

Redis を設定した環境では、Redis が落ちても**プロセス内の状態（メモリのリースなど）に切り替えない**。切り替えると、各 Pod がそれぞれ持ち主になり、同じ部屋の owner や reaper が複数になる（R1 の `leaseFor` / `LeaseFor` がこれを固定している）。

| 機能 | Redis が落ちている間 | 戻ったとき |
|---|---|---|
| 部屋の割り当て（新しい部屋・owner が居ない部屋） | 新しい割り当てを止め、入室に `instance_unavailable` を返す | 割り当てを再開する |
| 既存の部屋の owner | リースを延長できず、自己停止の期限を過ぎたら状態変更と入室を止め、接続を閉じる | 新しい epoch で割り当て直す（部屋の中身は失われる） |
| 在席（`ubi:presence`） | backend の一覧は空・古いままになる（表示用の近似値） | 次の heartbeat で戻る |
| reaper | リースを取れないので掃除を止める（消し過ぎない側に倒す） | 掃除を再開する。`ubi:absent` が消えていれば猶予を数え直す |
| HTTP・better-auth のレート制限 | **fail-open**（制限せずに通す）。backend の可用性を優先し、警告を出す。**ログイン（`/sign-in/email`）だけは fail-closed（503）**（R2 で決定。総当たりの主な的で、既存のセッションは Redis に依存しない） | 共有の数え方に戻る |
| キャッシュの無効化 | 通知が届かない。各 backend のキャッシュは TTL で揃う | 再開する |

- 既存の部屋が「Redis が落ちたら止まる」のは、二重の owner を避けるための意図した振る舞い。Redis の可用性が部屋の可用性の上限になるので、Redis の再起動にかかる時間と自己停止の余裕（TTL − 余裕）を合わせて決める。
- better-auth のレート制限は `rateLimit.customStorage` で Redis に置く。`secondaryStorage` はセッションと検証値まで Redis に移すので使わない（R2）。

## 部屋の作成・入室

1. backend が PostgreSQL でインスタンスの設定と入室の可否を確かめる（今と同じ）。
2. Directory で owner を引く。いなければ、`ready` で `draining` でない Pod から、空き容量（接続数・部屋数）で選び、Lua で原子的に割り当てる。
3. owner の管理 API で部屋を作る（`(gen, epoch)` 付き）。失敗したら `token` を照合して割り当てを取り消し、別の Pod で再試行する。
4. backend が `roomId, gen, epoch, ユーザー, 表示名, 期限` を含むチケットを発行する。全 Pod は共有の鍵で確かめる（`INSTANCE_TICKET_KEY`、無ければ `INSTANCE_ADMIN_TOKEN` から HMAC で派生。R1 で実装）。
5. Router が owner へ接続をプロキシする。owner もチケットと `(gen, epoch)` を確かめる。
6. 入室後のエンティティ操作・カーソル・スナップショット・配信は、owner の Pod の中で処理する（今のまま）。
7. owner を失ったら、次の入室で割り当て直す。メモリ上の部屋の状態は失われる（今の再起動と同じ）。

- 状態を変える要求の再送はしない（今のプロトコルのまま）。owner の交代や切断で結果が分からなくなった要求は、再接続のスナップショットで確かめる。分散化しても、要求が Pod の間を渡らないので、新しい取りこぼしは生まれない。

## reaper（空インスタンスの掃除）

- 実行は Redis のリース `ubi:lease:reaper`（`token` 付き、Lua で更新・解放）を取った backend 1 台だけ。掃除中も TTL の 1/3 ごとに更新し、失効した処理はリースを取り直さず削除を止める。
- 作成時刻は DB の `created_at`（timestamptz）。`markCreated` のプロセス内の記録をやめる。
- 復旧の猶予の起点（今の `absentSince`）は `ubi:absent:<roomId>` に置く。リースが別の backend に移っても、猶予が延びたり縮んだりしない。
- 削除の直前に、owner の管理 API の `close(emptyBefore, gen, epoch)` を呼ぶ。owner が「今も空で、emptyBefore より前から空」かつ世代が一致するときだけ閉じる（今の `instanceRuntime.close()` の原子的な判定を owner 側で保つ）。owner がいない部屋は、`ubi:absent` からの猶予が過ぎていれば DB から消す。

## KEDA（K1）

使い方・本番で有効にする手順は [chart の README](../../charts/ubichill/README.md) の「Go インスタンスの自動スケール（KEDA）」。

- Go Pod は `GET /metrics` で `ubichill_instance_{active_rooms,room_capacity,room_capacity_available,websocket_connections,relay_connections,draining}` を Prometheus の text 形式で出す。CPU・メモリは cAdvisor のものを使う（Go からは出さない）。
  - **標準ライブラリだけで書く**。gauge 6 つでラベルも histogram も無く、text 形式は数行で書ける。`prometheus/client_golang` は `client_model`・`common`・`procfs`・`protobuf` などを引き込み、Go の依存（今は gorilla/websocket と go-redis だけ）が数倍になる。histogram（配信の遅延の p95・p99）が要るようになったら入れ直す。
  - **認証は付けない**。Ingress は `/realtime/v1/ws` だけを Go へ送るので、管理 API と同じくクラスタの外には出ない。中身は数だけ（部屋 ID・利用者 ID・ラベルを出さない）。管理トークンで守ると Prometheus にそのトークンを渡すことになり、漏れたときの被害の方が大きい。
  - `websocket_connections` は heartbeat の `connections` と同じ数え方（部屋の参加者＋他の Pod へ中継している接続）。中継された接続は中継する Pod と owner の Pod の両方で数える。どちらも WebSocket を持つので負荷としては正しい。
  - `room_capacity_available` は draining の間 0 にする（合計して受けられる部屋の数を多く見積もらない）。
- chart は `ServiceMonitor`（`instanceRuntime.metrics.serviceMonitor.enabled`）と `ScaledObject`（`instanceRuntime.autoscaling.enabled`）を値で作る。どちらも既定は無効（CRD の無いクラスタで描画・適用が落ちない）。`ScaledObject` は `directory: redis` でないと描画で失敗する。
- **集約の指標（`ubichill_instance_scaling_pressure`・recording rule）は作らない**。trigger を接続数・部屋数・CPU の 3 つにし、HPA に最大を取らせる（HPA は trigger ごとに台数を出して大きい方を取る）。
  - recording rule は評価の間隔ぶん遅れ、`PrometheusRule` の CRD と Prometheus の `ruleSelector` にも依存する。rule が読み込まれないと KEDA は空の結果を受け、既定（`ignoreNullValues: true`）では 0 として scale-out しないまま気付けない。
  - 閾値の単位が「1 Pod に持たせたい接続数」「1 Pod に持たせたい部屋数」のまま残る。`AverageValue` なので台数は `ceil(合計 / 閾値)`。
  - 指標が無いときは `ignoreNullValues: "false"` で ScaledObject の失敗として出し、台数を変えない。
  - 部屋数の閾値は `maxRooms` 未満にする（上限に達した Pod は新しい部屋を 503 で断るので、その手前で増やす）。
  - 接続 200・部屋 800・CPU 600m。接続は負荷試験（#271）で決めた: CPU 上限 1 コア、1 部屋 10 人・カーソル 20Hz・3 割が操作で、1 Pod の `websocket_connections` が約 225 のとき CPU 約 640m・p95 約 30ms、約 375 で p95 が 300ms を超えた。
  - CPU の trigger は大人数の部屋のため（配信は人数の 2 乗で増え、接続数では測れない）。cAdvisor / metrics-server の値を `AverageValue` で使う（requests が 100m なので割合では使わない）。
- 新しい Pod は ready になってから割り当ての候補になる。既存の部屋は自動では移さない（backend は接続数の少ない Pod を選ぶので、新しい部屋は増えた Pod に置かれる）。
- 有効にすると Deployment に `replicas` を書かない（Argo CD の同期のたびに HPA の台数へ戻さない）。

## 自動の scale-in（K2）

WebSocket の接続先の Pod と部屋の owner の Pod は分かれている（WS Router）。なので owner だけを動かせば、クライアントの接続は切らずに済む。

### 消す Pod の選び方

- 各 Pod が自分の Pod に `controller.kubernetes.io/pod-deletion-cost` を書く（値 = 直接繋いでいるクライアント数 + 自分が owner の部屋の参加者数）。ReplicaSet は小さい Pod から消す（ベストエフォート）。
- 変わったときだけ、最短 30 秒おきに書く（API サーバーへの負荷と、注釈の書き換えのたびに起きる Pod の更新イベントを抑える）。
- client-go は入れない。in-cluster の ServiceAccount のトークン（書くたびに読み直す。projected のトークンは入れ替わる）と CA で `PATCH /api/v1/namespaces/{ns}/pods/{name}`（merge patch）を送る。使うのは 1 つの PATCH だけで、client-go は依存を数十倍にする。
- 書けなくても動作は続ける（消す Pod の選び方が ReplicaSet の既定に戻るだけ）。警告は 10 分に 1 回。
- RBAC は自動スケールが有効なときだけ作る（ServiceAccount・Role は pods の get/patch・RoleBinding）。Pod 名は起動ごとに変わるので `resourceNames` で絞れず、namespace の中の Pod を patch できる。注釈以外も書ける権限なので、namespace を Go 専用にするのが望ましい（未決）。

### 消される Pod（SIGTERM）

1. draining。新しい部屋は断る（今まで通り）。中継しかしていない Pod も draining のまま。
2. 空になった部屋は今まで通り閉じる。作られてから `--migrate-after`（既定 3h）未満の部屋は待つ（新しい部屋は来ないので、いつかは空になるか 3h に達する）。3h を過ぎて参加者の居る部屋は引っ越す。
3. 部屋が無くなっても、直接繋いでいるクライアント（今は中継しているだけ）が居る間は止まらない。上限は `--drain-timeout`（chart の既定 24h。1 日続く部屋があるため）。`terminationGracePeriodSeconds` は drainTimeout + 30 秒を chart が決める。
4. 上限の `--disconnect-notice`（既定 10m）前に、直接繋いでいるクライアントへ `{"event":"server:notice","data":{"kind":"disconnect","at":<epoch ms>}}` を送る（フロントの表示は別の PR）。

KEDA の接続数・部屋数の query は draining の Pod を除く（`sum(X{sel} unless on(pod) (ubichill_instance_draining{sel} == 1))`）。除かないと、止めている Pod に最長 24h 残る接続が残りの Pod の平均に足され、縮めた直後に増やし直す。CPU の trigger は除けない（止めている Pod は中継だけなので CPU は小さいと見込む）。

### owner の引っ越し（handoff）

1. **凍結**: 元の Pod は部屋の状態を変えない。変更系の要求は `{"success":false,"code":"migrating"}`（再試行できる）、応答の要らないもの（カーソル・ephemeral・ID の無い patch）は捨てる。入室は `instance_unavailable`。凍結より前に応答した変更はすべて写しに入る（変更と応答は部屋のロックの中で行う）。退出は接続を外すだけにし、猶予は先が数える。
2. **準備**: 先の Pod（Directory の ready・自分以外・空きあり・接続の少ない順。3 つまで試す）の `POST /realtime/v1/instances/{id}/handoff`（管理トークン、宛先のノード ID を照合）に、エンティティと順序・共有状態（値・revision・updatedAt・updatedBy）・参加者のプロフィール・定義・作った時刻を渡す。先は部屋を作って持っておき、新しい token を返す。まだ owner ではない。
3. **付け替え**: `Transfer(room, fromToken, toNode, toToken, gen, ttl)`（Lua で原子的に。fromToken が一致すれば node と token を替え、epoch+1。epoch のキーが消えていても今の epoch より小さくしない）。owner の居ない隙間は無い（backend が初期状態で作り直す隙が無い）。
4. **確定**: 先は Directory で自分に付け替わっていることを確かめ、**自分で延長してから** owner になる（自己停止の期限は先の時計で、延長を送った時刻から数える。付け替えは元の Pod の時計なので使わない）。
5. **接続の切り替え**: 元の Pod は部屋を閉じ（参加者を外す。接続は閉じない）、中継されてきた接続には `relay:migrate`（新しい owner の node・addr・gen・epoch）を送る。中継元の `pump` はそれを飲み込み、新しい owner に繋ぎ直し、チケットを (gen, epoch) で署名し直して `world:join` を送り、その応答を飲み込む。間にクライアントから来たフレームは 64 件まで持っておき順に送る（溢れたら切る）。元の Pod に直接繋いでいるクライアントは、元の Pod 自身が同じ仕組みで中継に変わる。
6. 新しい owner は移ってきた参加者を「切断の猶予中」で持ち（`max(grace, 30s)`）、繋ぎ直しの `world:join` では `user:joined` を出さず、移ってきたプロフィール（最新の位置）を使う。`users:update`・`world:snapshot` は送り直す（フロントは置き換える。`useWorld`・`useSocket`）。

#### 失敗したとき

| 起きたこと | 扱い |
|---|---|
| 先が見つからない・準備に失敗した | 凍結を解く。30 秒後に試し直す |
| 準備に handoffTimeout の半分以上かかった | 先に取りやめを送り、次の候補へ（先が準備を捨てる頃に付け替えない） |
| 付け替えが token 不一致（リースを失っていた） | 先に取りやめを送り、部屋を手放す（今の fencing と同じ） |
| 付け替えの応答が消えた | Directory を引いて確かめる。分からなければ部屋を手放して接続を閉じる（クライアントは繋ぎ直す）。付け替わっていれば、先が準備の期限に自分で引き取る |
| 確定が届かない（先が応答しない） | 元の Pod は付け替え済みとして進める。先は準備の期限（10 秒）に Directory を引き、自分に付け替わっていれば引き取る。Directory に届かない間はリースの TTL まで試し直す |
| 確定を断られた（先が準備を捨てていた） | 先の token で元の Pod に付け替え直し（epoch+1）、凍結を解く |
| 付け替えから確定までの間に、backend の作成・終了が先に届いた | 先は準備を引き取ってから処理する（割り当て直して初期状態で作り直さない・中身を確かめずに retire しない） |
| 中継元が繋ぎ直せない（先が入室を断った・溢れた） | そのクライアントだけ切る。いつものチケットの取り直しで戻る |
| 元の owner に付け替えのあとで変更が届いた | `migrating` で断る（元の部屋は閉じたまま凍結） |

- 旧版の中継元は `relay:migrate` を知らず、クライアントにそのまま送ってしまう。owner が引っ越すのは draining のとき（この版以降の Pod）で、中継元が旧版なのはこの版への最初の RollingUpdate の間だけ（そのときに draining になるのは旧版の Pod で、引っ越さない）なので、実害は無い。
- KEDA は home-manifests の `argocd-apps/keda.yaml`（公式の Helm chart、namespace `keda`、版は固定）で入れる。CRD は chart の templates に入っていて、`ScaledJob` の CRD が約 650KB あり client-side apply の `last-applied-configuration` の上限（256KB）を超えるので `ServerSideApply=true` にする。KEDA が自分で書き込む `APIService` と `ValidatingWebhookConfiguration` の `caBundle` は `ignoreDifferences` に入れる。

## backend の複数レプリカ

| 対象 | 対応 |
|---|---|
| HTTP のレート制限 | `rate-limit-redis` の store |
| better-auth のレート制限 | `rateLimit.customStorage` に Redis（セッション・検証値は Postgres のまま） |
| 登録の仮データ | Postgres の `pending_registrations`（[db-redesign.md](./db-redesign.md)） |
| reaper | Redis のリース、DB の `created_at`、共有の `ubi:absent`。削除の前に owner の世代と在席を確かめる |
| CLI 承認・仮登録の期限切れの掃除 | reaper と同じリースの下で実行する |
| ワールドの並び順（`reorderWorlds`） | Postgres で共有する（R2 ではメモリのまま。複数台で揃わないので DB 側の作業で移す） |
| キャッシュの無効化・ワールドの再読み込み | backend 専用の Redis Pub/Sub。通知が落ちても TTL で揃う |

backend を 2 台以上にする前に、DB 側の「時刻の型」と「仮登録」を終える。

## テスト

- 1 Pod で今と同じように動く（既存のテストがそのまま通る）。
- 2 Pod で別々の部屋を担当し、同じ部屋の接続が必ず同じ Pod に集まる。
- 同時に部屋を作っても、同時に入室しても、owner が重複しない。
- owner を止めて再起動したあと、古いチケットと古い epoch が拒否され、繋ぎ直せる。
- Redis の切断・TTL の期限切れ・旧 owner の復帰で、二重の書き込みが起きない。自己停止が新 owner の取得より先に起きる。
- Redis を消したあと、gen が変わって全 Pod が部屋を捨て、割り当て直せる。
- reaper のリースが別の backend に移っても、復旧の猶予が変わらない。
- KEDA で scale-out したあと、新しい部屋が新しい Pod に置かれる。
- 引っ越しの前後でエンティティ（順序）・共有状態（revision・updatedAt）が保たれ、中継中のクライアントも直接繋いでいたクライアントも切れず、入退室が出ない。凍結中の変更は再試行エラー、元の owner は付け替え後に変更を受けない。
- 確定しなかった準備は捨てられ、付け替えだけ済んだ準備は先が引き取る。3h 未満の部屋は移さない。上限の前に `server:notice` が届く。
- Directory の `Transfer` の契約（token 不一致・期限切れ・世代違い・同時の付け替え）。
- 配信遅延の p95・p99、CPU、メモリ、接続数、部屋の配置の偏りを測る。

## PR の分け方

| PR | 内容 | 前提 |
|---|---|---|
| R1 | Redis の接続・chart・共有のチケット Secret・メモリ実装 | なし |
| R2 | backend のレート制限・reaper（リースと共有の猶予）・キャッシュ共有、`replicas: 2` | R1、DB 側の時刻の型・仮登録 |
| G1 | Go の Directory、heartbeat、原子的な割り当て、リースと世代（fencing）、自己停止 | R1 |
| G2 | WS Router（Go Pod のプロキシ）、チケットの世代の検証、2 Pod での部屋単位の分散 | G1 |
| G3 | owner の障害時の割り当て直し、在席と reaper の整合、障害テスト | G2、R2 |
| K1 | Prometheus の指標、KEDA の scale-out、自動の scale-in は無効 | G3、クラスタの Prometheus・KEDA |
| K2 | 自動の scale-in（`pod-deletion-cost`・owner の引っ越し・直接の接続の中継を drainTimeout まで続ける） | K1 |
| K3 | 1 部屋の接続の限界に当たったときだけ、edge/owner の分離を検討 | 負荷試験 |

## 未決

1. WS Router を Go の Pod に兼ねさせ続けるか、別の Deployment に分けるか（G2 の負荷試験で決める）。
2. ~~KEDA の閾値~~ #271 の負荷試験で決めた（「KEDA（K1）」）。1 部屋の最大人数と、大人数の部屋の配信（カーソルをまとめて送るか）は未決。
3. Redis を Helm の subchart で持つか、外部の Redis にするか。
4. ~~自動の scale-in の方式~~ K2 で `pod-deletion-cost` と owner の引っ越しにした。残り: Role が namespace の Pod を patch できる（Go 専用の namespace にするか）、フロントの `migrating` の再試行と `server:notice` の表示、止めている Pod の CPU が KEDA の CPU の trigger に入ること。
5. ~~KEDA を home-manifests にどう入れるか~~ K1 で決めた（「KEDA（K1）」）。


## 本番に有効化する条件

- R2 は backend が 1 台でも、`REDIS_URL` があれば共有のレート制限・掃除・通知に Redis を使う。R2 の本番デプロイ前に、home-manifests で `redis.auth.existingSecret` と `existingSecretPasswordKey` を固定する。Argo CD の描画でパスワードを作り直させない。
- G3 は R2 と合わせ、reaper が観測した `(gen, epoch)` だけを閉じる。観測時に owner がいなければ、閉じる時点でも owner がいない場合だけ DB を削除する。
- 部屋の閉鎖は、Redis で token の照合・retired の設定・割り当てと在席の削除を原子的に行う。Redis に届かなければ成功を返さず、DB の行を残す。
- 本番データを検証環境へコピーしても、作者アカウントは `handle@domain` ごとに別のものとして扱う。別ドメインでの作者確認、鍵の取り消し、未署名ワールドの入室は検証用のアカウントと鍵で確かめる。
- K1 は KEDA を入れても、ubichill の Application では `directory: redis` → ServiceMonitor → ScaledObject の順に 1 つずつ有効にする（chart の README の「本番で有効にする手順」）。閾値を負荷試験で決めるまでは ScaledObject を有効にしない。
