---
"@ubichill/ecs": patch
"@ubichill/backend": patch
---

ECS・バックエンドのテストを追加し、発見した不具合を修正。

- `@ubichill/ecs`: クエリ結果の stale キャッシュが原因でエンティティ追加/削除後に誤った結果を返す不具合を修正（毎回フィルタする方式へ）。`entity` / `world` のテストを追加。
- `@ubichill/backend`: `validateUsername`（空白のみ入力が通る）と `validateUserStatus`（`dnd` 未対応）の不具合を修正。`validation` / `userManager` / `instanceState` / `flattenGameObject` のテストを追加し、`instanceState` と `flattenGameObject` は副作用を分離して純粋化。
