# DB の再設計と、インスタンスの水平スケール

対象ブランチ: `docs/db-redesign`（この文書）。実装は「移行の順番」の PR ごとに分ける。

## 決めたこと

- 登録の仮データは Postgres に置く（メモリに置かない）。
- インスタンス（Go）を複数 Pod にするとき、部屋の置き場所と在席は **Redis** で共有する。
- 公開したワールドの版は、変更しない `world_versions` に分ける。
- 鍵は自サーバーの作者・他サーバーの作者で 1 つのテーブルにする。

## いまの問題

| 対象 | 問題 | 影響 |
|---|---|---|
| 登録の仮データ | backend のメモリにあり、パスワードを平文で持つ | レプリカが 2 つ以上だと登録と確認が別の Pod に当たって失敗する。再起動で登録途中のものが消える |
| Go インスタンス | 部屋をメモリに持ち `replicas: 1` 固定。backend は Service 1 つに問い合わせる | Pod を増やすと作成・入室・在席の問い合わせが別の Pod に当たり壊れる |
| チケットの署名鍵 | Go が起動ごとに乱数で作る | Pod 間でチケットを確かめられない。再起動でゲストの再接続情報が無効になる |
| reaper | 作成時刻をプロセス内（`markCreated`）に持つ | backend を増やすと、作った Pod 以外は DB の時刻に頼る |
| 時刻の列 | すべて `timestamp`（タイムゾーンなし） | postgres-js の解釈でずれる。reaper がプロセス内の時刻を使っているのはこのため |
| 鍵 | 自サーバーは `publishing_environments`（取り消しは列）、他サーバーは `author_bindings.keys`（jsonb の中） | 作者の鍵の確認が 2 通りに分かれる。取り消しの表現も違う |
| `users` | `username` が未使用、`image` と `profile_image_url` の二重、`handle` が NULL 可 | `handle ?? null` の分岐が散らばる |
| `worlds` | 内部 ID `name` と公開名 `world_name` の 2 つ。公開中の版と下書きを 1 行で上書き | 署名済みの内容が上書きされ、前の版が残らない |
| `instances` | `current_users` が書かれも読まれもしない。`has_password` は `password_hash` から決まる | 正と食い違う値が残る |

## 原則

- **DB に置くのは、長く残る事実と所有だけ。** アカウント、作者の鍵、自サーバーで公開したワールドの版、インスタンスの設定（誰が・どのワールドを・どの公開範囲で）。
- **生きている状態は DB に置かない。** 部屋の中身と在席は Go が正で、複数 Pod の間で共有するものだけを Redis に置く（失ってよい・TTL で消える）。
- 秘密はハッシュだけを保存する（パスワード・OTP・登録 ID・API トークン・デバイスコード）。
- 時刻はすべて `timestamptz`。
- 外部や公式のワールドは今まで通り DB に入れない（ワールド＝URL）。

## スキーマ案

### アカウント

```
users
  id                       text PK            -- better-auth（nanoid）
  email                    text UNIQUE NOT NULL
  email_verified           boolean NOT NULL
  handle                   varchar(30) UNIQUE NOT NULL   -- URL・署名用の ID。変更不可
  name                     text NOT NULL                 -- 表示名
  display_name_key         varchar(120) UNIQUE           -- 表示名の一意判定キー
  display_name_changed_at  timestamptz
  image                    varchar(1024)                 -- プロフィール画像（サーバーだけが書く）
  bio                      text
  password_change_required boolean NOT NULL DEFAULT false
  created_at, updated_at   timestamptz
```

- `username` を消す。
- 画像は better-auth の `image` に寄せ、`profile_image_url` を消す。HTTP の `/update-user` は #242 で塞いだので、`image` に書けるのはサーバーだけ。
- `handle` を NOT NULL にする。登録では必ず決めるが、既存の行に NULL がある可能性がある。移行の前に本番の件数を数え、残っていれば次回のログインで決めさせる画面を先に出す（未決 1）。
- `sessions`・`accounts`・`verifications` は better-auth のまま。時刻だけ `timestamptz` にする。
- `user_settings`・`user_friends`・`user_favorites` は今のまま（時刻の型だけ変える）。

### 登録の仮データ

```
pending_registrations
  id_hash        text PK          -- 申込者に返す registrationId の SHA-256
  email          text NOT NULL
  handle         varchar(30) NOT NULL
  display_name   text NOT NULL
  password_hash  text NOT NULL    -- 申し込みの時点で better-auth の hasher でハッシュする
  otp_hash       text NOT NULL
  failures       integer NOT NULL DEFAULT 0
  expires_at     timestamptz NOT NULL
  INDEX (email), INDEX (expires_at)
```

- 規則は #242 のメモリ版（`services/pendingRegistrations.ts`）と同じにする。ID で引く、同じアドレスは同時に 3 件まで、5 回間違えたら捨てる、再送信で失敗回数を戻さない。
- 失敗回数の加算と取り出しは 1 文で行う（`UPDATE ... RETURNING` / `DELETE ... RETURNING`）。同時に送られた確認で 2 回登録させない。
- 本登録は、ハッシュ済みのパスワードで `users` と `accounts` を 1 トランザクションで作る。`auth.api.signUpEmail` は平文しか受け取らないので、better-auth の内部 adapter を使う。
- 期限切れの行は reaper と同じ定期処理で消す。
- `handle` と表示名は仮登録の段階では押さえない（他人の名前を 10 分間取り置きできないように）。本登録の時点で一意制約に当たったら失敗させる。

### 作者の鍵

```
author_keys
  public_key      text PK
  account         text NOT NULL        -- handle@domain（自サーバーの作者も同じ形）
  origin          text NOT NULL        -- local / remote
  user_id         text NULL REFERENCES users ON DELETE CASCADE   -- local のときだけ
  kind            text NULL            -- browser / cli / ci（local のときだけ）
  name            text NULL
  api_token_hash  text UNIQUE NULL     -- local のときだけ
  created_at      timestamptz NOT NULL
  last_used_at    timestamptz
  fetched_at      timestamptz          -- remote のときだけ（WebFinger から取った時刻）
  revoked_at      timestamptz
  revoke_reason   text                 -- lost / compromised
  INDEX (account), INDEX (user_id)
  CHECK (origin = 'local') = (user_id IS NOT NULL)

remote_authors
  account       text PK
  display_name  text
  fetched_at    timestamptz NOT NULL

author_confirmed_contents   -- 今のまま
```

- 作者の鍵の確認（`isAuthorKey`）は `author_keys` を `account` で引くだけにする。local は即時、remote は `fetched_at` が古ければ WebFinger から取り直す。
- 取り消しは両方とも行の `revoked_at` で表す。lost は取り消し以前の署名を有効のまま、compromised はすべての署名を無効にする。この意味は今と同じ。
- `publishing_environments` と `author_bindings` を移して消す。

### ワールド（自サーバーで公開したものだけ）

```
worlds
  id                  varchar(21) PK
  author_id           text NOT NULL REFERENCES users ON DELETE CASCADE
  world_name          varchar(50) NOT NULL        -- 公開名。URL は /api/v1/authors/<handle>/worlds/<world_name>.yaml
  current_version_id  varchar(21) NULL REFERENCES world_versions   -- 未公開なら NULL
  created_at, updated_at  timestamptz
  UNIQUE (author_id, world_name)

world_versions                    -- 変更しない（INSERT のみ）
  id             varchar(21) PK
  world_id       varchar(21) NOT NULL REFERENCES worlds ON DELETE CASCADE
  version        varchar(50) NOT NULL    -- metadata.version
  definition     jsonb NOT NULL          -- 作者が送った生の値（署名の対象）
  lock           jsonb
  signature      jsonb
  content_hash   text NOT NULL           -- sha256(JCS({definition, lock}))
  published_at   timestamptz NOT NULL
  UNIQUE (world_id, version)

world_drafts                      -- 0..1 / world
  world_id    varchar(21) PK REFERENCES worlds ON DELETE CASCADE
  definition  jsonb NOT NULL
  lock        jsonb
  updated_at  timestamptz NOT NULL

world_name_aliases                -- 今のまま
```

- 内部の ID `worlds.name` を消す。API の `/api/v1/worlds/:worldId` は `worlds.id` で引く。
- 公開は「`world_versions` に 1 行足し、`current_version_id` を付け替え、下書きを消す」を 1 トランザクションで行う。
- **同じ `version` で内容が違う公開は拒否する**（`content_hash` が違えばエラー）。版の番号を上げずに中身だけ差し替えることはできない。
- 署名し直し（鍵の取り消しのあとなど）は、同じ版の `signature` だけを変えることになる。`world_versions` は変更しない方針なので、署名だけ別の行にするか、この列に限って更新を許すかを決める（未決 2）。
- 公開を取り消すときは `current_version_id` を NULL にする。過去の版は残す。お気に入りやインスタンスが古い版の `content_hash` を指していても解決できる。
- `MAX_WORLDS_PER_USER` に加えて、1 ワールドあたりの版の数にも上限を設ける（古い版から消す）。

### インスタンス

```
instances
  id            varchar(21) PK
  world_ref     text NOT NULL          -- 正規 URL（今のまま）
  content_hash  text NULL              -- 作成時に解決したワールドの版（署名済みのとき）
  leader_id     text NOT NULL REFERENCES users ON DELETE CASCADE
  access_type   instance_access_type NOT NULL
  access_tags   jsonb
  password_hash varchar(255)           -- has_password は password_hash IS NOT NULL で判定する
  max_users     integer NOT NULL
  created_at    timestamptz NOT NULL
  expires_at    timestamptz
```

- `current_users` と `has_password` を消す。
- どの Pod にあるか・誰がいるかは DB に置かない（次の節の Redis）。
- `content_hash` を持たせ、作成後にワールドが更新されても、そのインスタンスは作成時の版で動くようにする。
- reaper の作成時刻は `created_at`（timestamptz）を使い、`markCreated` のプロセス内の記録をやめる。

## インスタンスの水平スケール（Redis）

### 全体

```
client ──WS──▶ Ingress ──▶ instance Service（任意の Pod）
                                │ 自分が持ち主でなければ、持ち主の Pod へ WS を中継する
                                ▼
                         持ち主の Pod（部屋をメモリに持つ）
backend ──管理 API──▶ 持ち主の Pod（Redis で引いた内部アドレス）
Go の各 Pod ──▶ Redis：ノードの生存・部屋の持ち主・在席
```

### Redis のキー

| キー | 値 | 書く側 | TTL |
|---|---|---|---|
| `ubi:node:<node>` | `{addr, rooms, members}` | 各 Pod（5 秒ごと） | 15 秒 |
| `ubi:room:<instanceId>` | 持ち主の `<node>` | 部屋を作った Pod（`SET NX`） | 持ち主が 5 秒ごとに延長（15 秒） |
| `ubi:presence:<instanceId>` | `{memberIds, emptySince}` | 持ち主の Pod（入退室のたびと 5 秒ごと） | 15 秒 |
| `ubi:rooms` | 部屋 ID の集合 | 持ち主の Pod | なし（部屋を消すとき SREM） |

- `<node>` は Pod 名（Downward API）、`addr` は Pod IP:port。
- **部屋の置き場所**: backend は `ubi:room:<id>` を引き、生きている持ち主がいればそこへ送る。いなければ `ubi:node:*` から部屋の少ない Pod を選び、その Pod に作らせる。持ち主の取り合いは `SET NX` で決める。
- **在席**: backend の `presence()` は `ubi:rooms` と `ubi:presence:*` をまとめて読む。各 Pod へ問い合わせを広げない。
- **WS の振り分け**: Ingress は今のまま `/realtime/v1/ws` を Service に向ける。受けた Pod は `world:join` のチケットの instanceId で持ち主を引き、自分でなければ持ち主へ WS を中継する。
  - Ingress の設定や Pod ごとの Service を増やさずに済む。代わりに中継のぶん 1 段遅くなる。
  - 中継をやめたくなったら、チケットに持ち主の `<node>` を入れ、Ingress の `upstream-hash-by` で振り分ける形に変えられる。
- **チケットの署名鍵**: Secret から全 Pod で同じ鍵を読む（`INSTANCE_TICKET_KEY`）。中継先の Pod でも確かめられ、再起動でゲストの再接続情報が無効にならない。
- **Pod が落ちたとき**: 持ち主のキーの TTL が切れる。次の入室で backend が別の Pod に作り直す。部屋の中の状態は失われる（今も再起動で失われるので同じ）。
- **Redis が落ちたとき**: 新しい部屋を作れなくなるが、既存の部屋の接続は続く（Pod 内のメモリで動いている）。在席の一覧は空になるので、reaper は「Redis が読めないときは消さない」ようにする。
- **単体モード**（`--guests`・テスト・Redis なし）: 同じ `Directory` インタフェースのメモリ実装を使う。今と同じく 1 Pod で動く。

### Go の変更点

- `Directory` インタフェース（`Claim / Owner / Heartbeat / PublishPresence / Release`）を作り、メモリ実装と Redis 実装を置く。
- 管理 API は今のまま（backend は持ち主の `addr` へ送る）。
- `serveSocket` に中継を足す。最初の `world:join` を読んでから持ち主を決めるので、そのフレームを中継先へ送り直す。

### chart の変更点

- instance を Deployment のまま `replicas` を可変にする（StatefulSet は不要。Pod 名と IP は Redis に出す）。
- Bitnami の Redis subchart を実際に使う。本番は既存の Redis を指せるようにする（`redis.external.url`）。
- `INSTANCE_TICKET_KEY` を Secret に追加する。

## 移行の順番（PR ごと）

1. **時刻の型**: すべての `timestamp` を `timestamptz` に（`ALTER ... TYPE timestamptz USING ... AT TIME ZONE 'UTC'`）。reaper の `markCreated` をやめる。
2. **登録の仮データ**: `pending_registrations` を作り、メモリ版を置き換える。API は #242 と同じ（`registrationId`）なのでフロントの変更は不要。
3. **鍵の統一**: `author_keys`・`remote_authors` を作り、`publishing_environments`・`author_bindings` から移す。読み書きを切り替えたあと、古いテーブルを次の PR で消す（2 段階）。
4. **users の整理**: `username`・`profile_image_url` を消す。`handle` の NULL を解消してから NOT NULL にする。
5. **worlds の版**: `world_versions`・`world_drafts` を作り、今の `definition/lock/signature` を版 1 行として移す。下書きの列も移す。API を `worlds.id` に寄せたあと、`worlds.name` と古い列を消す。
6. **instances**: `current_users`・`has_password` を消し、`content_hash` を足す。
7. **インスタンスのスケール**: Go の `Directory`（メモリ → Redis）、中継、共有のチケット鍵、chart。最後に `replicas` を 2 にして本番で確かめる。

- 消す列は、使わなくなる PR と消す PR を分ける。ロールバックで古いイメージに戻しても動くように。
- 本番の DB は `baselineIfNeeded` の挙動に注意する。永続ボリュームが残っていると、新しいマイグレーションが適用済み扱いになることがある（検証はボリュームを作り直して行う）。

## 未決

1. `handle` が NULL の既存アカウントの扱い。本番の件数次第で「ログイン時に決めさせる」か「自動で振る」かを決める。
2. 署名し直しで変わる `signature` を、`world_versions` の例外として更新するか、`world_version_signatures`（版ごとに複数の署名）に分けるか。
3. 版の保存数の上限（例: 1 ワールドあたり 20 版）。
4. Redis を Bitnami の subchart で持つか、外部の Redis を必須にするか。
5. backend の複数レプリカ化（reaper の二重実行）。Redis があるので `SET NX` のリース 1 つで済むが、このスケール作業に含めるか。
