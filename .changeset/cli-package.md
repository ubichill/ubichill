---
"@ubichill/sdk": major
"@ubichill/cli": major
"@ubichill/shared": patch
"@ubichill/loader": patch
---

CLI を `ubichill` から分け、`@ubichill/cli` として公開する。`ubichill` は mod が import する SDK だけになり、bin と `esbuild`・`yaml` への依存が無くなる（mod 開発者は `npm i ubichill` に加えて `npm i -D @ubichill/cli` を入れる。`ubichill` コマンドの名前と使い方は変わらない）。
