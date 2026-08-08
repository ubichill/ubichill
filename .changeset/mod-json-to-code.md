---
"@ubichill/sdk": minor
---

mod.json 廃止に伴う SDK 公開 API の追加:
- `export type { ComponentConfig, DataField, DataFieldType }` を追加（Worker コード内の config 宣言用）
- `export type { Ubi }` を追加（mod から見た Ubi グローバルの公開型）
- `cli/build.ts` が `mod.json` に代わり `package.json` + `export const config` からビルドするよう変更
