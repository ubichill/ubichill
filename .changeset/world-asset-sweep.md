---
"@ubichill/backend": patch
"@ubichill/db": patch
"@ubichill/shared": minor
---

どのワールドにも使われていないワールドの画像を、上げてから 7 日たったら消す（起動の 1 分後と 6 時間ごと、reaper のリースを持つ 1 台だけ）。このサーバーのワールドの下書き・版（だれのワールドでも）の定義に `<hash>.webp` が出てくれば使われているとみなす。同じ画像を上げ直すと猶予を数え直す（`created_at` を今にする）。shared に参照の形 `WORLD_ASSET_REFERENCE_PATTERN` を足す。
