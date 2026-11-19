---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

Mastodon・Misskey のアカウントで登録・ログイン・連携できるようにする（メールなしで登録できる）。外部アカウントは `accounts` の `(provider_id, account_id)` で一意にし、アプリの登録と表示用の情報の表を足す（migration 0038）。管理者は確認済みのメールを持つユーザーだけにする。`REGISTRATION=closed` で新規登録を止められる。
