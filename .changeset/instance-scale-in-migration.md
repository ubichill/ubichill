---
"@ubichill/backend": patch
---

Go のインスタンスを KEDA で自動で縮められるようにする（K2）。縮めるとき、部屋の owner だけを別の Pod へ引っ越し、クライアントの WebSocket は切らない。

Go: SIGTERM で draining になったあと、作られてから `--migrate-after`（既定 3h）を過ぎても参加者の居る部屋を、Directory の ready な Pod（接続の少ない順）へ引っ越す。若い部屋は空になるか 3h に達するまで待つ。引っ越しは「凍結 → 先の Pod の `POST /realtime/v1/instances/{id}/handoff` で準備 → Directory の `Transfer`（token が一致すれば node と token を替え epoch+1。Redis は Lua）→ 確定」で行い、owner の居ない隙間を作らない（確定が届かなくても、先が準備の期限に Directory を見て引き取る）。凍結の間、変更系の要求は `code: "migrating"` の失敗（状態は変えない）。中継してきた Pod には `relay:migrate` を送り、中継元が新しい owner へ繋ぎ直してチケットを署名し直す。元の Pod に直接繋いでいたクライアントは、元の Pod が中継に変わる。新しい owner は繋ぎ直しで `user:joined` を出さない。部屋が無くなっても直接繋いでいるクライアントが居る間は `--drain-timeout` まで止まらず、その `--disconnect-notice`（既定 10m）前に `server:notice`（`{"kind":"disconnect","at":<epoch ms>}`）を送る。`--pod-deletion-cost` で自分の Pod に `controller.kubernetes.io/pod-deletion-cost`（直接の接続数 + owner の部屋の参加者数）を書く（client-go は使わない）。

chart: ScaledObject の scale-in を有効にした（既定: 安定化 900 秒・10 分に 1 Pod。`autoscaling.scaleDown`）。接続数・部屋数の query から draining の Pod を除く。`drainTimeout` の既定を 24h にし、`terminationGracePeriodSeconds` は空なら drainTimeout + 30 秒。`migrateAfter`・`disconnectNotice` を足した。自動スケールが有効なときだけ、instance の ServiceAccount・Role（pods の get/patch）・RoleBinding を作り、`POD_NAMESPACE` を渡す。
