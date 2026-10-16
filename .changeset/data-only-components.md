---
"@ubichill/sdk": patch
"@ubichill/shared": patch
---

`ubichill build` が `config.dataOnly: true` の Component を、Worker を持たないデータ専用の Component として manifest に載せるようにした（バンドル・lock の components には載せない）。これまで `dataOnly` は型にあるだけでビルドが読んでおらず、mod が spawn するデータ（pen の `pen:stroke` など）を Host が「Worker が見つからない」と警告していた。manifest のスキーマに `dataOnly` を足した。
