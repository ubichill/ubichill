---
"@ubichill/backend": patch
---

画像の作り直しで色の数を数えるのを、Set ではなく 24 ビットの RGB の印で数えるようにする（2048×2048 で main thread を止める時間が 50〜100 ms → 26 ms）。可逆を作る時間の上限の説明を、sharp の timeout に合わせて 1〜2 秒に直す。
