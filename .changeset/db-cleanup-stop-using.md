---
"@ubichill/db": patch
"@ubichill/backend": patch
---

DB の古い列・テーブルを読み書きしないようにした（マイグレーション `0024_db_cleanup_stop_using`）。列の削除（0025）とリリースを分ける。

- `worlds` の 0023 より前の列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）への保存のたびの書き戻しをやめ、スキーマから外した。列は残し、新しいコードの INSERT が通るよう `name`・`version`・`definition` の NOT NULL を外す。
- `instances` の `has_password`・`current_users` をスキーマから外した。パスワードの有無は `password_hash` で決める。デプロイ中・戻したあとの 0023 のイメージが `has_password` で入室を確かめるので、0025 までは DB のトリガーが `password_hash` から `has_password` を決める。
- 0020 で移した古い鍵のテーブル `publishing_environments`・`author_bindings` を消した。0020 より前のイメージに戻すときの作り直し方は `docs/operations/db-migration.md`。
