---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/loader": minor
"@ubichill/bff": patch
---

mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP を配信するよう修正（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
