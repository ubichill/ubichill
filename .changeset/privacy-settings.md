---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

プライバシーの設定をまとめ、オンライン状態の見せ方を選べるようにした。

- オンライン状態（`PresenceVisibility`）: いる場所まで（初期値）・オンラインだけ・見せない。フレンドの現在地と、ほかのサーバーからの現在地の問い合わせの両方で効かせる。
  `GET /api/v1/users/me/privacy`・`PUT /api/v1/users/me/presence`。
- ほかのサーバーの人のプロフィール・検索結果に、そのサーバーがフレンドに対応していないか（`friendsUnsupported`）と、フェディバースでフォローされているか（`followsYou`）を付けた。
- DB: 0033（`user_settings.presence_visibility`）。
