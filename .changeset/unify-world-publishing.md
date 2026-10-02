---
"@ubichill/sdk": minor
"@ubichill/backend": minor
"@ubichill/shared": minor
"@ubichill/loader": minor
"@ubichill/db": minor
---

ワールドの公開を 1 つの形・規則・方法にまとめる。本体の DB・リポジトリ（worlds/）・外部ホストのワールドを区別しない。

- どのワールドも「定義・lock・署名」の組で、同じ規則で検証する。本体のワールドで署名が壊れていても、未署名に格下げせず拒否する
- 本体は中身を書き換えない（metadata.name も）。同じワールドかは作者 + metadata.name で決まる。本体へ送る入口は `PUT /api/v1/worlds` だけ
- `ubichill publish` は手元で署名した組をそのまま送る。prepare と `<world>.ubichill.json` は不要になった
- リポジトリのワールドは静的ファイル（`/api/v1/repository/worlds/<file>`）として、外部ホストと同じように配る
- `worlds/trusted-authors.json` による特別な信用をやめた。公式アカウントの鍵もほかの作者と同じく WebFinger で確かめ、画面から取り消せる
- lock に固定されていない mod は、配信場所に関係なく実行しない
