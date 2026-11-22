---
"@ubichill/core-components": minor
---

押せる部品（入口 `core:portal`・ワープ `core:warp`・スイッチ `core:switch`）に、見た目 `look`（`standard`・`none`。既定は `standard` で今までの見た目）を足す。`none` にすると部品は何も描かず、Entity の矩形いっぱいが押せる場所になる（見た目は同じ Entity の画像・文字で付ける。扉の絵を押すとワープなど）。押せる場所は同じ Entity のほかの部品より上に描き、キーボードでも押せる。World Editor の設定欄は「見た目」（標準・なし）で、エディタでは押せる範囲を点線と名前で見せる。`look` を知らない版は標準の見た目で描く。
