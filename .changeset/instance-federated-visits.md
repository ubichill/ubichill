---
"@ubichill/instance": minor
---

ほかの ubichill のサーバーの画面から来る来訪者（連合）を入れる。`--federated-visits`（環境変数 `INSTANCE_FEDERATED_VISITS`、既定 true）で、
自分の画面でない origin からの WebSocket を受け、その origin に結び付いたチケット（管理 API の `origin`）でだけ入室させる。
自分の画面の origin の接続には、これまでどおり origin の無いチケットを求める（チケットを別の画面で使わせない）。
