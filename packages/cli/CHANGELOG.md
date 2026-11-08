# @ubichill/cli

## 1.2.0

### Patch Changes

- Updated dependencies [6ba0785]
- Updated dependencies [787dfc4]
- Updated dependencies [4424709]
  - @ubichill/shared@1.14.0
  - @ubichill/loader@1.3.8

## 1.1.1

### Patch Changes

- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0
  - @ubichill/loader@1.3.7

## 1.1.0

### Minor Changes

- abbb4db: Component 同士を、階層の形ではなく**型付きの参照**で配線できるようにした（#191）。

  - SDK: `dataFields` の `entityRef` / `entityRefArray` に `component`（参照先が持つべき Component 型）と `required` を足した。`Ubi.event.emit(type, data, { ref: '<フィールド名>' })` で、ワールド作者が指した Entity のその型の Component にだけ届く。`scope: 'referrers'` で、参照で自分を指している Component に返せる。`EmitOptions`（`{ scope, targetType? }`）は interface のまま残し、参照で送るときの `RefEmitOptions`（`{ ref, targetType? }`）を足した。`emit` はどちらか一方を受ける（両方・どちらも無しは型で弾く）。既存の `scope` の意味は変えていない。
  - SDK: 古い Host は `ref`・`scope: 'referrers'` をエラーにせず捨てるので、プロトコルの版（`PROTOCOL_VERSION`）を 6 に上げ、`Ubi.runtime.supports('event:ref')`（と `core:media` の描画先の `'media:surface'`）で確かめられるようにした。
  - SDK: 参照フィールドの `access` で許す読み書きは、`component` を宣言していれば参照先のその型の Component だけ。`default` は World Editor で Component を足したときに data へ書く初期値で、data に無いときの代わりにはならない。
  - shared: 参照の解決と検査（`resolveRefs`・`findReferenceProblems`・`describeReferenceProblem`）。World Editor・`ubichill dev`・Host の配送が同じ判定を使う。mod の manifest の検証は `component`・`required` を受け付ける。
  - CLI: `ubichill dev` が毎回のビルドで参照の問題（未設定の必須参照・無い Entity・型の違う Entity）を検査し、ターミナルと dev パネルの診断（`DevFailure` の `kind: 'reference'`）に出す（止めはしない）。合成ワールドは合成の結果が変わったら部屋を作り直す（参照を足しただけでも配線し直す）。`world.yaml` が無いときに合成するワールドでは、型を宣言した参照をその型を置いた Entity に配線しておく。

- 4b24568: 端末への出力を作り直す（絵文字をやめ、Vite / Next.js と同じく `✓` 成功・`✗` 失敗・`!` 注意・`➜` 次にすること、TTY のときだけ色。`NO_COLOR` / `FORCE_COLOR` に従う）。

  - `ubichill dev`: 起動の途中は mod ごとのビルドの行、起動し終えたら最後に URL の案内（`ready in`）を出す。以降は時刻・`[dev]` / `[build]` / `[instance]`・結果の 1 行。ビルドの失敗は mod の名前と esbuild のコードの抜き出し、ワールドの失敗は直し方を添える。
  - `ubichill dev` は既定で手元（127.0.0.1）だけで待ち受ける。`--host`（全部の口）/ `--host=<addr>` で LAN に公開し、そのオリジンを Go にも許す。
  - 全体の `--debug`（`UBICHILL_DEBUG=1` と同じ）: 判断・時間・HTTP の要求・Go の info / debug のログを出し、失敗にスタックトレースを付ける。ふだんの失敗はメッセージと直し方だけ。
  - `ubichill dev` は Go を `--log-format=json` で起動し、JSON の行を `[instance]` の行にする（ふだんは warn / error だけ）。
  - backend・db（migrate）のログは 1 件 1 行（本番は ISO 時刻・level・色なし、スタックの改行は `\n`）。

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

- 04d9050: `ubichill build` が `config.dataOnly: true` の Component を、Worker を持たないデータ専用の Component として manifest に載せるようにした（バンドルせず、lock の components にも、置ける Component の一覧（`index.json` の `components`）にも載せない）。これまで `dataOnly` は型にあるだけでビルドが読んでおらず、mod が spawn するデータ（pen の `pen:stroke` など）を Worker として扱っていた。`ubichill dev` が `world.yaml` の無いときに合成するワールドにも data-only の型は置かない。manifest のスキーマに `dataOnly` を足した。

  `dataOnly` を書いた Component の `export const config` をリテラルとして読めない（テンプレート文字列・定数・スプレッドを使っている）と、ビルドを止めてそう知らせる。これまでなら黙って Worker として bundle され、spawn した Entity ごとに Worker が起動していた。

### Patch Changes

- 410b271: `ubichill dev` の画面で、mod が実行中に作るデータだけの entity（pen の `pen:stroke` など）に「mod のファイルを取得できません」と警告を出さない。
- cd7f158: npm 版（`ubichill`）を使う mod のバンドルに、使っていない SDK の実装（`UbiSDK` 本体など）が入らないようにした。これまでは `CORE_COMPONENT_TYPES` を 1 つ import するだけで minify 後に約 32KB 増えていた。`UbiSDK.FETCH_RPC_TIMEOUT_MS` は static フィールドから getter に変わる（読み取れる値は同じ。代入はできなくなる）。

  あわせて、`ubichill build` が自動で見つける権限が正しくなる。これまでは SDK の本体がバンドルに入ると、その中の文字列に反応して、使っていない `scene:read`・`scene:update` まで付いていた。新しい SDK で作り直した mod が、この誤検出に頼って scene の API を使っていた（`Ubi` を分割代入や別名で使うなど）なら、`export const config` の `capabilities` に書く。`FETCH_LIMITS.defaultMaxBytes`・`maxBytes` の型は `number` から値そのもののリテラル型になる（他の項目と同じ）。`@ubichill/cli` は同梱する `world.html` と shared の定数が同じ変更を含むので版を上げる。

- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0
  - @ubichill/loader@1.3.6

## 1.0.1

### Patch Changes

- 3777e11: `ubichill dev` を videoplayer・chillwa で使ってみて分かった点を直す。

  - world.yaml が無いときに合成するワールドを、実際のワールドと同じ形（mod ごとの親の下に Component を 1 つずつ）にし、`defaultTransform` の位置に置く。`scope: 'siblings'` のイベントが届くようになる。
  - ワールドだけのリポジトリ（`src/` が無い）でも `ubichill dev worlds/x.yaml` で動く。
  - Ctrl+C（`npm run dev` / `npx` が SIGINT を転送して 2 回届く）や、ポートが使用中で起動できないとき、どこかで捕まらない例外が出て落ちるときも Go が残らない。
  - 署名の無い手元の mod の署名ファイルを 204 で返す（ブラウザのコンソールに 404 を出さない）。
  - dev の状態表示を右上の小さな札にする（上端の帯が `overlay: top-left` の HUD を隠していた）。
  - 取れない mod の診断に、手元に無いのか `source.url` から取れないのかを出す。
  - 手元でビルドした mod は `source.url` が書いてあっても手元を使う（作業中のコードが動かなかった）。手元に無い mod は world.yaml の横の `.lock.json` の版（本番と同じ）を使い、外へ取りに行くのはワールドを作り直すときだけにする。
  - 診断を「今の失敗の一覧」として送る。起動直後の失敗が画面に出ない・壊して元に戻しても診断が残る、を直す。
  - ポートを先に開く（使用中ならビルドの前に分かる）。
  - 合成ワールドの entity の id が別の mod の親と子でぶつからない。画面固定の Component は x/y が無くても画面の角に置く。
  - Go が起動し直したあとの部屋の作り直しに失敗しても node が落ちず、ビルドの診断と並べて出し、次のビルドで部屋を作り直す。

## 1.0.0

### Major Changes

- 24578ca: CLI を `ubichill` から分け、`@ubichill/cli` として公開する。`ubichill` は mod が import する SDK だけになり、bin と `esbuild`・`yaml` への依存が無くなる（mod 開発者は `npm i ubichill` に加えて `npm i -D @ubichill/cli` を入れる。`ubichill` コマンドの名前と使い方は変わらない）。

### Minor Changes

- 24578ca: `ubichill dev`: 手元の mod を本番と同じ Go のインスタンスサーバーと `world.html` で動かす開発サーバー。Docker・DB・Go のツールチェーンは要らない。保存すると世代（lock・manifest・Worker・asset）を切り替えてページを読み直し、ビルドに失敗したら前の世代が動き続ける。
- 24578ca: ワールド定義の検証・写像（`definitionToResolved`）と、Go のインスタンスサーバーに渡す定義を作る `toInstanceDefinition` を `@ubichill/shared` に置き、backend と CLI が同じ変換を使う。`ubichill world build <world.yaml>` で、手元のワールドから `ubichill-instance --world` 用の定義 JSON を作れる。
- 24578ca: Go のインスタンスサーバー（`ubichill-instance`）を npm のプラットフォーム別パッケージ `@ubichill/instance-<os>-<cpu>` で配り、`@ubichill/cli` の optionalDependencies に入れる（macOS arm64/x64・Linux x64/arm64・Windows x64）。

### Patch Changes

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0
  - @ubichill/loader@1.3.5
