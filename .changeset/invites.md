---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

招待とリクエストインバイトを足した。

- 招待: 部屋にいる人がフレンドを今の部屋に招待する（一言付き・部屋がある間で最長 24 時間）。作成者以外は、フレンドのみ・招待のみの部屋には作成者のフレンドにだけ送れる。
- リクエストインバイト: 招待が要る部屋にいるフレンドに「入れて」と頼む（1 時間）。頼まれた人は通知から招待するか断る。
- 招待のみの部屋は URL だけでは入れず、見えない（404）。中にいる人のフレンドには部屋が見えるが、入るには招待が要る（`canJoin: false`）。
- 通知に AS2 の `Invite`（一言 `content`・期限 `endTime`）と `Join` を足した。招待のトーストからそのまま入れる。
- API: `GET /instances/:id/invite-candidates`、`POST /instances/:id/invites`、`POST /social/invite-requests`（`/:userId/accept`・`DELETE /:userId`）。
- DB: `instance_invites`・`invite_requests` を足し、`notifications` に `content`・`expires_at` を足す（0029）。
- backend の services を領域ごとのフォルダ（instances・notifications・social・profiles・worlds・authors・auth・cluster）に分けた。
