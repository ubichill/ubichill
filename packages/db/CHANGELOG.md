# @ubichill/db

## 1.9.0

### Minor Changes

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

- 21923d9: 作者参照から分散配布の mod package を取得・追加できるようにし、作者固定の lock v2、package 内プレハブの配置・差分更新・Unpack、標準 Component の表示、作成用 CLI と作品ページ・検索を追加する。既存 lock を保存時に維持し、依存更新の失敗で YAML と lock が食い違わないようにする。DB は配布物や版履歴を保存せず、作者と mod ID ごとの登録ポインタを使う。

  エディタで更新先を取得できなかった場合は、古い lock で補わず変更を取りやめ、以前の依存と lock を維持する。

- b3c43ad: backend の構造を整理する（API とレスポンスは変えない）。やり取りを止める判定を shared の interactionRefusal にまとめ、ユーザーを消すとブロックされた側の行も消す。
- 6e3ee64: ファイルの置き場所を機能ごとに整理する（振る舞い・API・export の名前は変えない）。連合を ubichill どうし・フェディバース・共通に分け、shared の user/ を account・social・publishing に分けた。
- b7b6366: 通知の種類の DB 制約を shared の一覧から作る（制約の中身は変えない）。マイグレーションの順を CI で確かめる。frontend の構造も整理した（振る舞いは変えない）。
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

## 1.8.0

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

## 1.7.0

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

## 1.6.0

### Minor Changes

- 890dd1d: ユーザーページを SNS のプロフィールの形にし、本人はその場で編集できるようにした。

  - プロフィールに、ひとこと（1 行・60 文字）・バナー画像・リンク（https だけ・最大 5 件。ホスト名で GitHub・X・YouTube・Bluesky・Twitch・pixiv・BOOTH・VRChat を見分ける）・話せる言語（決まった一覧から最大 5 件）を足した。規則は shared にあり、画面と API で同じものを使う。
  - アイコンとバナーはアップロードする。サーバーが sharp で作り直し（EXIF の向きを反映してメタデータを全部消す・アイコン 512×512 / バナー 1500×500 の WebP）、中身は DB（`profile_images`）に置く。配信は内容のハッシュ入りの URL（`/api/v1/users/:id/images/:kind/:hash.webp`）で、immutable で長く cache させる。
  - API: `PUT /api/v1/users/me/profile`、`PUT` / `DELETE /api/v1/users/me/images/:kind`。公開プロフィール（`/api/v1/users/:id`・`/api/v1/social/users/by-handle/:handle` など）に新しい項目を足した。
  - DB: `user_profiles`・`profile_images` を足す（0027。users は変えない）。
  - backend のイメージ: alpine で sharp を読み込めるよう、musl 用のネイティブ部分を入れる。
  - リンクのプレビュー（`/@ID`）: 自己紹介が無ければひとことを説明に使い、アイコンが無ければバナーを大きく出す。

### Patch Changes

- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0

## 1.5.2

### Patch Changes

- 4b24568: 端末への出力を作り直す（絵文字をやめ、Vite / Next.js と同じく `✓` 成功・`✗` 失敗・`!` 注意・`➜` 次にすること、TTY のときだけ色。`NO_COLOR` / `FORCE_COLOR` に従う）。

  - `ubichill dev`: 起動の途中は mod ごとのビルドの行、起動し終えたら最後に URL の案内（`ready in`）を出す。以降は時刻・`[dev]` / `[build]` / `[instance]`・結果の 1 行。ビルドの失敗は mod の名前と esbuild のコードの抜き出し、ワールドの失敗は直し方を添える。
  - `ubichill dev` は既定で手元（127.0.0.1）だけで待ち受ける。`--host`（全部の口）/ `--host=<addr>` で LAN に公開し、そのオリジンを Go にも許す。
  - 全体の `--debug`（`UBICHILL_DEBUG=1` と同じ）: 判断・時間・HTTP の要求・Go の info / debug のログを出し、失敗にスタックトレースを付ける。ふだんの失敗はメッセージと直し方だけ。
  - `ubichill dev` は Go を `--log-format=json` で起動し、JSON の行を `[instance]` の行にする（ふだんは warn / error だけ）。
  - backend・db（migrate）のログは 1 件 1 行（本番は ISO 時刻・level・色なし、スタックの改行は `\n`）。

- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0

## 1.5.1

### Patch Changes

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0

## 1.5.0

### Minor Changes

- d7850d7: 通知の仕組みを足した（ActivityStreams 2.0 に寄せた形）。

  - shared: 通知の型と zod のスキーマ（`Follow`・`Accept`・`Like`・`Announce`、種類ごとの object、actor はユーザー ID か https の URI）、一覧のカーソル、SSE の出来事。インスタンスのその場だけの知らせ `server:notice`（今は切断の予告 `{kind:"disconnect",at}`）の型と読み取り。イベントを足しただけなので `protocolVersion` は上げない（docs/PROTOCOLS.md の D）。
  - db: マイグレーション `0026_notifications`。`notifications`（受け手・種類・actor・object・既読時刻、同じ出来事は 1 つ）・`announcements`・`announcement_reads`（お知らせの既読の位置）を足し、返事を待っているフレンド申請を `Follow` の通知に写す。手順は `docs/operations/db-migration.md`。
  - backend: `/api/v1/notifications`（一覧・未読数・既読・SSE `stream`・お知らせの一覧と作成）。フレンドの申請で `Follow`、承認で `Accept`、ワールドのお気に入りで作者に `Like`（自分には送らない・同じ人の繰り返しは 1 つ）、関係が消えたら 2 人の間の申請・承認の通知を消す。お知らせを出せるのは公式アカウントだけ。SSE は Redis の Pub/Sub（`ubi:ch:notifications`）で全台に配り、Redis が無い・送れないときはその台の接続にだけ届ける。古い通知は 90 日・1 人 200 件で掃除する（1 台だけ）。

### Patch Changes

- Updated dependencies [d7850d7]
  - @ubichill/shared@1.10.0

## 1.4.1

### Patch Changes

- 4afeacc: better-auth の口のうち、画面が使うもの（ログイン・ログアウト・セッション取得・パスワード変更）だけを HTTP に開けるようにした。`/api/auth/sign-up/email` からメール確認を通らずに登録する、`/api/auth/update-user` で表示名の一意性と変更間隔を迂回する、といった使い方ができなくなる。

  仮登録はメールアドレスではなく、申し込んだ本人に返す ID で引くようにした（`/users/verify`・`/users/resend-otp` は `registrationId` を受け取る）。他人が同じアドレスで申し込み直して本人の仮登録をパスワードごと置き換えることはできない。認証コードは 5 回間違えると無効になる。

  公式アカウントは、メールアドレスを確認済みのアカウントだけを昇格させ、昇格前のログインと公開環境は取り消す。

- 70b6047: 作者の鍵を 1 つのテーブルにまとめた（マイグレーション `0020_author_keys`）。自サーバーの公開環境（`publishing_environments`）と他サーバーの作者の鍵一覧（`author_bindings` の jsonb）を、`author_keys`（代理キー・`origin` が local / remote）と `remote_authors` に移し、読み書きをすべて新しいテーブルに切り替えた。古いテーブルは残すが書かない（次のマイグレーションで消す）。古いイメージに戻すときの手順は `docs/operations/db-migration.md`。

  - 公開鍵は保存・照合の前に正規化する（shared の `normalizeEd25519PublicKey`。`ed25519:` の接頭辞・base64 / base64url・パディング・43 文字目の使われない bit の違いを 1 つにする）。これまでは文字列の完全一致で比べていたため、同じ鍵を別の書き方で別のアカウントに登録できた。DB でも正規形だけを受け付ける。
  - 同じ鍵を持てる自サーバーのアカウントは 1 つ。取り消した鍵を登録し直すこともできない（今と同じ）。
  - 他サーバーの作者が自サーバーの公開環境の鍵を名乗ってきた場合、その一覧は保存するが警告を記録し、その鍵では作者を付けない（これまでは付いていた）。
  - `@ubichill/db`: `publishingEnvironmentRepository`・`authorBindingRepository` を `authorKeyRepository`（`createAuthorKeyRepository`）にまとめた。別の DB に接続する `createDatabase` を足した。

- 083e2ba: 0024 で読み書きをやめた列を消した（マイグレーション `0025_db_cleanup_drop_columns`）。`worlds` の `name`・`version`・`definition`・`lock`・`signature`・`draft_*`、`instances` の `has_password`・`current_users` と、`has_password` を決めていたトリガーを消す。`world_versions.content_hash` を NOT NULL にし、空の行があればマイグレーションを止める。`migrate.js` は content_hash を埋めなくなった。0024 のイメージが行き渡ってから出す。手順は `docs/operations/db-migration.md`。
- 740ccc7: DB の古い列・テーブルを読み書きしないようにした（マイグレーション `0024_db_cleanup_stop_using`）。列の削除（0025）とリリースを分ける。

  - `worlds` の 0023 より前の列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）への保存のたびの書き戻しをやめ、スキーマから外した。列は残し、新しいコードの INSERT が通るよう `name`・`version`・`definition` の NOT NULL を外す。
  - `instances` の `has_password`・`current_users` をスキーマから外した。パスワードの有無は `password_hash` で決める。デプロイ中・戻したあとの 0023 のイメージが `has_password` で入室を確かめるので、0025 までは DB のトリガーが `password_hash` から `has_password` を決める。
  - 0020 で移した古い鍵のテーブル `publishing_environments`・`author_bindings` を消した。0020 より前のイメージに戻すときの作り直し方は `docs/operations/db-migration.md`。

- 72caae4: DB の時刻の列をすべて `timestamptz` にした（マイグレーション `0018_timestamptz`）。既存の値は UTC として変換するので、指す瞬間は変わらない。DB のセッションの TimeZone が UTC でなくても、`defaultNow()` の値がずれなくなる。

  空インスタンスの掃除（reaper）は、作成直後の猶予を DB の `created_at` だけで判定するようにした。作成したプロセスの中に時刻を持たないので、backend が複数あっても猶予が効く。

- b5419f6: 依存の更新（Dependabot #130・#244・#257・#258 をまとめた）: better-auth 1.7.7、drizzle-orm 0.45.4、express 5.3.0、express-rate-limit 8.7.1、resend 6.32.1、zod 4.6.7、nanoid 6.0.1（Node 18・20 のサポート終了。本番は Node 26）、react-router 8.4.0、@types/node 26.6.5。
- fa9d86a: 登録の仮データ（メール確認待ち）をメモリから Postgres の `pending_registrations` に移した（マイグレーション `0019_pending_registrations`）。backend が複数あっても、申し込みと確認が別の Pod に当たって失敗しない。再起動しても登録の途中は消えない。

  保存するのは登録 ID の SHA-256・認証コードの HMAC（鍵は better-auth の秘密）・パスワードのハッシュだけで、平文は持たない。同じメールアドレスの仮登録は同時に 3 件まで（アドレスごとのロックで、同時の申し込みでも超えない）。確認と本登録は 1 つのトランザクションで行い、本登録に失敗したら仮登録は残る。期限切れの仮登録は CLI 認可の要求と同じ定期処理で消す。

  メールアドレスは小文字に揃えてから確かめる・保存する（better-auth と同じ）。大文字を含むアドレスで登録したときに、既存ユーザーの確認をすり抜けたり、確認済みの印が付かなかったりしていた。

- 0030710: users を整理した（マイグレーション `0021_users_cleanup`）。`handle` を NOT NULL にし、未設定の既存ユーザーには `user_` + 16 進 12 桁を自動で振る（システムユーザーは予約語の `system`）。画像は better-auth の `image` に寄せた（`image` が空の行だけ移す）。`username`・`profile_image_url` は新しいコードから読まなくしたが、列はデプロイ中の古い Pod のために残す（0022 で消す）。

  - `PUT /api/v1/users/me/handle` と、handle 未設定を前提にした分岐・画面を消した。ユーザーの応答の `profileImageUrl` は `image` に変えた（内部 API）。shared の `UserSummary` も `handle: string`・`image` にした。
  - メール確認を通さない登録と公式アカウントの作成は、better-auth の `signUpEmail` をやめ、users と accounts を 1 トランザクションで handle ごと作る（`userRepository.createCredentialUser`）。better-auth の `additionalFields` に `handle`（required・input: false）を宣言した（宣言しないと drizzle adapter が schema mismatch で止まる）。
  - 公式アカウントへの昇格は「handle 未設定」ではなく「その ID で鍵の登録・公開をしたことが無い」を条件にした。
  - 古いイメージに戻す手順は `docs/operations/db-migration.md`。

- 7b0ec8d: `users` の `username`・`profile_image_url` を消した（マイグレーション `0022_users_drop_columns`）。0021 で読まなくした列で、0021 のイメージが行き渡ってから出す。手順は `docs/operations/db-migration.md`。
- ac490dd: 自サーバーで公開したワールドを、変えない版（`world_versions`）と下書き（`world_drafts`）に分けた（マイグレーション `0023_world_versions`）。既存の行の公開中の版を版 1 行に、下書き（未公開のワールドは今の定義）を下書きに移す。`worlds.id` を以前の `name` と同じ値にそろえ、API の `/api/v1/worlds/:worldId` は `worlds.id` で引く（応答の id は変わらない）。古い列（`name`・`version`・`definition`・`lock`・`signature`・`draft_*`）は読まなくしたが、デプロイ中の古い Pod と古いイメージへの戻しのために残し、保存のたびに書き直す（消すのは後続のマイグレーション）。

  - `content_hash` は shared の `worldContentHash()` だけで求める。移した版の値は `migrate.js` がマイグレーションの直後に埋める（`backfillWorldContentHashes`）。
  - 同じ `metadata.version` で中身の違う公開は 409（`code: version-conflict`）で拒否する。同じ中身への署名し直しは、その版の `signature` の列だけを置き換える。
  - 残す版は `limitsFor(user).maxVersionsPerWorld`（今は 3）まで。超えて公開すると古い版から消す（公開は拒否しない）。インスタンスが指す版は消さず、定期処理（10 分ごと）で消し直す。shared に `limitsFor` と `LIMITS.MAX_VERSIONS_PER_WORLD` を足し、ワールドの数の上限も `limitsFor` から取る。
  - `GET /api/v1/worlds/:worldId/versions?contentHash=...` を足した。残っている版を返し、消した版は 410。
  - インスタンスを作るとき、ワールドの `content_hash` と、自サーバーで公開した版なら `world_version_id`（`world_versions` へ `ON DELETE RESTRICT`）を記録する。
  - 手順と戻し方は `docs/operations/db-migration.md`。

- Updated dependencies [70b6047]
- Updated dependencies [c0164c3]
- Updated dependencies [db4057f]
- Updated dependencies [319eb74]
- Updated dependencies [f942349]
- Updated dependencies [4afeacc]
- Updated dependencies [0030710]
- Updated dependencies [ac490dd]
  - @ubichill/shared@1.9.1

## 1.4.0

### Minor Changes

- a5d6f3a: 外部（GitHub Pages など）に置いたワールド・mod をユーザーページに出せるようにした。`ubichill publish` に `--public-url`（mod は省略時 package.json の `homepage`）を渡すと、署名したときに作者アカウントのサーバーへ登録される。サーバーは本人の署名が付いた内容だけを登録し、表示する前に公開先で本人の署名付きで配られているかを確かめる。ユーザーページに「公開している mod」を追加し、外部のワールドも「作成したワールド」に出る。

### Patch Changes

- Updated dependencies [902a24c]
- Updated dependencies [a5d6f3a]
- Updated dependencies [9d7c2d9]
- Updated dependencies [18142c5]
- Updated dependencies [b802a3c]
  - @ubichill/shared@1.9.0

## 1.3.1

### Patch Changes

- Updated dependencies [c6cba3a]
  - @ubichill/shared@1.8.0

## 1.3.0

### Minor Changes

- 70ae199: 表示名を別の名前に変えるのを 90 日に 1 回までにする（大文字小文字・全角半角だけの変更と、重複の解消は除く）。ユーザー検索は表示名の一意キーで照合して ID の一致を先に並べ、`@ID@サーバー` の指定を解釈する（ほかのサーバーのアカウントは `remoteAccount` として返す）。

### Patch Changes

- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0

## 1.2.1

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0

## 1.2.0

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

## 1.1.0

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
