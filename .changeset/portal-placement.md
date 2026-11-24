---
"@ubichill/instance": minor
"@ubichill/shared": patch
---

部屋へのポータルを、部屋のいちばん前に置く。インスタンスは `portal:open` で作る `core:portal` の z を、ワールドの座標の Entity の z のいちばん大きいものの 1 つ上（整数）にする（画面に固定する `overlay` の Entity と、置き直しで消す自分の前のポータルは比べない。Entity が無ければ 0、transform の上限 1e7 を超えるなら 1e7）。弾幕の範囲（z: 5000）のようにワールドを覆う Entity の上にも出る。画面は置く場所を選ばせてから `portal:open` を送る（shared の `portal:open`・`roomPortalCenter` の説明を合わせた）。
