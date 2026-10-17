---
"@ubichill/db": patch
---

`users` の `username`・`profile_image_url` を消した（マイグレーション `0022_users_drop_columns`）。0021 で読まなくした列で、0021 のイメージが行き渡ってから出す。手順は `docs/operations/db-migration.md`。
