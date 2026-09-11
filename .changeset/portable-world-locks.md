---
'@ubichill/sdk': patch
---

外部ワールドの各 dependency に `source.url` を指定する portable lock 生成を標準化し、解決できない mod がある場合は部分的な lock を書かず失敗するようにしました。
