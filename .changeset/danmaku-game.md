---
"@ubichill/backend": patch
"@ubichill/loader": patch
---

公式ワールド（弾幕）をゲームにする。mod danmaku を 2.0.0 に上げる（壁 `danmaku:wall` を消すので major）。敵 `danmaku:enemy`（Worker を持たず設定だけ。現れる・去る秒、動き方、撃ち方 radial・spiral・aimed・rain）を遊ぶ範囲 `danmaku:canvas` の中に置くと、範囲がステージとして動かす。自機は範囲から出られず、HP・被弾後の無敵・撃墜と復活を持つ。部屋で共有するのはラウンドと始まった時刻と各自のダメージだけで、敵と弾は各クライアントが時刻から計算する。弾幕ワールドの結合テスト（loader）を壁からステージの確認に書き換える。ワールドのエディタは、設定欄（dataFields）を持つデータ専用の Component を置けるようにする（敵を置いて設定するため）。
