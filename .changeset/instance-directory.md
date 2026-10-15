---
"@ubichill/backend": patch
"@ubichill/shared": patch
---

Go のインスタンスに部屋の Directory を足す（G1）。部屋を作る（`PUT /realtime/v1/instances/{id}`）ときに、部屋をこのノードに割り当てる（Redis を設定したら Redis、無ければメモリ）。owner は部屋のリースを 5 秒ごとに延長し、最後に成功した延長の要求を送った時刻から 10 秒（TTL 15 秒 − 余裕 5 秒）を過ぎるか、延長が token 不一致で失敗したら、その部屋の状態変更と入室を止めて接続を閉じる（`instance:closing` は送らない。クライアントはチケットを取り直して入り直し、部屋は新しい epoch で作り直される）。Redis の中身が消えて `ubi:cluster:gen` が変わったら全部屋を捨てる。Redis を設定したあと Redis が落ちても、メモリに切り替えない（新しい部屋は 503、既存の部屋は自己停止する）。

参加チケットに部屋の世代（`gen`・`epoch`）を入れ、今の部屋の世代と一致しなければ `ticket_invalid` で拒否する。ゲストの再接続情報も、世代が違えば新しいゲスト ID を発行する（Go を再起動すると部屋の世代が変わるので、ゲストは新しい ID で入り直す）。

管理 API: 別のノードが owner の部屋の作成・終了は 409 と owner（`node`・`gen`・`epoch`・`addr`・`alive`）を返す。終了は自分が今の owner のときだけ行い、割り当てを token で解放する。在席のレスポンスに `node`・`gen`・`epoch` を足した（任意の項目。単体モードのゲスト向けには返さない）。backend はまだ使わない（G2 から）。

chart は instance に `POD_NAME`・`POD_IP`（Downward API）を渡す。instance は `replicas: 1` のまま（WebSocket を owner に振り分ける Router は G2）。
