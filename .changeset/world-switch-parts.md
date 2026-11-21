---
"@ubichill/core-components": minor
"@ubichill/shared": minor
"@ubichill/instance": minor
"@ubichill/backend": patch
---

mod を書かずに置ける動きの部品を足す: 最初の場所（`core:spawn`。部屋に入ったとき画面の中心に来る）、ワープ（`core:warp`。押すとワールドの中の別の Entity へスクロールする）、スイッチ（`core:switch`。押すと対象の Entity の見える・見えないを部屋の全員の画面で切り替える）。Entity に `visible`（`false` なら最初は見えない。子も）を足す。インスタンスは見えない Entity の一覧をスナップショットの `hiddenEntities` に持ち、`switch:press` を確かめてから切り替えて `entity:visibility` で配る。公式ワールド（弾幕）の mod danmaku を 1.0.6 に上げる（mod に埋め込まれる部品の一覧が増えたため）。
