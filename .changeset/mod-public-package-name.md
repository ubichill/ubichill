---
"@ubichill/sdk": patch
---

公開 CLI が JSX を常にワークスペース名 `@ubichill/sdk` で解決していたため、npm の `ubichill` を
入れた mod 作者が JSX を書くとビルドが `Could not resolve "@ubichill/sdk/jsx-runtime"` で失敗して
いたのを修正した。`jsxImportSource` を公開名 `ubichill` にする。

あわせてリポジトリ内の mod を「外部の mod 作者と同じ書き方・同じ型」で扱うようにした。
import と `jsxImportSource` を公開名 `ubichill` に統一し、tsconfig の参照先を SDK のソースから
npm 公開物 (`dist-npm`) へ向けた。ソース参照では公開 d.ts に現れない内部依存まで解決できてしまい、
公開 API から漏れた型を使っても気づけなかった。SDK 内部への直接 import を許していた
`@ubichill/sdk/*` のワイルドカードも削除した。

mod のビルドテストは `node_modules/ubichill` を張る構成に変え、この壊れ方を検出できるようにした。
