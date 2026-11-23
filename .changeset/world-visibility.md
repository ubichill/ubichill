---
"@ubichill/shared": minor
"@ubichill/backend": minor
"@ubichill/db": minor
---

ワールドに公開範囲（パブリック・プライベート）を足す。プライベートのワールドはインスタンスを作者しか作れず、一覧（ほかのサーバーへの一覧・お気に入り・プロフィール）に出ず、ワールドに置くポータルの行き先にできない。公開（署名した版）するまではプライベートとして扱い、既定はパブリック（マイグレーション 0048 の `worlds.visibility`）。作者は `PUT /api/v1/worlds/:worldId/visibility` で変える。ワールドに置くポータルは、行き先のワールドのパブリックの部屋（人のいちばん多い部屋。無ければ作る）へ入る。shared に `canStartInstance`・`isPortalDestination`・`canOpenRoomPortalTo`・`pickPortalInstance` を足した。ホームはほかの人のプライベートのワールドにできず、あとからプライベートになったら既定のワールドで入る。
