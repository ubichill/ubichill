---
"@ubichill/sdk": patch
"@ubichill/cli": patch
---

npm 版（`ubichill`）を使う mod のバンドルに、使っていない SDK の実装（`UbiSDK` 本体など）が入らないようにした。これまでは `CORE_COMPONENT_TYPES` を 1 つ import するだけで minify 後に約 32KB 増えていた。`UbiSDK.FETCH_RPC_TIMEOUT_MS` は static フィールドから getter に変わる（読み取れる値は同じ）。`FETCH_LIMITS.defaultMaxBytes`・`maxBytes` の型は `number` から値そのもののリテラル型になる（他の項目と同じ）。`@ubichill/cli` は同梱する `world.html` と shared の定数が同じ変更を含むので版を上げる。
