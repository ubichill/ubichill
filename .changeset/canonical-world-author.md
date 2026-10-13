---
"@ubichill/shared": minor
---

作者アカウントの表記の扱いをワールドと mod でそろえた。新しく署名する作者は正規の表記（`handle@domain`、ドメインは小文字）だけ（`signWorld` / `signMod` が断る）。揺れた表記（`@alice@example.com`・`alice@EXAMPLE.COM` など）の既存の署名は元のバイト列で検証し、検証後に作者とワールドの ID（`acct:作者/名前`）を正規の表記にする。#228 で mod の署名の揺れた表記を形式不正にしていたのは、この扱いに戻した。
