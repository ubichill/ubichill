---
"@ubichill/backend": patch
"@ubichill/db": patch
"@ubichill/shared": patch
---

設定の「ストレージ」の一覧を 50 個ずつ読むようにし（新しい順の続きの位置。合計と数は SUM・COUNT で引く。`GET /api/v1/users/me/storage/files`）、読み込みに回数の制限を掛ける。チェックしてまとめて消せるようにし（`POST /api/v1/users/me/storage/files/delete`、1 回 100 個まで）、消す回数をアップロードと別に数える。画像の作り直しは、PNG・GIF で縮めた後が 256 色以下のときだけ可逆も作り、可逆が失敗・時間切れ（1 秒）なら非可逆で通す（読み込みと縮小は 1 回）。マイグレーション 0046 に持ち主ごとの一覧の索引を足す。
