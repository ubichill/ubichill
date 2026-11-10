---
"@ubichill/shared": minor
"@ubichill/backend": minor
---

フェディバースの固定ノートを、種類（作ったワールド・公開している mod・お気に入りのワールド）ごとに 1 つのノートにまとめた。それぞれ新しい順に 10 件まで並べ、画像は 4 枚まで添付する。

- ノートの id は種類と中身の要約にした（中身が変わると id も変わる）。Mastodon・Misskey は同じ id のノートを取り直さないため。
- shared: `FEATURED_LIMITS` をやめて `FEATURED_ITEMS_PER_NOTE`・`FEATURED_IMAGES_PER_NOTE`・`FEATURED_KINDS` を足した。`pickFeatured` は種類ごとのグループ（`FeaturedGroup`）を返し、`featuredNoteContent`・`buildFeaturedNote` はグループを受け取る。`FeaturedItem` から `kind`・`key` を外した。
