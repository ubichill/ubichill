---
"@ubichill/backend": patch
"@ubichill/db": patch
---

routes・middleware から DB を直接呼ばないようにし、手順を services に移した。CLI の認可で同時に同じ鍵を登録したときに 500 になるのを 409 にした。起動の途中で送ったキャッシュの破棄の知らせ（公式アカウントの鍵の取り消しなど）が、ほかの backend に届かずに捨てられていたのを、繋いだときに送るようにした。`authorKeyRepository.createLocal` は同じ鍵がもうあれば例外ではなく `undefined` を返す。
