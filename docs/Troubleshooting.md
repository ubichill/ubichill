
## 過去の不具合と修正（再発防止）
特にAI側では問題ないと思われたが、ブラウザで見たとき気づいた不具合を記入している

### アバターカーソルがユーザーに追従しなかった
`handleWorldJoin` で `user.id = authUser.id` をセットしていたが、socket イベント（`cursor:moved` 等）は `socket.id` を使って emit していた。クライアントの `users` Map が `authUser.id` をキーにしていたため、`socket.id` で来た更新が一致せず無視されていた。
**修正**: `user.id = socket.id` に統一。現在は Go が参加チケットの subject を `user.id` とし、全イベントで同じ ID を使う。

### ペン・アバターが動かなかった（EVT_LIFECYCLE_INIT deadlock）
`sendEvent` が `isInitialized=false` のときイベントをキューに積む実装だったため、初期化イベント自体もキューに入り Worker が永久に起動しなかった。
**修正**: `EVT_LIFECYCLE_INIT` のみ `this.worker.postMessage()` で直接送信。

### サーバー再起動後にインスタンスが消えない
socket disconnect ハンドラが走らない場合、DB の `currentUsers` がリセットされなかった。
**修正**: 当時はサーバー起動時に全インスタンスを削除していた。現在は在席を Go が持ち DB に書かない。reaper は Go の在席で空室を判定し、Go の再起動直後で部屋が無いインスタンスは「無いと観測した時刻」から猶予を数える（再接続で作り直される前に消さない）。

### ロビーに戻ってもペンのストロークが残る
`PenCanvasProvider` がアプリルートにマウントされており、`position:fixed` の SVG が常時表示されていた。
**修正**: `world:snapshot` 受信時にキャンバス参照をクリア。ロビー遷移時に `resetWorld()` を呼ぶ。

## mod が実行されない（コンソールに「検証に失敗 (signature-…/author-…)」）

Host は、作者アカウントの署名を確認できた mod だけを実行する（→ [MOD.md](./MOD.md#作者署名必須)）。

| 理由 | 対処 |
| --- | --- |
| `signature-missing` | 配布物に `lock.sig.json` が無い。`ubichill publish <ビルド出力>` で署名して置き直す |
| `signature-content-mismatch` / `signature-mod-mismatch` | 署名のあとにビルドし直した、または別の版の署名。署名し直す。ワールドの lock を手で書き換えた場合も起きる（`ubichill install` で作り直す） |
| `author-unconfirmed` | 署名鍵が作者の有効な公開環境の鍵ではない（公開環境を取り消した・別のサーバーのアカウント）。`ubichill whoami` で確かめ、署名し直す |
| `author-pending` | 作者のサーバーにいま問い合わせられない。時間をおいて読み込み直す |

