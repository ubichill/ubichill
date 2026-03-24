
## 過去の不具合と修正（再発防止）
特にAI側では問題ないと思われたが、ブラウザで見たとき気づいた不具合を記入している

### アバターカーソルがユーザーに追従しなかった
`handleWorldJoin` で `user.id = authUser.id` をセットしていたが、socket イベント（`cursor:moved` 等）は `socket.id` を使って emit していた。クライアントの `users` Map が `authUser.id` をキーにしていたため、`socket.id` で来た更新が一致せず無視されていた。
**修正**: `user.id = socket.id` に統一。

### ペン・アバターが動かなかった（EVT_LIFECYCLE_INIT deadlock）
`sendEvent` が `isInitialized=false` のときイベントをキューに積む実装だったため、初期化イベント自体もキューに入り Worker が永久に起動しなかった。
**修正**: `EVT_LIFECYCLE_INIT` のみ `this.worker.postMessage()` で直接送信。

### サーバー再起動後にインスタンスが消えない
socket disconnect ハンドラが走らない場合、DB の `currentUsers` がリセットされなかった。
**修正**: サーバー起動時に `instanceManager.cleanupAll()` を実行 + `world:leave` イベントを追加。

### ロビーに戻ってもペンのストロークが残る
`PenCanvasProvider` がアプリルートにマウントされており、`position:fixed` の SVG が常時表示されていた。
**修正**: `world:snapshot` 受信時にキャンバス参照をクリア。ロビー遷移時に `resetWorld()` を呼ぶ。
