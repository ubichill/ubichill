# @ubichill/shared

## 1.18.0

### Minor Changes

- a50fc27: ボット対策をコントロールパネルで設定できるようにする。Cloudflare Turnstile か hCaptcha を選び、鍵の組で確かめてから保存する。使うと、メールアドレスとフェディバースでの新規登録と、パスワードでのログインで、ボットでないことを確かめる。パスワードでのログインは、メールアドレスの代わりに ID でもできるようにする。シークレットキーはサーバーの秘密で暗号化して置く（マイグレーション 0043）。
- cc6767c: ログイン画面に並べるフェディバースのサーバーを、コントロールパネルの「認証」で管理者が決められるようにする（`featured_fediverse_servers`、migration 0041）。メールなしで登録した人が、設定の「ログイン方法」でメールアドレスとパスワードを足せるようにする（確認コード、`email_link_requests`）。ログイン方法の追加・解除でパスワードの入れ直しを求めず、代わりに連絡先メールに知らせる。block したとき、ほかの backend も覚えた方針をすぐ捨てる。shared の `FEATURED_FEDIVERSE_SERVERS` は `MAX_FEATURED_FEDIVERSE_SERVERS` に置き換え、`LoginMethods` に `email` を足す。 設定の「アカウント」に、ログイン中の端末の一覧と 1 台ずつのログアウトを足す（`GET/DELETE /api/v1/users/me/sessions`）。メールは `SMTP_URL` があれば SMTP、無ければ Resend で送る。
- 5fba65a: 二段階認証（認証アプリとバックアップコード）を足す（`user_two_factors`・`two_factor_challenges`、migration 0042）。有効にすると、パスワードでもフェディバースでもログインのたびにコードを求め、コードを確かめてからセッションを作る（`POST /api/auth/two-factor/verify`）。設定の口は `/api/v1/users/me/two-factor`（状態・始める・有効にする・無効にする・バックアップコードの作り直し）。鍵の暗号化とバックアップコードの HMAC はどの秘密で作ったかを残し、`BETTER_AUTH_SECRETS` で秘密を入れ替えても古い秘密が残っている間は読める。shared に `TwoFactorStatus` などの型と `isTwoFactorRequired` を足す。
- dabeae7: 公開環境の追加に気付けて、取り消しやすくする（#184）。CLI・CI を公開環境として足す承認（`POST /api/v1/cli-auth/requests/:id/approve`）は、直近の本人確認（パスワードを 10 分以内に確かめた、パスワードの無い人は 10 分以内にログインした）を求め、足りなければ 403 `reauth-required` で断る。ブラウザで公開するときの自動の登録はこれまでどおり確認を出さない。ログイン方法の追加・解除（フェディバースの連携の開始 `POST /api/auth/fediverse/start` の `intent: 'link'`・`DELETE /api/v1/users/me/login-methods/:id`・メールアドレスとパスワードの追加 `POST /api/v1/users/me/email`・`/me/email/verify`）も直近の本人確認を求め（奪った古いセッションで攻撃者のログイン手段を足させない）、足したときのパスワードの確認の時刻はセッションのログインの時刻にする。追加の通知メールに種類・名前・鍵の指紋と、その環境を目立たせた設定の画面（`/settings/publishing?environment=<id>`）へのリンクを載せる。公開環境の名前（`PublishingEnvironmentNameSchema`）は U+2028・U+2029 も受け付けない。shared に `signingKeyFingerprint`・`publishingEnvironmentKindLabel`・`publishingEnvironmentSettingsPath` を足す。`ubichill login` と `ubichill ci create` は、承認画面と見比べる鍵の指紋を出す。
- 251f987: Mastodon・Misskey のアカウントで登録・ログイン・連携できるようにする（メールなしで登録できる）。ログインの前に使うサーバーを選んで確かめられる。外部アカウントは `accounts` の `(provider_id, account_id)` で一意にし、アプリの登録と表示用の情報の表、セッションの `password_verified_at`・`auth_account_id` を足す（migration 0038・0039）。管理者は確認済みのメールを持つユーザーだけにし、管理者の権限はパスワードで確かめたセッションだけで使える。ログイン方法の追加・解除には直近の本人確認が要る。`REGISTRATION=closed` で新規登録を止められる。
- 8788983: mod のお気に入りを足す。作者（handle@domain）と mod の ID で覚え（`user_mod_favorites`、マイグレーション 0050）、見るたびに作者のカタログで今の版を引く（このサーバーの作者は自分のカタログ、ほかのサーバーの作者は WebFinger が案内するカタログ）。足すのは作者のカタログに公開されている mod だけで、1 人 100 件まで（同時に足しても超えない）。`GET`・`POST`・`DELETE /api/v1/users/me/favorites/mods`、`GET /api/v1/users/me/favorites` に `modRefs`、ほかの人に見せる `GET /api/v1/users/:id/favorites` に `mods`（公開範囲はワールドのお気に入りと同じ 1 つの設定）。shared に `ModFavoriteRefSchema`・`FavoriteMods`。
- 2a8df33: `absoluteEntityTransform`（Entity の transform の絶対化と省略の補い）と `componentTransformOf`（Component の transform の上書き）を足し、`flattenGameObject` もこれを使う。エディタの描画と、プレハブを置く位置・一式の枠の計算も同じ関数で大きさを決め、Component にだけ幅・高さがあるプレハブの真ん中が落とした場所からずれないようにする。
- 2a8df33: Entity に表示名（`name`、日本語も可・50 文字まで）を足す。参照は今まで通り `id` で行う。置いたプレハブの親は、`prefab-<乱数>` ではなくプレハブの名前の id（`pen-set`、2 つ目から `pen-set-2`）と、プレハブの `name` の表示名になる（`ubichill prefab add` も同じ）。
- dccca47: ほかのサーバーの部屋のサーバーが回数の制限（429）・時間切れ（408）で答えたとき、部屋が無い（404）ではなく今は答えられない（503）として返す。このサーバーのドメインを付けた部屋の住所（`<ID>@<このサーバー>`）も、部屋の詳細・入室でこのサーバーの部屋として読む（shared の `localRoomIdOf`）。
- dccca47: 部屋にいる人が、どのワールドの部屋でも、ほかの部屋へのポータルを開けるようにする。行き先はワールドではなく部屋なので、後から通った人も同じ部屋に入る。インスタンスは `portal:open` を受けると `core:portal` の Entity（data は `room`・`expiresAt`・`ownerName`）を作って全員に配り、60 秒で消す（1 人 1 つ・置き直しは 3 秒あける・1 部屋 64 まで・置いた人が部屋を出ても消さない）。閉じられるのは置いた人だけ（`portal:close`）。数字は shared の `ROOM_PORTAL`。インスタンスの作成に `holdEmptyMs` を足し、ポータルの先に作った部屋は `held_until`（マイグレーション 0046）まで空でも消さない。
- e3611a0: コントロールパネルに「ブランディング」を足す: サーバーのアイコン（タブ・iOS のホーム画面・PWA 用の PNG を作る）・紹介のページのバナー（1200×630 の WebP）・テーマの色（ボタンの文字とのコントラスト比 4.5 未満は断る）・略称（`PUT /api/v1/admin/branding`・`PUT`・`DELETE /api/v1/admin/branding/images/:kind`、画像は `GET /api/v1/server/images/:variant/:hash`）。`GET /api/v1/server` にブランディングを入れる。BFF はどのページにもアイコン・`/manifest.webmanifest`・テーマの色を入れ、紹介のページ（`/`）にサーバー名・紹介・バナーの OGP・Twitter Card・JSON-LD（WebSite・Organization）を出す。`sitemap.xml` に検索に出してよい人のページ（`GET /api/v1/server/directory`。本番だけ）を足し、プライベートのワールドはワールドのページも sitemap も検索に載せない。「おすすめや検索に出す」をオフにした人のユーザーページは `noindex`（プロフィールに `discoverable` を足した）。`robots.txt` は OGP の画像を読ませる。BFF は検索に載せるかを `DEPLOYMENT_ENVIRONMENT`（chart が backend の `NODE_ENV` を渡す）で決め、本番以外は `X-Robots-Tag: noindex` も付ける。shared に `themePalette`・`themeColorProblem` などを足す。マイグレーション 0049（`server_branding`・`server_images`）。
- 64af1db: サーバーの情報（名前・紹介・管理者・利用規約などの URL）をコントロールパネルの「全般」で設定できるようにし、ログインしていない人が `/` を開くと出る紹介のページと NodeInfo に出す（マイグレーション 0044）。新規登録を終えたら、そのままログインする。
- b96babb: 設定に「ストレージ」を足す: 使っている量と容量・上げた画像の一覧（大きさ・画素数・上げた日・自分のワールドで使っているか）・その場で消す・使われていない画像を自動で消すかの切り替え（`GET /api/v1/users/me/storage`・`PUT /api/v1/users/me/storage/settings`）。自動で消すのを止めた人の画像は掃除が消さない。1 人あたりの容量（既定 200 MB）を管理者がコントロールパネルの「全般」で 10 MB〜10 GB に変えられるようにし（`GET`・`PUT /api/v1/admin/storage`）、数の上限（200 枚）をやめる。容量を越えたときは今の合計と画像の大きさを伝える。PNG・GIF のうち小さいか平らな画像は可逆の WebP も作り、小さい方を置く（ドット絵・平らな絵が小さくなり、縁もにじまない。プロフィール画像も同じ）。`GET /api/v1/assets`（一覧）は設定の「ストレージ」の API に移した。shared の `WORLD_ASSET_QUOTA`・`WorldAssetList` を `WORLD_ASSET_QUOTA_BYTES`・`StorageOverview` などに置き換える。マイグレーション 0046（`storage_settings`・`user_settings.world_asset_auto_cleanup`）。
- dbb02d9: どのワールドにも使われていないワールドの画像を、上げてから 7 日たったら消す（起動の 1 分後と 6 時間ごと、reaper のリースを持つ 1 台だけ）。このサーバーのワールドの下書き・版（だれのワールドでも）の定義に `<hash>.webp` が出てくれば使われているとみなす。同じ画像を上げ直すと猶予を数え直す（`created_at` を今にする）。shared に参照の形 `WORLD_ASSET_REFERENCE_PATTERN` を足す。
- 26c5bbc: mod を書かなくてもワールドに置ける本体の部品を足す: 画像（`core:image`）・文字（`core:text`）・ほかのワールドへの入口（`core:portal`）。ワールドの背景に画像を敷けるようにする（`environment.backgroundImage`・`backgroundImageFit`）。ワールドの作者は画像をこのサーバーに上げられる（`POST /api/v1/assets`。作り直した WebP を中身のハッシュの URL で配る。1 人 200 枚・200 MB まで。マイグレーション 0045）。

  mod に埋め込まれる本体の部品の一覧が増えたので、公式ワールド（弾幕）の mod danmaku を 1.0.5 に上げる。

- 396d07d: ワールドを読む側（部屋・サーバー・ほかのサーバーのワールドを読むとき）は、この版が知らない本体の部品（`core:*`）と、本体の部品の知らない項目を断らずに残し、使わないようにする。新しい ubichill で部品を足しても、ワールドがこの版以降のサーバーで開けなくなることはない。書く側は今まで通り確かめる。エディタは確認の一覧に出し、`ubichill publish` は公開を止め、`ubichill dev` は警告を出す。部屋では、表示されない部品があることをコンソールに出す。core-components に、知らない項目を捨てて読む `readCoreData`・`readCoreComponentData` と、書く側で使う `unknownCoreComponentKeys` を足す。
- 1b1d1d1: mod を書かずに置ける動きの部品を足す: 最初の場所（`core:spawn`。部屋に入ったとき画面の中心に来る）、ワープ（`core:warp`。押すとワールドの中の別の Entity へスクロールする）、スイッチ（`core:switch`。押すと対象の Entity の見える・見えないを部屋の全員の画面で切り替える）。Entity に `visible`（`false` なら最初は見えない。子も）を足す。インスタンスは見えない Entity の一覧をスナップショットの `hiddenEntities` に持ち、`switch:press` を確かめてから切り替えて `entity:visibility` で配る。公式ワールド（弾幕）の mod danmaku を 1.0.6 に上げる（mod に埋め込まれる部品の一覧が増えたため）。
- 4ca3146: ワールドの公開（作者の署名付き）にサムネイルを必要にする。World Editor の公開・`ubichill publish`・本体の保存（署名付き）が、サムネイルの無いワールドを断る（下書きと署名の無い保存には求めない。shared の `worldPublishProblem`）。公式ワールド（Ubichill Home・弾幕・WASM デモ）にサムネイルを付ける。入口（`core:portal`）は、行き先のワールドのサムネイルを丸い窓に出し、上に名前を出す。
- 15373c5: ワールドの公開範囲をサーバーの側で守る。プライベートのワールドの部屋を作れるのは作者だけで、作者のサーバーでだけ。

  - ワールドのファイル（`.yaml`・`.lock.json`・`.sig.json`）に公開範囲のヘッダー `Ubichill-World-Visibility: private|public` を付ける（`Access-Control-Expose-Headers` にも入れる）。ほかのサーバーは外部のワールドを解決するとき、`private` ならそのワールドの部屋をだれにも作らせず、一覧・ワールドに置くポータルの行き先からも外す（shared の `WORLD_VISIBILITY_HEADER`・`worldVisibilityFromHeader`）。ファイルは今までどおり誰にでも配る。
  - 部屋へのポータルを置く許可を backend が出す（`POST /api/v1/room-portals/grants`）。プライベートのワールドの部屋へは、その部屋を作った人にだけ出す（いまの公開範囲で判定する）。インスタンスは管理トークンのある運用で `portal:open` の `grant`（`base64url(JSON {room, userId, exp})` + `.` + HMAC-SHA256。鍵は管理トークンから `ubichill room portal grant v1` で派生、60 秒）を確かめ、無い・合わなければ断る。単体モードでは求めない（shared の `ROOM_PORTAL_GRANT`）。

- 15373c5: ワールドに公開範囲（パブリック・プライベート）を足す。プライベートのワールドはインスタンスを作者しか作れず、一覧（ほかのサーバーへの一覧・お気に入り・プロフィール）に出ず、ワールドに置くポータルの行き先にできない。公開（署名した版）するまではプライベートとして扱い、既定はパブリック（マイグレーション 0048 の `worlds.visibility`）。作者は `PUT /api/v1/worlds/:worldId/visibility` で変える。ワールドに置くポータルは、行き先のワールドのパブリックの部屋（人のいちばん多い部屋。無ければ作る）へ入る。shared に `canStartInstance`・`isPortalDestination`・`canOpenRoomPortalTo`・`pickPortalInstance` を足した。ホームはほかの人のプライベートのワールドにできず、あとからプライベートになったら既定のワールドで入る。

### Patch Changes

- b33fa19: ログインの画面（`/auth`）をやめ、`/` にまとめる。紹介のページに Mastodon・Misskey のアカウントでのログインを最初から並べ、メールアドレスとパスワードでのログイン・新規登録は、その上のダイアログで開く。フェディバースの認証から戻る先（二段階目・ID と表示名を決める・失敗）も `/` にする。前の `/auth` へのリンクは `/` へ移す。
- 8806acb: UI（`core:ui`）を、Entity の大きさの四角にする（FigJam の図形と同じ考え方）。塗り（`fill`）・枠線（`border`・`borderWidth`）・角丸（`radius`）・テキスト（`text`・`size`・`color`・`align`・`bold`）を持ち、`button: true` で押せるようになる。押すと、同じ Entity のスクリプト（ワープ `core:warp`・スイッチ `core:switch`・ポータル `core:portal`）を動かす。ワープ・スイッチは並び順に動かし、部屋を出るポータルは並びの最初の 1 つだけを最後に動かす（2 つ目からのポータルは動かず、エディタで知らせる）。押した動きが終わるまで同じボタンは押し直しても動かず、ボタンにした UI の `markup` は見た目だけ（中のリンクは押せない）。エディタの UI・テキストの欄は、data に無い項目に部屋で描く値を出す（置いたときの白い角丸の四角と「ようこそ」は、足したときの data として書く）。スクリプトは、ボタンにした UI があると自分では描かず、無ければ今まで通りの標準のボタンを出す。HTML 風の UI データ（`markup`）は上級者向けとして残す（書くとテキストの代わりに描く）。書いていない項目は描かないので、前の版の `core:ui` の見た目は変わらない。

  本体の部品の表示名を、型の名前の読みにそろえる（コライダー・メディア・UI・イメージ・テキスト・ポータル・ワープ・スイッチ・スポーン）。「入口」「最初の場所」「画像」「文字」と呼んでいたものは、YAML の `core:portal` などと対応が分からなかった。ポータルの既定の名前と、公開に要るサムネイルの説明も「ポータル」にする。

- 6b10cf8: 部屋へのポータルを、部屋のいちばん前に置く。インスタンスは `portal:open` で作る `core:portal` の z を、ワールドの座標の Entity の z のいちばん大きいものの 1 つ上（整数）にする（画面に固定する `overlay` の Entity と、置き直しで消す自分の前のポータルは比べない。0 より下にはしない（負の z はワールドの背景より奥に描かれる）、transform の上限 1e7 を超えるなら 1e7）。弾幕の範囲（z: 5000）のようにワールドを覆う Entity の上にも出る。画面は置く場所を選ばせてから `portal:open` を送る（shared の `portal:open`・`roomPortalCenter` の説明を合わせた）。
- b96babb: 設定の「ストレージ」の一覧を 50 個ずつ読むようにし（新しい順の続きの位置。合計と数は SUM・COUNT で引く。`GET /api/v1/users/me/storage/files`）、読み込みに回数の制限を掛ける。チェックしてまとめて消せるようにし（`POST /api/v1/users/me/storage/files/delete`、1 回 100 個まで）、消す回数をアップロードと別に数える。画像の作り直しは、PNG・GIF で縮めた後が 256 色以下のときだけ可逆も作り、可逆が失敗・時間切れ（1 秒）なら非可逆で通す（読み込みと縮小は 1 回）。マイグレーション 0046 に持ち主ごとの一覧の索引を足す。
- 026f27e: 画面・エラー・`ubichill dev` の出力・文書で「部屋」と「インスタンス」が混ざっていたのを「インスタンス」にそろえる（型の `Instance` の読み）。入れないインスタンスの呼び方は「プライベートインスタンス」にそろえる。用語集 `GLOSSARY.md` を足す。連合のプロトコルの `rooms`・部屋の住所の形は変えない。
- 15373c5: 外部のワールドの公開範囲を、取ってきた URL ではなく署名の作者で決める。プライベートのワールドのファイルを別の場所に置き直しても、作者がこのサーバーのアカウントならその作者のワールド（以前の名前を含む）の公開範囲で、ほかのサーバーのアカウントなら作者のサーバーの正規の URL のヘッダーで、部屋を作らせるかを決める。部屋の住所のドメインは URL のホストと同じ形にそろえる（`:443`・頭の 0 のポートを外す。`parseRoomAddress`）。
- 15373c5: 外部のワールドの公開範囲を閉じる側に倒す。作者の鍵の取得が一時的に失敗したとき（429・5xx・時間切れ。404・410 以外）は作者が無いとせず pending にする（shared の authorKeyDirectory。`fetchJson` は一時的な失敗を例外にする）。作者のサーバーの正規の URL の公開範囲を確かめられず、前に確かめた結果も無いときは部屋を作らない（503、`ResolvedWorld.visibilityUnconfirmed`）。外部のワールド・正規の URL を取りに行く回数に、ドメインごとに 1 分 120 回の上限を付ける。
- 15373c5: 外部のワールドの公開範囲を 1 つの規則で決める。名乗る作者はいつも署名から取り（確かめられなかったときは識別結果の `claimedAuthor`。作者を確かめられたかにかかわらず）、閉じる側にだけ使う。ほかのサーバーの作者のワールドの部屋は、作者のサーバーの正規の URL が期限（5 分）の内に public と決まったときだけ作れる（private はいつまでも使い、期限を過ぎた public は使わない。404・410 はパブリック。決められなければ 503）。作者を確かめられない間に部屋を作らない別の規則はやめた。
- 15373c5: 作者の鍵をいま確かめられない（`authorPending`）間も、署名が名乗る作者を識別結果の `claimedAuthor` に残し、外部のワールドの公開範囲を閉じる側にだけ当てる（プライベートにはするが、作者の ID は付けずパブリックにもしない）。作者を確かめられていない外部のワールドの部屋は作らない（503）。作者のサーバーの正規の URL とみなすのは https で同じオリジンのときだけにする。
- Updated dependencies [8806acb]
- Updated dependencies [26c5bbc]
- Updated dependencies [396d07d]
- Updated dependencies [1b1d1d1]
  - @ubichill/core-components@1.1.0

## 1.17.1

### Patch Changes

- 6b7e38d: 連合の受信を堅牢にする（Signature ヘッダーの ReDoS・署名を確かめる前の actor の取得の制限・落ちたサーバーによる確かめ直しの詰まり・Undo と Accept の id）。登録の 3 つの口に回数の制限を付ける。`user_friends.friend_id`・`sessions.user_id`・`accounts.user_id` に索引を足し（migration 0037）、フレンドの分類の O(n²)・在席の全件読み・ワールド一覧の全件解決を直し、ワールドの数の上限を並列でも守る。

## 1.17.0

### Minor Changes

- 84e07a3: mod に見た目の画像を同梱できるようにする。mod のサムネイル（`package.json` の `ubichill.thumbnail` → manifest の `thumbnail`）・Component の見た目（`config.thumbnail`）・プレハブの見た目（`prefabs/*.json` の `thumbnail`）は、どれも `assets/` 内の画像を指し、`assetIntegrity` で hash を固定する。`ubichill build` は参照先が `assets/` にあり、png・jpg・webp・avif・svg で 256 KB 以下かを確かめる。エディタは hash を確かめた画像だけを、アセット欄・Component の追加・mod 管理の一覧・作品ページに出す。
- 0d05e59: mod と ubichill の版を固定する。エディタは `latest` を書かず、既存の `latest` は保存時に lock の版へ固定する。`ubichill install world.yaml` は版を書いていない依存の最新版を取って world.yaml に固定し（以後の install では変えない。上げるのは `update`）、`update` も `latest` を版に書き換える。書き換えるのは版の行と `spec.requires` だけで、ほかの整形とコメントは変えない。ワールドは ubichill の版（`spec.requires.protocol`）を固定し、エディタの mod 管理の一覧で mod と同じく上げられる。古い版に固定したワールドはそのまま動かし、Host より新しい版のワールドだけ入る前とエディタで知らせる。Host のイメージは公開済みの mod の版を戻してからビルドし、一度公開した版を配り続ける。

## 1.16.0

### Minor Changes

- 21923d9: 作者参照から分散配布の mod package を取得・追加できるようにし、作者固定の lock v2、package 内プレハブの配置・差分更新・Unpack、標準 Component の表示、作成用 CLI と作品ページ・検索を追加する。既存 lock を保存時に維持し、依存更新の失敗で YAML と lock が食い違わないようにする。DB は配布物や版履歴を保存せず、作者と mod ID ごとの登録ポインタを使う。

  エディタで更新先を取得できなかった場合は、古い lock で補わず変更を取りやめ、以前の依存と lock を維持する。

- 50a82bd: フェディバースの固定ノートを、種類（作ったワールド・公開している mod・お気に入りのワールド）ごとに 1 つのノートにまとめた。それぞれ新しい順に 10 件まで並べ、画像は 4 枚まで添付する。

  - ノートの id は種類と中身の要約にした（中身が変わると id も変わる）。Mastodon・Misskey は同じ id のノートを取り直さないため。
  - shared: `FEATURED_LIMITS` をやめて `FEATURED_ITEMS_PER_NOTE`・`FEATURED_IMAGES_PER_NOTE`・`FEATURED_KINDS` を足した。`pickFeatured` は種類ごとのグループ（`FeaturedGroup`）を返し、`featuredNoteContent`・`buildFeaturedNote` はグループを受け取る。`FeaturedItem` から `kind`・`key` を外した。

- fc8a52b: フレンド同士のメッセージ（1 対 1）を足した（#198 の一部）。

  - shared: `MESSAGE_LIMITS`・`messageRefusal`・`MessageContentSchema`・`SendMessageRequestSchema`・`DirectMessage`・`ConversationSummary`・`ConversationPage`・`mergeMessages` を足した。通知の種類に `Create`（object は `Note`）を足した（`AppNotification` の `object.type === 'Note'` は `Announce` だけではなくなった）。
  - shared: メッセージへのリアクション（`REACTION_LIMITS`・`isSingleEmoji`・`ReactRequestSchema`・`MessageReaction`・`tallyReactions`・`withReaction`・`toggledReaction`）。`DirectMessage` に `reactions` を足し、会話の一覧の `last` は `DirectMessageBody`。通知の種類に `EmojiReact`（content は絵文字）、SSE の出来事に `reaction` を足した。
  - db: `direct_messages`・`direct_message_reactions` を足し、通知の種類に `Create`・`EmojiReact` を許した（0036）。
  - backend: `/api/v1/messages`（会話の一覧・会話・送る・既読・リアクションの付け外し）。届いたら通知と SSE に載せる。古いメッセージは通知と同じ日数で消す。

- 72b1f61: 満員の部屋の扱いを変えた。

  - 満員の部屋も一覧・フレンドの現在地に出し、画面では「満員」として「入る」を押せなくする（部屋の作成者を除く）。
  - 部屋の作成者は満員でも入れる。Go の管理 API のチケットに `leader` を足し、そのチケットは定員を 1 人まで超えて入れる（引っ越しの受け入れも定員 +1 人まで）。backend は満員の部屋に作成者が入るときだけ `leader` を付ける。
  - 満員の部屋への招待（`'full'`）とリクエストインバイト（`'full'`）を断る。リクエストインバイトで満員を理由にするのは、相手が場所を見せていて、頼む人にその部屋が見えるときだけ（ほかは届けて、答えるときに満員で断る）。
  - shared: `InstanceAudience` に `maxUsers` を足し、`blockedByCapacity`・`isFullFor` を足した。`ListInstancesQuerySchema` から `includeFull` を外した。
  - db: `instanceRepository.findAll` から `includeFull` を外した（DB の status では絞らない）。

- 5365069: ほかのサーバーの人（Mastodon・Misskey）のカスタム絵文字・リンク・メンションを出せるようにした。

  - shared: `RichSegment`・`CustomEmoji`・`splitCustomEmojis`・`storedRichTextOf`・`storedCustomEmojisOf`（user/richText）と、`htmlToRichText`・`readCustomEmojis`（federation/richText）を足した。`readActorDocument` は `bio`・`emojis` を返し、`summary` は `bio` をつないだ文字にした。`remoteProfileView` は `bioSegments`・`emojis` と、表の項目の `href` を返す。`REMOTE_SUMMARY_MAX_LENGTH` は profileFields に移した。
  - `UserSummary.emojis`・`UserProfile.bioSegments`・`ProfileField.href`・`FediverseFollower.emojis` を足した。
  - db: `RemoteActorProfileRecord` に `bio`・`emojis` を足し、フォロワーと連合のフレンドの一覧が `profile` も返すようにした（列は増やしていない）。

- 8f0912b: ロール（Misskey のロールに合わせたもの）と、管理者のコントロールパネルを足した。

  - 管理者は公式アカウント（`ubichill`。ロールに関係なく常に管理者）と、期限の切れていない「管理者」のロールを持つ人。
    `requireAdmin`・`/api/v1/users/me` の `isAdmin`・お知らせの投稿がこの判定を使う。お知らせは公式アカウントだけでなく管理者なら出せる。
  - 公開のロールはプロフィール（`UserProfile.roles`。`{ id, name, color }` を表示順に）に出す。ほかのサーバーの人は空。
  - API（管理者だけ）: `GET/POST /api/v1/admin/roles`・`PUT/DELETE /api/v1/admin/roles/:roleId`・
    `GET /api/v1/admin/roles/:roleId/members`・`PUT/DELETE /api/v1/admin/roles/:roleId/members/:userId`・`GET /api/v1/admin/users?q=`。
  - shared: `RoleInputSchema`・`RoleAssignmentRequestSchema`・`isAdministrator`・`publicRolesOf`・`assignedRolesOf`・`compareRoles` などを足した。
    `userProfileOf` は 3 つ目の引数に公開のロールを取る。
  - db: 0034（`roles`・`role_assignments`）。`roleRepository`・`userRepository.listRecent` を足した。
  - 画面: 管理者にだけ、ランチパッドの左の列に「コントロールパネル」（ユーザー・ロール・連合・お知らせ）を出す。連合とお知らせは設定から移した。

- 6317b11: ユーザーをブロックできるようにした（このサーバーの人と、ほかのサーバーの人）。

  - ブロックすると、フレンド・申請（両方向）・招待・リクエスト・2 人の間の通知を消し、ほかのサーバーの人ならフレンドの解除とフォロワーから外すことを相手に送る。
  - ブロックした人は検索・部屋の中のカーソルと参加者の一覧に出さない。新しい通知も作らない。プロフィールは開けて、そこから解除できる（設定の「プライバシー」にも一覧）。
  - どちらかがブロックしている 2 人の間では、フレンド申請・招待・リクエストインバイト・連合の申請とフォローを止める。ブロックされた側への答えは、断られたときと見分けがつかない。
  - ブロックした人が作者として署名した mod は、ワールドに入っても実行しない（理由は mod の読み込みの知らせに出す）。作者は署名で確かめた作者アカウント（`handle@domain`）で突き合わせる。
  - `GET /api/v1/social/blocks`・`POST /api/v1/social/blocks`・`DELETE /api/v1/social/blocks/:userId`。プロフィールに `blocked` を付けた。
  - shared: `isBlockedBetween`・`hasBlocked`・`hiddenIdsOf`・`blockRefusal`・`authorAccountKey`・`blockedAuthorKeys`・`isModAuthorBlocked`・`BlockedUser`・`BlocksResponse`・`BlockRequestSchema`。
  - DB: 0035（`user_blocks`）。

### Patch Changes

- b3c43ad: backend の構造を整理する（API とレスポンスは変えない）。やり取りを止める判定を shared の interactionRefusal にまとめ、ユーザーを消すとブロックされた側の行も消す。
- 6e3ee64: ファイルの置き場所を機能ごとに整理する（振る舞い・API・export の名前は変えない）。連合を ubichill どうし・フェディバース・共通に分け、shared の user/ を account・social・publishing に分けた。
- 88cd7db: プロフィール・設定のワールド一覧に正規 URL と共有パスを含め、部屋のワールド情報からも作者と作品名の共有 URL を作る。ワールド詳細の再取得を参照先の変更に限定し、カーソル更新による不要な再描画を抑える。

## 1.15.0

### Minor Changes

- be9da67: フェディバース（Mastodon・Misskey など）のプロフィールに、固定ノートを出すようにした。作ったワールド 2・公開している mod 2・お気に入りのワールド 1（お気に入りの公開範囲がパブリックのときだけ）を新しい順に出す。

  - actor の `featured`（`/ap/users/:id/collections/featured`）と、ノート 1 つずつ（`/ap/users/:id/featured/:key`）。ノートの id は項目ごとに変えない。
  - ワールドの保存・削除、外部の作品、お気に入りとその公開範囲が変わったら、まとめて `Update{Person}` を届ける。
  - ワールドの共有ページのパス（`worldPagePath`・`localWorldPagePath`）を shared に移した。`favoriteRepository.latest` を足した。

- 86a3e4f: Mastodon・Misskey など（フェディバース）から ubichill のユーザーをフォローできるようにした。フレンドとは別の片方向の関係で、フォロワーに見えるのはプロフィールだけ。

  - `Follow` を受けて `Accept{Follow}`・`Reject{Follow}` で答え、`Undo{Follow}` で外す。承認制（初期値オフ）と、おすすめ・検索に出すかを設定の「プロフィール」で選べる。
    承認待ちとフォロワーの一覧から承認・拒否・フォロワーから外すができる（`/api/v1/fediverse`）。通知に `FediverseFollow`・`FediverseFollowRequest` を足した。
  - ほかの実装との署名は draft-cavage の `rsa-sha256`（keyId は `<actor>#main-key`）。RSA の鍵は actor ごとに作って保存し、秘密鍵は鍵の種から導いた鍵で包む。
    RFC 9421 の Ed25519 を告知していない相手へは draft-cavage で送り、受けるのは inbox だけ（部屋 RPC は RFC 9421 のまま）。
  - actor の文書に `publicKey`・`followers`・`following`・`discoverable`／`indexable` を載せ、`manuallyApprovesFollowers` を本人の設定にした。自己紹介は HTML で載せる。
  - DB: 0031（`federation_actor_keys`・`federation_followers`・`user_settings` のフェディバースの設定・通知の種類）。

- f8c52bb: フェディバースとのプロフィールのやり取りで、出していなかった・読んでいなかった項目を足した。

  - 出す: バナー（`image`）、作った日（`published`）、リンク・話せる言語・ひとことを `attachment` の `PropertyValue` で載せる（リンクは `rel="me"`）。
    ubichill どうしのために、ひとことと言語は拡張の語 `statusMessage`・`spokenLanguages` にも載せる。
  - 読む: ほかのサーバーの人のバナーと、項目の表（16 件まで）を読む。https のリンクの項目はプロフィールのリンクにし、ほかの項目は補足情報の表に出す。
    自己紹介は改行を残し、1500 文字まで読む。
  - DB: 0032（`remote_actors.banner`・`remote_actors.profile`）。

- 2a500f2: フレンドの一覧（現在地・すべてのフレンド）にひとことを出す。`UserSummary.status`（任意）・`remoteStatusOf`（ほかのサーバーの人のひとことを確かめて取り出す）・`userRepository.statusesOf` を追加し、フレンドの一覧の応答にひとことを載せる。
- 833415f: プライバシーの設定をまとめ、オンライン状態の見せ方を選べるようにした。

  - オンライン状態（`PresenceVisibility`）: いる場所まで（初期値）・オンラインだけ・見せない。フレンドの現在地と、ほかのサーバーからの現在地の問い合わせの両方で効かせる。
    `GET /api/v1/users/me/privacy`・`PUT /api/v1/users/me/presence`。
  - ほかのサーバーの人のプロフィール・検索結果に、そのサーバーがフレンドに対応していないか（`friendsUnsupported`）と、フェディバースでフォローされているか（`followsYou`）を付けた。
  - DB: 0033（`user_settings.presence_visibility`）。

## 1.14.0

### Minor Changes

- 6ba0785: サーバー間の連合（federation v1）を足した。どの ubichill のサーバーの人とも、フレンドになり・招待し合い・相手のサーバーの部屋に入れる。

  - 形は ActivityPub（AS2）。人から人への知らせ（フレンドの申請・承認・解除、招待、リクエストインバイト、プロフィールの更新）は相手の inbox へ、
    部屋の問い（入室・招待の権利・見えるか・フレンドの現在地）は部屋のサーバーへの RPC（`/federation/v1/...`）。
  - 署名は RFC 9421（Ed25519・`sig1`）と RFC 9530 の Content-Digest。鍵は actor ごとに `FEDERATION_KEY_SEED` から導き、FEP-521a の Multikey で載せる。
    actor はオリジンで信頼する（FEP-fe34）。WebFinger・NodeInfo・`implements`（FEP-844e）で見つける。
  - 来訪: 画面は自分のサーバーのまま、ホームが部屋のサーバーに入室を頼み、ブラウザの origin に結び付いた Go のチケットで部屋のサーバーにつなぐ。
    部屋の住所は `<部屋 ID>@<ドメイン>`（`/instance/:住所`）。
  - 配送は DB の予定（`SKIP LOCKED`・同じ 2 人の間は順に・送り直し・サーキットブレーカー）。管理者はほかのサーバーを「新しいつながりを受けない」「連合しない」に絞れる。
  - API: `/ap/*`・`/federation/v1/*`・NodeInfo、`/api/v1/federation`（状態・付き合い方・知っているサーバー）、`/api/v1/instances/:id/visit`。
    既存の API は、部屋の住所・actor の URL をそのまま受ける（`Instance.remote`・`UserSummary.domain`）。
  - DB: 0030（`remote_actors`・`remote_servers`・`domain_policies`・`remote_friendships`・`federation_deliveries`・`federation_seen`・
    `remote_visits`・`federated_admissions`。招待とリクエストの相手の外部キーを外す）。
  - 画面: ほかのサーバーの部屋には、部屋のサーバーでの ID（住所の `@` より前）で入る。

- 787dfc4: ロビーをなくし、ログインしたら自分のホームワールドの部屋へそのまま入るようにした。

  - ホームは設定できる（ワールドの詳細の「ホームに設定」・設定の「ホーム」）。公開範囲はパブリックから招待のみまで選べ、既定は招待のみ。ホームを設定していない人は公式の既定ワールドに入る。
  - `/` を開くとホームの部屋を新しく作って移る（使い回さない。ホームは一人で入る場所）。ホームのワールドを開けなければ既定のワールドで入り、そう知らせる。
  - ホームの部屋に入れずに戻ってきたときは、自動ではもう作らない（もう一度試す・既定のワールドで入る・ログアウトを選ぶ）。別のタブ・端末に接続を取られたときは、自動ではどこへも移らない（タブ同士で取り合わないため）。
  - API: `GET` / `PUT /api/v1/users/me/home`、`POST /api/v1/users/me/home/instance`（呼ぶたびに作る。`?fallback=default`）。
  - DB: `user_settings` に `home_world_ref`・`home_access_type` を足す（0028）。
  - 部屋の中の HUD をランチパッドにした（Esc でも開く）。下のドック（ランチパッド・通知・現在地・音声・設定）で切り替え、ランチパッドのトップには現在地（ホーム・招待リンク）・オンラインのフレンド・ワールドを並べる。
  - ソーシャル: フレンドがいまどの部屋にいるかを部屋ごとにまとめ、自分の部屋を一番上に出す。人を押すと部屋から抜けずにプロフィールを開く。ログアウトは設定の「アカウント」。
  - 音声: ワールドのメディア全体の音量とミュート（mod が決めた音量に掛ける。端末に保存）。
  - スモーク（ブラウザ）: ログインしてホームへ自動で入る流れに変えた。パスワード欄の「表示」ボタンでラベルの指定が 2 つに当たっていたのも直した。

- 4424709: 招待とリクエストインバイトを足した。

  - 招待: 部屋にいる人がフレンドを今の部屋に招待する（一言付き・部屋がある間で最長 24 時間）。作成者以外は、フレンドのみ・招待のみの部屋には作成者のフレンドにだけ送れる。
  - リクエストインバイト: 招待が要る部屋にいるフレンドに「入れて」と頼む（1 時間）。頼まれた人は通知から招待するか断る。
  - 招待のみの部屋は URL だけでは入れず、見えない（404）。中にいる人のフレンドには部屋が見えるが、入るには招待が要る（`canJoin: false`）。
  - 通知に AS2 の `Invite`（一言 `content`・期限 `endTime`）と `Join` を足した。招待のトーストからそのまま入れる。
  - API: `GET /instances/:id/invite-candidates`、`POST /instances/:id/invites`、`POST /social/invite-requests`（`/:userId/accept`・`DELETE /:userId`）。
  - 部屋のパスワードをやめた（画面からは設定も入力もできず、招待のみ・フレンドで足りる）。`Instance.access.password`・作成の `access.password`・入室の `password` を消し、パスワード付きだった部屋は招待のみに移す（0029）。`instances.password_hash` は使わなくなり、次の PR で消す。
  - DB: `instance_invites`・`invite_requests` を足し、`notifications` に `content`・`expires_at` を足す（0029）。
  - backend の services を領域ごとのフォルダ（instances・notifications・social・profiles・worlds・authors・auth・cluster）に分けた。

## 1.13.0

### Minor Changes

- 890dd1d: ユーザーページを SNS のプロフィールの形にし、本人はその場で編集できるようにした。

  - プロフィールに、ひとこと（1 行・60 文字）・バナー画像・リンク（https だけ・最大 5 件。ホスト名で GitHub・X・YouTube・Bluesky・Twitch・pixiv・BOOTH・VRChat を見分ける）・話せる言語（決まった一覧から最大 5 件）を足した。規則は shared にあり、画面と API で同じものを使う。
  - アイコンとバナーはアップロードする。サーバーが sharp で作り直し（EXIF の向きを反映してメタデータを全部消す・アイコン 512×512 / バナー 1500×500 の WebP）、中身は DB（`profile_images`）に置く。配信は内容のハッシュ入りの URL（`/api/v1/users/:id/images/:kind/:hash.webp`）で、immutable で長く cache させる。
  - API: `PUT /api/v1/users/me/profile`、`PUT` / `DELETE /api/v1/users/me/images/:kind`。公開プロフィール（`/api/v1/users/:id`・`/api/v1/social/users/by-handle/:handle` など）に新しい項目を足した。
  - DB: `user_profiles`・`profile_images` を足す（0027。users は変えない）。
  - backend のイメージ: alpine で sharp を読み込めるよう、musl 用のネイティブ部分を入れる。
  - リンクのプレビュー（`/@ID`）: 自己紹介が無ければひとことを説明に使い、アイコンが無ければバナーを大きく出す。

### Patch Changes

- d6764be: 作者がユーザーページに登録した外部のワールド（GitHub Pages など）を、短い共有 URL（`/@handle/name`）で開けるようにした。開けるのは、その作者の署名でそのワールドだと確かめられたときだけ。`/world?url=…` で開いた場合も、そうなら短い共有 URL に置き換え、共有リンクにもそれを使う。

## 1.12.0

### Minor Changes

- abbb4db: Component 同士を、階層の形ではなく**型付きの参照**で配線できるようにした（#191）。

  - SDK: `dataFields` の `entityRef` / `entityRefArray` に `component`（参照先が持つべき Component 型）と `required` を足した。`Ubi.event.emit(type, data, { ref: '<フィールド名>' })` で、ワールド作者が指した Entity のその型の Component にだけ届く。`scope: 'referrers'` で、参照で自分を指している Component に返せる。`EmitOptions`（`{ scope, targetType? }`）は interface のまま残し、参照で送るときの `RefEmitOptions`（`{ ref, targetType? }`）を足した。`emit` はどちらか一方を受ける（両方・どちらも無しは型で弾く）。既存の `scope` の意味は変えていない。
  - SDK: 古い Host は `ref`・`scope: 'referrers'` をエラーにせず捨てるので、プロトコルの版（`PROTOCOL_VERSION`）を 6 に上げ、`Ubi.runtime.supports('event:ref')`（と `core:media` の描画先の `'media:surface'`）で確かめられるようにした。
  - SDK: 参照フィールドの `access` で許す読み書きは、`component` を宣言していれば参照先のその型の Component だけ。`default` は World Editor で Component を足したときに data へ書く初期値で、data に無いときの代わりにはならない。
  - shared: 参照の解決と検査（`resolveRefs`・`findReferenceProblems`・`describeReferenceProblem`）。World Editor・`ubichill dev`・Host の配送が同じ判定を使う。mod の manifest の検証は `component`・`required` を受け付ける。
  - CLI: `ubichill dev` が毎回のビルドで参照の問題（未設定の必須参照・無い Entity・型の違う Entity）を検査し、ターミナルと dev パネルの診断（`DevFailure` の `kind: 'reference'`）に出す（止めはしない）。合成ワールドは合成の結果が変わったら部屋を作り直す（参照を足しただけでも配線し直す）。`world.yaml` が無いときに合成するワールドでは、型を宣言した参照をその型を置いた Entity に配線しておく。

- abbb4db: 組み込み Component `core:media`（動画を描く場所。Unity の MeshRenderer に当たる）を足した（#191）。

  - ワールドに `core:media` を置き、mod は参照フィールド `{ type: 'entityRef', component: 'core:media' }` でそれを指す。フィールドの名前を `Ubi.media.*` の targetId に使うと、`<video>` は参照先の Entity の位置・大きさで描かれる。URL の許可・同期・状態はその mod のもの。動画を出すだけの Worker を別に作らなくてよい。
  - `data` は `fit`（`contain` / `cover`）だけ。何を再生するかは持たない（未知のキーは検証で落ちる）。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
  - 1 つの動画面に出力できるのは 1 つ（Component のインスタンス × `core:media` を指す `entityRef`）。2 つ以上が指す面・`core:media` を 2 つ持つ Entity には誰の動画も描かず、World Editor（Hierarchy・Inspector）と `ubichill dev` が知らせる。判定は shared の `findMediaConflicts`（描いてよい出力は `owners`）。
  - 描けるのはワールド定義に置いた Component の出力だけ。部屋の中で作られた Component は面を指しても描かず、競合にも数えない（参加者が面を指す Component を作って動画を消せないように）。
  - `entityRefArray` は `core:media` を指しても描画先にならない。`mediaTargets` と同じ名前の `core:media` の参照はビルドで止める（CLI）。
  - `CORE_COMPONENT_TYPES.media` を足した。

- abbb4db: 組み込み Component `core:ui` を足した（#191）。ワールド作者が HTML 風の UI データ（`markup`）を書くと、Host が mod の UI と同じ描画（Shadow DOM・タグと属性の許可リスト・URL と style の検査）で描く。mod を作らずに看板・説明・リンクを置ける。

  - `script`・`style`・`template`・`iframe` などは中身ごと、`on*` 属性・コメントは解析で捨てる。使えないタグ（`b`・`center` など）はタグだけ外して中身を描く。要素名でない `<` は文字として描く。
  - リンクと画像は https だけ（画像は `data:image/` も可）。画像は参照元を送らない（`referrerpolicy` は `no-referrer` に固定）。mod の UI の規則は変えていない。
  - 解析は文字数に比例する時間で終わる（壊れた入力でも読み直さない）。入れ子は 32 段・要素は 2000 個まで。
  - `markup` は 2 万文字まで。未知のキーは検証で落ちる。クライアントからは作成・変更できない（ほかの `core:*` と同じ）。
  - 押したときの動きはまだ無い。`button`・`input` などは描くが押しても何も起きないので、World Editor の Inspector が「未対応」と知らせる（捨てた `on*` 属性・`script`・タグを外した要素・https でない URL・上限を超えた部分も同じ欄で知らせる）。
  - `CORE_COMPONENT_TYPES.ui` を足した。

- 04d9050: `CanvasStrokeData` に任意の `mode: 'draw' | 'erase'` を、`Ubi.canvas` に `replaceStrokes(targetId, strokes)` を追加し、Host ⇔ Worker のプロトコルを v7 にした（古い Host か確かめるには `Ubi.runtime.supports('canvas:erase')`）。

  - `'erase'` のストロークは、なぞった部分のそれまでの線を消す（Host は `destination-out` で重ね、`color` は使わない）。pen mod の消しゴム（`pen:pen` の `eraser: true`）で使う。消すストロークの `color` は透明にしているので、`mode` を知らない v5 以前の Host では何も描かれない（黒い線にはならない）。
  - `replaceStrokes` は永続レイヤーを消し、渡したストロークをその順で描き直す（`canvas:draw` の権限で使える）。消すストロークは重ねる順で結果が変わるので、先に描いた線の順番が後から決まったとき（サーバーの順と違った・保存に失敗した）に使う。v5 以前の Host では何も起きない。

### Patch Changes

- 04d9050: `ubichill build` が `config.dataOnly: true` の Component を、Worker を持たないデータ専用の Component として manifest に載せるようにした（バンドルせず、lock の components にも、置ける Component の一覧（`index.json` の `components`）にも載せない）。これまで `dataOnly` は型にあるだけでビルドが読んでおらず、mod が spawn するデータ（pen の `pen:stroke` など）を Worker として扱っていた。`ubichill dev` が `world.yaml` の無いときに合成するワールドにも data-only の型は置かない。manifest のスキーマに `dataOnly` を足した。

  `dataOnly` を書いた Component の `export const config` をリテラルとして読めない（テンプレート文字列・定数・スプレッドを使っている）と、ビルドを止めてそう知らせる。これまでなら黙って Worker として bundle され、spawn した Entity ごとに Worker が起動していた。

## 1.11.0

### Minor Changes

- b4c63fa: Go のインスタンスにカーソルのまとめ送りと接続数の上限を足した。

  - Go: `--cursor-batch-interval`（既定 50ms、0 で無効）。`world:join` で `features: ["cursors:batch"]` を宣言した接続には、間隔の中の `cursor:move` を利用者ごとに最新の 1 件にし、自分の分を除いて 1 フレームの `cursors:moved` で送る。宣言しない接続には今まで通り `cursor:moved` を 1 件ずつ送る。中継は宣言をそのまま owner へ通し、引っ越しでは同じ宣言で入り直す。
  - Go: `--max-connections`（既定 0 ＝無制限）。上限の 9 割から新しい部屋（作成・引っ越し）を 503 で断り、heartbeat の `full` と `room_capacity_available` を 0 にする。上限で新しい参加者の `world:join`（直接・中継の両方）を `instance_unavailable` で断る。入室中の接続は切らず、`/ready` も落とさない。指標 `ubichill_instance_connection_capacity`・`ubichill_instance_rejected_joins_total{reason}` を足した。chart は `instanceRuntime.maxConnections`。
  - backend: heartbeat の `full` の Pod には新しい部屋を置かない（古い版の Pod は書かないので部屋数だけで決める）。
  - shared: `ServerToClientEvents` に `cursors:moved`、`world:join` の data に `features?`（`InstanceFeature`）、`CursorMovedPayload` を足した。宣言を足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。

- 24578ca: ワールド定義の検証・写像（`definitionToResolved`）と、Go のインスタンスサーバーに渡す定義を作る `toInstanceDefinition` を `@ubichill/shared` に置き、backend と CLI が同じ変換を使う。`ubichill world build <world.yaml>` で、手元のワールドから `ubichill-instance --world` 用の定義 JSON を作れる。

### Patch Changes

- 24578ca: CLI を `ubichill` から分け、`@ubichill/cli` として公開する。`ubichill` は mod が import する SDK だけになり、bin と `esbuild`・`yaml` への依存が無くなる（mod 開発者は `npm i ubichill` に加えて `npm i -D @ubichill/cli` を入れる。`ubichill` コマンドの名前と使い方は変わらない）。

## 1.10.0

### Minor Changes

- d7850d7: 通知の仕組みを足した（ActivityStreams 2.0 に寄せた形）。

  - shared: 通知の型と zod のスキーマ（`Follow`・`Accept`・`Like`・`Announce`、種類ごとの object、actor はユーザー ID か https の URI）、一覧のカーソル、SSE の出来事。インスタンスのその場だけの知らせ `server:notice`（今は切断の予告 `{kind:"disconnect",at}`）の型と読み取り。イベントを足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。
  - db: マイグレーション `0026_notifications`。`notifications`（受け手・種類・actor・object・既読時刻、同じ出来事は 1 つ）・`announcements`・`announcement_reads`（お知らせの既読の位置）を足し、返事を待っているフレンド申請を `Follow` の通知に写す。手順は `docs/operations/db-migration.md`。
  - backend: `/api/v1/notifications`（一覧・未読数・既読・SSE `stream`・お知らせの一覧と作成）。フレンドの申請で `Follow`、承認で `Accept`、ワールドのお気に入りで作者に `Like`（自分には送らない・同じ人の繰り返しは 1 つ）、関係が消えたら 2 人の間の申請・承認の通知を消す。お知らせを出せるのは公式アカウントだけ。SSE は Redis の Pub/Sub（`ubi:ch:notifications`）で全台に配り、Redis が無い・送れないときはその台の接続にだけ届ける。古い通知は 90 日・1 人 200 件で掃除する（1 台だけ）。

## 1.9.1

### Patch Changes

- 70b6047: 作者の鍵を 1 つのテーブルにまとめた（マイグレーション `0020_author_keys`）。自サーバーの公開環境（`publishing_environments`）と他サーバーの作者の鍵一覧（`author_bindings` の jsonb）を、`author_keys`（代理キー・`origin` が local / remote）と `remote_authors` に移し、読み書きをすべて新しいテーブルに切り替えた。古いテーブルは残すが書かない（次のマイグレーションで消す）。古いイメージに戻すときの手順は `docs/operations/db-migration.md`。

  - 公開鍵は保存・照合の前に正規化する（shared の `normalizeEd25519PublicKey`。`ed25519:` の接頭辞・base64 / base64url・パディング・43 文字目の使われない bit の違いを 1 つにする）。これまでは文字列の完全一致で比べていたため、同じ鍵を別の書き方で別のアカウントに登録できた。DB でも正規形だけを受け付ける。
  - 同じ鍵を持てる自サーバーのアカウントは 1 つ。取り消した鍵を登録し直すこともできない（今と同じ）。
  - 他サーバーの作者が自サーバーの公開環境の鍵を名乗ってきた場合、その一覧は保存するが警告を記録し、その鍵では作者を付けない（これまでは付いていた）。
  - `@ubichill/db`: `publishingEnvironmentRepository`・`authorBindingRepository` を `authorKeyRepository`（`createAuthorKeyRepository`）にまとめた。別の DB に接続する `createDatabase` を足した。

- c0164c3: Go のインスタンスに部屋の Directory を足す（G1）。部屋を作る（`PUT /realtime/v1/instances/{id}`）ときに、部屋をこのノードに割り当てる。割り当てを Redis で共有するのは `INSTANCE_DIRECTORY=redis`（chart の `instanceRuntime.directory: redis`）のときだけで、既定はメモリ（1 Pod では共有する相手がおらず、Redis の可用性が部屋の可用性の上限になるだけのため）。owner は部屋のリースを 5 秒ごとに延長し、最後に成功した延長の要求を送った時刻から 10 秒（TTL 15 秒 − 余裕 5 秒）を過ぎるか、延長が token 不一致で失敗したら、その部屋の状態変更と入室を止めて接続を閉じる（`instance:closing` は送らない。クライアントはチケットを取り直して入り直し、部屋は新しい epoch で作り直される）。Redis の中身が消えて `ubi:cluster:gen` が変わったら全部屋を捨てる。`redis` にしたあと Redis が落ちても、メモリに切り替えない（新しい部屋は 503、既存の部屋は自己停止する）。

  参加チケットに部屋の世代（`gen`・`epoch`）を入れ、今の部屋の世代と一致しなければ `ticket_invalid` で拒否する。ゲストの再接続情報も、世代が違えば新しいゲスト ID を発行する（Go を再起動すると部屋の世代が変わるので、ゲストは新しい ID で入り直す。R1 の「再起動してもゲストの再接続情報が切れない」はこの PR で取り消しになる）。

  管理 API: 別のノードが owner の部屋の作成・終了は 409 と owner（`node`・`gen`・`epoch`・`addr`・`alive`）を返す。終了は自分が今の owner のときだけ行い、割り当てを token で解放する。在席のレスポンスに `node`・`gen`・`epoch` を足した（任意の項目。単体モードのゲスト向けには返さない）。backend はまだ使わない（G2 から）。

  chart は instance に `POD_NAME`・`POD_IP`（Downward API）を渡す。instance は `replicas: 1` のまま（WebSocket を owner に振り分ける Router は G2）。

- db4057f: Go のインスタンスの owner が落ちた・止まるときの扱いを揃える（G3）。

  Go: 閉じた部屋を 2 分作らせない印（`retired`）を Directory に移した。`directory: redis` なら `ubi:retired:<id>`（TTL 2 分）を割り当ての Lua の中で確かめるので、閉じた Pod 以外に作成が届いても生き返らない（閉じる側は割り当てを解放する前に印を付ける）。`memory` では今までどおり Pod の中だけ。heartbeat の `ubi:node:<id>` に `capacity`（`--max-rooms`、既定 1000）を足し、`connections` に中継している接続を含め、`ubi:nodes` に自分を載せる。SIGTERM を受けたら draining に入り、新しい部屋の作成を 503 で断り、`state: draining` をすぐ書き、`GET /ready`（新設）を 503 にする。持っている部屋は動き続け、接続が無くなるか `--drain-timeout`（既定 0）を過ぎたら残りを閉じて割り当てを解放する。部屋数が上限に達した Pod の作成も 400 から 503 に変えた。

  backend: `INSTANCE_DIRECTORY=redis` のとき、部屋の作成を Service の振り分けに任せず、Redis の `ubi:nodes`・`ubi:node:<id>` から選んだ Pod へ直接送る（部屋の owner が生きていれば owner、居なければ `ready` で上限未満の Pod を接続数・部屋数の少ない順）。503 と応答なしは 3 つの Pod まで送り直す。Pod の状態を読めなければ Service に任せる。owner が割り当てを解放せずに落ちたとき（409 で `alive: false`）は送り直さず、入室は今までどおり 503 でクライアントに取り直させる。

  shared: インスタンスのプロトコルに `GET /ready` と、作成（PUT）の 503 を足した（生成した型の追加のみ）。

  chart: `directory: redis` の Deployment を RollingUpdate（`maxSurge: 1`・`maxUnavailable: 0`）にした（`memory` は新旧の Pod が並ぶと owner が 2 つになるので Recreate のまま）。readinessProbe を `/ready` に、`instanceRuntime.maxRooms`（既定 1000）・`drainTimeout`（既定 15s、memory では 0）・`terminationGracePeriodSeconds`（既定 30）を足した。

  reaper も R2 と統合し、観測した `(gen, epoch)` または不在条件だけを閉じる。終了は token の照合・retired の設定・割り当てと在席の削除を原子的に行い、競合や Redis 障害時に成功を返さない。owner と在席が期限切れの参照は `ubi:rooms` から掃除する。

- 319eb74: Go のインスタンスを複数の Pod で動かせるようにする（G2）。各 Pod が WS Router を兼ね、最初の `world:join` の部屋が手元に無ければ、Directory の owner の内部アドレスの `/realtime/v1/relay` へ WebSocket を張って中継する。owner は Upgrade の後に 1 回だけ決め、owner が接続を閉じたら（自己停止・終了・退出）中継も閉じる（クライアントはチケットを取り直して繋ぎ直す）。owner が居ない・死んでいるときは `instance_unavailable`、チケットの世代が今の owner と違えば `ticket_invalid`。owner も中継された `world:join` のチケットと世代を自分で確かめる。中継用の口は Ingress に出さず、管理トークンから派生した鍵の HMAC（送り元・宛先のノード ID・30 秒の期限）で Pod 間の接続を確かめる。毎秒 240 件のレート制限はクライアントが繋いだ Pod だけが数える。

  管理 API（作成・チケット発行・終了）に任意の `?gen=&epoch=` を足し、今の部屋の世代と違えば 409（今の owner を付ける）を返す。在席のレスポンスに owner の `addr` を足した（任意の項目）。

  backend: 部屋の作成（PUT）の 409 を成功扱いにせず、owner の `addr`（`http://<addr>/realtime/v1`）へチケット発行・終了を世代付きで送る。`INSTANCE_DIRECTORY=redis`（chart は `instanceRuntime.directory` を backend にも渡す）のときは、作成を受けた Pod へ直接続く管理 API を送り、在席を Redis の `ubi:rooms`・`ubi:presence:<id>` から読む（Redis が落ちていれば在席は失敗にし、reaper が空室と誤って消さない）。`memory` のときは今までどおり `INSTANCE_RUNTIME_URL` に送る。

  chart: `instanceRuntime.replicas`（既定 1）。`directory: memory` のまま 2 以上にすると描画で失敗する。

- f942349: Go のインスタンスからメディア固有の処理を取り除き、部屋の汎用の共有状態に置き換える。

  - 新しいイベント: `state:get`（キーの今の値）・`state:update`（キー・値・`expectedRevision`。一致したときだけ書き、`revision` を 1 進めて `updatedAt`（サーバー時刻の ms）と `updatedBy` を付ける。一致しなければ `code: "conflict"` と今の値を返す）・`state:changed`（書いた本人以外への通知）。値は解釈しない JSON。上限はキー 512 バイト・値 32KiB・部屋あたり 1000 キー・合計 4MiB。
  - 消したイベント: `media:timeline:get`・`media:timeline:update`・`media:timeline`、どこからも使われていなかった `media:sync`・`media:state-request`・`media:state-response`（`MediaSyncState` 型も消す）。インスタンスのプロトコルは内部の API（docs/PROTOCOLS.md の D）なので互換の層は作らず、`protocolVersion` も上げない。
  - メディアの意味（load/play/pause/seek/ended/metadata の状態遷移と再生位置の計算）は Host（`@ubichill/react` の `createMediaRuntime`）へ移した。共有状態の `updatedAt` を再生の基準時刻にする。mod 向けの `Ubi.media` と Worker へのイベントは変わらない。

- 4afeacc: インスタンスに入るとき、ほかの参加者に見せる名前を SNS がチケットに入れ、Go のインスタンスはクライアントが送る名前より優先する（ほかの人や公式になりすませない）。入室時のユーザー情報は名前・ステータス・位置だけを配る（任意の画像 URL などを全員のブラウザに読ませない）。1 人が同時に持てるエンティティは 16 個まで、1 インスタンスの状態は 16MB まで。

  デプロイは Go のインスタンスを先に更新すること。古い Go は参加チケットの要求に知らない項目（`name`）があると拒否する。

- 0030710: users を整理した（マイグレーション `0021_users_cleanup`）。`handle` を NOT NULL にし、未設定の既存ユーザーには `user_` + 16 進 12 桁を自動で振る（システムユーザーは予約語の `system`）。画像は better-auth の `image` に寄せた（`image` が空の行だけ移す）。`username`・`profile_image_url` は新しいコードから読まなくしたが、列はデプロイ中の古い Pod のために残す（0022 で消す）。

  - `PUT /api/v1/users/me/handle` と、handle 未設定を前提にした分岐・画面を消した。ユーザーの応答の `profileImageUrl` は `image` に変えた（内部 API）。shared の `UserSummary` も `handle: string`・`image` にした。
  - メール確認を通さない登録と公式アカウントの作成は、better-auth の `signUpEmail` をやめ、users と accounts を 1 トランザクションで handle ごと作る（`userRepository.createCredentialUser`）。better-auth の `additionalFields` に `handle`（required・input: false）を宣言した（宣言しないと drizzle adapter が schema mismatch で止まる）。
  - 公式アカウントへの昇格は「handle 未設定」ではなく「その ID で鍵の登録・公開をしたことが無い」を条件にした。
  - 古いイメージに戻す手順は `docs/operations/db-migration.md`。

- ac490dd: 自サーバーで公開したワールドを、変えない版（`world_versions`）と下書き（`world_drafts`）に分けた（マイグレーション `0023_world_versions`）。既存の行の公開中の版を版 1 行に、下書き（未公開のワールドは今の定義）を下書きに移す。`worlds.id` を以前の `name` と同じ値にそろえ、API の `/api/v1/worlds/:worldId` は `worlds.id` で引く（応答の id は変わらない）。古い列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）は読まなくしたが、デプロイ中の古い Pod と古いイメージへの戻しのために残し、保存のたびに書き直す（消すのは後続のマイグレーション）。

  - `content_hash` は shared の `worldContentHash()` だけで求める。移した版の値は `migrate.js` がマイグレーションの直後に埋める（`backfillWorldContentHashes`）。
  - 同じ `metadata.version` で中身の違う公開は 409（`code: version-conflict`）で拒否する。同じ中身への署名し直しは、その版の `signature` の列だけを置き換える。
  - 残す版は `limitsFor(user).maxVersionsPerWorld`（今は 3）まで。超えて公開すると古い版から消す（公開は拒否しない）。インスタンスが指す版は消さず、定期処理（10 分ごと）で消し直す。shared に `limitsFor` と `LIMITS.MAX_VERSIONS_PER_WORLD` を足し、ワールドの数の上限も `limitsFor` から取る。
  - `GET /api/v1/worlds/:worldId/versions?contentHash=...` を足した。残っている版を返し、消した版は 410。
  - インスタンスを作るとき、ワールドの `content_hash` と、自サーバーで公開した版なら `world_version_id`（`world_versions` へ `ON DELETE RESTRICT`）を記録する。
  - 手順と戻し方は `docs/operations/db-migration.md`。

## 1.9.0

### Minor Changes

- 902a24c: mod の作者署名の確認をブラウザで行うようにした（単体モードでも mod が動く）。作者の確認の規則（鍵一覧の期限・取り消し・取得の上限・作者のサーバーが止まったときの猶予）を `@ubichill/shared` の `createAuthorKeyDirectory` に移し、ブラウザ（localStorage）とサーバー（DB）が同じコードで確かめる。Host は自分のオリジンの backend に確認を頼まなくなった。使われなくなった `POST /api/v1/mods/signature/verify` は削除した（フロントは backend との版のずれを検知して読み込み直すので、内部の API の互換は残さない）。WebFinger の鍵一覧の URL は、実行環境の URL で正規化してから同じオリジンかを比べる。localStorage を使えない環境ではメモリに切り替えて確認を続ける。
- a5d6f3a: 外部（GitHub Pages など）に置いたワールド・mod をユーザーページに出せるようにした。`ubichill publish` に `--public-url`（mod は省略時 package.json の `homepage`）を渡すと、署名したときに作者アカウントのサーバーへ登録される。サーバーは本人の署名が付いた内容だけを登録し、表示する前に公開先で本人の署名付きで配られているかを確かめる。ユーザーページに「公開している mod」を追加し、外部のワールドも「作成したワールド」に出る。
- 18142c5: サービストークンに、依頼した mod の確認済みの作者アカウント（`mod_author`）を載せるようにした。Host が読み込み時に確認した mod の署名を発行の依頼に付け、サーバーが確かめ直したときだけ入る。サービスは `checkServiceTokenClaims` の `allowedModAuthors` で「自分が署名した mod からの依頼だけ受ける」と決められる。
- b802a3c: 作者署名をワールドと mod で 1 つの形式にした（`format: "ubichill-signature"`・`version: 2`・`kind`。docs/PROTOCOLS.md）。署名する値・検証の順番は `signEnvelope` / `verifyEnvelope` の 1 か所で、`kind` が署名する値に入るので別の種類の署名として使い回せない。作者は必須で正規の表記だけ。版 1 の署名は読まないので、ワールドと mod は `ubichill publish` で署名し直す必要がある。形式を固定するテストベクターを加えた。

### Patch Changes

- 9d7c2d9: Host ⇔ Worker のプロトコルの契約（版ごとのコマンド・イベントの一覧）を追加し、版を上げずに変えるとテストが落ちるようにした。約束ごとの種類と互換の扱いを docs/PROTOCOLS.md にまとめた。

## 1.8.0

### Minor Changes

- c6cba3a: mod の作者署名を必須にした。`ubichill publish <ビルド出力>` がワールドと同じアカウント・同じ鍵（CI は `UBICHILL_CREDENTIALS`）で `v<version>/lock.sig.json` を書き出し、Host は署名で作者を確認できた mod だけを実行する（`POST /api/v1/mods/signature/verify`）。`ubichill verify` は署名も検証し（`--require-signatures`）、単体 mod の出力（`dist/v<version>/`）も検証するようになった。公開済みの mod は署名して公開し直す必要がある。権限の許可は「作者＋ mod の ID」に結び付くようになり、同じ ID を名乗る別の作者の mod は許可を引き継がない（これまでの許可は確認し直しになる）。

## 1.7.0

### Minor Changes

- 70ae199: 表示名を別の名前に変えるのを 90 日に 1 回までにする（大文字小文字・全角半角だけの変更と、重複の解消は除く）。ユーザー検索は表示名の一意キーで照合して ID の一致を先に並べ、`@ID@サーバー` の指定を解釈する（ほかのサーバーのアカウントは `remoteAccount` として返す）。
- 5d131c6: mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
- 1e313e9: mod が外部サービスへ身元証明を渡せる `Ubi.identity.token(audience)` を追加。Ubichill のサーバーが短命の JWT（EdDSA）を発行し、サービスは公開鍵（`/api/v1/service-tokens/keys`）だけで検証できる。利用者 ID はサービスごとの仮名。権限 `identity:token`。プロトコル v5。

## 1.6.0

### Minor Changes

- 749cc83: インスタンス内の通信・状態管理を Go サーバーへ分離。ゲストによる単体運用、SNS 参加チケット、OpenAPI による共通型生成、WebSocket 接続と再同期に対応。

## 1.5.0

### Minor Changes

- 307340c: フレンド・ソーシャルとインスタンスの公開範囲を追加し、通信が切れたあとにインスタンスが消える問題を直す。

  - フレンドの申請・承認・解除と、ユーザー検索（ID の前方一致・表示名の部分一致）。API は `/api/v1/social`
  - フレンドの現在地（インスタンスごと。見えないインスタンスにいるフレンドは「非公開の場所」）
  - インスタンスの公開範囲（パブリック・フレンド+・フレンドのみ・招待のみ）を一覧・詳細・参加で効かせる。作成時に選べる
  - 自動で再接続したら参加し直す（以前は参加し直さず、猶予の後に退出扱いになって空のインスタンスが削除されていた）
  - 同じアカウントが別のタブで参加したら、古いタブに理由を知らせてから切る
  - ユーザーページをログインなしで見られるようにし、自己紹介（本人が書く）とリンクのプレビュー（名前・アイコン・説明）を付ける

## 1.4.0

### Minor Changes

- 0d3bd18: ワールドの公開を 1 つの形・規則・方法にまとめる。本体の DB・リポジトリ（worlds/）・外部ホストのワールドを区別しない。

  - どのワールドも「定義・lock・署名」の組で、同じ規則で検証する。本体のワールドで署名が壊れていても、未署名に格下げせず拒否する
  - 本体は中身を書き換えない（metadata.name も）。同じワールドかは作者 + metadata.name で決まる。本体へ送る入口は `PUT /api/v1/worlds` だけ
  - `ubichill publish` は手元で署名した組をそのまま送る。prepare と `<world>.ubichill.json` は不要になった
  - 配り方も 1 つ: 本体のワールド（DB・リポジトリとも）は `/api/v1/worlds/<id>.yaml` と兄弟の `.lock.json` / `.sig.json` で、外部ホストと同じ形。以前の URL・共有 URL は `.yaml` に正規化し、保存済みのお気に入り・インスタンスの参照も書き換える
  - `worlds/trusted-authors.json` による特別な信用をやめた。公式アカウントの鍵もほかの作者と同じく WebFinger で確かめ、画面から取り消せる
  - lock に固定されていない mod は、配信場所に関係なく実行しない
  - リポジトリ（worlds/）のワールドは、作者がこのサーバーのアカウントのものだけ配る。ほかのサーバーの作者のワールドは写しを配らず、公式アカウントがプロフィールの「連合」でそのサーバーをフォローして一覧に出す（例: https://ubichill.com）
  - 使われていなかった `WORLDS_REGISTRY_URLS` とレジストリの列挙を削除
  - 共有 URL は `/@ID/名前`、配信は `/api/v1/authors/ID/worlds/名前.yaml`（作者と名前で決まり、ほかのサーバーも URL だけでたどれる）。保存には ID が要る
  - 名前（metadata.name）の変更は移動: 同じワールドのまま URL が変わり、以前の URL からもたどれる。エディタのワールド情報に名前の欄を追加
  - 公式ワールドの署名は、ほかの作者と同じく CI（公式アカウントの CI 用公開環境、Secret UBICHILL_CREDENTIALS）で main に入ったときに行う。署名ファイルはコミットしない（`pnpm sign:worlds` を廃止）
  - `ubichill publish` は複数のワールドをまとめて公開・書き出しでき、共有 URL を表示する

## 1.3.0

### Minor Changes

- 25e2070: 公開できるワールドを「作者アカウント（handle@domain）まで確認できた署名」に限定しました（公式ワールドも `ubichill@ubichill.com` で署名）。作者アカウントと鍵の結び付けは初回だけ WebFinger で確認して保存し、以後の通常アクセスでは確認しません。WebFinger で表示名も公開し、作者名はアカウントから引きます。`ubichill sign` は `--author` なしの署名に警告を出します。
- 25e2070: 公式アカウント（ID `ubichill`）をサーバー起動時に用意するようにしました。初期パスワードは `OFFICIAL_ACCOUNT_INITIAL_PASSWORD` で指定し、ログイン後に変更を促します。公式アカウントは公式ワールドの作者と管理者を兼ね、連合ピアの追加・削除やワールドの再読み込み・並べ替えは管理者だけが実行できるようにしました（以前はログインしていれば誰でも実行できました）。パスワードの変更機能を追加しました。
- 25e2070: 表示名を VRChat と同じく一意にしました（全角半角・大文字小文字・空白の違いは同じ名前として扱い、あとから変更可能）。移行時に重複していた既存ユーザーには表示名の変更を促します。作者の表示は署名で確認できたアカウントを `@ID` と `@サーバー` に分けて表示し、どのサーバーが作者の鍵を証明しているかを示します。
- 25e2070: ワールドの署名に作者アカウント（`handle@domain`、表示は `@youkan@ubichill.com`）を含められるようにしました。受け手は WebFinger（`/.well-known/webfinger`）で作者の公開鍵を引き、署名鍵と一致したときだけ作者として表示します。ユーザーは日本語も使える表示名と、URL・署名用の変更不可な ID を別々に持ち、署名用の公開鍵を 1 本アカウントに登録します（秘密鍵の所有を証明して登録）。CLI は `ubichill sign --author=handle@domain` / env `UBICHILL_AUTHOR` に対応しました。
- 25e2070: ワールドの作者署名を追加しました。`ubichill keygen` / `ubichill sign <world.yaml>` で兄弟ファイル `<world>.sig.json` を生成でき、ホストは YAML と lock の改竄を検知して拒否し、URL が変わっても `公開鍵 + metadata.name` で同じワールドと判定します。サーバーは鍵を持たず、本体で作ったワールドは作者がブラウザの鍵で署名し、サーバーは検証済みの署名だけを保存・配信します。署名を検証できないワールドは一覧に公開せず、URL から入る場合は入室前に確認します。

## 1.2.0

### Minor Changes

- c764ea4: スマホ/タブレットのタッチ操作に対応した。

  **入力**: 入力収集を PointerEvent 化し、各入力イベントに `pointerType`(mouse/pen/touch)を、
  mod へ `Ubi.hasCoarsePointer`(タッチ/ペンが使えるか。`any-pointer: coarse` も見るのでマウス併用の
  ハイブリッド端末でも true)を公開した。mod 開発者はこの 1 つの真偽値を見るだけで、見た目と
  ロジックの出し分けに集中できる。mod UI のポインタイベント detail には要素のローカル座標と
  要素サイズを渡す(`UiPointerActionDetail`)ので、要素の画面位置やビューポートサイズを知らなくても
  仮想スティックのようなドラッグ操作を実装できる。

  **画面固定オーバーレイ**: `ComponentConfig.overlay` / `EntityComponentSchema.overlay` を追加。
  画面の角(`top-left` 等)を指定すると transform.x/y を「その角からの距離」として解釈するので、
  画面サイズ(縦/横/タブレット)に依存せず HUD が画面内に収まる。`fill` は画面全体を覆うレイヤーで、
  1 Component で「左下にスティック・右下にボタン」のように複数箇所へ配置できる。
  manifest の値は Component 追加時の既定値で、以降は World Editor の Inspector で Entity ごとに
  上書きできる。

  **長押し対策**: タッチ/ペンの長押しで出るネイティブのコンテキストメニューを抑止し(テキスト入力欄は
  貼り付けのため除外)、mod 描画面ではテキスト選択も無効化した。選択ジェスチャがハプティクス(バイブ)の
  発生源なので、これを切らないと「どこを押しても振動する」状態が止まらない。

  **ドラッグの取り合い**: 何かを持っている間(`Ubi.grip`)はワールドのスクロールコンテナを
  `touch-action: none` にして、指のドラッグを mod の操作として扱う。既定ではブラウザがパン
  (スクロール)と解釈して `pointercancel` を発火させ、ペンで描く操作が最初の一筆で途切れていた。

  **掴む/離すの修正**: `Ubi.grip` が release の CMD を 2 回送っていた(holder 変化を検知する
  ゴースト防止経路と `release()` 自身)。先に届く座標なしの release で host 側の hold 状態が畳まれ、
  後から届く座標付き release が捨てられていたため、トレイへ戻したペンが指の最後の位置へ落ちていた。
  送信元を 1 か所に集約して戻り先を保持する。あわせて host 側は「今持っているもの」の release でだけ
  hold 状態を畳むようにした。持ち替え(A を持ったまま B を掴む)では B の hold の後に A の release が
  届くため、無条件に畳むと B の追従だけ止まり「ペンが追従しないのに描ける」状態になっていた。
  ストロークの座標はカーソルではなく「ペン先の実位置」から求めるようにした。ペンの形状・持ち方を
  知っているのはペン本体だけなので、ペン先の算出はペン側の責務にし、canvas は受け取った点を線に
  するだけにした(持ち方や見た目を変えても線はペン先から出る)。トレイへ戻すときはトレイ原点へ
  吸着させず、押した位置にペンを置く。

  **バグ修正**: `worldResolver` の正規化が Component のフィールドを列挙して組み直していたため、
  スキーマに追加した項目(overlay)を黙って落としていた。また入力座標をワールド座標へ直すための
  スクロール量供給元の登録がマウント時一度だけで、Worker 再生成(`myUserId` 確定・権限承認)で
  失われ、スクロール後に描いた線が指の位置からスクロール量だけずれていた。overlay Entity を
  掴んだときの座標系のずれも修正した。

## 1.1.0

### Minor Changes

- 988f2c8: `Ubi.ride`(乗る)プリミティブを追加した。乗り物 Entity が `Ubi.ride.exclusive()` を宣言すると、
  ユーザーがそれに乗っている間だけアバターが OS カーソルから切り離され、矢印キーでの移動 + カメラ追従に切り替わる。
  降りると通常のマウス追従に戻る。マウスとキーボードはワールド単位の排他設定ではなく、乗車状態によって動的に切り替わる
  (`CMD_RIDE`・`packages/react` の `RideProvider`/`useRide`/`ridingSyncRef` を追加)。

  `packages/frontend/src/components/cursor/useKeyboardMovement.ts`(押下キーからの位置積分・既存の
  `updatePosition`/`cursor:move` をそのまま再利用)と `useCameraFollow.ts`(スクロール位置の追従計算の純関数)を追加し、
  `CursorLayer.tsx` に配線した。マウス操作のみの既存ワールド(pen・video-player・チルわ等)の挙動は一切変更していない。

  あわせて、前回 PR で追加した Component の永続 id (`EntityComponentSchema.id`) が `worldResolver.ts` の
  `normalizeEntity` で欠落しており、実運用では常に index フォールバックになっていた不具合を修正した。

- 7c89fcb: Component を 1 つも持たない GameObject（座標だけのマーカー・スポーン地点・矩形など）を mod から読めるようにした。`flattenGameObject` がそのような GameObject に対し、新しい予約型 `EMPTY_ENTITY_TYPE`（`'__entity__'`）を持つ ComponentInstance を 1 件発行する。`Ubi.entity.query`/`get` や entityRef から通常の Entity と同様に transform/entityId を参照できる。Worker を持たないため Host 側は mod 解決を試みない。
- 7c89fcb: 1 Entity に複数 Component を配置できるようにし、Component 単位で `transform` を上書き可能にした。`dataFields` に `entityRef`/`entityRefArray` 型を追加し、mod が Editor 上で他 Entity を明示的にターゲティングできるようにした。

  - `entityRef`/`entityRefArray` で明示配線した Entity は `watchScope` 外でも読み書きを許可する(`declaredTargets`)。
  - Component の見た目（jsx/canvas/ロジック）は manifest 宣言ではなく `canvasTargets` / `ui:render` capability から自動判定するようにした（`renderKind` 宣言は不要）。
  - ワールドの `dependencies[].source` から `type` ディスクリミネータを廃止し、`url` の有無で「外部 URL / ローカル（public mods）」を判定するようにした（旧 `type` は無視され後方互換）。
  - `ubichill build` が出力する `index.json` に外部レジストリの既存バージョン履歴をマージするようにし、mod 開発者がバージョン管理を意識しなくても複数バージョン公開が維持されるようにした。

  あわせて、`Ubi.entity().update()` の自己更新が `watchScope` チェックで誤って拒否される重大なリグレッションを修正した。`onUpdateEntity`/`onDestroyEntity` が受け取る id は componentInstanceId であり GameObject id とは別の識別子空間だったが、旧実装はこれを混同しており全 mod の自己更新が壊れていた。

- 7c89fcb: `entityRef`/`entityRefArray` の dataFields に `access: 'read' | 'write'`（既定 `'read'`）を追加した。

  これまで「Inspector で他 Entity を参照した」ことが、参照先の読み取り・更新・削除すべてを一括で許可する強い権限になっていた。`access` を明示的に分離し、既定では読み取りのみを許可、`access: 'write'` を宣言したフィールドのみ参照先への `transform`/`data` 更新も許可するようにした。削除はこの経路からは一切許可されない（`watchScope` で見える Entity のみ削除可能）。

- 7c89fcb: Entity 内の Component に永続 id を持たせられるようにした。これまで flat ComponentInstance の id は `${entityId}::${配列index}` で採番しており、Component の並べ替え・途中への挿入・削除で既存 Component の id が変わってしまい、永続 state の誤適用・lock の付け替わり・entityRef 等の外部参照の破損が起こり得た。

  `EntityComponentSchema` に任意の `id`（kebab-case）を追加し、指定があればそれを flat id の採番に使う（`${entityId}::${id}`）。省略時は従来通り index フォールバックのため、既存の world.yaml はそのまま動作する。World Editor で新規に Component を追加する際は、component 名から自動的に一意な id を採番する。

## 1.0.1

### Patch Changes

- 13aee7d: メディア同期プロトコルを一般化し、バックグラウンド再生を整備した。

  - `media:sync` / `media:state-response` のペイロードを `currentIndex`（動画プレイリスト前提）から `MediaSyncState`（`mediaId` ベース、`duration` / `playbackRate` を任意付加）へ一般化。バックエンドは引き続き中身を解釈しないリレーのみ。
  - `Ubi.media.load()` に `kind`（`'audio' | 'video'`）を追加。`'audio'` はデバイス操作（メディアキー/ロック画面）を既定で許可し、`navigator.mediaSession.playbackState` を設定してバックグラウンド再生を継続する。`'video'`（既定）は明示許可までデバイス操作をロックする。

- 13aee7d: `shared` レイヤーから mod 固有の概念を排除した。

  - `User` から `penColor` / `heldEntityId` を削除（`heldEntityId` はカーソル追従に必要なため `cursor:move` / `cursor:moved` イベント側に残す）。
  - 未使用の `EmojiEvent` と `isMenuOpen` を削除。
  - `user:update` / `user:updated` イベントを廃止（呼び出し元・ハンドラをすべて除去）。

  これにより `shared` は特定 mod（ペン等）の存在を知らない純粋な共有レイヤーになる。
