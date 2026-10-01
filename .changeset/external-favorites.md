---
'@ubichill/backend': minor
---

外部ワールド（URL で入ったワールド）もお気に入りに登録・一覧表示できるようにしました。お気に入りはサーバーが URL から解決し、作者まで確認できたワールドだけを表示します。お気に入り一覧には公開範囲（Private / Friends / Public、初期値は Private）を付け、`GET /api/v1/users/:userId/favorites` は見てよい人にだけ返します。
