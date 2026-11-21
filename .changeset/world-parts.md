---
"@ubichill/core-components": minor
"@ubichill/shared": minor
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/sdk": minor
"@ubichill/cli": minor
---

mod を書かなくてもワールドに置ける本体の部品を足す: 画像（`core:image`）・文字（`core:text`）・ほかのワールドへの入口（`core:portal`）。ワールドの背景に画像を敷けるようにする（`environment.backgroundImage`・`backgroundImageFit`）。ワールドの作者は画像をこのサーバーに上げられる（`POST /api/v1/assets`。作り直した WebP を中身のハッシュの URL で配る。1 人 200 枚・200 MB まで。マイグレーション 0045）。

mod に埋め込まれる本体の部品の一覧が増えたので、公式ワールド（弾幕）の mod danmaku を 1.0.5 に上げる。
