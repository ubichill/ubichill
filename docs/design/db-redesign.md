# DB（Postgres）の再設計

対象ブランチ: `docs/db-redesign`（この文書）。実装は「移行の順番」の PR ごとに分ける。
Redis を使うスケールの作業（Go の Pub/Sub・backend の複数レプリカ）は [instance-scaling.md](./instance-scaling.md) に分けた。

## 決めたこと

- 登録の仮データは Postgres に置く（メモリに置かない）。
- 公開したワールドの版は、変更しない `world_versions` に分ける。残すのは 3 版まで。それ以上は課金で増やす（ワールドの保存数と同じ仕組み）。
- 鍵は自サーバーの作者・他サーバーの作者で 1 つのテーブルにする。
- 生きている状態（部屋・在席・レート制限の数など）は DB に置かず、Redis の作業で扱う。

## いまの問題

| 対象 | 問題 | 影響 |
|---|---|---|
| 登録の仮データ | backend のメモリにあり、パスワードを平文で持つ | レプリカが 2 つ以上だと登録と確認が別の Pod に当たって失敗する。再起動で登録途中のものが消える |
| reaper | 作成時刻をプロセス内（`markCreated`）に持つ | backend を増やすと、作った Pod 以外は DB の時刻に頼る |
| 時刻の列 | すべて `timestamp`（タイムゾーンなし） | postgres-js の解釈でずれる。reaper がプロセス内の時刻を使っているのはこのため |
| 鍵 | 自サーバーは `publishing_environments`（取り消しは列）、他サーバーは `author_bindings.keys`（jsonb の中） | 作者の鍵の確認が 2 通りに分かれる。取り消しの表現も違う |
| `users` | `username` が未使用、`image` と `profile_image_url` の二重、`handle` が NULL 可 | `handle ?? null` の分岐が散らばる |
| `worlds` | 内部 ID `name` と公開名 `world_name` の 2 つ。公開中の版と下書きを 1 行で上書き | 署名済みの内容が上書きされ、前の版が残らない |
| `instances` | `current_users` が書かれも読まれもしない。`has_password` は `password_hash` から決まる | 正と食い違う値が残る |

## 原則

- **DB に置くのは、長く残る事実と所有だけ。** アカウント、作者の鍵、自サーバーで公開したワールドの版、インスタンスの設定（誰が・どのワールドを・どの公開範囲で）。
- **生きている状態は DB に置かない。** 部屋の中身と在席は Go が正で、複数 Pod の間で共有するものは Redis に置く（[instance-scaling.md](./instance-scaling.md)）。
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
- **「同じアドレスは 3 件まで」は、数えてから足す（`SELECT COUNT` → `INSERT`）だけでは同時の申し込みで超える。** トランザクションの最初に `pg_advisory_xact_lock(hashtextextended(lower(email), 0))` でアドレスごとに直列にしてから、数えて足す。
- **確認と本登録は 1 つのトランザクションにする。**
  1. `SELECT ... FROM pending_registrations WHERE id_hash = $1 FOR UPDATE` で行を押さえる。
  2. 期限切れなら消して終わる。コードが違えば `failures` を足し、上限なら消して確定させる（このトランザクションはここで commit）。
  3. コードが合えば、`users` と `accounts` を作り、仮登録を消して commit する。
  - 本登録が一意制約などで失敗したらロールバックし、仮登録は残る。同じコードで入れ直せる（メモリ版の `restore()` は要らなくなる）。
- `users` と `accounts` は、better-auth の adapter ではなく、同じトランザクションの中で drizzle から直接書く（adapter は自分の接続を使うのでトランザクションに入れられない）。パスワードのハッシュは better-auth の `ctx.password.hash` で作り、`accounts.provider_id = 'credential'` など better-auth が読む形に揃える。better-auth を更新したときに形がずれないよう、「直接作ったユーザーで better-auth のログインが通る」結合テストを置く。
- 期限切れの行は reaper と同じ定期処理で消す。
- `handle` と表示名は仮登録の段階では押さえない（他人の名前を 10 分間取り置きできないように）。本登録の時点で一意制約に当たったら失敗させる。

### 作者の鍵

```
author_keys
  id              text PK              -- 代理キー（公開鍵は主キーにしない。下の理由）
  account         text NULL            -- remote のときだけ handle@domain。local は user_id から決める（下）
  algorithm       text NOT NULL        -- 今は ed25519 だけ
  public_key      text NOT NULL        -- 正規化した値（base64url・接頭辞なし）
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
  UNIQUE (account, algorithm, public_key)
  UNIQUE (algorithm, public_key) WHERE origin = 'local'   -- 1 つの鍵を持てる自サーバーのアカウントは 1 つ
  INDEX (user_id)                      -- account は一意索引の先頭列で引ける
  CHECK ((origin = 'local') = (user_id IS NOT NULL))
  CHECK ((origin = 'remote') = (account IS NOT NULL))

remote_authors
  account       text PK
  display_name  text
  fetched_at    timestamptz NOT NULL

author_confirmed_contents   -- 今のまま
```

- **公開鍵を主キーにしない理由**
  - 信頼の単位は「鍵」ではなく「アカウントと鍵の組」。他のサーバーは、自サーバーの利用者の公開鍵を自分のアカウントの鍵だと WebFinger で主張できる。公開鍵が主キーだと両方の主張を記録できず、先に入った方が勝つか上書きになる。署名には作者のアカウントが入っているので、確かめるべきは「この鍵がこのアカウントのものか」で、鍵だけで引く必要はない。
  - 同じ鍵の書き方の違い（base64 と base64url、`ed25519:` の接頭辞）で別の行にならないよう、保存の前に正規化し、アルゴリズムを列に持つ。
  - 取り消した鍵を同じアカウントに登録し直すことは、`UNIQUE (account, algorithm, public_key)` で防ぐ（取り消しは覆らない。登録し直すなら新しい鍵）。主キーの副作用に頼らず、規則として持つ。
- 他のサーバーが自サーバーの local の鍵を名乗ってきたら（同じ `(algorithm, public_key)` の local の行がある）、その remote の行は保存するが警告を記録し、署名の確認では使わない（なりすましの試みとして扱う）。
- **local の行は `account` を持たず、`user_id` から `users.handle` と `PUBLIC_BASE_URL` で作者アカウントを決める**（#251 で決定）。自ドメインは環境変数で決まり SQL から見えない、`PUBLIC_BASE_URL` を変えると保存した値が古くなる、handle が NULL のユーザーも鍵を登録できる、の 3 つのため。`UNIQUE (account, …)` が効くのは remote の行だけで、local は部分一意で守る。
- 公開鍵の正規化は shared の `normalizeEd25519PublicKey` 1 つ（接頭辞なし・パディングなしの base64url、43 文字目の余りの 2 bit を 0 に揃える）。余りの bit を揃えないと、同じ鍵が 4 通りの文字列で検証を通る。
- 作者の鍵の確認（`isAuthorKey`）は、shared の `authorKeyDirectory` の形（アカウント単位の鍵一覧）を保ち、DB はアカウントで引き、鍵の照合は正規化した値で行う。local は即時、remote は `fetched_at` が古ければ WebFinger から取り直す。
- 取り消しは両方とも行の `revoked_at` で表す。lost は取り消し以前の署名を有効のまま、compromised はすべての署名を無効にする。この意味は今と同じ。
- `publishing_environments` と `author_bindings` を移して消す。読み書きを切り替える PR と、古いテーブルを消す PR を分ける。

### ワールド（自サーバーで公開したものだけ）

```
worlds
  id                  varchar(21) PK
  author_id           text NOT NULL REFERENCES users ON DELETE CASCADE
  world_name          varchar(50) NOT NULL        -- 公開名。URL は /api/v1/authors/<handle>/worlds/<world_name>.yaml
  current_version_id  varchar(21) NULL                -- 未公開なら NULL
  created_at, updated_at  timestamptz
  UNIQUE (author_id, world_name)
  FOREIGN KEY (id, current_version_id) REFERENCES world_versions (world_id, id)
    -- 別のワールドの版を current に指せないようにする（current_version_id が NULL なら検査されない）

world_versions                    -- 変更しない（INSERT のみ）
  id             varchar(21) PK
  world_id       varchar(21) NOT NULL REFERENCES worlds ON DELETE CASCADE
  version        varchar(50) NOT NULL    -- metadata.version
  definition     jsonb NOT NULL          -- 作者が送った生の値（署名の対象）
  lock           jsonb
  signature      jsonb
  content_hash   text NOT NULL           -- shared の worldContentHash() の値（後述）
  published_at   timestamptz NOT NULL
  UNIQUE (world_id, version)
  UNIQUE (world_id, id)                  -- worlds からの複合外部キーの参照先

world_drafts                      -- 0..1 / world
  world_id    varchar(21) PK REFERENCES worlds ON DELETE CASCADE
  definition  jsonb NOT NULL
  lock        jsonb
  updated_at  timestamptz NOT NULL

world_name_aliases                -- 今のまま
```

- `worlds` と `world_versions` は互いを参照する。作るときは `worlds`（current は NULL）→ `world_versions` → `worlds.current_version_id` の更新、の順で 1 トランザクションに入れる。
- **`content_hash` は、shared の `worldContentHash()` を唯一の正とする。** 形式は `sha256-<base64>`（`formatIntegrity`）で、`canonicalJson({ definition, lock: lock ?? null })` を対象にする。lock が無い版も `null` として計算する。保存する側で別のハッシュ計算を書かない（hex にすると既存の contentHash と一致しなくなる）。
- 内部の ID `worlds.name` を消す。API の `/api/v1/worlds/:worldId` は `worlds.id` で引く。
- 公開は「`world_versions` に 1 行足し、`current_version_id` を付け替え、下書きを消す」を 1 トランザクションで行う。
- **同じ `version` で内容が違う公開は拒否する**（`content_hash` が違えばエラー）。版の番号を上げずに中身だけ差し替えることはできない。
- 署名し直し（鍵の取り消しのあとなど）は、同じ版の `signature` だけを変えることになる。`world_versions` は変更しない方針なので、署名だけ別の行にするか、この列に限って更新を許すかを決める（未決 2）。
- 公開を取り消すときは `current_version_id` を NULL にする。過去の版は残す。
- **残す版は 3 つまで。** 4 つ目を公開すると、いちばん古い版を消す（公開そのものは拒否しない。更新できなくなると困るため）。
  - **消してよいかの基準は「その版を指すインスタンスの行が DB にあるか」にする。** Go 側で動いているかは基準にしない。owner が落ちても DB の行は残り、再入室で同じ版から作り直すため。
  - これを DB で守るため、`instances.world_version_id` から `world_versions` へ `ON DELETE RESTRICT` の外部キーを張る（下のインスタンスの節）。インスタンスが reaper に消されてから、版を消す。
  - 消せなかった古い版は、次に公開するときか定期処理で消し直す。その間は一時的に 3 版を超える。
- **古い版の contentHash を後から解決できるのは、残っている版だけ。** 消した版の `content_hash` を指す取得は 410 Gone を返す。
  - お気に入りはワールドの URL（`world_ref`）で持っているので、版を消しても影響しない。
  - 版をまたいだ同一性は、署名済みのワールドの `worldId`（`ed25519:<publicKey>/<metadata.name>`）で表す（[world-identity.md](./world-identity.md)）。`content_hash` は「その版の中身」の識別にだけ使う。
  - 上限はワールドの保存数（今の `LIMITS.MAX_WORLDS_PER_USER` = 5）と同じ仕組みで決める。`limitsFor(user)` が `{ maxWorlds, maxVersionsPerWorld }` を返す関数にしておき、今は定数を返す。課金を入れるときは、この関数がプランを見るように変えるだけにする。

### インスタンス

```
instances
  id            varchar(21) PK
  world_ref     text NOT NULL          -- 正規 URL（今のまま）
  content_hash  text NULL              -- 作成時に解決したワールドの版（worldContentHash()）
  world_version_id varchar(21) NULL REFERENCES world_versions ON DELETE RESTRICT
                                       -- 自サーバーで公開したワールドのときだけ。外部・公式は NULL
  leader_id     text NOT NULL REFERENCES users ON DELETE CASCADE
  access_type   instance_access_type NOT NULL
  access_tags   jsonb
  password_hash varchar(255)           -- has_password は password_hash IS NOT NULL で判定する
  max_users     integer NOT NULL
  created_at    timestamptz NOT NULL
  expires_at    timestamptz
```

- `current_users` と `has_password` を消す。
- どの Pod にあるか・誰がいるかは DB に置かない（Redis。[instance-scaling.md](./instance-scaling.md)）。
- `content_hash` を持たせ、作成後にワールドが更新されても、そのインスタンスは作成時の版で動くようにする。
- reaper の作成時刻は `created_at`（timestamptz）を使い、`markCreated` のプロセス内の記録をやめる。

## 移行の順番（PR ごと）

1. **時刻の型**: すべての `timestamp` を `timestamptz` に（`ALTER ... TYPE timestamptz USING ... AT TIME ZONE 'UTC'`）。reaper の `markCreated` をやめる。
2. **登録の仮データ**: `pending_registrations` を作り、メモリ版を置き換える。API は #242 と同じ（`registrationId`）なのでフロントの変更は不要。
3. **鍵の統一**: `author_keys`・`remote_authors` を作り、`publishing_environments`・`author_bindings` から移す。読み書きを切り替えたあと、古いテーブルを次の PR で消す（2 段階）。
4. **users の整理**: `username`・`profile_image_url` を消す。`handle` の NULL を解消してから NOT NULL にする。
5. **worlds の版**: `world_versions`・`world_drafts` を作り、今の `definition/lock/signature` を版 1 行として移す。下書きの列も移す。API を `worlds.id` に寄せたあと、`worlds.name` と古い列を消す。
6. **instances**: `current_users`・`has_password` を消し、`content_hash` を足す。

Redis の作業との依存: backend を 2 つ以上にする前に、1（reaper のプロセス内の時刻をやめる）と 2（仮登録）を終えておく。

- 消す列は、使わなくなる PR と消す PR を分ける。ロールバックで古いイメージに戻しても動くように。
- 本番の DB は `baselineIfNeeded` の挙動に注意する。永続ボリュームが残っていると、新しいマイグレーションが適用済み扱いになることがある（検証はボリュームを作り直して行う）。

## 未決

1. `handle` が NULL の既存アカウントの扱い。本番の件数次第で「ログイン時に決めさせる」か「自動で振る」かを決める。
2. 署名し直しで変わる `signature` を、`world_versions` の例外として更新するか、`world_version_signatures`（版ごとに複数の署名）に分けるか。
3. 古い版を自動で消すか、4 つ目の公開を拒否して「どれを消すか」を作者に選ばせるか（この文書は自動で消す案）。
