# ブランディングと、紹介のページの OGP・SEO

管理者がコントロールパネルの「ブランディング」で、サーバーのアイコン・紹介のページのバナー・テーマの色・略称を決める（Misskey のブランディングにならった）。あわせて、紹介のページ（`/`）の OGP・JSON-LD と、`robots.txt`・`sitemap.xml` を BFF が出す。サーバーの名前と紹介は「全般」（[サーバーの紹介とサーバーの情報](server-info.md)）。

## できること

- コントロールパネルの「ブランディング」（`components/admin/BrandingSection.tsx`）
  - アイコン・バナー: 選んだらすぐ置き換える。「外す」で既定に戻す。
  - テーマの色（ボタンなどの主な色）と略称: 保存で反映する。色は保存の前に、決めた色で作った色の組のボタンとコントラスト比を見せる。
- アイコン: ブラウザーのタブ・iOS のホーム画面・PWA・紹介のページ・ワールドのページの見出し・OGP（バナーが無いとき）・JSON-LD のロゴ。
- バナー: 紹介のページの上と、`/` を共有したときの大きいカード。
- テーマの色: 画面のトークン（`primary` の仲間）を上書きする。PWA の `theme_color`。
- 略称: ホーム画面のアイコンの名前（manifest の `short_name`・`apple-mobile-web-app-title`）、ワールドのページの見出しとタブのタイトルの後ろ。空ならサーバー名。
- 紹介のページ（`/`）: `<title>`・`meta description`・OGP・Twitter Card・JSON-LD（`WebSite` と `Organization` を 1 つの `@graph`）。
- どのページの `<head>` にも、アイコン・`manifest.webmanifest`・テーマの色の `<style>` を入れる。
- `robots.txt`・`sitemap.xml`（本番だけ）。本番以外はどのページも `noindex`（`X-Robots-Tag` も付ける）。本番かどうかは backend の `NODE_ENV`（`/api/version` の environment）で決め、chart が同じ値を BFF に `DEPLOYMENT_ENVIRONMENT` で渡す（frontend のイメージは Express のために `NODE_ENV=production` 固定なので、それでは見分けられない）。
- 「おすすめや検索に出す」をオフにした人のユーザーページは `noindex`（見つからない人のページも）。

## 決めたこと

| 決めたこと | 理由 |
| --- | --- |
| 画像はプロフィール画像と同じく Postgres に置き、同じ作り直しの手順（`processImage`・sharp）を通す | オブジェクトストレージが無く backend が複数台。EXIF を消し、ハッシュ入りの URL で長く cache させる仕組みをそのまま使える。 |
| アイコンは正方形に切り抜き、32px・180px・192px・512px の PNG を作る | Safari は WebP の favicon を出せない。iOS のホーム画面・PWA の manifest も PNG を前提にする。180px（iOS）は透明な部分を白で塗る（iOS は黒で塗る）。送られた画像を読むのは 1 回だけで、小さいものは作り直した 512px から縮める。 |
| バナーは 1200×630 の WebP | OGP の推奨の比。プロフィール画像・ワールドのサムネイルも WebP を OGP に出している。 |
| 置いた画像は種類（アイコン・バナー）ごとにまとめて入れ替える（`pg_advisory_xact_lock`） | 同時に 2 枚送られても、タブのアイコンは片方・PWA はもう片方、と混ざらない。アイコンは 4 つそろっているときだけ出す。 |
| 略称と色は `server_branding`、画像は `server_images`（`server_info` に列を足さない） | `server_info` はサーバー名が必須の行。色だけ決めたときに既定の名前で行を作り、「全般を一度も保存していない」が分からなくなるのを避けた。 |
| テーマの色は主な色だけ（背景などは変えない） | 主な色から、押したとき・押している間・フォーカスの輪・半透明の色を作る（shared の `themePalette`）。背景まで変えると、文字の色との組み合わせを全部確かめないといけない。 |
| ボタンの文字（`textOnPrimary`）とのコントラスト比が 4.5 未満の色は断る | WCAG AA（通常の文字）。押したとき・押している間の色も 4.5 以上に保つ（既定の色と同じく明るくするが、明るくして読めなくなる色は暗くする）。比は切り捨てて見せる（4.49 を 4.5 と出して「足りているのに断られた」と見せない）。 |
| フォーカスの輪の色（`primaryHighlight`）は明るさを決めた値にそろえる。灰色・黒は彩度を足さない | どの主な色でも、暗いワールドの上で見える。無彩色に彩度を足すと赤になる。 |
| 色は BFF が HTML の `<style id="ubichill-theme">` に入れ、画面は起動したときに `GET /api/v1/server` を読んで同じ要素を書き換える | 読み込んだ直後に既定の色が一瞬見えない。管理者が変えたらその場で画面に出る。既定に戻したときも、BFF が入れた前の色が残らない。開発（Vite だけ）でも色が出る。 |
| BFF はサーバーの情報を 30 秒覚え、古くなったら覚えている値を返しつつ裏で読み直す。読めなければ 5 秒は読みに行かない | どのページの HTML にも入れるので、毎回 backend を待たせない。backend が落ちている間も HTML を遅らせない（既定の見た目で返す）。 |
| `GET /api/v1/server` にブランディングを入れる（別の口を作らない） | 紹介のページ・画面の色・BFF が同じものを読む。 |
| sitemap には、紹介のページ・このサーバーのパブリックなワールド・「おすすめや検索に出す」をオンにしている人のページだけを載せる | プライベートのワールド・外部のファイル・連合のワールドは載せない（ワールドのページの判定 `isWorldIndexable` と同じ。この PR でワールドのページもプライベートなら `noindex` にした）。検索に出すのをオフにした人は載せない。 |
| sitemap は 1 つのファイルで、人は ID の順に 1 万人まで。人のページには `lastmod` を付けない。BFF が 1 時間、backend が 10 分覚え、`/api/v1/server/directory` は本番だけ（ほかは 404）・IP ごとに 1 分 30 回まで | sitemaps.org の上限（5 万件）に収まる。`users.updated_at` はメールの連携・パスワードの変更でも変わるので、時刻やその順に並べるとアカウントを変えた時刻が外に出る。ワールドの一覧は全部を解決して作るので重い。超えるようになったら sitemap index に分ける。 |
| `robots.txt` は `/api/` を断るが、OGP の画像（サーバー・プロフィール・ワールドの画像）は読ませる | X（Twitter）のカードを作るクローラーは robots.txt に従い、断った画像はカードに出さない。 |
| `/favicon.ico` は今のアイコンの PNG へ移す（302） | `<link rel="icon">` を読まないクライアント（フィードリーダーなど）が見に来る。 |

## 仕組み

- shared: `server/branding.ts`（作る画像の種類・URL・`ServerBrandingUpdateSchema`）、`server/themeColor.ts`（コントラスト比・色の組・CSS 変数）。panda.config.ts も既定の `primary`・`textOnPrimary` をここから取る。
- DB: `server_branding`（1 行）・`server_images`（作った画像ごとに 1 行）。migration 0049。
- backend: `services/server/branding.ts`（手順）・`brandingImages.ts`（画像を作る）・`brandingService.ts`（配線）。
  - `GET /api/v1/server`: 情報・ブランディング・新規登録・人数（`no-cache`）。
  - `GET /api/v1/server/images/:variant/:hash.(png|webp)`: 画像（`immutable`）。
  - `GET /api/v1/server/directory`: 検索に出してよい人の ID（sitemap 用。本番だけ）。
  - `PUT /api/v1/admin/branding`・`PUT`・`DELETE /api/v1/admin/branding/images/:kind`（管理者だけ）。
- BFF: `site.ts`（応答をまとめる。古い backend でも既定で動く）・`head.ts`（どのページにも入れるもの）・`landing.ts`・`manifest.ts`・`crawl.ts`（robots・sitemap・ワールドを載せてよいか）・`shell.ts`（index.html の既定のタイトル・説明・アイコンを外して入れる）・`refreshing.ts`。
- フロント: `lib/server/serverInfo.ts`（読んで覚え、色を掛ける）。

## 残り

- PWA の maskable アイコン（安全な余白を付けたもの）。
- 管理者が保存する前に、画面全体を決めた色で見てみる。
