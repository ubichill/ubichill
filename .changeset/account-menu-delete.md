---
"@ubichill/backend": minor
"@ubichill/db": minor
---

アカウントの削除（退会）とアカウントの切り替えを足す。削除は直近の本人確認と ID の入れ直しを求め、開いている部屋を閉じてからユーザーを消す。退会した ID は `retired_accounts`（migration 0040）に残して二度と使わせず、WebFinger と actor は 410 を返す。切り替えは better-auth の multiSession でこのブラウザーのアカウントを覚え、トークンを画面に返さない口（`/account-switch/*`）で切り替え・このアカウントだけのログアウトをする。
