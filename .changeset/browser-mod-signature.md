---
"@ubichill/shared": minor
"@ubichill/backend": minor
---

mod の作者署名の確認をブラウザで行うようにした（単体モードでも mod が動く）。作者の確認の規則（鍵一覧の期限・取り消し・取得の上限・作者のサーバーが止まったときの猶予）を `@ubichill/shared` の `createAuthorKeyDirectory` に移し、ブラウザ（localStorage）とサーバー（DB）が同じコードで確かめる。Host は自分のオリジンの backend に確認を頼まなくなったので、`POST /api/v1/mods/signature/verify` を削除した。WebFinger の鍵一覧の URL は、同じオリジンの絶対 URL か `/` で始まるパスだけを受け付ける。
