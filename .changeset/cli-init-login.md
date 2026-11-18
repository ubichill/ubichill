---
'@ubichill/cli': patch
---

`ubichill init mod` の雛形に `src/env.d.ts`（Worker のグローバルの `Ubi` の型の宣言）を置き、`Ubi` を使うと `npm run build` の型チェックで落ちていたのを直す。`ubichill login` は Windows では `cmd` を通さず `explorer.exe` でブラウザを開き（URL の `&` で state が落ちていた）、サーバーが返す承認画面の URL はログイン先と同じオリジンの http(s) だけを開く（ログイン先が localhost なら、localhost の別のポートも開く）。
