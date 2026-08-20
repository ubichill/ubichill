---
"@ubichill/shared": minor
"@ubichill/sdk": minor
"@ubichill/backend": patch
---

`Ubi.ride`(乗る)プリミティブを追加した。乗り物 Entity が `Ubi.ride.exclusive()` を宣言すると、
ユーザーがそれに乗っている間だけアバターが OS カーソルから切り離され、矢印キーでの移動 + カメラ追従に切り替わる。
降りると通常のマウス追従に戻る。マウスとキーボードはワールド単位の排他設定ではなく、乗車状態によって動的に切り替わる
(`CMD_RIDE`・`packages/react` の `RideProvider`/`useRide`/`ridingSyncRef` を追加)。

`packages/frontend/src/components/cursor/useKeyboardMovement.ts`(押下キーからの位置積分・既存の
`updatePosition`/`cursor:move` をそのまま再利用)と `useCameraFollow.ts`(スクロール位置の追従計算の純関数)を追加し、
`CursorLayer.tsx` に配線した。マウス操作のみの既存ワールド(pen・video-player・チルわ等)の挙動は一切変更していない。

あわせて、前回PRで追加した Component の永続 id (`EntityComponentSchema.id`) が `worldResolver.ts` の
`normalizeEntity` で欠落しており、実運用では常に index フォールバックになっていた不具合を修正した。
