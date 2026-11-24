---
"@ubichill/backend": minor
"@ubichill/bff": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

コントロールパネルに「ブランディング」を足す: サーバーのアイコン（タブ・iOS のホーム画面・PWA 用の PNG を作る）・紹介のページのバナー（1200×630 の WebP）・テーマの色（ボタンの文字とのコントラスト比 4.5 未満は断る）・略称（`PUT /api/v1/admin/branding`・`PUT`・`DELETE /api/v1/admin/branding/images/:kind`、画像は `GET /api/v1/server/images/:variant/:hash`）。`GET /api/v1/server` にブランディングを入れる。BFF はどのページにもアイコン・`/manifest.webmanifest`・テーマの色を入れ、紹介のページ（`/`）にサーバー名・紹介・バナーの OGP・Twitter Card・JSON-LD（WebSite・Organization）を出す。`sitemap.xml` に検索に出してよい人のページ（`GET /api/v1/server/directory`）を足し、プライベートのワールドはワールドのページも sitemap も検索に載せない。`robots.txt` は OGP の画像を読ませる。本番以外は `X-Robots-Tag: noindex` も付ける。shared に `themePalette`・`themeColorProblem` などを足す。マイグレーション 0049（`server_branding`・`server_images`）。
