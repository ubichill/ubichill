---
"@ubichill/backend": patch
---

インスタンス作成の 1 IP・1 時間あたりの上限を `INSTANCE_CREATE_LIMIT_PER_HOUR` で変えられるようにする（既定は 10 のまま）。負荷試験のために dev で上げる用。本番（`NODE_ENV=production`）では既定より大きくすると起動しない。
