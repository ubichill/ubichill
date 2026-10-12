---
"@ubichill/shared": minor
---

ワールドの署名の作者アカウントも、mod の署名と同じく正規の表記（`handle@domain`、ドメインは小文字）だけを受け付けるようにした（`SignedAuthorAccountSchema`）。`@alice@example.com`・`alice@EXAMPLE.COM` などで署名したワールドは形式不正になる。
