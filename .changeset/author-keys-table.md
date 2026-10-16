---
"@ubichill/db": patch
"@ubichill/backend": patch
"@ubichill/shared": patch
---

作者の鍵を 1 つのテーブルにまとめた（マイグレーション `0020_author_keys`）。自サーバーの公開環境（`publishing_environments`）と他サーバーの作者の鍵一覧（`author_bindings` の jsonb）を、`author_keys`（代理キー・`origin` が local / remote）と `remote_authors` に移し、読み書きをすべて新しいテーブルに切り替えた。古いテーブルは残すが書かない（次のマイグレーションで消す）。古いイメージに戻すときの手順は `docs/operations/db-migration.md`。

- 公開鍵は保存・照合の前に正規化する（shared の `normalizeEd25519PublicKey`。`ed25519:` の接頭辞・base64 / base64url・パディング・43 文字目の使われない bit の違いを 1 つにする）。これまでは文字列の完全一致で比べていたため、同じ鍵を別の書き方で別のアカウントに登録できた。DB でも正規形だけを受け付ける。
- 同じ鍵を持てる自サーバーのアカウントは 1 つ。取り消した鍵を登録し直すこともできない（今と同じ）。
- 他サーバーの作者が自サーバーの公開環境の鍵を名乗ってきた場合、その一覧は保存するが警告を記録し、その鍵では作者を付けない（これまでは付いていた）。
- `@ubichill/db`: `publishingEnvironmentRepository`・`authorBindingRepository` を `authorKeyRepository`（`createAuthorKeyRepository`）にまとめた。別の DB に接続する `createDatabase` を足した。
