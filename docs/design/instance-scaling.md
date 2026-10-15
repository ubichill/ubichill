# インスタンスと backend の水平スケール（Redis）

対象ブランチ: `docs/db-redesign`（[db-redesign.md](./db-redesign.md) と同じ PR）。実装は「進め方」の PR ごとに分ける。

## 決めたこと

- Go のインスタンスを複数 Pod にする。WebSocket の配信は **Redis Pub/Sub** で Pod 間に広げる。
- backend も複数レプリカにする。プロセス内に持っている「全体で 1 つであるべき状態」を Redis に移す。
- DB（Postgres）の作業とは分ける。依存は「backend を 2 つ以上にする前に、DB 側の 1（時刻の型）と 2（仮登録）を終える」だけ。

## 前提：何を速くし、何を諦めるか

- インスタンスは永久ではない。部屋の中身は失ってよい（今も再起動で消え、再接続でスナップショットから戻る）。
- 速度を重視する。ただし、**Pub/Sub は 1 Pod で完結する今より速くはならない。** 別の Pod にいる人どうしのやり取りは、Redis を 2 回通る（送り手の Pod → Redis → 部屋の持ち主 → Redis → 受け手の Pod）。クラスタ内なら 1 回あたり 1ms 未満の見込みだが、ゼロではない。
- Pub/Sub で得られるのは次の 3 つで、速さではない。
  - 1 つの部屋の接続を複数 Pod に分けられる（1 Pod の接続数の上限が部屋の上限にならない）
  - 接続先の Pod を決め打ちしなくてよい（Ingress の設定が今のまま）
  - Pod を入れ替えても、その Pod に繋いでいた人だけが繋ぎ直せば済む
- 速さを取り戻す工夫は 2 つ入れる（後述）。状態を持たない通知（カーソルなど）は持ち主を通さない。同じ Pod の中で済むときは Redis を通さない。

## Go：役割の分け方

```
client ──WS──▶ Ingress ──▶ どれかの Pod（受付 = edge）
                              │ 状態を変える要求 ──▶ 部屋の持ち主（owner）の Pod
                              │                       │ 適用して通知を publish（seq 付き）
                              ◀── room チャンネル ◀────┘
                              │ 自分に繋いでいる参加者へ配る
```

- **owner**: 部屋ごとに 1 つの Pod。エンティティ・メンバー・メディアのタイムラインを持ち、状態を変える要求を直列に適用する（今の `Room` そのもの）。
- **edge**: WebSocket を受けた Pod。チケットを確かめ、要求を owner へ送り、room チャンネルを購読して、自分に繋いでいる参加者へ配る。
- 同じ Pod が owner と edge を兼ねるのが普通の状態。1 Pod 構成では今と同じ動きになる。

### Redis のキーとチャンネル

| 名前 | 種類 | 中身 | 書く側 |
|---|---|---|---|
| `ubi:node:<node>` | キー（TTL 15 秒） | `{addr, rooms, connections}` | 各 Pod（5 秒ごと） |
| `ubi:room:<id>` | キー（TTL 15 秒） | owner の `<node>` | owner（`SET NX` で取り、5 秒ごとに延長） |
| `ubi:presence:<id>` | キー（TTL 15 秒） | `{memberIds, emptySince}` | owner（入退室のたびと 5 秒ごと） |
| `ubi:rooms` | 集合 | 部屋 ID | owner（部屋を消すとき SREM） |
| `ubi:ch:room:<id>` | チャンネル | 部屋への通知（seq 付き） | owner・edge（状態を持たない通知） |
| `ubi:ch:node:<node>` | チャンネル | その Pod 宛ての要求と応答 | owner・edge |

- `<node>` は Pod 名（Downward API）。
- edge は、自分に繋いでいる参加者がいる部屋のチャンネルだけを購読する。

### メッセージの流れ

| 種類 | 例 | 流れ |
|---|---|---|
| 入室 | `world:join` | edge がチケットを確かめる → owner へ送る → owner がメンバーに加え（edge と接続 ID を記録）、スナップショットを edge へ返す → `user:joined` を room チャンネルへ |
| 状態を変える | `entity:create/patch/delete`、`status:update`、`media:timeline:update` | edge → owner（`ubi:ch:node:<owner>`）→ owner が適用 → 応答を edge へ、通知を room チャンネルへ |
| 状態を持たない | `cursor:move`、`entity:ephemeral`、`media:sync` | edge が直接 room チャンネルへ publish（owner を通さない）。owner も購読していて、スナップショット用の最後の位置だけ更新する |
| 退室・切断 | `world:leave`、接続断 | edge → owner。edge の Pod ごと落ちたときは、owner が `ubi:node:<edge>` の消失を見て、その edge のメンバーを外す |

- **同じ Pod の中では Redis を通さない。** edge と owner が同じなら関数呼び出しで済ませる。room チャンネルへの publish も、自分の Pod の参加者へはローカルで配り、Redis へは他の Pod のためだけに出す。
- **参加者を owner の Pod に寄せる（任意）。** チケットに owner の `<node>` を入れ、Ingress の `upstream-hash-by` で振り分ければ、ほとんどの通信が Pod 内で済む。外れても edge として動くので正しさは変わらない。最初は入れず、測ってから決める。

### 順序と取りこぼし

- Redis Pub/Sub は「届けば順番どおり、届かないこともある」（購読の接続が切れた間の通知は失われる）。
- owner は部屋ごとの連番 `seq` を状態の通知に付ける。edge は部屋ごとに最後の `seq` を覚え、飛びを見つけたらその部屋の参加者に再同期させる（スナップショットを取り直す）。
- 今のプロトコルも「自動の再送はせず、再接続のスナップショットで戻す」なので、意味は変わらない。
- 状態を持たない通知（カーソル）は `seq` を付けない。落ちても次の位置で上書きされる。

### owner が落ちたとき

- `ubi:room:<id>` の TTL が切れる。次の要求で edge（または backend）が別の Pod に owner を取らせ、ワールドの定義から部屋を作り直す。
- 部屋の中身は失われる（今と同じ）。あとで必要になれば、owner がエンティティを `ubi:state:<id>` に間引いて書き、新しい owner がそこから戻す形を足せる（「進め方」の G5）。

### チケットとセキュリティ

- 署名鍵は Secret（`INSTANCE_TICKET_KEY`）から全 Pod で同じものを読む。edge がどの Pod でも確かめられる。
- 入室時の表示名の固定・ユーザー情報の絞り込み・ロック数・部屋の容量（#242）は owner が引き続き行う。
- Redis への接続は内部ネットワークだけに閉じ、パスワードを付ける。Pub/Sub のメッセージは Pod どうしの信頼を前提にする（Redis に書ける者は部屋を書き換えられる）。

### backend との関係

- backend の `presence()` は `ubi:rooms` と `ubi:presence:*` を読む（各 Pod への問い合わせをやめる）。
- 部屋の作成・終了・チケット発行は、owner の Pod の管理 API へ送る。owner がいなければ `ubi:node:*` から部屋の少ない Pod を選んで作らせる。

## backend の複数レプリカ

いまプロセス内にあって、レプリカを増やすと壊れるもの。

| 対象 | 今 | 移す先 |
|---|---|---|
| HTTP のレート制限（express-rate-limit） | プロセスごとに数える（N 台で上限が N 倍） | `rate-limit-redis` の store |
| better-auth のレート制限 | プロセスごと | better-auth の `secondaryStorage` に Redis |
| 空インスタンスの掃除（reaper） | 全レプリカで走る。作成時刻をプロセス内に持つ | 作成時刻は DB の `created_at`（timestamptz）。実行は Redis のリース `SET ubi:lease:reaper <pod> NX PX 30000` を取った 1 台だけ |
| 期限切れの CLI 承認・仮登録の掃除 | 全レプリカで走る | 同じリース（重複しても害はないが無駄） |
| ワールドの並び順（`reorderWorlds`） | メモリ | DB（または Redis）。どのレプリカでも同じ順にする |
| ワールドの再読み込み・キャッシュ | 受けたレプリカだけが読み直す | Redis Pub/Sub の `ubi:ch:backend` で「この URL を捨てて」を全レプリカへ流す。公開・削除のときも同じ |
| 登録の仮データ | メモリ | Postgres（[db-redesign.md](./db-redesign.md) の 2） |

- 外部ワールドのキャッシュ（`remoteWorldCache` など）はレプリカごとでよい。取得が重複するだけで、TTL で揃う。
- 同梱のワールドのファイルは各レプリカのイメージに入っているので、そのままでよい。

## 単体モードとテスト

- Redis を使う部分は、すべてインタフェース（Go の `Directory` と `Bus`、backend の `Lease`・`RateLimitStore`・`InvalidationBus`）の後ろに置き、メモリ実装を持つ。
- 単体モード（`--guests`）・テスト・Redis なしの開発は、メモリ実装で 1 プロセスで動く。**edge と owner の分離は、メモリ実装でも同じコードを通す**（1 Pod でも Pub/Sub の経路を試せるように）。
- Redis 実装は、testcontainers か CI の Redis サービスで結合テストをする。2 Pod を立て、別の Pod に繋いだ 2 人が互いの操作を受け取れること、`seq` の飛びで再同期することを確かめる。

## 進め方（PR ごと）

| PR | 内容 | 前提 |
|---|---|---|
| R1 | Redis の接続（backend・Go）、chart、`INSTANCE_TICKET_KEY` の共有 | なし |
| R2 | backend：レート制限・better-auth・リース・並び順・無効化のバス。`replicas: 2` | R1、DB 側の 1・2 |
| G1 | Go：`Directory`（ノード・部屋の持ち主・在席）をメモリ実装で入れ、backend の在席を Directory から読む | R1 |
| G2 | Go：edge と owner の分離、`Bus` のメモリ実装、`seq` と再同期。動きは 1 Pod のまま | G1 |
| G3 | Go：`Directory` と `Bus` の Redis 実装、edge の Pod が落ちたときの掃除。`replicas: 2` で負荷試験 | G2 |
| G4 | （測ってから）owner の Pod への寄せ（チケットのヒント＋`upstream-hash-by`） | G3 |
| G5 | （必要なら）部屋の中身を Redis に間引いて書き、owner の交代で戻す | G3 |

## 未決

1. Redis を Bitnami の subchart で持つか、外部の Redis を必須にするか。失ってよい状態しか置かないので、永続化なしの subchart で足りる見込み。
2. 負荷試験の目標（1 部屋の最大人数、Pod 数、許せる遅延）。G3 の合格の基準にする。
3. edge と owner の間の要求を、Pub/Sub ではなく Pod どうしの直接の通信（内部の WebSocket や HTTP）にするか。Redis を 1 回減らせるが、Pod のアドレスの管理が要る。最初は Pub/Sub で揃える案。
