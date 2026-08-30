# @ubichill/shared

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
