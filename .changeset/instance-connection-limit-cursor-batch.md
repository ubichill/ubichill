---
"@ubichill/backend": patch
"@ubichill/shared": minor
---

Go のインスタンスにカーソルのまとめ送りと接続数の上限を足した。

- Go: `--cursor-batch-interval`（既定 50ms、0 で無効）。`world:join` で `features: ["cursors:batch"]` を宣言した接続には、間隔の中の `cursor:move` を利用者ごとに最新の 1 件にし、自分の分を除いて 1 フレームの `cursors:moved` で送る。宣言しない接続には今まで通り `cursor:moved` を 1 件ずつ送る。中継は宣言をそのまま owner へ通し、引っ越しでは同じ宣言で入り直す。
- Go: `--max-connections`（既定 0＝無制限）。上限の 9 割から新しい部屋（作成・引っ越し）を 503 で断り、heartbeat の `full` と `room_capacity_available` を 0 にする。上限で新しい参加者の `world:join`（直接・中継の両方）を `instance_unavailable` で断る。入室中の接続は切らず、`/ready` も落とさない。指標 `ubichill_instance_connection_capacity`・`ubichill_instance_rejected_joins_total{reason}` を足した。chart は `instanceRuntime.maxConnections`。
- backend: heartbeat の `full` の Pod には新しい部屋を置かない（古い版の Pod は書かないので部屋数だけで決める）。
- shared: `ServerToClientEvents` に `cursors:moved`、`world:join` の data に `features?`（`InstanceFeature`）、`CursorMovedPayload` を足した。宣言を足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。
