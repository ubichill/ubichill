---
"@ubichill/shared": minor
---

`shared` レイヤーから mod 固有の概念を排除した。

- `User` から `penColor` / `heldEntityId` を削除（`heldEntityId` はカーソル追従に必要なため `cursor:move` / `cursor:moved` イベント側に残す）。
- 未使用の `EmojiEvent` と `isMenuOpen` を削除。
- `user:update` / `user:updated` イベントを廃止（呼び出し元・ハンドラをすべて除去）。

これにより `shared` は特定 mod（ペン等）の存在を知らない純粋な共有レイヤーになる。
