---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

組み込み Component `core:ui` を足した（#191）。ワールド作者が HTML 風の UI データ（`markup`）を書くと、Host が mod の UI と同じ描画（Shadow DOM・タグと属性の許可リスト・URL と style の検査）で描く。mod を作らずに看板・説明・リンクを置ける。

- `script`・`style`・`template`・`iframe` などは中身ごと、`on*` 属性・コメントは解析で捨てる。使えないタグ（`b`・`center` など）はタグだけ外して中身を描く。要素名でない `<` は文字として描く。
- リンクと画像は https だけ（画像は `data:image/` も可）。画像は参照元を送らない（`referrerpolicy` は `no-referrer` に固定）。mod の UI の規則は変えていない。
- 解析は文字数に比例する時間で終わる（壊れた入力でも読み直さない）。入れ子は 32 段・要素は 2000 個まで。
- `markup` は 2 万文字まで。未知のキーは検証で落ちる。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
- 押したときの動きはまだ無い。`button`・`input` などは描くが押しても何も起きないので、World Editor の Inspector が「未対応」と知らせる（捨てた `on*` 属性・`script`・タグを外した要素・https でない URL・上限を超えた部分も同じ欄で知らせる）。
- `CORE_COMPONENT_TYPES.ui` を足した。
