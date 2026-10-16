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
