---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

設定に「ストレージ」を足す: 使っている量と容量・上げた画像の一覧（大きさ・画素数・上げた日・自分のワールドで使っているか）・その場で消す・使われていない画像を自動で消すかの切り替え（`GET /api/v1/users/me/storage`・`PUT /api/v1/users/me/storage/settings`）。自動で消すのを止めた人の画像は掃除が消さない。1 人あたりの容量（既定 200 MB）を管理者がコントロールパネルの「全般」で 10 MB〜10 GB に変えられるようにし（`GET`・`PUT /api/v1/admin/storage`）、数の上限（200 枚）をやめる。容量を越えたときは今の合計と画像の大きさを伝える。PNG・GIF のうち小さいか平らな画像は可逆の WebP も作り、小さい方を置く（ドット絵・平らな絵が小さくなり、縁もにじまない。プロフィール画像も同じ）。`GET /api/v1/assets`（一覧）は設定の「ストレージ」の API に移した。shared の `WORLD_ASSET_QUOTA`・`WorldAssetList` を `WORLD_ASSET_QUOTA_BYTES`・`StorageOverview` などに置き換える。マイグレーション 0046（`storage_settings`・`user_settings.world_asset_auto_cleanup`）。
