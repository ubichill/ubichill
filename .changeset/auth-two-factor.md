---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

二段階認証（認証アプリとバックアップコード）を足す（`user_two_factors`・`two_factor_challenges`、migration 0042）。有効にすると、パスワードでもフェディバースでもログインのたびにコードを求め、コードを確かめてからセッションを作る（`POST /api/auth/two-factor/verify`）。設定の口は `/api/v1/users/me/two-factor`（状態・始める・有効にする・無効にする・バックアップコードの作り直し）。鍵の暗号化とバックアップコードの HMAC はどの秘密で作ったかを残し、`BETTER_AUTH_SECRETS` で秘密を入れ替えても古い秘密が残っている間は読める。shared に `TwoFactorStatus` などの型と `isTwoFactorRequired` を足す。
