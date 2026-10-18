---
"@ubichill/db": patch
"@ubichill/backend": patch
"@ubichill/shared": patch
---

自サーバーで公開したワールドを、変えない版（`world_versions`）と下書き（`world_drafts`）に分けた（マイグレーション `0023_world_versions`）。既存の行の公開中の版を版 1 行に、下書き（未公開のワールドは今の定義）を下書きに移す。`worlds.id` を以前の `name` と同じ値にそろえ、API の `/api/v1/worlds/:worldId` は `worlds.id` で引く（応答の id は変わらない）。古い列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）は読まなくしたが、デプロイ中の古い Pod と古いイメージへの戻しのために残し、保存のたびに書き直す（消すのは後続のマイグレーション）。

- `content_hash` は shared の `worldContentHash()` だけで求める。移した版の値は `migrate.js` がマイグレーションの直後に埋める（`backfillWorldContentHashes`）。
- 同じ `metadata.version` で中身の違う公開は 409（`code: version-conflict`）で拒否する。同じ中身への署名し直しは、その版の `signature` の列だけを置き換える。
- 残す版は `limitsFor(user).maxVersionsPerWorld`（今は 3）まで。超えて公開すると古い版から消す（公開は拒否しない）。インスタンスが指す版は消さず、定期処理（10 分ごと）で消し直す。shared に `limitsFor` と `LIMITS.MAX_VERSIONS_PER_WORLD` を足し、ワールドの数の上限も `limitsFor` から取る。
- `GET /api/v1/worlds/:worldId/versions?contentHash=...` を足した。残っている版を返し、消した版は 410。
- インスタンスを作るとき、ワールドの `content_hash` と、自サーバーで公開した版なら `world_version_id`（`world_versions` へ `ON DELETE RESTRICT`）を記録する。
- 手順と戻し方は `docs/operations/db-migration.md`。
