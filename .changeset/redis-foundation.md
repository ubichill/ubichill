---
"@ubichill/backend": patch
---

backend と Go のインスタンスが Redis に繋がるようにする（`REDIS_URL`・`REDIS_PASSWORD`。どちらも任意で、未設定なら今まで通り Redis なしで動く）。backend の `/health` は Redis を設定したときだけ `redis: "ready" | "unavailable"` を載せ、Redis が落ちても 200 を返す。複数の backend・Go Pod で使うリース（メモリ実装と Redis 実装）を足したが、まだどこからも使わない。

Go のインスタンスの参加チケットの署名鍵を、`INSTANCE_TICKET_KEY` か、無ければ `INSTANCE_ADMIN_TOKEN` から派生した鍵にする（全 Pod・再起動の前後で同じ鍵）。Go を再起動しても発行済みのチケットとゲストの再接続情報は無効にならない。管理トークンを変えると発行済みのチケットは無効になる。

chart は backend と instance の両方に `REDIS_URL` と `REDIS_PASSWORD`（redis subchart の Secret を参照）を渡す。GitOps では `redis.auth.existingSecret` を指定すること（指定しないと描画のたびにパスワードが作り直される）。
