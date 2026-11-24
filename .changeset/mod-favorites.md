---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

mod のお気に入りを足す。作者（handle@domain）と mod の ID で覚え（`user_mod_favorites`、マイグレーション 0050）、見るたびに作者のカタログで今の版を引く（このサーバーの作者は自分のカタログ、ほかのサーバーの作者は WebFinger が案内するカタログ）。足すのは作者のカタログに公開されている mod だけで、1 人 100 件まで（同時に足しても超えない）。`GET`・`POST`・`DELETE /api/v1/users/me/favorites/mods`、`GET /api/v1/users/me/favorites` に `modRefs`、ほかの人に見せる `GET /api/v1/users/:id/favorites` に `mods`（公開範囲はワールドのお気に入りと同じ 1 つの設定）。shared に `ModFavoriteRefSchema`・`FavoriteMods`。
