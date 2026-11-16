# @ubichill/sdk

## 4.1.4

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

## 4.1.3

### Patch Changes

- Updated dependencies [be9da67]
- Updated dependencies [86a3e4f]
- Updated dependencies [f8c52bb]
- Updated dependencies [2a500f2]
- Updated dependencies [833415f]
  - @ubichill/shared@1.15.0

## 4.1.2

### Patch Changes

- Updated dependencies [6ba0785]
- Updated dependencies [787dfc4]
- Updated dependencies [4424709]
  - @ubichill/shared@1.14.0

## 4.1.1

### Patch Changes

- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0

## 4.1.0

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

- cd7f158: npm 版（`ubichill`）を使う mod のバンドルに、使っていない SDK の実装（`UbiSDK` 本体など）が入らないようにした。これまでは `CORE_COMPONENT_TYPES` を 1 つ import するだけで minify 後に約 32KB 増えていた。`UbiSDK.FETCH_RPC_TIMEOUT_MS` は static フィールドから getter に変わる（読み取れる値は同じ。代入はできなくなる）。

  あわせて、`ubichill build` が自動で見つける権限が正しくなる。これまでは SDK の本体がバンドルに入ると、その中の文字列に反応して、使っていない `scene:read`・`scene:update` まで付いていた。新しい SDK で作り直した mod が、この誤検出に頼って scene の API を使っていた（`Ubi` を分割代入や別名で使うなど）なら、`export const config` の `capabilities` に書く。`FETCH_LIMITS.defaultMaxBytes`・`maxBytes` の型は `number` から値そのもののリテラル型になる（他の項目と同じ）。`@ubichill/cli` は同梱する `world.html` と shared の定数が同じ変更を含むので版を上げる。

- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0

## 4.0.0

### Major Changes

- 24578ca: CLI を `ubichill` から分け、`@ubichill/cli` として公開する。`ubichill` は mod が import する SDK だけになり、bin と `esbuild`・`yaml` への依存が無くなる（mod 開発者は `npm i ubichill` に加えて `npm i -D @ubichill/cli` を入れる。`ubichill` コマンドの名前と使い方は変わらない）。

### Patch Changes

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0

## 3.3.2

### Patch Changes

- Updated dependencies [d7850d7]
  - @ubichill/shared@1.10.0
  - @ubichill/loader@1.3.4

## 3.3.1

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
  - @ubichill/loader@1.3.3

## 3.3.0

### Minor Changes

- a5d6f3a: 外部（GitHub Pages など）に置いたワールド・mod をユーザーページに出せるようにした。`ubichill publish` に `--public-url`（mod は省略時 package.json の `homepage`）を渡すと、署名したときに作者アカウントのサーバーへ登録される。サーバーは本人の署名が付いた内容だけを登録し、表示する前に公開先で本人の署名付きで配られているかを確かめる。ユーザーページに「公開している mod」を追加し、外部のワールドも「作成したワールド」に出る。
- b802a3c: 作者署名をワールドと mod で 1 つの形式にした（`format: "ubichill-signature"`・`version: 2`・`kind`。docs/PROTOCOLS.md）。署名する値・検証の順番は `signEnvelope` / `verifyEnvelope` の 1 か所で、`kind` が署名する値に入るので別の種類の署名として使い回せない。作者は必須で正規の表記だけ。版 1 の署名は読まないので、ワールドと mod は `ubichill publish` で署名し直す必要がある。形式を固定するテストベクターを加えた。

### Patch Changes

- Updated dependencies [902a24c]
- Updated dependencies [a5d6f3a]
- Updated dependencies [9d7c2d9]
- Updated dependencies [18142c5]
- Updated dependencies [b802a3c]
  - @ubichill/shared@1.9.0
  - @ubichill/loader@1.3.2

## 3.2.0

### Minor Changes

- c6cba3a: mod の作者署名を必須にした。`ubichill publish <ビルド出力>` がワールドと同じアカウント・同じ鍵（CI は `UBICHILL_CREDENTIALS`）で `v<version>/lock.sig.json` を書き出し、Host は署名で作者を確認できた mod だけを実行する（`POST /api/v1/mods/signature/verify`）。`ubichill verify` は署名も検証し（`--require-signatures`）、単体 mod の出力（`dist/v<version>/`）も検証するようになった。公開済みの mod は署名して公開し直す必要がある。権限の許可は「作者＋ mod の ID」に結び付くようになり、同じ ID を名乗る別の作者の mod は許可を引き継がない（これまでの許可は確認し直しになる）。

### Patch Changes

- Updated dependencies [c6cba3a]
  - @ubichill/shared@1.8.0
  - @ubichill/loader@1.3.1

## 3.1.0

### Minor Changes

- 5d131c6: mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
- 1e313e9: mod が外部サービスへ身元証明を渡せる `Ubi.identity.token(audience)` を追加。Ubichill のサーバーが短命の JWT（EdDSA）を発行し、サービスは公開鍵（`/api/v1/service-tokens/keys`）だけで検証できる。利用者 ID はサービスごとの仮名。権限 `identity:token`。プロトコル v5。

### Patch Changes

- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0
  - @ubichill/loader@1.3.0

## 3.0.2

### Patch Changes

- 749cc83: インスタンス内の通信・状態管理を Go サーバーへ分離。ゲストによる単体運用、SNS 参加チケット、OpenAPI による共通型生成、WebSocket 接続と再同期に対応。
- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0
  - @ubichill/loader@1.2.2

## 3.0.1

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0
  - @ubichill/loader@1.2.1

## 3.0.0

### Major Changes

- 902e748: 鍵ファイルを自分で作って管理する `ubichill keygen` / `ubichill sign` を廃止する。署名は `ubichill login`（CI は `ubichill ci create`）のあと `ubichill publish` で行う（鍵は CLI が作り、作者アカウントに自動で登録される）。

  - `ubichill install` は署名しなくなった（`--no-sign` / `--key-file` も廃止）。手元に鍵ファイルがあると、作者の付かない署名を黙って作っていた
  - 署名の確認（旧 `ubichill sign --check`）は `ubichill verify <world.yaml>`。無効・未署名に加えて、作者アカウントの無い署名も不合格にする
  - 旧コマンドを実行すると、代わりの使い方を表示して終了する

### Patch Changes

- 902e748: `ubichill publish --out`（外部ホスト向け）でも、署名の前にサーバーで公開環境とアカウントを確かめる。公開環境の「最終利用」が記録されるので、使っている CI が「未使用」「長く使われていません」に見えなくなる。公開環境が取り消されていれば署名せずに止める（サーバーに届かないときは警告して続ける）。

## 2.4.0

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
  - @ubichill/loader@1.2.0

## 2.3.0

### Minor Changes

- 24f1f4b: CLI に `login` / `logout` / `whoami` / `publish` / `ci create` を追加しました。`ubichill login` はブラウザで承認してこの端末を公開環境にし（`--device` で別の端末で承認）、`ubichill publish` は mod の固定・作者アカウント付きの署名・公開（本体へ、または `--out` で外部ホスト向けに書き出し）を一度に行います。CI は `ubichill ci create` で作った認証情報を `UBICHILL_CREDENTIALS` に入れて公開できます。

## 2.2.0

### Minor Changes

- 25e2070: 公開できるワールドを「作者アカウント（handle@domain）まで確認できた署名」に限定しました（公式ワールドも `ubichill@ubichill.com` で署名）。作者アカウントと鍵の結び付けは初回だけ WebFinger で確認して保存し、以後の通常アクセスでは確認しません。WebFinger で表示名も公開し、作者名はアカウントから引きます。`ubichill sign` は `--author` なしの署名に警告を出します。
- 25e2070: ワールドの署名に作者アカウント（`handle@domain`、表示は `@youkan@ubichill.com`）を含められるようにしました。受け手は WebFinger（`/.well-known/webfinger`）で作者の公開鍵を引き、署名鍵と一致したときだけ作者として表示します。ユーザーは日本語も使える表示名と、URL・署名用の変更不可な ID を別々に持ち、署名用の公開鍵を 1 本アカウントに登録します（秘密鍵の所有を証明して登録）。CLI は `ubichill sign --author=handle@domain` / env `UBICHILL_AUTHOR` に対応しました。
- 25e2070: ワールドの作者署名を追加しました。`ubichill keygen` / `ubichill sign <world.yaml>` で兄弟ファイル `<world>.sig.json` を生成でき、ホストは YAML と lock の改竄を検知して拒否し、URL が変わっても `公開鍵 + metadata.name` で同じワールドと判定します。サーバーは鍵を持たず、本体で作ったワールドは作者がブラウザの鍵で署名し、サーバーは検証済みの署名だけを保存・配信します。署名を検証できないワールドは一覧に公開せず、URL から入る場合は入室前に確認します。

### Patch Changes

- cc4f3af: `ubichill build` が Windows でワーカー/アセットの相対パスを誤って算出し、絶対パスが出力先・コンポーネント名に混入してビルドが失敗する問題を修正
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
  - @ubichill/shared@1.3.0
  - @ubichill/loader@1.1.2

## 2.1.1

### Patch Changes

- 985040b: 外部ワールドの各 dependency に `source.url` を指定する portable lock 生成を標準化し、解決できない mod がある場合は部分的な lock を書かず失敗するようにしました。

## 2.1.0

### Minor Changes

- d7f8ccb: メディア API に `MediaSource`、`MediaState`、構造化 `MediaError`、`loadId` を追加し、
  `Ubi.media.load({ source, ... })` と `Ubi.media.getState()` を公開した。Host は単一の状態機械から
  `media:stateChange` を通知し、shared 再生では Server 時刻と revision を持つ正規タイムラインを使う。

  従来の位置引数 `load(url, ...)`、個別 media event、peer relay API は deprecated として互換維持する。

## 2.0.1

### Patch Changes

- 4b4a7e4: Worker（Component）ごとに `requestAnimationFrame` を持っていた tick を、ワールド全体で 1 本の
  ループに統一した。Component の数だけループが走る状態と、同じフレーム内で
  どの Worker が先に進むか保証がない状態を解消する。

  フレームは「先にワールドを進め、その結果を持って各 Worker を進める」構成になり、
  Host が確定させた事実を同じフレームの tick で mod へ渡せるようになった。
  その最初の適用として、`core:collider` の接触を Host が判定し、関係する Entity 上の mod へ
  `collision:enter` / `collision:exit` を配る。mod は `events.on('collision:enter', ...)` で
  受け取れる（emit と同じ経路なので、専用のプロトコルは増えていない）。

  ループを 1 本に束ねたことで「mod 1 つの例外でワールド全体の時間が止まる」危険が生まれるため、
  各購読者の例外は隔離し、1 つが投げても残りは必ず実行する。

  あわせて、接触イベントでは扱えない用途のために `findOverlapping` / `isOverlapping` を追加した。
  「今この形はどれと重なっているか」をその場で問い合わせる純関数で、次の 2 つはイベントでは
  解けないためこちらを使う:

  - 移動して良いかを**動く前に**確かめる（イベントが届く頃には既に埋まっている）
  - Entity として登録されていないもの（描画だけの粒子・カーソル・範囲選択など）の判定
    何を「当たった」とみなすか（押し戻す/すり抜ける）は呼び出し側の方針なので、重なっている相手を
    そのまま返すだけにして解釈は持たせていない。

## 2.0.0

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

### Patch Changes

- 44b496f: 公開 CLI が JSX を常にワークスペース名 `@ubichill/sdk` で解決していたため、npm の `ubichill` を
  入れた mod 作者が JSX を書くとビルドが `Could not resolve "@ubichill/sdk/jsx-runtime"` で失敗して
  いたのを修正した。`jsxImportSource` を公開名 `ubichill` にする。

  あわせてリポジトリ内の mod を外部の mod 作者と同じ書き方に揃えた。import と `jsxImportSource` を
  公開名 `ubichill` に統一し、SDK 内部への直接 import を許していた `@ubichill/sdk/*` のワイルドカード
  を削除した。mod のビルドテストは `node_modules/ubichill` を張る構成に変え、この壊れ方を検出できる
  ようにした。

- 44b496f: Host 組み込み Component の「実行時の振る舞い」を持つ `@ubichill/runtime` を新設した。
  Collider の型と幾何計算をここへ移し、接触の検出 (`detectContacts`) と前フレームとの差分
  (`diffContacts` / `createCollisionTracker`) を純関数として追加した。DOM もネットワークも時計も
  持たないので、ブラウザでもサーバーでも同じコードが動く。

  これに伴い `@ubichill/core-components` は「データ形式 (Zod スキーマ)」だけを持つようになり、
  SDK が Component の実装パッケージに依存する形を解消した。SDK の公開 API (`ColliderData` /
  `overlaps` / `resolveColliderGeometry` / `matchesCollisionLayers` / `CORE_COMPONENT_TYPES`) は
  名前も型も変わらないため、mod 側の変更は不要。

- Updated dependencies [c764ea4]
  - @ubichill/shared@1.2.0
  - @ubichill/loader@1.1.1

## 1.0.0

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

- 7c89fcb: 1 Entity に複数 Component を配置できるようにし、Component 単位で `transform` を上書き可能にした。`dataFields` に `entityRef`/`entityRefArray` 型を追加し、mod が Editor 上で他 Entity を明示的にターゲティングできるようにした。

  - `entityRef`/`entityRefArray` で明示配線した Entity は `watchScope` 外でも読み書きを許可する(`declaredTargets`)。
  - Component の見た目（jsx/canvas/ロジック）は manifest 宣言ではなく `canvasTargets` / `ui:render` capability から自動判定するようにした（`renderKind` 宣言は不要）。
  - ワールドの `dependencies[].source` から `type` ディスクリミネータを廃止し、`url` の有無で「外部 URL / ローカル（public mods）」を判定するようにした（旧 `type` は無視され後方互換）。
  - `ubichill build` が出力する `index.json` に外部レジストリの既存バージョン履歴をマージするようにし、mod 開発者がバージョン管理を意識しなくても複数バージョン公開が維持されるようにした。

  あわせて、`Ubi.entity().update()` の自己更新が `watchScope` チェックで誤って拒否される重大なリグレッションを修正した。`onUpdateEntity`/`onDestroyEntity` が受け取る id は componentInstanceId であり GameObject id とは別の識別子空間だったが、旧実装はこれを混同しており全 mod の自己更新が壊れていた。

- 7c89fcb: `entityRef`/`entityRefArray` の dataFields に `access: 'read' | 'write'`（既定 `'read'`）を追加した。

  これまで「Inspector で他 Entity を参照した」ことが、参照先の読み取り・更新・削除すべてを一括で許可する強い権限になっていた。`access` を明示的に分離し、既定では読み取りのみを許可、`access: 'write'` を宣言したフィールドのみ参照先への `transform`/`data` 更新も許可するようにした。削除はこの経路からは一切許可されない（`watchScope` で見える Entity のみ削除可能）。

### Patch Changes

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [988f2c8]
  - @ubichill/shared@1.1.0
  - @ubichill/loader@1.1.0

## 0.5.0

### Minor Changes

- 13aee7d: メディア同期プロトコルを一般化し、バックグラウンド再生を整備した。

  - `media:sync` / `media:state-response` のペイロードを `currentIndex`（動画プレイリスト前提）から `MediaSyncState`（`mediaId` ベース、`duration` / `playbackRate` を任意付加）へ一般化。バックエンドは引き続き中身を解釈しないリレーのみ。
  - `Ubi.media.load()` に `kind`（`'audio' | 'video'`）を追加。`'audio'` はデバイス操作（メディアキー/ロック画面）を既定で許可し、`navigator.mediaSession.playbackState` を設定してバックグラウンド再生を継続する。`'video'`（既定）は明示許可までデバイス操作をロックする。

- 24c4c3e: `ubichill lock` を `ubichill install` に改名し、world.yaml の `dependencies[].source.version`（完全一致 `x.y.z` のみ）を実際に解決するようにした。従来はこのフィールドが lock 生成時に一切参照されず、常に最新版が固定されていた。

  - `ubichill install <world.yaml>`: `source.version` が pin されていればそのバージョンを直接取得して lock する。`ubichill lock` は非推奨エイリアスとして残る（既存スクリプトを壊さないため）。
  - `ubichill update <world.yaml> [<modName>]`: pin 済みバージョンが古ければ最新へ world.yaml を書き換え（コメント/フォーマットは保持）、lock を再生成する。
  - `ubichill build` が出力する `index.json` に、過去にビルドした全バージョンの履歴（`versions`）を追加した（トップレベルの `id`/`name`/`version`/`components` は従来通り現行最新のまま）。

  `DependencySourceSchema.version` は `SemVer`（`x.y.z`）または明示的な `'latest'` のどちらかで検証されるようになった（`^`/`~` などのレンジ指定は非対応）。省略時も解決後は必ず `'latest'` になる（zod default）ため、「省略＝常に最新を追う」という暗黙の意味を読み手が推測する必要がない。

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/ecs@1.0.1
  - @ubichill/shared@1.0.1
  - @ubichill/loader@1.0.1

## 0.4.0

### Minor Changes

- 3b15235: `Ubi.ui.render(factory, targetId)` が `factory()` 実行中に読んだ `Ubi.state` のキーを自動追跡し、そのキーが変わったときだけ自動で再描画するようになりました。`state.onChange(key, render)` による手動の再描画結線は不要になります（既存の呼び出しを残しても害はありません）。読まなかったキーの変化では再描画されないため、postMessage の送信数は増えません。

  さらに、Worker ファイルが `export default function() { return <jsx/> }` のように UI をデフォルトエクスポートすると、初回の `Ubi.ui.render()` 呼び出しも不要になり自動でマウントされます。`Ubi.grip` の `isMine`/`holder` 等は内部で `Ubi.state` を読むため、これらも自動追跡の対象です。

## 0.3.0

### Minor Changes

- a896802: `ubichill build` が `index.json`（レジストリ一覧: `id`/`name`/`version`/`components`）を自動生成するようになった。

  - 単一 mod（外部リポジトリ）: 自分自身を 1 件だけ含む配列を `distDir`/`publicDir` に出力する。World Editor の「レジストリ URL を追加」機能にそのまま渡せる。
  - モノレポの一括ビルド: 全 mod を集約した配列をバッチルートに出力する。

  `buildMod()` の戻り値が `void` から `{ id, name, version, components }`（`ModIndexEntry`）に変わった。

## 0.2.0

### Minor Changes

- b801fc9: mod.json 廃止に伴う SDK 公開 API の追加:
  - `export type { ComponentConfig, DataField, DataFieldType }` を追加（Worker コード内の config 宣言用）
  - `export type { Ubi }` を追加（mod から見た Ubi グローバルの公開型）
  - `cli/build.ts` が `mod.json` に代わり `package.json` + `export const config` からビルドするよう変更
