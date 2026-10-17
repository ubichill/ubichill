---
"@ubichill/shared": patch
---

Go のインスタンスからメディア固有の処理を取り除き、部屋の汎用の共有状態に置き換える。

- 新しいイベント: `state:get`（キーの今の値）・`state:update`（キー・値・`expectedRevision`。一致したときだけ書き、`revision` を 1 進めて `updatedAt`（サーバー時刻の ms）と `updatedBy` を付ける。一致しなければ `code: "conflict"` と今の値を返す）・`state:changed`（書いた本人以外への通知）。値は解釈しない JSON。上限はキー 512 バイト・値 32KiB・部屋あたり 1000 キー・合計 4MiB。
- 消したイベント: `media:timeline:get`・`media:timeline:update`・`media:timeline`、どこからも使われていなかった `media:sync`・`media:state-request`・`media:state-response`（`MediaSyncState` 型も消す）。インスタンスのプロトコルは内部の API（docs/PROTOCOLS.md の D）なので互換の層は作らず、`protocolVersion` も上げない。
- メディアの意味（load/play/pause/seek/ended/metadata の状態遷移と再生位置の計算）は Host（`@ubichill/react` の `createMediaRuntime`）へ移した。共有状態の `updatedAt` を再生の基準時刻にする。mod 向けの `Ubi.media` と Worker へのイベントは変わらない。
