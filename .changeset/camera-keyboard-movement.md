---
"@ubichill/shared": minor
"@ubichill/backend": patch
---

`environment.movementMode: 'mouse' | 'keyboard'`(既定 `'mouse'`)を追加した。

- `'mouse'`（既定）: 従来通りマウス追従・ネイティブ自由スクロール。`worldSize` は見た目のキャンバスサイズのヒントに過ぎず、強制力は無い。
- `'keyboard'`: 矢印キーでアバター自身の position を動かし、カメラ(スクロール位置)がアバターへ追従する(ゲーム向け)。このモードでのみ `worldSize` がカメラのパン可能範囲として実際にクランプされる。

`packages/frontend/src/components/cursor/useKeyboardMovement.ts`(押下キーからの位置積分・既存の `updatePosition`/`cursor:move` をそのまま再利用)と `useCameraFollow.ts`(スクロール位置の追従計算)を追加し、`CursorLayer.tsx` に配線した。`mouse` モードの既存ワールド(pen・video-player・チルわ等)の挙動は一切変更していない。

あわせて、前回PRで追加した Component の永続 id (`EntityComponentSchema.id`) が `worldResolver.ts` の `normalizeEntity` で欠落しており、実運用では常に index フォールバックになっていた不具合を修正した。
