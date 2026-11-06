---
"@ubichill/shared": minor
"@ubichill/sdk": minor
---

`CanvasStrokeData` に任意の `mode: 'draw' | 'erase'` を、`Ubi.canvas` に `replaceStrokes(targetId, strokes)` を追加し、Host ⇔ Worker のプロトコルを v7 にした（古い Host か確かめるには `Ubi.runtime.supports('canvas:erase')`）。

- `'erase'` のストロークは、なぞった部分のそれまでの線を消す（Host は `destination-out` で重ね、`color` は使わない）。pen mod の消しゴム（`pen:pen` の `eraser: true`）で使う。消すストロークの `color` は透明にしているので、`mode` を知らない v5 以前の Host では何も描かれない（黒い線にはならない）。
- `replaceStrokes` は永続レイヤーを消し、渡したストロークをその順で描き直す（`canvas:draw` の権限で使える）。消すストロークは重ねる順で結果が変わるので、先に描いた線の順番が後から決まったとき（サーバーの順と違った・保存に失敗した）に使う。v5 以前の Host では何も起きない。
