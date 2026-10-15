---
"@ubichill/ui-renderer": patch
---

mod の UI を描くときの許可判定を HTML と SVG で揃えた。SVG に付けた `onclick` などのイベント属性が Host のページで実行される穴を塞ぐ。SVG の参照（`<use href>`・`url()`）は同じ文書内だけにし、インラインスタイルの `url()`・`image-set()` などは捨てる（ドメイン承認を通らない送信経路になるため）。リンクは別タブ・opener なしで開き、フォームは送信させず、パスワード欄は描かない。
