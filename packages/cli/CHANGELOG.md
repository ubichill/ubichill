# @ubichill/cli

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
