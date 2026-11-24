---
"@ubichill/shared": minor
"@ubichill/backend": minor
"@ubichill/cli": patch
---

公開環境の追加に気付けて、取り消しやすくする（#184）。CLI・CI を公開環境として足す承認（`POST /api/v1/cli-auth/requests/:id/approve`）は、直近の本人確認（パスワードを 10 分以内に確かめた、パスワードの無い人は 10 分以内にログインした）を求め、足りなければ 403 `reauth-required` で断る。ブラウザで公開するときの自動の登録はこれまでどおり確認を出さない。追加の通知メールに種類・名前・鍵の指紋と、その環境を目立たせた設定の画面（`/settings/publishing?environment=<id>`）へのリンクを載せる。shared に `signingKeyFingerprint`・`publishingEnvironmentKindLabel`・`publishingEnvironmentSettingsPath` を足す。`ubichill login` と `ubichill ci create` は、承認画面と見比べる鍵の指紋を出す。
