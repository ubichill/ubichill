---
"@ubichill/cli": minor
"@ubichill/sdk": patch
"@ubichill/shared": patch
---

`ubichill build` が `config.dataOnly: true` の Component を、Worker を持たないデータ専用の Component として manifest に載せるようにした（バンドルせず、lock の components にも、置ける Component の一覧（`index.json` の `components`）にも載せない）。これまで `dataOnly` は型にあるだけでビルドが読んでおらず、mod が spawn するデータ（pen の `pen:stroke` など）を Worker として扱っていた。`ubichill dev` が `world.yaml` の無いときに合成するワールドにも data-only の型は置かない。manifest のスキーマに `dataOnly` を足した。

`dataOnly` を書いた Component の `export const config` をリテラルとして読めない（テンプレート文字列・定数・スプレッドを使っている）と、ビルドを止めてそう知らせる。これまでなら黙って Worker として bundle され、spawn した Entity ごとに Worker が起動していた。
