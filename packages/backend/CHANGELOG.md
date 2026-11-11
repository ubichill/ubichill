# @ubichill/backend

## 1.13.0

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
- Updated dependencies [21923d9]
- Updated dependencies [50a82bd]
- Updated dependencies [fc8a52b]
- Updated dependencies [72b1f61]
- Updated dependencies [b3c43ad]
- Updated dependencies [6e3ee64]
- Updated dependencies [b7b6366]
- Updated dependencies [5365069]
- Updated dependencies [8f0912b]
- Updated dependencies [88cd7db]
- Updated dependencies [6317b11]
  - @ubichill/shared@1.16.0
  - @ubichill/db@1.9.0

## 1.12.0

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

### Patch Changes

- Updated dependencies [be9da67]
- Updated dependencies [86a3e4f]
- Updated dependencies [f8c52bb]
- Updated dependencies [2a500f2]
- Updated dependencies [833415f]
  - @ubichill/shared@1.15.0
  - @ubichill/db@1.8.0

## 1.11.0

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

### Patch Changes

- Updated dependencies [6ba0785]
- Updated dependencies [787dfc4]
- Updated dependencies [4424709]
  - @ubichill/shared@1.14.0
  - @ubichill/db@1.7.0

## 1.10.0

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
- 890dd1d: ロビーの「共有 URL を貼って入る」などで、共有ページの URL（`…/world?url=…`、どのサーバーのものでも）・`@handle/name`・`https://` を省いた `host/@handle/name` を貼っても、同じワールドにたどり着くようにした。
- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0
  - @ubichill/db@1.6.0

## 1.9.2

### Patch Changes

- 4b24568: 端末への出力を作り直す（絵文字をやめ、Vite / Next.js と同じく `✓` 成功・`✗` 失敗・`!` 注意・`➜` 次にすること、TTY のときだけ色。`NO_COLOR` / `FORCE_COLOR` に従う）。

  - `ubichill dev`: 起動の途中は mod ごとのビルドの行、起動し終えたら最後に URL の案内（`ready in`）を出す。以降は時刻・`[dev]` / `[build]` / `[instance]`・結果の 1 行。ビルドの失敗は mod の名前と esbuild のコードの抜き出し、ワールドの失敗は直し方を添える。
  - `ubichill dev` は既定で手元（127.0.0.1）だけで待ち受ける。`--host`（全部の口）/ `--host=<addr>` で LAN に公開し、そのオリジンを Go にも許す。
  - 全体の `--debug`（`UBICHILL_DEBUG=1` と同じ）: 判断・時間・HTTP の要求・Go の info / debug のログを出し、失敗にスタックトレースを付ける。ふだんの失敗はメッセージと直し方だけ。
  - `ubichill dev` は Go を `--log-format=json` で起動し、JSON の行を `[instance]` の行にする（ふだんは warn / error だけ）。
  - backend・db（migrate）のログは 1 件 1 行（本番は ISO 時刻・level・色なし、スタックの改行は `\n`）。

- 4d98926: 依存を更新する（@redis/client 6.3.1・dotenv 18.0.9・express-rate-limit 8.7.3・rate-limit-redis 6.0.2・resend 6.37.0・better-auth 1.7.15）。
- ddd7bc3: undici を 8 に上げる（外部 URL の取得 `safeFetch` の接続時の DNS 検査は、8 でも接続のたびに呼ばれることを確かめた）。
- Updated dependencies [abbb4db]
- Updated dependencies [4b24568]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0
  - @ubichill/db@1.5.2

## 1.9.1

### Patch Changes

- 9a21d63: chart の同梱の Redis を、Bitnami の subchart（`bitnami/redis:latest`）から chart 自身のテンプレートで動かす Valkey（`valkey/valkey:8.1.11-alpine`、Redis 7.2 互換）に替えた。

  - Service `<release>-redis-master:6379` と Secret の参照は変わらないので、backend・instance の `REDIS_URL`・`REDIS_PASSWORD` はそのまま。
  - StatefulSet・PVC の名前が変わるので、移行のときに Redis の中身は消える（Go は部屋を作り直し、レート制限は 0 から数え直す。ログインのセッションは Postgres なので消えない）。手順は chart の README の「Bitnami の subchart からの移行」。
  - `redis.auth.password` か `redis.auth.existingSecret` が要る（乱数で作らない）。イメージは版で固定し、`latest` と Bitnami のイメージは描画で失敗する。
  - `maxmemory` はメモリの上限の 75%、`maxmemory-policy` は `noeviction`（リースを追い出さない）。
  - exporter は `oliver006/redis_exporter` の sidecar（`redis.metrics.enabled`）。

- 4a3e032: dev 環境と負荷試験のための chart・CI・クライアントの変更。

  - CI: main への push で `:main-<sha>` タグも付ける（dev 環境の Image Updater が追う。`:sha-<sha>` は PR のプレビューにも付くので区別する）。
  - chart: `instanceRuntime.nodeSelector` / `affinity` / `tolerations` で Go の Pod の配置を指定できる（負荷の生成器と別のノードに置く）。
  - chart: Go の権限を絞る。Role は pods の `patch` だけにし、`ValidatingAdmissionPolicy`（`instanceRuntime.autoscaling.deletionCostPolicy.enabled`、既定 true）で、この ServiceAccount からの更新を「同じ release の instance の Pod の pod-deletion-cost の注釈だけ」に限る。
  - react（changeset の対象外）: 部屋の引っ越し中に `code: "migrating"` で断られた応答付きの要求（state:update・entity:create など）を 500ms おきに最大 20 回送り直す。利用者からは失敗に見えない。

- aa04846: `WORLDS_SERVE_UNSIGNED_REPOSITORY=true`（開発・プレビュー・dev 環境）のとき、ほかのサーバーの作者の署名が付いた同梱ワールドも、署名を外して「署名なし」として公式アカウントの名義で配る。dev 環境は main のイメージ（本番の作者の署名付き）で動くので、今までは配れるワールドが 1 つも無かった。作者のサーバーへは問い合わせず、本番ではこの設定自体が使えない。
- b4c63fa: Go のインスタンスにカーソルのまとめ送りと接続数の上限を足した。

  - Go: `--cursor-batch-interval`（既定 50ms、0 で無効）。`world:join` で `features: ["cursors:batch"]` を宣言した接続には、間隔の中の `cursor:move` を利用者ごとに最新の 1 件にし、自分の分を除いて 1 フレームの `cursors:moved` で送る。宣言しない接続には今まで通り `cursor:moved` を 1 件ずつ送る。中継は宣言をそのまま owner へ通し、引っ越しでは同じ宣言で入り直す。
  - Go: `--max-connections`（既定 0 ＝無制限）。上限の 9 割から新しい部屋（作成・引っ越し）を 503 で断り、heartbeat の `full` と `room_capacity_available` を 0 にする。上限で新しい参加者の `world:join`（直接・中継の両方）を `instance_unavailable` で断る。入室中の接続は切らず、`/ready` も落とさない。指標 `ubichill_instance_connection_capacity`・`ubichill_instance_rejected_joins_total{reason}` を足した。chart は `instanceRuntime.maxConnections`。
  - backend: heartbeat の `full` の Pod には新しい部屋を置かない（古い版の Pod は書かないので部屋数だけで決める）。
  - shared: `ServerToClientEvents` に `cursors:moved`、`world:join` の data に `features?`（`InstanceFeature`）、`CursorMovedPayload` を足した。宣言を足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。

- e956ac5: インスタンス作成の 1 IP・1 時間あたりの上限を `INSTANCE_CREATE_LIMIT_PER_HOUR` で変えられるようにする（既定は 10 のまま）。負荷試験のために dev で上げる用。本番（`NODE_ENV=production`）では既定より大きくすると起動しない。
- 01165a6: Go のインスタンスのリースの既定を TTL 30 秒・余裕 10 秒・Directory の往復の上限 5 秒にする（15 秒・5 秒・2 秒から）。CPU の上限に張り付いた Pod では、延長の goroutine が何千もの送信の後ろに並んで往復が数秒遅れ、dev の負荷試験（1000 接続・3 Pod）で 1 Pod の部屋が 21 個自己停止して約 290 人が切断された。延長が 20 秒まで遅れても部屋を保つ。代わりに、落ちた Pod の部屋を別の Pod が作り直せるまで最長 30 秒かかる（backend の復旧の猶予 60 秒の内）。

  フロント（@ubichill/react、changeset の対象外）は、一度入れた後の切断に限り繋ぎ直しを 60 秒・10 回まで続ける（最初の入室は今まで通り 30 秒・6 回）。リースが 30 秒になったので、Pod の障害の直後は部屋を作り直せるまで最長 30 秒 + backend の作り直しの時間がかかり、30 秒で諦めると戻れたはずの利用者が脱落する。

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0
  - @ubichill/db@1.5.1

## 1.9.0

### Minor Changes

- d7850d7: 通知の仕組みを足した（ActivityStreams 2.0 に寄せた形）。

  - shared: 通知の型と zod のスキーマ（`Follow`・`Accept`・`Like`・`Announce`、種類ごとの object、actor はユーザー ID か https の URI）、一覧のカーソル、SSE の出来事。インスタンスのその場だけの知らせ `server:notice`（今は切断の予告 `{kind:"disconnect",at}`）の型と読み取り。イベントを足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。
  - db: マイグレーション `0026_notifications`。`notifications`（受け手・種類・actor・object・既読時刻、同じ出来事は 1 つ）・`announcements`・`announcement_reads`（お知らせの既読の位置）を足し、返事を待っているフレンド申請を `Follow` の通知に写す。手順は `docs/operations/db-migration.md`。
  - backend: `/api/v1/notifications`（一覧・未読数・既読・SSE `stream`・お知らせの一覧と作成）。フレンドの申請で `Follow`、承認で `Accept`、ワールドのお気に入りで作者に `Like`（自分には送らない・同じ人の繰り返しは 1 つ）、関係が消えたら 2 人の間の申請・承認の通知を消す。お知らせを出せるのは公式アカウントだけ。SSE は Redis の Pub/Sub（`ubi:ch:notifications`）で全台に配り、Redis が無い・送れないときはその台の接続にだけ届ける。古い通知は 90 日・1 人 200 件で掃除する（1 台だけ）。

### Patch Changes

- 636974f: Go のインスタンスを KEDA で自動で縮められるようにする（K2）。縮めるとき、部屋の owner だけを別の Pod へ引っ越し、クライアントの WebSocket は切らない。

  Go: SIGTERM で draining になったあと、作られてから `--migrate-after`（既定 3h）を過ぎても参加者の居る部屋を、Directory の ready な Pod（接続の少ない順）へ引っ越す。若い部屋は空になるか 3h に達するまで待つ。引っ越しは「凍結 → 先の Pod の `POST /realtime/v1/instances/{id}/handoff` で準備 → Directory の `Transfer`（token が一致すれば node と token を替え epoch+1。Redis は Lua）→ 確定」で行い、owner の居ない隙間を作らない（確定が届かなくても、先が準備の期限に Directory を見て引き取る）。凍結の間、変更系の要求は `code: "migrating"` の失敗（状態は変えない）。中継してきた Pod には `relay:migrate` を送り、中継元が新しい owner へ繋ぎ直してチケットを署名し直す。元の Pod に直接繋いでいたクライアントは、元の Pod が中継に変わる。新しい owner は繋ぎ直しで `user:joined` を出さない。部屋が無くなっても直接繋いでいるクライアントが居る間は `--drain-timeout` まで止まらず、その `--disconnect-notice`（既定 10m）前に `server:notice`（`{"kind":"disconnect","at":<epoch ms>}`）を送る。`--pod-deletion-cost` で自分の Pod に `controller.kubernetes.io/pod-deletion-cost`（直接の接続数 + owner の部屋の参加者数）を書く（client-go は使わない）。

  chart: ScaledObject の scale-in を有効にした（既定: 安定化 900 秒・10 分に 1 Pod。`autoscaling.scaleDown`）。接続数・部屋数の query から draining の Pod を除く。`drainTimeout` の既定を 24h にし、`terminationGracePeriodSeconds` は空なら drainTimeout + 30 秒。`migrateAfter`・`disconnectNotice` を足した。自動スケールが有効なときだけ、instance の ServiceAccount・Role（pods の get/patch）・RoleBinding を作り、`POD_NAMESPACE` を渡す。

- Updated dependencies [d7850d7]
  - @ubichill/shared@1.10.0
  - @ubichill/db@1.5.0

## 1.8.1

### Patch Changes

- 4afeacc: better-auth の口のうち、画面が使うもの（ログイン・ログアウト・セッション取得・パスワード変更）だけを HTTP に開けるようにした。`/api/auth/sign-up/email` からメール確認を通らずに登録する、`/api/auth/update-user` で表示名の一意性と変更間隔を迂回する、といった使い方ができなくなる。

  仮登録はメールアドレスではなく、申し込んだ本人に返す ID で引くようにした（`/users/verify`・`/users/resend-otp` は `registrationId` を受け取る）。他人が同じアドレスで申し込み直して本人の仮登録をパスワードごと置き換えることはできない。認証コードは 5 回間違えると無効になる。

  公式アカウントは、メールアドレスを確認済みのアカウントだけを昇格させ、昇格前のログインと公開環境は取り消す。

- 70b6047: 作者の鍵を 1 つのテーブルにまとめた（マイグレーション `0020_author_keys`）。自サーバーの公開環境（`publishing_environments`）と他サーバーの作者の鍵一覧（`author_bindings` の jsonb）を、`author_keys`（代理キー・`origin` が local / remote）と `remote_authors` に移し、読み書きをすべて新しいテーブルに切り替えた。古いテーブルは残すが書かない（次のマイグレーションで消す）。古いイメージに戻すときの手順は `docs/operations/db-migration.md`。

  - 公開鍵は保存・照合の前に正規化する（shared の `normalizeEd25519PublicKey`。`ed25519:` の接頭辞・base64 / base64url・パディング・43 文字目の使われない bit の違いを 1 つにする）。これまでは文字列の完全一致で比べていたため、同じ鍵を別の書き方で別のアカウントに登録できた。DB でも正規形だけを受け付ける。
  - 同じ鍵を持てる自サーバーのアカウントは 1 つ。取り消した鍵を登録し直すこともできない（今と同じ）。
  - 他サーバーの作者が自サーバーの公開環境の鍵を名乗ってきた場合、その一覧は保存するが警告を記録し、その鍵では作者を付けない（これまでは付いていた）。
  - `@ubichill/db`: `publishingEnvironmentRepository`・`authorBindingRepository` を `authorKeyRepository`（`createAuthorKeyRepository`）にまとめた。別の DB に接続する `createDatabase` を足した。

- 85910ee: Redis を設定した backend を複数台で動かせるように、プロセス内にあった状態を Redis で揃える（Redis なしの 1 台では今まで通り）。

  - HTTP のレート制限（全体・インスタンス作成・サービストークン・外部の作品の再確認）は `rate-limit-redis` で台数をまたいで数える。Redis が落ちている間は制限せずに通し、警告は limiter ごとに 1 回だけ出す。
  - better-auth のレート制限は `rateLimit.customStorage` で Redis に数える（`secondaryStorage` はセッションの保存先まで変えるので使わない）。Redis が落ちている間も、ログイン（`/api/auth/sign-in/email`）だけは 503 で断る。
  - 空インスタンスの掃除と期限切れの CLI 認可の掃除は、リース `ubi:lease:reaper` を持つ 1 台だけが行う。Redis が落ちている間は掃除しない。Go に部屋が無いと最初に観測した時刻は `ubi:absent:<instanceId>` に置き、担当の backend が替わっても復旧の猶予が延びない。
  - ワールドの保存・削除・再読み込み、作者の鍵・表示名の変更、外部ワールドの確かめ直し、連合のフォロー、公開のお気に入りの変更を、Pub/Sub（`ubi:ch:backend`）でほかの backend に知らせてキャッシュを捨てさせる。届かなくても期限で揃うよう、本体のワールドの解決結果（今までは期限なし）は 5 分、連合のフォロー先は 5 分で読み直す。
  - ワールドの並び順はまだプロセス内のままで、複数台では揃わない。chart の `backend.replicaCount` は既定 1 のまま。Redis なしで 2 以上を指定すると描画で失敗する。

- 740ccc7: DB の古い列・テーブルを読み書きしないようにした（マイグレーション `0024_db_cleanup_stop_using`）。列の削除（0025）とリリースを分ける。

  - `worlds` の 0023 より前の列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）への保存のたびの書き戻しをやめ、スキーマから外した。列は残し、新しいコードの INSERT が通るよう `name`・`version`・`definition` の NOT NULL を外す。
  - `instances` の `has_password`・`current_users` をスキーマから外した。パスワードの有無は `password_hash` で決める。デプロイ中・戻したあとの 0023 のイメージが `has_password` で入室を確かめるので、0025 までは DB のトリガーが `password_hash` から `has_password` を決める。
  - 0020 で移した古い鍵のテーブル `publishing_environments`・`author_bindings` を消した。0020 より前のイメージに戻すときの作り直し方は `docs/operations/db-migration.md`。

- 72caae4: DB の時刻の列をすべて `timestamptz` にした（マイグレーション `0018_timestamptz`）。既存の値は UTC として変換するので、指す瞬間は変わらない。DB のセッションの TimeZone が UTC でなくても、`defaultNow()` の値がずれなくなる。

  空インスタンスの掃除（reaper）は、作成直後の猶予を DB の `created_at` だけで判定するようにした。作成したプロセスの中に時刻を持たないので、backend が複数あっても猶予が効く。

- b5419f6: 依存の更新（Dependabot #130・#244・#257・#258 をまとめた）: better-auth 1.7.7、drizzle-orm 0.45.4、express 5.3.0、express-rate-limit 8.7.1、resend 6.32.1、zod 4.6.7、nanoid 6.0.1（Node 18・20 のサポート終了。本番は Node 26）、react-router 8.4.0、@types/node 26.6.5。
- 154a908: テストの修正のみ（worldRegistry.events.test の @ubichill/db の差し替えに authorKeyRepository を足す）。動作の変更はない。
- eebac88: Go のインスタンスの負荷を Prometheus で集め、KEDA で Pod を自動で増やせるようにする（K1）。

  Go: `GET /metrics`（認証なし。Ingress には出さない）で `ubichill_instance_active_rooms`・`room_capacity`・`room_capacity_available`（draining の間は 0）・`websocket_connections`（heartbeat の `connections` と同じ。中継を含む）・`relay_connections`・`draining` を Prometheus の text 形式で出す。依存を増やさないよう標準ライブラリだけで書いた。

  chart: `instanceRuntime.metrics.serviceMonitor.enabled` で ServiceMonitor を、`instanceRuntime.autoscaling.enabled` で KEDA の ScaledObject（`minReplicaCount: 1`・自動の scale-in は無効・接続数と部屋数の 2 つの trigger）を作る。どちらも既定は無効。ScaledObject は `directory: redis` でないと描画で失敗し、有効なときは Deployment に `replicas` を書かない。instance の Service にラベルを付けた。

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

- cdbb81b: chart: Go のインスタンスの KEDA の閾値を負荷試験の結果で決める。`instanceRuntime.autoscaling.targetConnectionsPerPod` の既定を 300 から 200 に下げ、CPU の trigger（`targetCPUPerPod`、既定 600m、空なら作らない）を足す。大人数の部屋は配信が人数の 2 乗で増え、接続数では負荷を測れないため。
- 26a4525: Go のインスタンスが負荷の高いときに部屋ごと落ちる問題を直す。

  - 部屋のリースの延長を、部屋ごとの往復から 1 つのパイプラインにまとめる。CPU の上限に当たった Pod では往復の遅れが部屋の数だけ積み重なり、後ろの部屋が期限（送った時刻 + 10 秒）に間に合わず自己停止していた（負荷試験で 1 Pod 500 接続・50 部屋のときに 44 部屋が止まった）。Redis の再起動でスクリプトのキャッシュが消えたときは本文ごと送り直す。
  - `cursor:moved` などの broadcast を 1 回だけ符号化し、全員に同じバイト列を送る。今までは受け手ごとに符号化し直していた。

- 319eb74: Go のインスタンスを複数の Pod で動かせるようにする（G2）。各 Pod が WS Router を兼ね、最初の `world:join` の部屋が手元に無ければ、Directory の owner の内部アドレスの `/realtime/v1/relay` へ WebSocket を張って中継する。owner は Upgrade の後に 1 回だけ決め、owner が接続を閉じたら（自己停止・終了・退出）中継も閉じる（クライアントはチケットを取り直して繋ぎ直す）。owner が居ない・死んでいるときは `instance_unavailable`、チケットの世代が今の owner と違えば `ticket_invalid`。owner も中継された `world:join` のチケットと世代を自分で確かめる。中継用の口は Ingress に出さず、管理トークンから派生した鍵の HMAC（送り元・宛先のノード ID・30 秒の期限）で Pod 間の接続を確かめる。毎秒 240 件のレート制限はクライアントが繋いだ Pod だけが数える。

  管理 API（作成・チケット発行・終了）に任意の `?gen=&epoch=` を足し、今の部屋の世代と違えば 409（今の owner を付ける）を返す。在席のレスポンスに owner の `addr` を足した（任意の項目）。

  backend: 部屋の作成（PUT）の 409 を成功扱いにせず、owner の `addr`（`http://<addr>/realtime/v1`）へチケット発行・終了を世代付きで送る。`INSTANCE_DIRECTORY=redis`（chart は `instanceRuntime.directory` を backend にも渡す）のときは、作成を受けた Pod へ直接続く管理 API を送り、在席を Redis の `ubi:rooms`・`ubi:presence:<id>` から読む（Redis が落ちていれば在席は失敗にし、reaper が空室と誤って消さない）。`memory` のときは今までどおり `INSTANCE_RUNTIME_URL` に送る。

  chart: `instanceRuntime.replicas`（既定 1）。`directory: memory` のまま 2 以上にすると描画で失敗する。

- fa9d86a: 登録の仮データ（メール確認待ち）をメモリから Postgres の `pending_registrations` に移した（マイグレーション `0019_pending_registrations`）。backend が複数あっても、申し込みと確認が別の Pod に当たって失敗しない。再起動しても登録の途中は消えない。

  保存するのは登録 ID の SHA-256・認証コードの HMAC（鍵は better-auth の秘密）・パスワードのハッシュだけで、平文は持たない。同じメールアドレスの仮登録は同時に 3 件まで（アドレスごとのロックで、同時の申し込みでも超えない）。確認と本登録は 1 つのトランザクションで行い、本登録に失敗したら仮登録は残る。期限切れの仮登録は CLI 認可の要求と同じ定期処理で消す。

  メールアドレスは小文字に揃えてから確かめる・保存する（better-auth と同じ）。大文字を含むアドレスで登録したときに、既存ユーザーの確認をすり抜けたり、確認済みの印が付かなかったりしていた。

- a124a25: 開発・プレビュー（`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`、chart の `values-dev.yaml`）では、署名の無い同梱ワールド（`worlds/`）を公式アカウントの名義で「署名なし」として配る。公式ワールドの署名は main への push でしか付けないので、プレビューには入れるワールドが 1 つも無かった。本番（`NODE_ENV=production`）でこの設定を有効にすると起動しない。署名があって内容と合わないものは今まで通り配らない。
- 4afeacc: インスタンスに入るとき、ほかの参加者に見せる名前を SNS がチケットに入れ、Go のインスタンスはクライアントが送る名前より優先する（ほかの人や公式になりすませない）。入室時のユーザー情報は名前・ステータス・位置だけを配る（任意の画像 URL などを全員のブラウザに読ませない）。1 人が同時に持てるエンティティは 16 個まで、1 インスタンスの状態は 16MB まで。

  デプロイは Go のインスタンスを先に更新すること。古い Go は参加チケットの要求に知らない項目（`name`）があると拒否する。

- cbb2eb2: backend と Go のインスタンスが Redis に繋がるようにする（`REDIS_URL`・`REDIS_PASSWORD`。どちらも任意で、未設定なら今まで通り Redis なしで動く）。backend の `/health` は Redis を設定したときだけ `redis: "ready" | "unavailable"` を載せ、Redis が落ちても 200 を返す。複数の backend・Go Pod で使うリース（メモリ実装と Redis 実装）を足したが、まだどこからも使わない。

  Go のインスタンスの参加チケットの署名鍵を、`INSTANCE_TICKET_KEY` か、無ければ `INSTANCE_ADMIN_TOKEN` から派生した鍵にする（全 Pod・再起動の前後で同じ鍵）。Go を再起動しても発行済みのチケットとゲストの再接続情報は無効にならない。管理トークンを変えると発行済みのチケットは無効になる。

  chart は backend と instance の両方に `REDIS_URL` と `REDIS_PASSWORD`（redis subchart の Secret を参照）を渡す。GitOps では `redis.auth.existingSecret` を指定すること（指定しないと描画のたびにパスワードが作り直される）。

- 4c0e362: `GET /api/v1/users/me/worlds` が、本体に保存したワールドの配信の道筋（`url`）と、署名を検証できなかった理由（`problemCode`）を返すようにした。設定の「ワールド」から署名し直すときに使う。
- 4afeacc: サーバーが外部 URL を取りに行くときの確認を強めた。IPv4 射影（`[::ffff:127.0.0.1]`）・NAT64 などの書き方で内部アドレスへ届く穴を塞ぎ、接続に使う DNS 解決の結果でも確かめる（DNS リバインディング対策）。応答本文の大きさと時間に上限を設け、別のホストへのリダイレクトでは Authorization を外す。ワールド取得用の GitHub トークンは GitHub のホストにだけ送る。
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

- Updated dependencies [4afeacc]
- Updated dependencies [70b6047]
- Updated dependencies [083e2ba]
- Updated dependencies [740ccc7]
- Updated dependencies [72caae4]
- Updated dependencies [b5419f6]
- Updated dependencies [c0164c3]
- Updated dependencies [db4057f]
- Updated dependencies [319eb74]
- Updated dependencies [f942349]
- Updated dependencies [fa9d86a]
- Updated dependencies [4afeacc]
- Updated dependencies [0030710]
- Updated dependencies [7b0ec8d]
- Updated dependencies [ac490dd]
  - @ubichill/db@1.4.1
  - @ubichill/shared@1.9.1

## 1.8.0

### Minor Changes

- 902a24c: mod の作者署名の確認をブラウザで行うようにした（単体モードでも mod が動く）。作者の確認の規則（鍵一覧の期限・取り消し・取得の上限・作者のサーバーが止まったときの猶予）を `@ubichill/shared` の `createAuthorKeyDirectory` に移し、ブラウザ（localStorage）とサーバー（DB）が同じコードで確かめる。Host は自分のオリジンの backend に確認を頼まなくなった。使われなくなった `POST /api/v1/mods/signature/verify` は削除した（フロントは backend との版のずれを検知して読み込み直すので、内部の API の互換は残さない）。WebFinger の鍵一覧の URL は、実行環境の URL で正規化してから同じオリジンかを比べる。localStorage を使えない環境ではメモリに切り替えて確認を続ける。
- a5d6f3a: 外部（GitHub Pages など）に置いたワールド・mod をユーザーページに出せるようにした。`ubichill publish` に `--public-url`（mod は省略時 package.json の `homepage`）を渡すと、署名したときに作者アカウントのサーバーへ登録される。サーバーは本人の署名が付いた内容だけを登録し、表示する前に公開先で本人の署名付きで配られているかを確かめる。ユーザーページに「公開している mod」を追加し、外部のワールドも「作成したワールド」に出る。
- 18142c5: サービストークンに、依頼した mod の確認済みの作者アカウント（`mod_author`）を載せるようにした。Host が読み込み時に確認した mod の署名を発行の依頼に付け、サーバーが確かめ直したときだけ入る。サービスは `checkServiceTokenClaims` の `allowedModAuthors` で「自分が署名した mod からの依頼だけ受ける」と決められる。
- b802a3c: 作者署名をワールドと mod で 1 つの形式にした（`format: "ubichill-signature"`・`version: 2`・`kind`。docs/PROTOCOLS.md）。署名する値・検証の順番は `signEnvelope` / `verifyEnvelope` の 1 か所で、`kind` が署名する値に入るので別の種類の署名として使い回せない。作者は必須で正規の表記だけ。版 1 の署名は読まないので、ワールドと mod は `ubichill publish` で署名し直す必要がある。形式を固定するテストベクターを加えた。

### Patch Changes

- 2a2dc60: ワールドの一覧でローカルと連合を混ぜないようにした。`GET /api/v1/worlds` の既定は `scope=local`（このサーバーのワールドだけ）になり、`scope=all` は無くなった。連合ピアからはピアのローカルだけを取り、このサーバー自身のワールドを連合の一覧に出さない。
- Updated dependencies [902a24c]
- Updated dependencies [a5d6f3a]
- Updated dependencies [9d7c2d9]
- Updated dependencies [18142c5]
- Updated dependencies [b802a3c]
  - @ubichill/shared@1.9.0
  - @ubichill/db@1.4.0

## 1.7.0

### Minor Changes

- c6cba3a: mod の作者署名を必須にした。`ubichill publish <ビルド出力>` がワールドと同じアカウント・同じ鍵（CI は `UBICHILL_CREDENTIALS`）で `v<version>/lock.sig.json` を書き出し、Host は署名で作者を確認できた mod だけを実行する（`POST /api/v1/mods/signature/verify`）。`ubichill verify` は署名も検証し（`--require-signatures`）、単体 mod の出力（`dist/v<version>/`）も検証するようになった。公開済みの mod は署名して公開し直す必要がある。権限の許可は「作者＋ mod の ID」に結び付くようになり、同じ ID を名乗る別の作者の mod は許可を引き継がない（これまでの許可は確認し直しになる）。

### Patch Changes

- Updated dependencies [c6cba3a]
  - @ubichill/shared@1.8.0
  - @ubichill/db@1.3.1

## 1.6.0

### Minor Changes

- 70ae199: 表示名を別の名前に変えるのを 90 日に 1 回までにする（大文字小文字・全角半角だけの変更と、重複の解消は除く）。ユーザー検索は表示名の一意キーで照合して ID の一致を先に並べ、`@ID@サーバー` の指定を解釈する（ほかのサーバーのアカウントは `remoteAccount` として返す）。
- 1e313e9: mod が外部サービスへ身元証明を渡せる `Ubi.identity.token(audience)` を追加。Ubichill のサーバーが短命の JWT（EdDSA）を発行し、サービスは公開鍵（`/api/v1/service-tokens/keys`）だけで検証できる。利用者 ID はサービスごとの仮名。権限 `identity:token`。プロトコル v5。

### Patch Changes

- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0
  - @ubichill/db@1.3.0

## 1.5.0

### Minor Changes

- 749cc83: インスタンス内の通信・状態管理を Go サーバーへ分離。ゲストによる単体運用、SNS 参加チケット、OpenAPI による共通型生成、WebSocket 接続と再同期に対応。

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0
  - @ubichill/db@1.2.1

## 1.4.0

### Minor Changes

- 307340c: フレンド・ソーシャルとインスタンスの公開範囲を追加し、通信が切れたあとにインスタンスが消える問題を直す。

  - フレンドの申請・承認・解除と、ユーザー検索（ID の前方一致・表示名の部分一致）。API は `/api/v1/social`
  - フレンドの現在地（インスタンスごと。見えないインスタンスにいるフレンドは「非公開の場所」）
  - インスタンスの公開範囲（パブリック・フレンド+・フレンドのみ・招待のみ）を一覧・詳細・参加で効かせる。作成時に選べる
  - 自動で再接続したら参加し直す（以前は参加し直さず、猶予の後に退出扱いになって空のインスタンスが削除されていた）
  - 同じアカウントが別のタブで参加したら、古いタブに理由を知らせてから切る
  - ユーザーページをログインなしで見られるようにし、自己紹介（本人が書く）とリンクのプレビュー（名前・アイコン・説明）を付ける

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0
  - @ubichill/db@1.2.0

## 1.3.0

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

### Patch Changes

- Updated dependencies [0d3bd18]
  - @ubichill/shared@1.4.0
  - @ubichill/db@1.1.0

## 1.2.0

### Minor Changes

- 24f1f4b: CLI に `login` / `logout` / `whoami` / `publish` / `ci create` を追加しました。`ubichill login` はブラウザで承認してこの端末を公開環境にし（`--device` で別の端末で承認）、`ubichill publish` は mod の固定・作者アカウント付きの署名・公開（本体へ、または `--out` で外部ホスト向けに書き出し）を一度に行います。CI は `ubichill ci create` で作った認証情報を `UBICHILL_CREDENTIALS` に入れて公開できます。
- 45f35b8: 外部ワールド（URL で入ったワールド）もお気に入りに登録・一覧表示できるようにしました。お気に入りはサーバーが URL から解決し、作者まで確認できたワールドだけを表示します。お気に入り一覧には公開範囲（Private / Friends / Public、初期値は Private）を付け、`GET /api/v1/users/:userId/favorites` は見てよい人にだけ返します。
- f8ad698: 公式アカウントのパスワードを Secret（`OFFICIAL_ACCOUNT_PASSWORD`）で管理するようにしました。起動のたびにその値へ合わせ、値が変わったときだけ既存のログインを無効にします。画面からは変更できません。
- 2ac2ab1: 作者アカウントが公開環境（ブラウザ・CLI・CI）ごとに署名鍵を持てるようにし、取り消せるようにしました。取り消した鍵の署名は取り消し前のものも作者が外れます。鍵一覧は WebFinger の links から辿る `/api/v1/authors/:handle/signing-keys` で公開し、旧 `ed25519-signing-key` プロパティは削除しました。Web では「公開する」でこのブラウザの鍵を自動で作成・登録します。

### Patch Changes

- 26bf376: 公式アカウントのプロフィールに、リポジトリ（worlds/）で管理している公式ワールドを表示するようにしました。リポジトリの記録（worlds/trusted-authors.json）で管理している鍵は、画面からは取り消せません。

## 1.1.0

### Minor Changes

- 25e2070: 公開できるワールドを「作者アカウント（handle@domain）まで確認できた署名」に限定しました（公式ワールドも `ubichill@ubichill.com` で署名）。作者アカウントと鍵の結び付けは初回だけ WebFinger で確認して保存し、以後の通常アクセスでは確認しません。WebFinger で表示名も公開し、作者名はアカウントから引きます。`ubichill sign` は `--author` なしの署名に警告を出します。
- 25e2070: 公式アカウント（ID `ubichill`）をサーバー起動時に用意するようにしました。初期パスワードは `OFFICIAL_ACCOUNT_INITIAL_PASSWORD` で指定し、ログイン後に変更を促します。公式アカウントは公式ワールドの作者と管理者を兼ね、連合ピアの追加・削除やワールドの再読み込み・並べ替えは管理者だけが実行できるようにしました（以前はログインしていれば誰でも実行できました）。パスワードの変更機能を追加しました。
- 25e2070: 表示名を VRChat と同じく一意にしました（全角半角・大文字小文字・空白の違いは同じ名前として扱い、あとから変更可能）。移行時に重複していた既存ユーザーには表示名の変更を促します。作者の表示は署名で確認できたアカウントを `@ID` と `@サーバー` に分けて表示し、どのサーバーが作者の鍵を証明しているかを示します。
- 25e2070: ワールドの署名に作者アカウント（`handle@domain`、表示は `@youkan@ubichill.com`）を含められるようにしました。受け手は WebFinger（`/.well-known/webfinger`）で作者の公開鍵を引き、署名鍵と一致したときだけ作者として表示します。ユーザーは日本語も使える表示名と、URL・署名用の変更不可な ID を別々に持ち、署名用の公開鍵を 1 本アカウントに登録します（秘密鍵の所有を証明して登録）。CLI は `ubichill sign --author=handle@domain` / env `UBICHILL_AUTHOR` に対応しました。
- 25e2070: ワールドの作者署名を追加しました。`ubichill keygen` / `ubichill sign <world.yaml>` で兄弟ファイル `<world>.sig.json` を生成でき、ホストは YAML と lock の改竄を検知して拒否し、URL が変わっても `公開鍵 + metadata.name` で同じワールドと判定します。サーバーは鍵を持たず、本体で作ったワールドは作者がブラウザの鍵で署名し、サーバーは検証済みの署名だけを保存・配信します。署名を検証できないワールドは一覧に公開せず、URL から入る場合は入室前に確認します。

### Patch Changes

- 25e2070: pnpm 12 の `pnpm deploy` が backend の `.gitignore`（`dist/`）に従い `dist/index.js` 以外を落とし、起動時に `Cannot find module './config'` で落ちていた問題を修正しました。`files` で `dist` を明示し、Docker ビルドでデプロイ後の `dist` がビルド成果物と一致するかを検証します。
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
  - @ubichill/shared@1.3.0
  - @ubichill/db@1.0.4

## 1.0.3

### Patch Changes

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

- Updated dependencies [c764ea4]
  - @ubichill/shared@1.2.0
  - @ubichill/db@1.0.3

## 1.0.2

### Patch Changes

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

- 7c89fcb: Entity 内の Component に永続 id を持たせられるようにした。これまで flat ComponentInstance の id は `${entityId}::${配列index}` で採番しており、Component の並べ替え・途中への挿入・削除で既存 Component の id が変わってしまい、永続 state の誤適用・lock の付け替わり・entityRef 等の外部参照の破損が起こり得た。

  `EntityComponentSchema` に任意の `id`（kebab-case）を追加し、指定があればそれを flat id の採番に使う（`${entityId}::${id}`）。省略時は従来通り index フォールバックのため、既存の world.yaml はそのまま動作する。World Editor で新規に Component を追加する際は、component 名から自動的に一意な id を採番する。

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
  - @ubichill/shared@1.1.0
  - @ubichill/db@1.0.2

## 1.0.1

### Patch Changes

- 13aee7d: ECS・バックエンドのテストを追加し、発見した不具合を修正。

  - `@ubichill/ecs`: クエリ結果の stale キャッシュが原因でエンティティ追加/削除後に誤った結果を返す不具合を修正（毎回フィルタする方式へ）。`entity` / `world` のテストを追加。
  - `@ubichill/backend`: `validateUsername`（空白のみ入力が通る）と `validateUserStatus`（`dnd` 未対応）の不具合を修正。`validation` / `userManager` / `instanceState` / `flattenGameObject` のテストを追加し、`instanceState` と `flattenGameObject` は副作用を分離して純粋化。

- 13aee7d: メディア同期プロトコルを一般化し、バックグラウンド再生を整備した。

  - `media:sync` / `media:state-response` のペイロードを `currentIndex`（動画プレイリスト前提）から `MediaSyncState`（`mediaId` ベース、`duration` / `playbackRate` を任意付加）へ一般化。バックエンドは引き続き中身を解釈しないリレーのみ。
  - `Ubi.media.load()` に `kind`（`'audio' | 'video'`）を追加。`'audio'` はデバイス操作（メディアキー/ロック画面）を既定で許可し、`navigator.mediaSession.playbackState` を設定してバックグラウンド再生を継続する。`'video'`（既定）は明示許可までデバイス操作をロックする。

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/shared@1.0.1
  - @ubichill/db@1.0.1
