# 本番 DB のマイグレーション手順

既存のデータを書き換えるマイグレーション（例: `0018_timestamptz`）を本番に出すときの手順。
マイグレーションは backend の Pod の initContainer（`node node_modules/@ubichill/db/dist/migrate.js`）が実行し、失敗すると新しい Pod は起動せず、古い Pod が動き続ける。

kubectl を使う前に、必ず対象のクラスタを確かめる（kubeconfig に複数のクラスタがある）。

```sh
kubectl config current-context
kubectl -n ubichill get pods -l app.kubernetes.io/name=postgresql
```

以下、`$PG` は Postgres の Pod 名（例: `ubichill-postgresql-0`）。

## 1. 事前確認

```sh
kubectl -n ubichill exec -it $PG -- bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U ubichill -d ubichill'
```

```sql
SHOW timezone;
-- DB 共通・ロール共通・DB とロールの組ごとの設定をすべて確認する
SELECT d.datname, r.rolname, s.setconfig
FROM pg_db_role_setting s
LEFT JOIN pg_database d ON d.oid = s.setdatabase
LEFT JOIN pg_roles r ON r.oid = s.setrole
WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
  AND s.setrole IN (0, (SELECT oid FROM pg_roles WHERE rolname = current_user));
-- 適用済みのマイグレーション（baselineIfNeeded で空振りしていないかの基準）
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
```

- `0018_timestamptz` の前提は「TimeZone が UTC/GMT で、`ubichill` の DB とロールに別の設定が無い」。
  - マイグレーション自体も同じ検査をし、満たさなければ何も変えずに失敗する。
  - ただし、過去に一時的に別の設定だった期間は検出できないので、心当たりがないかも確かめる。
- 代表的な時刻を控えておく（適用後に同じ瞬間を指すか比べる）。

```sql
SELECT id, created_at, expires_at FROM instances ORDER BY created_at DESC LIMIT 3;
SELECT id, expires_at FROM sessions ORDER BY expires_at DESC LIMIT 3;
SELECT id, created_at FROM users ORDER BY created_at DESC LIMIT 3;
```

## 2. バックアップ

```sh
kubectl -n ubichill exec $PG -- bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -U ubichill -d ubichill -Fc' > ubichill-$(date +%Y%m%d-%H%M).dump
ls -l ubichill-*.dump
```

## 3. 復元の確認（バックアップが使えることを先に確かめる）

本番とは別の場所（手元の Docker など）に復元し、件数を比べる。本番の DB に復元しない。

```sh
docker run -d --rm --name ubi-restore-check -e POSTGRES_PASSWORD=p -p 55499:5432 postgres:18-alpine
sleep 5
docker exec -i ubi-restore-check pg_restore -U postgres -d postgres --no-owner < ubichill-*.dump
docker exec ubi-restore-check psql -U postgres -tAc 'SELECT count(*) FROM users; SELECT count(*) FROM worlds;'
docker stop ubi-restore-check
```

## 4. 適用

- main にマージすると Image Updater が新しい backend をデプロイし、initContainer がマイグレーションを実行する。
- 列の型の変更はテーブルを書き直すので、その間は対象のテーブルが排他ロックされる。今の規模なら一瞬の見込みだが、利用者の少ない時間に出す。

## 5. 事後確認

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'
ORDER BY table_name, column_name;
-- すべて timestamp with time zone になっていること

-- 1. で控えた行が同じ瞬間を指すこと（表示は UTC）
SET timezone = 'UTC';
SELECT id, created_at, expires_at FROM instances ORDER BY created_at DESC LIMIT 3;
```

- ログインしたままのブラウザでセッションが切れていないこと、新しくログインできることを確かめる。

## 戻すとき

時刻を UTC とみなす変換は、前提が崩れていた場合に元の情報を取り戻せない。逆向きの SQL に頼らず、2. のバックアップから戻す。

```sh
kubectl -n ubichill scale deploy/ubichill-backend --replicas=0
kubectl -n ubichill exec -i $PG -- bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore -U ubichill -d ubichill --clean --if-exists' < ubichill-YYYYMMDD-HHMM.dump
# 古いイメージに戻してから backend を起こす（新しいイメージはまたマイグレーションを当てる）
```

## 0020_author_keys（作者の鍵を author_keys・remote_authors に移す）

`publishing_environments`（自サーバーの公開環境）と `author_bindings`（他サーバーの作者の鍵一覧）を `author_keys`・`remote_authors` に写す。
新しいイメージは新しいテーブルだけを読み書きし、古いテーブルは**残すが書かない**（消すのは次のマイグレーション）。
1.〜2. の手順（事前確認・バックアップ）は同じ。

### 事前確認

自サーバーの鍵に、形の読めないものや、正規化すると同じ鍵になるもの（同じ鍵の別の書き方）があると、0020 は何も変えずに失敗する。
どちらのアカウントの鍵かは自動で決めないので、先に数える（どちらも 0 行であること）。

```sql
SELECT id, user_id, public_key FROM publishing_environments
WHERE regexp_replace(public_key, '^ed25519:', '') !~ '^[A-Za-z0-9+/_-]{43}=?$';

SELECT encode(decode(translate(rtrim(regexp_replace(public_key, '^ed25519:', ''), '='), '-_', '+/') || '=', 'base64'), 'hex') AS key,
       array_agg(id), array_agg(user_id)
FROM publishing_environments GROUP BY 1 HAVING count(*) > 1;
```

### 事後確認

```sql
SELECT (SELECT count(*) FROM publishing_environments) AS old_local, (SELECT count(*) FROM author_keys WHERE origin = 'local') AS new_local,
       (SELECT count(*) FROM author_bindings) AS old_remote, (SELECT count(*) FROM remote_authors) AS new_remote;
```

### デプロイ中に古い Pod が書いたものを写す

マイグレーションは initContainer で走り、その間も古い Pod が古いテーブルに書く。マイグレーションの後に古い Pod で行われた
公開環境の登録・**取り消し**は新しいテーブルに入っていない。取り消しが漏れると、取り消したはずの鍵が新しいイメージで有効のままになるので、
古い Pod がすべて止まってから、次を確かめて写す。

```sql
-- 古いテーブルだけで取り消されている（写す）
UPDATE author_keys a SET revoked_at = p.revoked_at, revoke_reason = p.revoke_reason
FROM publishing_environments p
WHERE a.id = p.id AND p.revoked_at IS NOT NULL AND a.revoked_at IS NULL;

-- 古いテーブルだけにある公開環境（写す。鍵が正規形でなければ CHECK で失敗するので、その行は本人に登録し直してもらう）
INSERT INTO author_keys (id, algorithm, public_key, origin, user_id, kind, name, api_token_hash, created_at, last_used_at, revoked_at, revoke_reason)
SELECT p.id, 'ed25519', p.public_key, 'local', p.user_id, p.kind, p.name, p.api_token_hash, p.created_at, p.last_used_at, p.revoked_at, p.revoke_reason
FROM publishing_environments p
WHERE NOT EXISTS (SELECT 1 FROM author_keys a WHERE a.id = p.id);
```

`author_bindings` は取り直せるキャッシュなので写さなくてよい（新しいイメージが T_fresh ごとに取り直す）。

### 古いイメージに戻すとき

古いイメージは古いテーブルを読むので、0020 の後に新しいイメージで行った変更は見えない。

- **0020 の後に取り消した鍵が、古いイメージでは有効に戻る。** 戻したら、すぐに取り消しを古いテーブルへ写す。
- 0020 の後に登録した公開環境（ブラウザ・CLI・CI）は古いイメージから見えない。その鍵で署名したワールドに作者が付かず、
  その公開環境の API トークンも通らない。下の 2 つ目の SQL で写す（写さなければ、本人がログインし直して登録し直す）。
- 他サーバーの作者の確認結果は、古いテーブルの古い結果を使い、T_fresh を過ぎたものから取り直す。

```sql
UPDATE publishing_environments p SET revoked_at = a.revoked_at, revoke_reason = a.revoke_reason
FROM author_keys a
WHERE a.id = p.id AND a.revoked_at IS NOT NULL AND p.revoked_at IS NULL;

INSERT INTO publishing_environments (id, user_id, kind, name, public_key, api_token_hash, created_at, last_used_at, revoked_at, revoke_reason)
SELECT id, user_id, kind, name, public_key, api_token_hash, created_at, last_used_at, revoked_at, revoke_reason
FROM author_keys a
WHERE origin = 'local' AND NOT EXISTS (SELECT 1 FROM publishing_environments p WHERE p.id = a.id)
ON CONFLICT DO NOTHING;
```

もう一度新しいイメージに進めるときは、0020 は適用済みなので再び走らない。上の「デプロイ中に古い Pod が書いたものを写す」をもう一度行う。

## 0021_users_cleanup（users の handle を必須にし、画像を image に寄せる）

- handle が NULL のユーザーに `user_` + 16 進 12 桁（`gen_random_uuid()` の先頭）を振る。システムユーザー（`00000000-…`）だけは予約語の `system`。
  振った handle は変更できないので、その人はそのまま使い続ける（URL は `/@user_…`、作者アカウントは `user_…@<domain>`）。
- `image` が空の行だけ、`profile_image_url` の値を `image` に移す。
- `handle` を NOT NULL にする。`username`・`profile_image_url` は**残す**（新しいイメージは読まない。デプロイ中の古い Pod が SELECT するので、消すのは次の 0022）。

1.〜2. の手順（事前確認・バックアップ）は同じ。

### 事前確認

```sql
-- 振られる人（本番では 5 件の見込み。システムユーザーを含むか確かめる）
SELECT id, email, name, username, created_at FROM users WHERE handle IS NULL ORDER BY created_at;
-- 移す画像（image と profile_image_url が両方あって違う行は image を残す）
SELECT id, image, profile_image_url FROM users WHERE coalesce(btrim(profile_image_url), '') <> '';
-- 予約語の system を他人が持っていないこと（持っていればシステムユーザーにも user_… を振る）
SELECT id FROM users WHERE handle = 'system';
```

振られた人には、ID が決まったこと（`@user_…`）を知らせる。ID はあとから変えられない。

### 事後確認

```sql
SELECT count(*) FROM users WHERE handle IS NULL;  -- 0
SELECT id, handle FROM users WHERE handle ~ '^user_[0-9a-f]{12}$' OR handle = 'system';
```

- 新しくログインできること、`/@<振った handle>` のプロフィールが開けることを確かめる。

### 古いイメージに戻すとき

列は残っているので、そのまま戻せる。振った handle と NOT NULL もそのままでよい（古いイメージの「ID を設定する」画面は出なくなる）。
ただし古いイメージは handle を後から書く作り方（better-auth の signUpEmail）でユーザーを作るので、公式アカウントが無い DB で起動すると
その作成が NOT NULL で失敗する（本番は作成済みなので当たらない）。
0021 の後に新しいイメージで変わった画像は `image` にだけあり、古いイメージ（`profile_image_url` を出す）には出ない（今はどちらも書く口が無い）。

## 0022_users_drop_columns（username・profile_image_url を消す）

0021 で読まなくなった 2 列（`username` は一意制約ごと）を消す。データの書き換えは無い。

### 事前確認

- **0021 を当てたイメージがすべての Pod で動き、0021 より前のイメージに戻す予定が無いこと**（古いイメージは 2 列を SELECT するので、
  デプロイ中に古い Pod が残っていると users を読む処理がほぼすべて失敗する）。0021 と同じリリースで出さない。

```sql
SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1;  -- 0021 まで適用済み
SELECT count(*) FROM users WHERE coalesce(btrim(profile_image_url), '') <> '' AND image IS DISTINCT FROM btrim(profile_image_url);
-- 0 でなければ、image を正として捨てる値を控える
```

### 事後確認

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('username', 'profile_image_url');  -- 0 行
```

### 古いイメージに戻すとき

0021 以降のイメージ（0022 の前を含む）へはそのまま戻せる。0021 より前のイメージに戻すときは、**イメージを戻す前に**列を足し直す
（値は戻らない。画像は `image` に移してあるので、古いイメージでは画像が出なくなるだけ）。

```sql
ALTER TABLE users ADD COLUMN username varchar(255);
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
ALTER TABLE users ADD COLUMN profile_image_url varchar(1024);
```

## 0023_world_versions（ワールドの版と下書きを分ける）

`worlds` の 1 行に入っていた公開中の版と下書きを、`world_versions`（版。変えない）と `world_drafts`（下書き）に分ける。

- 署名のある行は、`definition`・`lock`・`signature`・`version` をそのまま版 1 行にし、`current_version_id` で指す（公開の時刻は `updated_at`）。
- 下書き: 公開中の行は `draft_*` を、署名の無い行は今の `definition`・`lock` を下書きにする（未公開のワールドは下書きを署名なしとして配る。
  配る中身は 0023 の前と同じ）。
- `worlds.id` を `worlds.name` と同じ値に書き換える（API の `/api/v1/worlds/:worldId` の id と、以前の形の URL `/api/v1/worlds/<name>` を変えないため）。
  `world_name_aliases.world_id` も同じく書き換える。name が 21 文字を超える行・ほかの行の id と同じ name の行は書き換えず、その行の API の id は変わる。
- `content_hash` は SQL では入れない（shared の `worldContentHash()` と同じ値を SQL で作れない）。`migrate.js` がマイグレーションの直後に埋める。
  失敗したら initContainer が失敗する。もう一度流せば、残りだけ埋める。
- `instances` に `content_hash` と `world_version_id`（`world_versions` へ `ON DELETE RESTRICT`）を足す。既存のインスタンスは NULL のまま。
- `worlds` の `name`・`version`・`definition`・`lock`・`signature`・`draft_*` は**残す**（デプロイ中の古い Pod が読み書きする）。
  新しいイメージは読まず、保存のたびに版と下書きから書き直す（古いイメージに戻したときに同じ中身が見えるように）。消すのは後続のマイグレーション。
- 開発環境の `pnpm dev` は `drizzle-kit push` でスキーマだけ合わせるので、既存のワールドは移らない（版も下書きも無いので見つからなくなる）。
  手元のワールドを残したいときは、下の「古い Pod が書いたものを写す」の SQL を当てる。

1.〜2. の手順（事前確認・バックアップ）は同じ。

### 事前確認

```sql
-- 本番は 5 行の見込み。署名あり（版になる）・下書きあり・署名なし（下書きになる）の数
SELECT count(*) AS total, count(signature) AS signed, count(draft_definition) AS drafted,
       count(*) FILTER (WHERE signature IS NULL) AS unsigned FROM worlds;
-- id を name にそろえられない行（0 行の見込み。あれば API の id が変わるので、作者のエディタのブックマークが外れる）
SELECT w.id, w.name FROM worlds w
WHERE w.id <> w.name AND (length(w.name) > 21 OR EXISTS (SELECT 1 FROM worlds o WHERE o.id = w.name));
-- 署名の無い行に下書きがある（今のコードでは起きない。あれば draft_* を下書きにし、definition は版にも下書きにも残らない）
SELECT id, name FROM worlds WHERE signature IS NULL AND draft_definition IS NOT NULL;
```

### 事後確認

```sql
SELECT (SELECT count(*) FROM worlds WHERE signature IS NOT NULL) AS signed,
       (SELECT count(*) FROM world_versions) AS versions,
       (SELECT count(*) FROM world_drafts) AS drafts,
       (SELECT count(*) FROM world_versions WHERE content_hash IS NULL) AS unhashed;  -- signed = versions、unhashed = 0
SELECT count(*) FROM worlds WHERE id <> name;  -- 事前確認で出た行の数と同じ
```

- 自分のワールドの一覧（`/api/v1/users/me/worlds`）・共有 URL・YAML の配信・エディタの下書きが 0023 の前と同じに見えること。

### デプロイ中に古い Pod が書いたものを写す

マイグレーションの後に古い Pod が行った保存は、古い列にだけ入る。古い Pod がすべて止まってから、次の 2 つが 0 行であることを確かめる。

```sql
-- 古い Pod が作ったワールド（版も下書きも無いので、新しいイメージでは見つからない）
SELECT w.id, w.name FROM worlds w
WHERE w.current_version_id IS NULL AND NOT EXISTS (SELECT 1 FROM world_drafts d WHERE d.world_id = w.id);
-- 古い Pod が保存したワールド（古い列が版・下書きと食い違う）
SELECT w.id, w.name FROM worlds w
LEFT JOIN world_versions v ON v.id = w.current_version_id
LEFT JOIN world_drafts d ON d.world_id = w.id
WHERE (w.signature IS NOT NULL AND (v.id IS NULL OR v.definition IS DISTINCT FROM w.definition
           OR v.signature IS DISTINCT FROM w.signature OR d.definition IS DISTINCT FROM w.draft_definition))
   OR (w.signature IS NULL AND (v.id IS NOT NULL OR d.definition IS DISTINCT FROM w.definition));
```

行があれば、その行を 0023 と同じ規則で移し直す（`$ID` は上で出た id）。署名のある行の新しい版は、版を上げて公開されていれば足し、
同じ version で中身が違えば上書きされた版なので作者に知らせる。最後に `migrate.js` をもう一度流して content_hash を埋める。

```sql
-- 署名なし: 下書きを今の定義にし、公開中を外す
INSERT INTO world_drafts (world_id, definition, lock, updated_at)
SELECT id, definition, lock, updated_at FROM worlds WHERE id = '$ID'
ON CONFLICT (world_id) DO UPDATE SET definition = EXCLUDED.definition, lock = EXCLUDED.lock, updated_at = EXCLUDED.updated_at;
UPDATE worlds SET current_version_id = NULL WHERE id = '$ID';
-- 署名あり（新しい version）: 版を足して公開中にし、下書きを draft_* に合わせる
INSERT INTO world_versions (id, world_id, version, definition, lock, signature, published_at)
SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 21), id, version, definition, lock, signature, updated_at
FROM worlds WHERE id = '$ID';
UPDATE worlds w SET current_version_id = v.id FROM world_versions v WHERE w.id = '$ID' AND v.world_id = w.id AND v.version = w.version;
DELETE FROM world_drafts WHERE world_id = '$ID';
INSERT INTO world_drafts (world_id, definition, lock, updated_at)
SELECT id, draft_definition, draft_lock, coalesce(draft_updated_at, updated_at) FROM worlds WHERE id = '$ID' AND draft_definition IS NOT NULL;
```

### 古いイメージに戻すとき

新しいイメージは古い列を書き直しているので、古いイメージはそのまま同じ中身を読める（id は name と同じ値なので、新しく作ったワールドも引ける）。
ただし、**イメージを戻す前に**インスタンスの版の参照を外す。古いイメージはワールドを消すとき版を指すインスタンスを考えないので、
外さないと RESTRICT でワールドとユーザーの削除が失敗する。

```sql
UPDATE instances SET world_version_id = NULL WHERE world_version_id IS NOT NULL;
```

- 古いイメージは版の履歴を使わない（公開中の 1 つだけ）。同じ version で中身の違う公開も通るので、そのまま古い列だけが変わる。
- 新しいイメージに進め直すときは、上の「古い Pod が書いたものを写す」で食い違いを確かめてから出す。

## 0024_db_cleanup_stop_using（古い列を書かない・古い鍵のテーブルを消す）

列の削除（0025）の前の段。新しいイメージは次のものを読み書きしなくなる。列は**残す**（デプロイ中・戻したあとの 0023 のイメージが書く）。

- `worlds` の `name`・`version`・`definition`・`lock`・`signature`・`draft_*`: 保存のたびの書き戻しをやめる。新しく作る行は NULL のまま。
  新しいイメージの INSERT が通るよう、`name`・`version`・`definition` の NOT NULL だけ外す（`name` の UNIQUE は NULL どうしでは重ならない）。
- `instances` の `has_password`・`current_users`: パスワードの有無は `password_hash IS NOT NULL` で決める。`current_users` は誰も読まない（default の 0 のまま）。
  0023 のイメージは `has_password` だけを見て入室のパスワードを確かめるので、新しいイメージが作ったパスワード付きのインスタンスに
  古い Pod からパスワードなしで入れないよう、トリガー `instances_sync_has_password` で INSERT・UPDATE のたびに `password_hash` から決める
  （既存の食い違う行も直す）。トリガーは 0025 で列と一緒に消す。
- `publishing_environments`・`author_bindings` を DROP する（0020 以降のイメージは読み書きしない。行は 0020 で `author_keys`・`remote_authors` に移してある）。

1.〜2. の手順（事前確認・バックアップ）は同じ。バックアップには古い鍵のテーブルが入っている（戻すときに使う）。

### 事前確認

- **0023 のイメージ（#266）がすべての Pod で動いていること**。0020 より前のイメージは古い鍵のテーブルを読むので、残っていると作者の確認・API トークンが通らない。

```sql
SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1;  -- 0023 まで適用済み
-- 0020 の「デプロイ中に古い Pod が書いたものを写す」が済んでいること（どちらも 0 行。あれば 0020 の節の SQL で写してから出す）
SELECT p.id FROM publishing_environments p WHERE NOT EXISTS (SELECT 1 FROM author_keys a WHERE a.id = p.id);
SELECT p.id FROM publishing_environments p JOIN author_keys a ON a.id = p.id
WHERE p.revoked_at IS NOT NULL AND a.revoked_at IS NULL;
-- has_password と password_hash の食い違い（0 の見込み。あれば 0024 が password_hash に合わせる）
SELECT id, has_password FROM instances WHERE has_password IS DISTINCT FROM (password_hash IS NOT NULL);
```

### 事後確認

```sql
SELECT to_regclass('publishing_environments'), to_regclass('author_bindings');  -- どちらも NULL
SELECT tgname FROM pg_trigger WHERE tgrelid = 'instances'::regclass AND NOT tgisinternal;  -- instances_sync_has_password
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'worlds' AND column_name IN ('name', 'version', 'definition');  -- すべて YES
```

- パスワード付きのインスタンスを作り、一覧で鍵の印が出ること、パスワードなしでは入れず正しいパスワードで入れることを確かめる。
- 作者の鍵の一覧（`/api/v1/authors/<handle>/signing-keys`）・公開・CLI の API トークンが 0024 の前と同じに通ること。

### 古いイメージに戻すとき

- **0023 のイメージ（#266）へはそのまま戻せる。** 0023 のイメージは古い列を読まず（書くだけ）、`has_password` はトリガーが正しく保つ。
- **0023 より前のイメージへは、0023 の節の「古いイメージに戻すとき」に加えて、イメージを戻す前に古い列を版と下書きから書き直す**
  （0024 の後に保存したワールドは古い列が古いまま、新しく作ったワールドは NULL）。

```sql
UPDATE worlds w SET
    name = COALESCE(w.name, w.id),
    version = COALESCE(v.version, d.definition->'metadata'->>'version', w.version),
    definition = COALESCE(v.definition, d.definition, w.definition),
    lock = CASE WHEN v.id IS NOT NULL THEN v.lock WHEN d.world_id IS NOT NULL THEN d.lock ELSE w.lock END,
    signature = CASE WHEN v.id IS NOT NULL THEN v.signature WHEN d.world_id IS NOT NULL THEN NULL ELSE w.signature END,
    draft_definition = CASE WHEN v.id IS NOT NULL THEN d.definition END,
    draft_lock = CASE WHEN v.id IS NOT NULL THEN d.lock END,
    draft_updated_at = CASE WHEN v.id IS NOT NULL THEN d.updated_at END
FROM worlds s
LEFT JOIN world_versions v ON v.id = s.current_version_id
LEFT JOIN world_drafts d ON d.world_id = s.id
WHERE w.id = s.id;
```

- **0020 より前のイメージ（古い鍵のテーブルを読む）へ戻すと、鍵が見えなくなる**（作者の確認が外れ、API トークンが通らない）。
  イメージを戻す前にテーブルを作り直し、0020 の節の「古いイメージに戻すとき」の SQL で `author_keys` から写す。
  `author_bindings` は取り直せるキャッシュなので空でよい。

```sql
CREATE TABLE publishing_environments (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL,
    name text NOT NULL,
    public_key text NOT NULL CONSTRAINT publishing_environments_public_key_unique UNIQUE,
    api_token_hash text CONSTRAINT publishing_environments_api_token_hash_unique UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text
);
CREATE INDEX publishing_environments_user_id_idx ON publishing_environments (user_id);
CREATE TABLE author_bindings (
    account text PRIMARY KEY,
    keys jsonb NOT NULL,
    display_name text,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
```

もう一度新しいイメージに進めるときは、0024 は適用済みなので再び走らない。作り直したテーブルは誰も読まないので、0025 の前に手で消してよい。

## 0025_db_cleanup_drop_columns（worlds・instances の古い列を消す）

0024 で読み書きをやめた列を消す。データの書き換えは無い。

- `worlds` の `name`（UNIQUE ごと）・`version`・`definition`・`lock`・`signature`・`draft_*`、`instances` の `has_password`・`current_users`、
  `has_password` を決めていたトリガー `instances_sync_has_password` を消す。
- `world_versions.content_hash` を NOT NULL にする。空の行があれば、何も変えずに失敗する（initContainer が失敗し、古い Pod が動き続ける）。
- `migrate.js` は content_hash を埋めなくなる。0023 より前の DB に 0023〜0025 を 1 回で当てると、埋める前に 0025 に来て失敗するので、
  先に 0024 のイメージで当てる（本番は 0024 のリリースで済んでいる前提）。

1.〜2. の手順（事前確認・バックアップ）は同じ。

### 事前確認

- **0024 のイメージがすべての Pod で動き、0024 より前のイメージに戻す予定が無いこと**。0023 のイメージは worlds の古い列を INSERT し、
  `has_password` を読むので、デプロイ中に残っているとワールドの作成とインスタンスの一覧・入室が失敗する。0024 と同じリリースで出さない。

```sql
SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1;  -- 0024 まで適用済み
SELECT count(*) FROM world_versions WHERE content_hash IS NULL;  -- 0（0 でなければ 0024 のイメージの migrate.js をもう一度流す）
SELECT id, has_password FROM instances WHERE has_password IS DISTINCT FROM (password_hash IS NOT NULL);  -- 0 行
```

### 事後確認

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND ((table_name = 'worlds' AND column_name IN
      ('name', 'version', 'definition', 'lock', 'signature', 'draft_definition', 'draft_lock', 'draft_updated_at'))
   OR (table_name = 'instances' AND column_name IN ('has_password', 'current_users')));  -- 0 行
SELECT is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'world_versions' AND column_name = 'content_hash';  -- NO
```

- ワールドの保存・公開、パスワード付き・なしのインスタンスの作成・入室・一覧の鍵の印が 0025 の前と同じであることを確かめる。

### 古いイメージに戻すとき

0024 のイメージへはそのまま戻せる（消した列を読み書きしない）。0024 より前のイメージに戻すときは、**イメージを戻す前に**列とトリガーを足し直す
（値は戻らない。worlds の古い列は 0024 の節の書き直しの SQL で、has_password は下の UPDATE で入れる）。0023 より前のイメージへは、
さらに 0024 の節の「古いイメージに戻すとき」を行う。

```sql
ALTER TABLE world_versions ALTER COLUMN content_hash DROP NOT NULL;  -- 0023 のイメージは NULL を書かないので、戻さなくてもよい
ALTER TABLE worlds ADD COLUMN name varchar(255) CONSTRAINT worlds_name_unique UNIQUE, ADD COLUMN version varchar(50),
    ADD COLUMN definition jsonb, ADD COLUMN lock jsonb, ADD COLUMN signature jsonb,
    ADD COLUMN draft_definition jsonb, ADD COLUMN draft_lock jsonb, ADD COLUMN draft_updated_at timestamptz;
ALTER TABLE instances ADD COLUMN has_password boolean NOT NULL DEFAULT false, ADD COLUMN current_users integer NOT NULL DEFAULT 0;
UPDATE instances SET has_password = (password_hash IS NOT NULL);
CREATE FUNCTION instances_sync_has_password() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.has_password := NEW.password_hash IS NOT NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER instances_sync_has_password BEFORE INSERT OR UPDATE ON instances
FOR EACH ROW EXECUTE FUNCTION instances_sync_has_password();
```

- 0023 のイメージは worlds の INSERT で `name`・`version`・`definition` を書き、読まないので、上の書き直しをしなくても動く。
- has_password を足し直さずに 0023 のイメージを動かすと、インスタンスを読む処理がすべて失敗する。

## 0026_notifications（通知・お知らせの表を足す）

表を 3 つ足し、返事を待っているフレンド申請を通知（`Follow`）に写す。既存の表は変えない。

- `notifications`: 本人に関わる出来事（`Follow`・`Accept`・`Like`）。受け手・actor（このサーバーのユーザーか、将来のリモートの URI のどちらか 1 つ）・
  object（jsonb、形は shared のスキーマで確かめる）・作成時刻・既読時刻。同じ出来事は `(recipient_id, dedupe_key)` の一意索引で 1 つにする。
  受け手か actor のユーザーを消すと、通知も消える。
- `announcements`: 運営のお知らせ。全員に行を書かない。
- `announcement_reads`: 利用者ごとの「この時刻までのお知らせは読んだ」位置。行が無い人は登録した時刻を位置とする（読むときに合わせる）。
- 写すのは `user_friends` の `pending` の行だけ（申請された人への `Follow`、時刻は申請の時刻をミリ秒に丸めたもの）。ID は 2 人の組から決めるので、
  もう一度流しても増えない。

1.〜2. の手順（事前確認・バックアップ）は同じ。足すだけなので、古い Pod が残っていても困らない（古いイメージは新しい表を読み書きしない）。

### 事前確認

```sql
SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1;  -- 0025 まで適用済み
SELECT count(*) FROM user_friends WHERE status = 'pending';  -- 写す件数（事後確認で比べる）
```

### 事後確認

```sql
SELECT count(*) FROM notifications WHERE type = 'Follow';  -- 事前確認の pending の件数と同じ
SELECT count(*) FROM notifications n
LEFT JOIN user_friends f ON f.user_id = n.actor_user_id AND f.friend_id = n.recipient_id AND f.status = 'pending'
WHERE n.type = 'Follow' AND f.user_id IS NULL;  -- 0（申請中でないものを写していない）
```

- 申請中のフレンドがいるアカウントでログインし、ヘッダーのベルに件数が出て、一覧から承認・拒否できることを確かめる。

### 掃除

backend の定期の掃除（`maintenanceGate` を持つ 1 台だけ、10 分ごと）が、90 日より古い通知・お知らせと、1 人あたり 200 件を超えた古い通知を消す
（`NOTIFICATION_LIMITS`）。上限を超える受け手を探すのに `notifications` を受け手ごとに数えるので、行が数百万を超えたら、受け手ごとの件数を持つか、
掃除を受け手の範囲ごとに分ける。

### 古いイメージに戻すとき

0025 のイメージへはそのまま戻せる（新しい表を読まない）。表を残したまま戻し、もう一度新しいイメージに進めると、戻していた間の申請は通知にならない
（フレンドの一覧からは見える）。表を消すのは、新しいイメージに戻さないと決めたときだけにする。

```sql
DROP TABLE notifications, announcements, announcement_reads;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);  -- 0026 の行
```
