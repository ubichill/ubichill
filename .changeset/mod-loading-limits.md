---
"@ubichill/cli": patch
---

mod の取得と実行に上限を付ける（`ubichill dev` の画面と、lock を読む CLI の処理）。

- mod の取得は manifest 1MiB・署名 64KiB・Worker 32MiB、時間は manifest と署名 15 秒・Worker 60 秒まで。超えた応答は読むのをやめる
- lock の `version` は `x.y.z`、`workerUrl` は版のディレクトリの中の相対パス（`..`・絶対パス・`\`・`%`・クエリは不可）、`baseUrl` は http(s) でクエリ・フラグメント・認証情報なし。http の `baseUrl` は開発用の Host が自分のオリジンとして許すときだけ取りに行く
- mod から Host へのコマンドは 1 tick 512 件まで、`Ubi.event.emit` の data はおよそ 64KiB まで。超えた分は捨てて診断を 1 回出す
- 拒否の診断に mod が送ったコマンド名を入れない（名前を変えて診断の抑制を外させない）
