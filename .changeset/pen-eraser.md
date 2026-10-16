---
"@ubichill/shared": minor
"@ubichill/sdk": minor
---

`CanvasStrokeData` に任意の `mode: 'draw' | 'erase'` を追加し、Host ⇔ Worker のプロトコルを v6 にした。`'erase'` のストロークは、なぞった部分のそれまでの線を消す（Host は `destination-out` で重ね、`color` は使わない）。pen mod の消しゴム（`pen:pen` の `eraser: true`）で使う。消すストロークの `color` は透明にしているので、`mode` を知らない v5 以前の Host では何も描かれない（黒い線にはならない）。
