---
"@ubichill/sdk": patch
---

`config.dataOnly` の説明を直す。設定欄（`dataFields`）を持つデータ専用の Component は、World Editor で置いて設定できる部品になる（例: 弾幕の敵 `danmaku:enemy`）。設定欄の無いもの（例: `pen:stroke`）は、これまで通り mod が spawn して持ち回るだけ。
