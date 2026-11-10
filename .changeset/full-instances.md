---
"@ubichill/shared": minor
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/instance": minor
---

満員の部屋の扱いを変えた。

- 満員の部屋も一覧・フレンドの現在地に出し、画面では「満員」として「入る」を押せなくする（部屋の作成者を除く）。
- 部屋の作成者は満員でも入れる。Go の管理 API のチケットに `leader` を足し、そのチケットは定員を 1 人まで超えて入れる（引っ越しの受け入れも定員 +1 人まで）。backend は満員の部屋に作成者が入るときだけ `leader` を付ける。
- 満員の部屋への招待（`'full'`）とリクエストインバイト（`'full'`）を断る。リクエストインバイトで満員を理由にするのは、相手が場所を見せていて、頼む人にその部屋が見えるときだけ（ほかは届けて、答えるときに満員で断る）。
- shared: `InstanceAudience` に `maxUsers` を足し、`blockedByCapacity`・`isFullFor` を足した。`ListInstancesQuerySchema` から `includeFull` を外した。
- db: `instanceRepository.findAll` から `includeFull` を外した（DB の status では絞らない）。
