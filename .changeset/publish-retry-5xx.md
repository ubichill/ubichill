---
"@ubichill/cli": patch
---

`ubichill publish --public-url` は、公開済みの版を確かめるときに公開先が一時的なエラー（5xx・通信の失敗）を返したら、間をおいて 3 回までやり直す。GitHub Pages が反映中に返す 503 で公開が止まらないようにする。
