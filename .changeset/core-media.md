---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

組み込み Component `core:media`（動画を描く場所。Unity の MeshRenderer に当たる）を足した（#191）。

- ワールドに `core:media` を置き、mod は参照フィールド `{ type: 'entityRef', component: 'core:media' }` でそれを指す。フィールドの名前を `Ubi.media.*` の targetId に使うと、`<video>` は参照先の Entity の位置・大きさで描かれる。URL の許可・同期・状態はその mod のもの。動画を出すだけの Worker を別に作らなくてよい。
- `data` は `fit`（`contain` / `cover`）だけ。何を再生するかは持たない（未知のキーは検証で落ちる）。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
- 1 つの動画面に出力できるのは 1 つ（Component のインスタンス × `core:media` を指す `entityRef`）。2 つ以上が指す面・`core:media` を 2 つ持つ Entity には誰の動画も描かず、World Editor（Hierarchy・Inspector）と `ubichill dev` が知らせる。判定は shared の `findMediaConflicts`（描いてよい出力は `owners`）。
- 描けるのはワールド定義に置いた Component の出力だけ。部屋の中で作られた Component は面を指しても描かず、競合にも数えない（参加者が面を指す Component を作って動画を消せないように）。
- `entityRefArray` は `core:media` を指しても描画先にならない。`mediaTargets` と同じ名前の `core:media` の参照はビルドで止める（CLI）。
- `CORE_COMPONENT_TYPES.media` を足した。
