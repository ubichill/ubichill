---
"@ubichill/sdk": patch
"@ubichill/cli": patch
---

npm 版（`ubichill`）を使う mod のバンドルに、使っていない SDK の実装（`UbiSDK` 本体など）が入らないようにした。これまでは `CORE_COMPONENT_TYPES` を 1 つ import するだけで minify 後に約 32KB 増えていた。`UbiSDK.FETCH_RPC_TIMEOUT_MS` は static フィールドから getter に変わる（読み取れる値は同じ。代入はできなくなる）。

あわせて、`ubichill build` が自動で見つける権限が正しくなる。これまでは SDK の本体がバンドルに入ると、その中の文字列に反応して、使っていない `scene:read`・`scene:update` まで付いていた。新しい SDK で作り直した mod が、この誤検出に頼って scene の API を使っていた（`Ubi` を分割代入や別名で使うなど）なら、`export const config` の `capabilities` に書く。`FETCH_LIMITS.defaultMaxBytes`・`maxBytes` の型は `number` から値そのもののリテラル型になる（他の項目と同じ）。`@ubichill/cli` は同梱する `world.html` と shared の定数が同じ変更を含むので版を上げる。
