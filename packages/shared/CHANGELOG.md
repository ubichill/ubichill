# @ubichill/shared

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

- 4afeacc: インスタンスに入るとき、ほかの参加者に見せる名前を SNS がチケットに入れ、Go のインスタンスはクライアントが送る名前より優先する（ほかの人や公式になりすませない）。入室時のユーザー情報は名前・ステータス・位置だけを配る（任意の画像 URL などを全員のブラウザに読ませない）。1 人が同時に持てるエンティティは 16 個まで、1 インスタンスの状態は 16MB まで。

  デプロイは Go のインスタンスを先に更新すること。古い Go は参加チケットの要求に知らない項目（`name`）があると拒否する。

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
