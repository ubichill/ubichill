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
