---
'@ubichill/sdk': patch
---

`Ubi.event.define()` の `on` / `onBroadcast` で、handler の中で自分を解除すると同じイベントの次の handler が呼ばれなかったのを直す。handler の中で追加した handler は、その回では呼ばれず次から呼ばれる。同じ handler を 2 回登録したときに解除を 2 回呼ぶと、もう 1 つの登録まで消えていたのも直す。`jsx-runtime` の型の案内を、公開名の `"jsxImportSource": "ubichill"` に直す。
