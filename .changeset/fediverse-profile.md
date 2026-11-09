---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

フェディバースとのプロフィールのやり取りで、出していなかった・読んでいなかった項目を足した。

- 出す: バナー（`image`）、作った日（`published`）、リンク・話せる言語・ひとことを `attachment` の `PropertyValue` で載せる（リンクは `rel="me"`）。
  ubichill どうしのために、ひとことと言語は拡張の語 `statusMessage`・`spokenLanguages` にも載せる。
- 読む: ほかのサーバーの人のバナーと、項目の表（16 件まで）を読む。https のリンクの項目はプロフィールのリンクにし、ほかの項目は補足情報の表に出す。
  自己紹介は改行を残し、1500 文字まで読む。
- DB: 0032（`remote_actors.banner`・`remote_actors.profile`）。
