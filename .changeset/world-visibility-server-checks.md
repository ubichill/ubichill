---
"@ubichill/shared": minor
"@ubichill/backend": minor
"@ubichill/instance": minor
---

ワールドの公開範囲をサーバーの側で守る。プライベートのワールドの部屋を作れるのは作者だけで、作者のサーバーでだけ。

- ワールドのファイル（`.yaml`・`.lock.json`・`.sig.json`）に公開範囲のヘッダー `Ubichill-World-Visibility: private|public` を付ける（`Access-Control-Expose-Headers` にも入れる）。ほかのサーバーは外部のワールドを解決するとき、`private` ならそのワールドの部屋をだれにも作らせず、一覧・ワールドに置くポータルの行き先からも外す（shared の `WORLD_VISIBILITY_HEADER`・`worldVisibilityFromHeader`）。ファイルは今までどおり誰にでも配る。
- 部屋へのポータルを置く許可を backend が出す（`POST /api/v1/room-portals/grants`）。プライベートのワールドの部屋へは、その部屋を作った人にだけ出す（いまの公開範囲で判定する）。インスタンスは管理トークンのある運用で `portal:open` の `grant`（`base64url(JSON {room, userId, exp})` + `.` + HMAC-SHA256。鍵は管理トークンから `ubichill room portal grant v1` で派生、60 秒）を確かめ、無い・合わなければ断る。単体モードでは求めない（shared の `ROOM_PORTAL_GRANT`）。
