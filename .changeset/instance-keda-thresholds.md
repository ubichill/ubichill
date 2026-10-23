---
"@ubichill/backend": patch
---

chart: Go のインスタンスの KEDA の閾値を負荷試験の結果で決める。`instanceRuntime.autoscaling.targetConnectionsPerPod` の既定を 300 から 200 に下げ、CPU の trigger（`targetCPUPerPod`、既定 600m、空なら作らない）を足す。大人数の部屋は配信が人数の 2 乗で増え、接続数では負荷を測れないため。
