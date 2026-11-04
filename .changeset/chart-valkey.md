---
"@ubichill/backend": patch
---

chart の同梱の Redis を、Bitnami の subchart（`bitnami/redis:latest`）から chart 自身のテンプレートで動かす Valkey（`valkey/valkey:8.1.11-alpine`、Redis 7.2 互換）に替えた。

- Service `<release>-redis-master:6379` と Secret の参照は変わらないので、backend・instance の `REDIS_URL`・`REDIS_PASSWORD` はそのまま。
- StatefulSet・PVC の名前が変わるので、移行のときに Redis の中身は消える（Go は部屋を作り直し、レート制限は 0 から数え直す。ログインのセッションは Postgres なので消えない）。手順は chart の README の「Bitnami の subchart からの移行」。
- `redis.auth.password` か `redis.auth.existingSecret` が要る（乱数で作らない）。イメージは版で固定し、`latest` と Bitnami のイメージは描画で失敗する。
- `maxmemory` はメモリの上限の 75%、`maxmemory-policy` は `noeviction`（リースを追い出さない）。
- exporter は `oliver006/redis_exporter` の sidecar（`redis.metrics.enabled`）。
