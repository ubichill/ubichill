---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

Mastodon・Misskey のアカウントで登録・ログイン・連携できるようにする（メールなしで登録できる）。ログインの前に使うサーバーを選んで確かめられる。外部アカウントは `accounts` の `(provider_id, account_id)` で一意にし、アプリの登録と表示用の情報の表、セッションの `password_verified_at`・`auth_account_id` を足す（migration 0038・0039）。管理者は確認済みのメールを持つユーザーだけにし、管理者の権限はパスワードで確かめたセッションだけで使える。ログイン方法の追加・解除には直近の本人確認が要る。`REGISTRATION=closed` で新規登録を止められる。
