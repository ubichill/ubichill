---
"@ubichill/shared": minor
---

`absoluteEntityTransform`（Entity の transform の絶対化と省略の補い）と `componentTransformOf`（Component の transform の上書き）を足し、`flattenGameObject` もこれを使う。エディタの描画と、プレハブを置く位置・一式の枠の計算も同じ関数で大きさを決め、Component にだけ幅・高さがあるプレハブの真ん中が落とした場所からずれないようにする。
