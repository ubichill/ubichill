---
"@ubichill/db": patch
---

0024 で読み書きをやめた列を消した（マイグレーション `0025_db_cleanup_drop_columns`）。`worlds` の `name`・`version`・`definition`・`lock`・`signature`・`draft_*`、`instances` の `has_password`・`current_users` と、`has_password` を決めていたトリガーを消す。`world_versions.content_hash` を NOT NULL にし、空の行があればマイグレーションを止める。`migrate.js` は content_hash を埋めなくなった。0024 のイメージが行き渡ってから出す。手順は `docs/operations/db-migration.md`。
