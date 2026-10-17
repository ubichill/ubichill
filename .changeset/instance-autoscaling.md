---
"@ubichill/backend": patch
---

Go のインスタンスの負荷を Prometheus で集め、KEDA で Pod を自動で増やせるようにする（K1）。

Go: `GET /metrics`（認証なし。Ingress には出さない）で `ubichill_instance_active_rooms`・`room_capacity`・`room_capacity_available`（draining の間は 0）・`websocket_connections`（heartbeat の `connections` と同じ。中継を含む）・`relay_connections`・`draining` を Prometheus の text 形式で出す。依存を増やさないよう標準ライブラリだけで書いた。

chart: `instanceRuntime.metrics.serviceMonitor.enabled` で ServiceMonitor を、`instanceRuntime.autoscaling.enabled` で KEDA の ScaledObject（`minReplicaCount: 1`・自動の scale-in は無効・接続数と部屋数の 2 つの trigger）を作る。どちらも既定は無効。ScaledObject は `directory: redis` でないと描画で失敗し、有効なときは Deployment に `replicas` を書かない。instance の Service にラベルを付けた。
