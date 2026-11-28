---
name: federation
description: ubichill の連合（ubichill 同士の AP・部屋 RPC・来訪）、フェディバース（Misskey・Mastodon とのフォロー・ノート・プロフィール）、フェディバースログイン（MiAuth・OAuth）を作る・直す・手元や本物のサーバーで確かめるときに使う。外の実装の癖と、2 台で確かめる手順。
---

# 連合とフェディバース

## どこを読むか

| 面 | 設計書 | コード |
|---|---|---|
| ubichill 同士（AP 面・部屋 RPC 面・来訪・招待・現在地） | `docs/design/federation.md` | `packages/backend/src/services/federation/ubichill/` |
| フェディバース（フォロー・固定ノート・プロフィール） | `docs/design/federation.md` の「フェディバース」 | `packages/backend/src/services/federation/fediverse/` |
| 署名・配送 | 同上 | `services/federation/transport/`・`routes/federation/signed.ts` |
| フェディバースログイン | `docs/design/fediverse-sign-in.md` | `packages/backend/src/services/auth/fediverse/` |

- 署名の照合は 1 か所だけで行う。`pnpm check:architecture` の `signatures-in-one-place` が守っている。新しく照合を書かず、既存のものを呼ぶ。
- 決めたことを変えたら、設計書の該当する節も直す。

## 外の実装の癖（コードを読んでも分からないもの）

- **Misskey・Mastodon は RFC 9421（Ed25519）を検証しない。** 外へ送る署名は RSA と draft-cavage にする。draft-cavage を受けるのは inbox だけにする。
- **Misskey は、鍵の無い actor を一度覚えると、取り直しても鍵を足さない。** そのあと、その人から届くものは全部 `failed to resolve user publicKey` で捨てられる。ubichill 側からは直せず、相手のサーバーの管理者が DB を直すしかない。
  - actor の文書は、`publicKey` を載せない状態で一度も公開してはいけない。actor の形を変えるときや新しい種類の actor を足すときは、最初から鍵を載せる。
- **Misskey の OAuth は、複数台で動くサーバー（misskey.io など）では失敗する**（同意の途中の状態をプロセスのメモリに持つため）。Misskey 系（nodeinfo の `software.name` が misskey・sharkey・cherrypick）は MiAuth を使う。
- **メタデータ（RFC 8414・nodeinfo）を出していないサーバーがある**（fedibird・pawoo など）。ログインの画面に並べるサーバーは、判定に通るかを実際に試してから足す。
- keyId が actor の下に無い実装（GoToSocial の `/main-key` など）の署名は、まだ受けない。
- 本物の Misskey は、ログインのときに client_id の文書を取りに来る。外から届く環境でないと確かめられない。

## 確かめ方

### 本物のサーバーで

ログイン・フォロー・プロフィールの見え方（ヘッダー画像・補足情報・「フォローされています」）は、手元では確かめきれない。PR のプレビュー環境（`https://pr-<番号>.ubichill.com`）から、本物の Misskey・Mastodon のアカウントで試す。

### 手元で 2 台（ubichill 同士）

A と B は、次のものを全部分ける。1 つでも共有すると、片方の状態がもう片方に漏れて、偽の成功や偽の失敗になる。

| 分けるもの | A（B は 3100 台を 3200 台に） | 設定する場所 |
|---|---|---|
| 画面 | `http://localhost:3100` | Vite の `--port 3100 --strictPort`。backend の `CORS_ORIGIN` と Go の `--origins` にもこの origin を入れる |
| backend | `http://localhost:3101` | backend の `PORT=3101`・`BETTER_AUTH_URL=http://localhost:3101`。画面の `VITE_BACKEND_URL=http://localhost:3101` |
| 連合の公開 URL | `http://localhost:3101` | backend の `PUBLIC_BASE_URL=http://localhost:3101`。actor の URL と連合で名乗るドメインの元になる（既定は両方とも `http://localhost:3001`） |
| Go | `127.0.0.1:3102` | Go の `--listen`。backend の `INSTANCE_RUNTIME_URL=http://127.0.0.1:3102` と `INSTANCE_PUBLIC_URL=http://localhost:3102/realtime/v1/ws`（既定の相対パスだと、Vite の中継が :3002 に固定されているので別の Go に繋がる） |
| Go の管理トークン | backend と Go で同じ値、A と B では別の値 | `INSTANCE_ADMIN_TOKEN`（32 文字以上） |
| DB | `ubichill_fed_a` | `DATABASE_URL`。作ってから、同じ `DATABASE_URL` を付けて `mise exec -- pnpm --filter @ubichill/db migrate:dev` を当てる |
| Redis | 使わない（`INSTANCE_DIRECTORY=memory`）か、db 番号を分ける | `REDIS_URL` |

- 両方に `FEDERATION_ALLOW_HTTP=true` と `WORLDS_FETCH_ALLOW_PRIVATE=true` を付ける。
- 環境変数の読み込みは `packages/backend/src/config/index.ts`・`packages/backend/src/services/federation/config.ts`・`services/instance/cmd/instance/main.go` を見る。
- 相手は `@<ID>@localhost:3201` のように探す。
- **localhost の cookie はポートで分かれない。** A と B に同じブラウザでログインすると、セッションが上書きし合う。ブラウザのプロファイルを分けるか、API のスクリプトで確かめる。
- backend は `@ubichill/db` の `dist` を読む。db を直したら `mise exec -- pnpm turbo build --filter=@ubichill/db` をしてから起こし直す。直したつもりで古い SQL が動く。
- 3000〜3002 の `pnpm dev` や、ほかの作業が使っているポートには触らない。止めるのは自分が起こした PID だけ（`host-ui` の skill の「サーバーを止めるとき」と同じ）。
