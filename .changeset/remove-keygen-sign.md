---
"@ubichill/sdk": major
---

鍵ファイルを自分で作って管理する `ubichill keygen` / `ubichill sign` を廃止する。署名は `ubichill login`（CI は `ubichill ci create`）のあと `ubichill publish` で行う（鍵は CLI が作り、作者アカウントに自動で登録される）。

- `ubichill install` は署名しなくなった（`--no-sign` / `--key-file` も廃止）。手元に鍵ファイルがあると、作者の付かない署名を黙って作っていた
- 署名の確認（旧 `ubichill sign --check`）は `ubichill verify <world.yaml>`。無効・未署名に加えて、作者アカウントの無い署名も不合格にする
- 旧コマンドを実行すると、代わりの使い方を表示して終了する
