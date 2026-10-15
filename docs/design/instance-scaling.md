# インスタンスと backend の水平スケール（Photon 型・Redis・KEDA）

対象ブランチ: `docs/db-redesign`（[db-redesign.md](./db-redesign.md) と同じ PR）。実装は「PR の分け方」ごとに分ける。

## 方針

- 1 つの部屋（インスタンス）の状態と WebSocket 接続は、**同じ Go Pod** が持つ。1 Pod は複数の部屋を担当できる。
- 部屋の中の操作と配信は、今の Go の `Room` の中で完結させる。Redis Pub/Sub は通さない。
- Redis は、部屋 ID → 担当 Pod の Directory、Pod の生存、owner のリースと世代（fencing）、在席、backend の共有状態に使う。
- KEDA は Pod 数の調整だけを担う。部屋の配置・WebSocket の振り分け・障害からの復旧は Ubichill が実装する。
- 最初は `minReplicaCount: 1` とし、自動の scale-out だけを有効にする。自動の scale-in は、安全な drain ができるまで無効にする。
- 単体モード（`--guests`・テスト・Redis なし）は、メモリ実装で今のまま動かす。

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
- Router は Upgrade の時点で 1 回だけ Directory を引く。owner が交代したら旧 owner が接続を閉じ、クライアントは新しいチケットで繋ぎ直す（今の `ticket_invalid` / `instance_unavailable` からの復旧の経路をそのまま使う）。
- TLS は今のまま Ingress で終端する。Pod 間は内部ネットワークの平文の WebSocket。

## Redis Directory

| キー | 内容 | TTL |
|---|---|---|
| `ubi:cluster:gen` | クラスタの世代 ID（最初の Pod が `SET NX` で置くランダムな値） | なし |
| `ubi:node:<nodeId>` | `{addr, startedAt, state: ready/draining, rooms, connections, capacity}` | 15 秒（5 秒ごとに更新） |
| `ubi:room:<roomId>` | `{node, epoch, token}`（owner のリース） | 15 秒（owner が 5 秒ごとに延長） |
| `ubi:room:epoch:<roomId>` | owner の世代。交代のたびに INCR | なし（部屋を消すとき DEL） |
| `ubi:presence:<roomId>` | `{members, emptySince}`（表示用の近似値） | 15 秒 |
| `ubi:absent:<roomId>` | owner が見つからなくなった最初の時刻（reaper の復旧猶予） | なし（部屋が見つかったら DEL） |
| `ubi:rooms` | 部屋 ID の集合（期限切れの参照は reaper が掃除する） | なし |

- `nodeId` は Pod 名に起動ごとの乱数を足したもの（再起動した Pod を別のノードとして扱う）。
- 在席は表示用の近似値。入室の許可と定員の最終判定は owner が行う。

### owner のリースと世代（fencing）

- **割り当て**（Lua で原子的に行う）: `ubi:room:<roomId>` が無ければ、`epoch = INCR ubi:room:epoch:<roomId>` と新しい `token`（乱数）で `ubi:room:<roomId>` を `PX` 付きで作り、`{node, epoch, token}` を返す。あれば今の値を返す。同時に作られても owner は 1 つになる。
- **更新・解放**（Lua）: `token` が一致するときだけ TTL を延ばす・消す。
- **世代**: owner が交代するたびに epoch が増える。比べるときは `(cluster gen, epoch)` の組で比べる。
  - チケットに `(gen, epoch)` を入れ、owner は自分の世代と一致しないチケットを拒否する。
  - backend から owner への管理 API（作成・チケット発行・終了）も `(gen, epoch)` を付け、一致しなければ 409 を返す。
- **旧 owner の自己停止**: owner は、最後に更新が成功した**要求を送った時刻**から `TTL − 余裕`（例: 15 秒 − 5 秒）を過ぎたら、その部屋の状態変更と入室を止め、接続を閉じる。時刻は monotonic clock で測る。基準を応答を受けた時刻にすると、Redis の応答が遅れたときに、旧 owner と新 owner が同時に動く隙間ができる。
- **副作用のある処理**（部屋の終了・エンティティの永続化など、外に影響するもの）は、実行の直前に「自分のリースがまだ有効か」を確かめる。
- **Redis が全部消えたとき**: `ubi:cluster:gen` が消えるか変わる。各 Pod は heartbeat で変化を見つけたら、持っている部屋をすべて捨てて接続を閉じる。新しい gen で部屋を割り当て直す。世代を Postgres に持つ必要はない（部屋はもともと一時的なもの）。

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

- 実行は Redis のリース `ubi:lease:reaper`（`token` 付き、Lua で更新・解放）を取った backend 1 台だけ。
- 作成時刻は DB の `created_at`（timestamptz）。`markCreated` のプロセス内の記録をやめる。
- 復旧の猶予の起点（今の `absentSince`）は `ubi:absent:<roomId>` に置く。リースが別の backend に移っても、猶予が延びたり縮んだりしない。
- 削除の直前に、owner の管理 API の `close(emptyBefore, gen, epoch)` を呼ぶ。owner が「今も空で、emptyBefore より前から空」かつ世代が一致するときだけ閉じる（今の `instanceRuntime.close()` の原子的な判定を owner 側で保つ）。owner がいない部屋は、`ubi:absent` からの猶予が過ぎていれば DB から消す。

## KEDA

- Go Pod は `active_rooms`・`websocket_connections`・`room_capacity_available`・`draining`・CPU・メモリを Prometheus 形式で出す。
- 集約した指標（例: `ubichill_instance_scaling_pressure`。recording rule で作る）を、KEDA の Prometheus scaler に渡す。指標と閾値は負荷試験で決める。
- 新しい Pod は ready になってから割り当ての候補になる。既存の部屋は自動では移さない。
- **自動の scale-in は最初は無効**（`scaleDown.selectPolicy: Disabled`）。HPA は、どの Pod を消すかを部屋の有無で選べないため。
- 手動で縮めるときは、対象の Pod を `draining` にして新しい部屋の割り当てを止め、部屋が空になってから終了させる。
- SIGTERM を受けたら readiness を false にし、`terminationGracePeriodSeconds` の範囲で接続を閉じて、クライアントを繋ぎ直させる。
- **自動の scale-in（K2）の候補**: 各 Pod が自分の部屋数・接続数を `controller.kubernetes.io/pod-deletion-cost` の注釈に書けば、ReplicaSet は空いている Pod を優先して消す（ベストエフォート）。drain と組み合わせれば、配置コントローラを作らずに済む可能性がある。注釈を書くには、Pod の ServiceAccount に自分の Pod を patch する RBAC が要る。
- 前提: 本番（home-manifests）には Prometheus（`apps/prometheus`）はあるが、**KEDA は無い**。K1 は home-manifests に KEDA の Application を足すところから始める。

```yaml
# 概念の例（そのままは使えない。指標は未実装）
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ubichill-instance
spec:
  scaleTargetRef:
    name: ubichill-instance
  minReplicaCount: 1
  maxReplicaCount: 10
  pollingInterval: 30
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          selectPolicy: Disabled
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus-operated.monitoring.svc:9090
        query: ubichill_instance_scaling_pressure
        threshold: "1"
```

## backend の複数レプリカ

| 対象 | 対応 |
|---|---|
| HTTP のレート制限 | `rate-limit-redis` の store |
| better-auth のレート制限 | better-auth の `secondaryStorage` に Redis |
| 登録の仮データ | Postgres の `pending_registrations`（[db-redesign.md](./db-redesign.md)） |
| reaper | Redis のリース、DB の `created_at`、共有の `ubi:absent`。削除の前に owner の世代と在席を確かめる |
| CLI 承認・仮登録の期限切れの掃除 | reaper と同じリースの下で実行する |
| ワールドの並び順（`reorderWorlds`） | Postgres で共有する |
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
- 自動の scale-in が無効で、手動の drain が安全に終わる。
- 配信遅延の p95・p99、CPU、メモリ、接続数、部屋の配置の偏りを測る。

## PR の分け方

| PR | 内容 | 前提 |
|---|---|---|
| R1 | Redis の接続・chart・共有のチケット Secret・メモリ実装 | なし |
| R2 | backend のレート制限・reaper（リースと共有の猶予）・キャッシュ共有、`replicas: 2` | R1、DB 側の時刻の型・仮登録 |
| G1 | Go の Directory、heartbeat、原子的な割り当て、リースと世代（fencing）、自己停止 | R1 |
| G2 | WS Router（Go Pod のプロキシ）、チケットの世代の検証、2 Pod での部屋単位の分散 | G1 |
| G3 | owner の障害時の割り当て直し、在席と reaper の整合、障害テスト | G2 |
| K1 | Prometheus の指標、KEDA の scale-out、自動の scale-in は無効 | G3、クラスタの Prometheus・KEDA |
| K2 | 安全な自動の scale-in（`pod-deletion-cost` と drain、足りなければ配置コントローラ） | K1 |
| K3 | 1 部屋の接続の限界に当たったときだけ、edge/owner の分離を検討 | 負荷試験 |

## 未決

1. WS Router を Go の Pod に兼ねさせ続けるか、別の Deployment に分けるか（G2 の負荷試験で決める）。
2. Pod の容量の指標と KEDA の閾値、1 部屋の最大人数、許せる遅延。
3. Redis を Helm の subchart で持つか、外部の Redis にするか。
4. 自動の scale-in の方式（`pod-deletion-cost` で足りるか）。決まるまでは scale-out だけを自動にする。
5. KEDA を home-manifests にどう入れるか（Helm の Application、namespace、CRD の扱い）。
