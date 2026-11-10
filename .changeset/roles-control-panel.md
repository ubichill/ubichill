---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

ロール（Misskey のロールに合わせたもの）と、管理者のコントロールパネルを足した。

- 管理者は公式アカウント（`ubichill`。ロールに関係なく常に管理者）と、期限の切れていない「管理者」のロールを持つ人。
  `requireAdmin`・`/api/v1/users/me` の `isAdmin`・お知らせの投稿がこの判定を使う。お知らせは公式アカウントだけでなく管理者なら出せる。
- 公開のロールはプロフィール（`UserProfile.roles`。`{ id, name, color }` を表示順に）に出す。ほかのサーバーの人は空。
- API（管理者だけ）: `GET/POST /api/v1/admin/roles`・`PUT/DELETE /api/v1/admin/roles/:roleId`・
  `GET /api/v1/admin/roles/:roleId/members`・`PUT/DELETE /api/v1/admin/roles/:roleId/members/:userId`・`GET /api/v1/admin/users?q=`。
- shared: `RoleInputSchema`・`RoleAssignmentRequestSchema`・`isAdministrator`・`publicRolesOf`・`assignedRolesOf`・`compareRoles` などを足した。
  `userProfileOf` は 3 つ目の引数に公開のロールを取る。
- db: 0034（`roles`・`role_assignments`）。`roleRepository`・`userRepository.listRecent` を足した。
- 画面: 管理者にだけ、ランチパッドの左の列に「コントロールパネル」（ユーザー・ロール・連合・お知らせ）を出す。連合とお知らせは設定から移した。
