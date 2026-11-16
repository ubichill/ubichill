---
"@ubichill/shared": minor
"@ubichill/cli": minor
"@ubichill/sdk": patch
---

mod に見た目の画像を同梱できるようにする。mod のサムネイル（`package.json` の `ubichill.thumbnail` → manifest の `thumbnail`）・Component の見た目（`config.thumbnail`）・プレハブの見た目（`prefabs/*.json` の `thumbnail`）は、どれも `assets/` 内の画像を指し、`assetIntegrity` で hash を固定する。`ubichill build` は参照先が `assets/` にあり、png・jpg・webp・avif・svg で 256 KB 以下かを確かめる。エディタは hash を確かめた画像だけを、アセット欄・Component の追加・mod 管理の一覧・作品ページに出す。
