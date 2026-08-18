---
"@ubichill/sdk": minor
"@ubichill/shared": minor
---

`entityRef`/`entityRefArray` の dataFields に `access: 'read' | 'write'`（既定 `'read'`）を追加した。

これまで「Inspector で他 Entity を参照した」ことが、参照先の読み取り・更新・削除すべてを一括で許可する強い権限になっていた。`access` を明示的に分離し、既定では読み取りのみを許可、`access: 'write'` を宣言したフィールドのみ参照先への `transform`/`data` 更新も許可するようにした。削除はこの経路からは一切許可されない（`watchScope` で見える Entity のみ削除可能）。
