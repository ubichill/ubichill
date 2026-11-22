---
"@ubichill/shared": minor
"@ubichill/instance": minor
"@ubichill/backend": minor
"@ubichill/db": minor
---

部屋にいる人が、どのワールドの部屋でも、ほかの部屋へのポータルを開けるようにする。行き先はワールドではなく部屋なので、後から通った人も同じ部屋に入る。インスタンスは `portal:open` を受けると `core:portal` の Entity（data は `room`・`expiresAt`・`ownerName`）を作って全員に配り、3 分で消す（1 人 1 つ・置き直しは 3 秒あける・1 部屋 64 まで・置いた人が部屋を出ても消さない）。閉じられるのは置いた人だけ（`portal:close`）。数字は shared の `ROOM_PORTAL`。インスタンスの作成に `holdEmptyMs` を足し、ポータルの先に作った部屋は `held_until`（マイグレーション 0046）まで空でも消さない。
