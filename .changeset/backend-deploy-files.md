---
'@ubichill/backend': patch
---

pnpm 12 の `pnpm deploy` が backend の `.gitignore`（`dist/`）に従い `dist/index.js` 以外を落とし、起動時に `Cannot find module './config'` で落ちていた問題を修正しました。`files` で `dist` を明示し、Docker ビルドでデプロイ後の `dist` がビルド成果物と一致するかを検証します。
