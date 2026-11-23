---
"@ubichill/shared": patch
"@ubichill/backend": patch
---

外部のワールドの公開範囲を閉じる側に倒す。作者の鍵の取得が一時的に失敗したとき（429・5xx・時間切れ。404・410 以外）は作者が無いとせず pending にする（shared の authorKeyDirectory。`fetchJson` は一時的な失敗を例外にする）。作者のサーバーの正規の URL の公開範囲を確かめられず、前に確かめた結果も無いときは部屋を作らない（503、`ResolvedWorld.visibilityUnconfirmed`）。外部のワールド・正規の URL を取りに行く回数に、ドメインごとに 1 分 120 回の上限を付ける。
