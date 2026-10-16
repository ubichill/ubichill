---
"@ubichill/backend": patch
---

`GET /api/v1/users/me/worlds` が、本体に保存したワールドの配信の道筋（`url`）と、署名を検証できなかった理由（`problemCode`）を返すようにした。設定の「ワールド」から署名し直すときに使う。
