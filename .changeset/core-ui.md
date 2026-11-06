---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

組み込み Component `core:ui` を足した（#191）。ワールド作者が HTML 風の UI データ（`markup`）を書くと、Host が mod の UI と同じ描画（Shadow DOM・タグと属性の許可リスト・URL と style の検査）で描く。mod を作らずに看板・説明・リンクを置ける。

- `script`・`style`・`template`・`iframe` などは中身ごと、`on*` 属性・コメントは解析で捨てる。リンクは新しいタブで開く。
- `markup` は 2 万文字まで。未知のキーは検証で落ちる。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
- `CORE_COMPONENT_TYPES.ui` を足した。
