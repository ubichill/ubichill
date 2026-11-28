# @ubichill/bff

## 1.1.0

### Minor Changes

- e3611a0: コントロールパネルに「ブランディング」を足す: サーバーのアイコン（タブ・iOS のホーム画面・PWA 用の PNG を作る）・紹介のページのバナー（1200×630 の WebP）・テーマの色（ボタンの文字とのコントラスト比 4.5 未満は断る）・略称（`PUT /api/v1/admin/branding`・`PUT`・`DELETE /api/v1/admin/branding/images/:kind`、画像は `GET /api/v1/server/images/:variant/:hash`）。`GET /api/v1/server` にブランディングを入れる。BFF はどのページにもアイコン・`/manifest.webmanifest`・テーマの色を入れ、紹介のページ（`/`）にサーバー名・紹介・バナーの OGP・Twitter Card・JSON-LD（WebSite・Organization）を出す。`sitemap.xml` に検索に出してよい人のページ（`GET /api/v1/server/directory`。本番だけ）を足し、プライベートのワールドはワールドのページも sitemap も検索に載せない。「おすすめや検索に出す」をオフにした人のユーザーページは `noindex`（プロフィールに `discoverable` を足した）。`robots.txt` は OGP の画像を読ませる。BFF は検索に載せるかを `DEPLOYMENT_ENVIRONMENT`（chart が backend の `NODE_ENV` を渡す）で決め、本番以外は `X-Robots-Tag: noindex` も付ける。shared に `themePalette`・`themeColorProblem` などを足す。マイグレーション 0049（`server_branding`・`server_images`）。

### Patch Changes

- 8806acb: UI（`core:ui`）を、Entity の大きさの四角にする（FigJam の図形と同じ考え方）。塗り（`fill`）・枠線（`border`・`borderWidth`）・角丸（`radius`）・テキスト（`text`・`size`・`color`・`align`・`bold`）を持ち、`button: true` で押せるようになる。押すと、同じ Entity のスクリプト（ワープ `core:warp`・スイッチ `core:switch`・ポータル `core:portal`）を動かす。ワープ・スイッチは並び順に動かし、部屋を出るポータルは並びの最初の 1 つだけを最後に動かす（2 つ目からのポータルは動かず、エディタで知らせる）。押した動きが終わるまで同じボタンは押し直しても動かず、ボタンにした UI の `markup` は見た目だけ（中のリンクは押せない）。エディタの UI・テキストの欄は、data に無い項目に部屋で描く値を出す（置いたときの白い角丸の四角と「ようこそ」は、足したときの data として書く）。スクリプトは、ボタンにした UI があると自分では描かず、無ければ今まで通りの標準のボタンを出す。HTML 風の UI データ（`markup`）は上級者向けとして残す（書くとテキストの代わりに描く）。書いていない項目は描かないので、前の版の `core:ui` の見た目は変わらない。

  本体の部品の表示名を、型の名前の読みにそろえる（コライダー・メディア・UI・イメージ・テキスト・ポータル・ワープ・スイッチ・スポーン）。「入口」「最初の場所」「画像」「文字」と呼んでいたものは、YAML の `core:portal` などと対応が分からなかった。ポータルの既定の名前と、公開に要るサムネイルの説明も「ポータル」にする。

- 026f27e: 画面・エラー・`ubichill dev` の出力・文書で「部屋」と「インスタンス」が混ざっていたのを「インスタンス」にそろえる（型の `Instance` の読み）。入れないインスタンスの呼び方は「プライベートインスタンス」にそろえる。用語集 `GLOSSARY.md` を足す。連合のプロトコルの `rooms`・部屋の住所の形は変えない。
- b5a4f17: World Editor のコントロールパネルから、エディタの画面を撮ってサムネイルにできるようにする（「画面から撮る」で 16:9 の枠を出し、部屋で見える通りに描いて撮る）。ほかのサーバーのエディタも写せるように、上げた画像（`/api/v1/assets/*.webp`）と公式ワールドのサムネイル（`/world-thumbnails/*`）を、どのオリジンからも読めるようにする。
- Updated dependencies [a50fc27]
- Updated dependencies [cc6767c]
- Updated dependencies [5fba65a]
- Updated dependencies [dabeae7]
- Updated dependencies [251f987]
- Updated dependencies [b33fa19]
- Updated dependencies [8788983]
- Updated dependencies [8806acb]
- Updated dependencies [6b10cf8]
- Updated dependencies [2a8df33]
- Updated dependencies [2a8df33]
- Updated dependencies [dccca47]
- Updated dependencies [dccca47]
- Updated dependencies [e3611a0]
- Updated dependencies [64af1db]
- Updated dependencies [b96babb]
- Updated dependencies [b96babb]
- Updated dependencies [026f27e]
- Updated dependencies [dbb02d9]
- Updated dependencies [26c5bbc]
- Updated dependencies [396d07d]
- Updated dependencies [1b1d1d1]
- Updated dependencies [4ca3146]
- Updated dependencies [15373c5]
- Updated dependencies [15373c5]
- Updated dependencies [15373c5]
- Updated dependencies [15373c5]
- Updated dependencies [15373c5]
- Updated dependencies [15373c5]
  - @ubichill/shared@1.18.0

## 1.0.21

### Patch Changes

- Updated dependencies [6b7e38d]
  - @ubichill/shared@1.17.1

## 1.0.20

### Patch Changes

- Updated dependencies [84e07a3]
- Updated dependencies [0d05e59]
  - @ubichill/shared@1.17.0

## 1.0.19

### Patch Changes

- Updated dependencies [21923d9]
- Updated dependencies [50a82bd]
- Updated dependencies [fc8a52b]
- Updated dependencies [72b1f61]
- Updated dependencies [b3c43ad]
- Updated dependencies [6e3ee64]
- Updated dependencies [5365069]
- Updated dependencies [8f0912b]
- Updated dependencies [88cd7db]
- Updated dependencies [6317b11]
  - @ubichill/shared@1.16.0

## 1.0.18

### Patch Changes

- Updated dependencies [be9da67]
- Updated dependencies [86a3e4f]
- Updated dependencies [f8c52bb]
- Updated dependencies [2a500f2]
- Updated dependencies [833415f]
  - @ubichill/shared@1.15.0

## 1.0.17

### Patch Changes

- 8c6176a: 画面と API のビルドコミットが異なる場合に更新通知が再表示される問題を修正。SNS 画面に同梱する版情報をキャッシュさせずに配信し、単独ワールドの配布物には追加しない。

## 1.0.16

### Patch Changes

- Updated dependencies [6ba0785]
- Updated dependencies [787dfc4]
- Updated dependencies [4424709]
  - @ubichill/shared@1.14.0

## 1.0.15

### Patch Changes

- d6764be: 作者がユーザーページに登録した外部のワールド（GitHub Pages など）を、短い共有 URL（`/@handle/name`）で開けるようにした。開けるのは、その作者の署名でそのワールドだと確かめられたときだけ。`/world?url=…` で開いた場合も、そうなら短い共有 URL に置き換え、共有リンクにもそれを使う。
- 890dd1d: ユーザーページを SNS のプロフィールの形にし、本人はその場で編集できるようにした。

  - プロフィールに、ひとこと（1 行・60 文字）・バナー画像・リンク（https だけ・最大 5 件。ホスト名で GitHub・X・YouTube・Bluesky・Twitch・pixiv・BOOTH・VRChat を見分ける）・話せる言語（決まった一覧から最大 5 件）を足した。規則は shared にあり、画面と API で同じものを使う。
  - アイコンとバナーはアップロードする。サーバーが sharp で作り直し（EXIF の向きを反映してメタデータを全部消す・アイコン 512×512 / バナー 1500×500 の WebP）、中身は DB（`profile_images`）に置く。配信は内容のハッシュ入りの URL（`/api/v1/users/:id/images/:kind/:hash.webp`）で、immutable で長く cache させる。
  - API: `PUT /api/v1/users/me/profile`、`PUT` / `DELETE /api/v1/users/me/images/:kind`。公開プロフィール（`/api/v1/users/:id`・`/api/v1/social/users/by-handle/:handle` など）に新しい項目を足した。
  - DB: `user_profiles`・`profile_images` を足す（0027。users は変えない）。
  - backend のイメージ: alpine で sharp を読み込めるよう、musl 用のネイティブ部分を入れる。
  - リンクのプレビュー（`/@ID`）: 自己紹介が無ければひとことを説明に使い、アイコンが無ければバナーを大きく出す。

- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0

## 1.0.14

### Patch Changes

- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0

## 1.0.13

### Patch Changes

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0

## 1.0.12

### Patch Changes

- Updated dependencies [d7850d7]
  - @ubichill/shared@1.10.0

## 1.0.11

### Patch Changes

- Updated dependencies [70b6047]
- Updated dependencies [c0164c3]
- Updated dependencies [db4057f]
- Updated dependencies [319eb74]
- Updated dependencies [f942349]
- Updated dependencies [4afeacc]
- Updated dependencies [0030710]
- Updated dependencies [ac490dd]
  - @ubichill/shared@1.9.1

## 1.0.10

### Patch Changes

- Updated dependencies [902a24c]
- Updated dependencies [a5d6f3a]
- Updated dependencies [9d7c2d9]
- Updated dependencies [18142c5]
- Updated dependencies [b802a3c]
  - @ubichill/shared@1.9.0

## 1.0.9

### Patch Changes

- Updated dependencies [c6cba3a]
  - @ubichill/shared@1.8.0

## 1.0.8

### Patch Changes

- 5d131c6: mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0

## 1.0.7

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0

## 1.0.6

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0

## 1.0.5

### Patch Changes

- Updated dependencies [0d3bd18]
  - @ubichill/shared@1.4.0

## 1.0.4

### Patch Changes

- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
  - @ubichill/shared@1.3.0

## 1.0.3

### Patch Changes

- Updated dependencies [c764ea4]
  - @ubichill/shared@1.2.0

## 1.0.2

### Patch Changes

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
  - @ubichill/shared@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/shared@1.0.1
