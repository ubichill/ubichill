# @ubichill/db

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
