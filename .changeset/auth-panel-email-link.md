---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

ログイン画面に並べるフェディバースのサーバーを、コントロールパネルの「認証」で管理者が決められるようにする（`featured_fediverse_servers`、migration 0041）。メールなしで登録した人が、設定の「ログイン方法」でメールアドレスとパスワードを足せるようにする（確認コード、`email_link_requests`）。ログイン方法の追加・解除でパスワードの入れ直しを求めず、代わりに連絡先メールに知らせる。block したとき、ほかの backend も覚えた方針をすぐ捨てる。shared の `FEATURED_FEDIVERSE_SERVERS` は `MAX_FEATURED_FEDIVERSE_SERVERS` に置き換え、`LoginMethods` に `email` を足す。
