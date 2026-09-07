# @ubichill/sdk

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
