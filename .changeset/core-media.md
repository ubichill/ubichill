---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

組み込み Component `core:media`（動画を描く場所。Unity の MeshRenderer に当たる）を足した（#191）。

- ワールドに `core:media` を置き、mod は参照フィールド `{ type: 'entityRef', component: 'core:media' }` でそれを指す。フィールドの名前を `Ubi.media.*` の targetId に使うと、`<video>` は参照先の Entity の位置・大きさで描かれる。URL の許可・同期・状態はその mod のもの。動画を出すだけの Worker を別に作らなくてよい。
- `data` は `fit`（`contain` / `cover`）だけ。何を再生するかは持たない（未知のキーは検証で落ちる）。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
- `CORE_COMPONENT_TYPES.media` を足した。
