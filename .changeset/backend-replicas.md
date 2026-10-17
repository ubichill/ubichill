---
"@ubichill/backend": patch
---

Redis を設定した backend を複数台で動かせるように、プロセス内にあった状態を Redis で揃える（Redis なしの 1 台では今まで通り）。

- HTTP のレート制限（全体・インスタンス作成・サービストークン・外部の作品の再確認）は `rate-limit-redis` で台数をまたいで数える。Redis が落ちている間は制限せずに通し、警告は limiter ごとに 1 回だけ出す。
- better-auth のレート制限は `rateLimit.customStorage` で Redis に数える（`secondaryStorage` はセッションの保存先まで変えるので使わない）。Redis が落ちている間も、ログイン（`/api/auth/sign-in/email`）だけは 503 で断る。
- 空インスタンスの掃除と期限切れの CLI 認可の掃除は、リース `ubi:lease:reaper` を持つ 1 台だけが行う。Redis が落ちている間は掃除しない。Go に部屋が無いと最初に観測した時刻は `ubi:absent:<instanceId>` に置き、担当の backend が替わっても復旧の猶予が延びない。
- ワールドの保存・削除・再読み込み、作者の鍵・表示名の変更、外部ワールドの確かめ直し、連合のフォロー、公開のお気に入りの変更を、Pub/Sub（`ubi:ch:backend`）でほかの backend に知らせてキャッシュを捨てさせる。届かなくても期限で揃うよう、本体のワールドの解決結果（今までは期限なし）は 5 分、連合のフォロー先は 5 分で読み直す。
- ワールドの並び順はまだプロセス内のままで、複数台では揃わない。chart の `backend.replicaCount` は既定 1 のまま。Redis なしで 2 以上を指定すると描画で失敗する。
