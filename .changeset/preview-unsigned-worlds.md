---
"@ubichill/backend": patch
---

開発・プレビュー（`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`、chart の `values-dev.yaml`）では、署名の無い同梱ワールド（`worlds/`）を公式アカウントの名義で「署名なし」として配る。公式ワールドの署名は main への push でしか付けないので、プレビューには入れるワールドが 1 つも無かった。本番（`NODE_ENV=production`）でこの設定を有効にすると起動しない。署名があって内容と合わないものは今まで通り配らない。
