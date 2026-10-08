# @ubichill/bff

## 1.0.8

### Patch Changes

- 5d131c6: mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0

## 1.0.7

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0

## 1.0.6

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0

## 1.0.5

### Patch Changes

- Updated dependencies [0d3bd18]
  - @ubichill/shared@1.4.0

## 1.0.4

### Patch Changes

- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
  - @ubichill/shared@1.3.0

## 1.0.3

### Patch Changes

- Updated dependencies [c764ea4]
  - @ubichill/shared@1.2.0

## 1.0.2

### Patch Changes

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
  - @ubichill/shared@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/shared@1.0.1
