---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/loader": minor
"@ubichill/bff": patch
---

mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
