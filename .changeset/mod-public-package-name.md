---
"@ubichill/sdk": patch
---

公開 CLI が JSX を常にワークスペース名 `@ubichill/sdk` で解決していたため、npm の `ubichill` を
入れた mod 作者が JSX を書くとビルドが `Could not resolve "@ubichill/sdk/jsx-runtime"` で失敗して
いたのを修正した。`jsxImportSource` を公開名 `ubichill` にする。

あわせてリポジトリ内の mod を外部の mod 作者と同じ書き方に揃えた。import と `jsxImportSource` を
公開名 `ubichill` に統一し、SDK 内部への直接 import を許していた `@ubichill/sdk/*` のワイルドカード
を削除した。mod のビルドテストは `node_modules/ubichill` を張る構成に変え、この壊れ方を検出できる
ようにした。
