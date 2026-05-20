# ECS マイグレーション設計ノート

ubichill のプラグインモデルを Unity 風 (MonoBehaviour 寄り) の Component 駆動から、
Pure ECS の方向に漸近させていく一連の作業の記録。命名・責務・通信プロトコルを 1 箇所にまとめる。

関連: [ARCHITECTURE.md](../ARCHITECTURE.md) / [API.md](../API.md)

---

## 0. 用語と命名規約

ECS 業界標準では **Entity == GameObject**。ubichill では「Entity」を Pure ECS の
Entity の意味で使い、ランタイムで Worker に渡る flat ビューを `ComponentInstance` と呼ぶ。

| 概念 | 型 / 識別子 | 解説 |
|---|---|---|
| **Entity** (== GameObject) | `WorldEntity` / `entityId` | `transform` + `components[]` + `children[]` を持つ「箱」。kebab-case の人間可読 id。 |
| **Component (型)** | `EntityComponent` | Entity に貼り付く 1 つの振る舞い。`type = "pluginId:componentName"`。 |
| **Component インスタンス (実体)** | `ComponentInstance<T>` / `id` (= `componentInstanceId`) | Worker 1 つに 1:1 対応する flat ビュー。`entityId` (自身が乗る Entity) と `parentEntityId` (親 Entity) を持つ。 |
| Worker 識別子 | `Ubi.componentInstanceId` | サンドボックス内で「私はどの Component インスタンスか」を一意に示す。 |
| Entity 識別子 | `Ubi.entityId` | この Component が乗っている Entity (GameObject) の id。Pure ECS の Entity と一致。 |
| Component 型名 | `Ubi.componentType` | `"pluginId:componentName"` |

### よくある混乱と回避策

- **Worker 内では「自分」== Component インスタンス**。`Ubi.entityId` は「自分が乗っている箱」であって、同一 Entity 上には他の Component インスタンスも存在し得る。
- `ComponentInstance` の `id` フィールドが内部 flat ID (= `componentInstanceId`)、`entityId` が GameObject 側の id。命名が紛らわしいが、Worker 互換の flat 形を維持する以上どこかで一致しないキーが出る。**「Worker からは entityId が GameObject」**と覚える。
- `Ubi.world.updateEntity(id, patch)` の `id` は **ComponentInstance.id (= componentInstanceId)** であり Entity id ではない。pen plugin リファクタ時に何度かこれを取り違えた。

---

## 1. パッケージ責務 (再掲)

| パッケージ | 責務 | 依存禁止 |
|---|---|---|
| `@ubichill/engine` | 純粋 ECS (Entity / Component / System / Query)。Worker 内ローカル ECS で使用。 | React / DOM / Worker / Network |
| `@ubichill/sandbox` | Worker ライフサイクル・Tick・入力収集・コマンドディスパッチ | React |
| `@ubichill/sdk` | プラグイン公開 API (`Ubi`)。Worker 内のみで動く。 | Host 内部 |
| `@ubichill/react` | Host 側 React Hooks (`usePluginWorker` 他) | — |
| `@ubichill/shared` | 型・プロトコル定義 | — |
| `plugins/*` | 各プラグイン実装。`@ubichill/sdk` のみ依存。 | — |

---

## 2. Stage 1〜3 振り返り

### Stage 1: Entity / Component / System の分離 (基礎モデル化)

エディタ / DB レイヤでは GameObject (Entity) と Component の分離を導入し、
Worker への配信時に flat ビュー (`ComponentInstance`) に展開する非対称モデルを採用。

実装した主な型 / 関数:
- `WorldEntity` (GameObject 側) と `ComponentInstance` (Worker flat 側) の二重表現
- `AvailableComponent` (ツールバー / Editor 用メタデータ)
- `EntityComponent` (Entity に載る 1 Component)
- Backend での flatten 処理: `WorldEntity` → `ComponentInstance[]` (`flattenGameObject`)

### Stage 2: Worker 単位の Component 化 (1 Component = 1 Worker)

各 `ComponentInstance` ごとに 1 つの Sandbox Worker を立ち上げる方針に切替。
- `PluginHostManager` を `componentInstanceId` でレジストリ管理
- React 側で `WorkerPluginHost` が Component インスタンスごとに mount
- Component 型別の `WorkerPluginDefinition`

### Stage 3: 通信プロトコル整備と watchScope

各 Worker が自分にとって意味のある Entity だけを購読できるように `watchScope` を導入。

- `watchScope: 'entity' | 'subtree' | 'world'`
  - `entity`: 自 Entity 上の Component インスタンスのみ (`e.entityId === selfEntityId`)
  - `subtree`: 自 Entity + 子孫 (parentEntityId チェーンを辿る)
  - `world`: ワールド全体 (重いので限定使用)
- `watchEntityTypes: string[]` で受け取りたい Component 型を宣言
- 初期スナップショット `initialEntities` を Worker 起動時に渡す
- Host 側 `useWorld` の差分配信ループ (`usePluginEntitySync`) で `EVT_ENTITY_WATCH` を発火
- Worker 再起動時 (`workerRevision` 変化時) は購読範囲内全 Entity を再送

---

## 3. Stage 4: Ubi.entity API (兄弟 / 親 / 子 アクセス)

### 問題意識

Stage 3 までは、同じ Entity 上の他 Component のデータを読むには
`Ubi.network.broadcast` か `Ubi.world.getEntity(id)` のどちらかしかなく、
ECS 的には自然な「兄弟 Component アクセス」が回りくどい経路になっていた。

### 設計

`Ubi.entity.*` を新設。RPC で Host にクエリし、Host 側で Entity hierarchy を解決して返す。

```ts
// 自 Entity 上の他 Component (自分は除く)
const siblings = await Ubi.entity.getSiblings<T>();
const screen = await Ubi.entity.getSibling<ScreenData>('video-player:screen');

// 親 Entity 上の Component
const parents = await Ubi.entity.getParent<T>();          // 全 Component
const owner = await Ubi.entity.getParentComponent<T>('world:owner');

// 子 Entity 上の Component
const children = await Ubi.entity.getChildren<T>();
const strokes = await Ubi.entity.getChildren<StrokeData>('pen:stroke');

// 自 Entity + 子孫 から type 一致を集める
const allStrokes = await Ubi.entity.queryInSubtree<StrokeData>('pen:stroke');
```

実利用例:
- pen plugin: `Ubi.entity.queryInSubtree('pen:stroke')` で自ペン Entity 配下の自分が描いた stroke を集める想定
- video-player: `Ubi.entity.getSibling('video-player:screen')` で同 Entity の screen Component を controls から参照

### プロトコル追加

`PluginGuestCommand` に 4 件 RPC を追加:
- `ENTITY_GET_SIBLINGS` (`CmdEntityGetSiblings`)
- `ENTITY_GET_PARENT` (`CmdEntityGetParent`)
- `ENTITY_GET_CHILDREN` (`CmdEntityGetChildren`)
- `ENTITY_QUERY_SUBTREE` (`CmdEntityQuerySubtree`)

Capability: `scene:read` で有効化 (既存)。

### Host 側実装

`packages/react/src/hooks/usePluginEntity.ts` が、`useWorld` の `entities` から
`indexByGameObject` Map を構築して O(1) で sibling/parent/children を解決する。

### Worker 間通信の制約 (設計上の落とし穴)

`Ubi.entity` API は **read-only**。書き込み・イベント送信のための同 tab 内クロス Worker チャネルは SDK にない。
これは pen plugin リファクタで何度もぶつかった制約なので明示する:

| 経路 | 同 tab 内 sender へ届く? | 他 tab/他ユーザーへ届く? | 用途 |
|---|---|---|---|
| `Ubi.network.broadcast(type, data)` | ❌ Socket.IO `socket.to(room)` で送信者除外 | ✅ 同一 `entityId` を持つ他ユーザーの Worker | クロスユーザー揮発性同期 |
| `Ubi.network.sendToHost(type, data)` | ✅ ただし自 Worker → Host の片道のみ | ❌ | 自 Worker から自 Host (React) へ |
| `Ubi.world.updateEntity(id, patch)` | ✅ 全 Worker (entity の watcher 全員) に entity:type イベントとして届く | ✅ Reliable State として全員に永続反映 | 共有状態の書き換え |
| `Ubi.entity.*` (read) | ✅ 同期的に最新の hierarchy を見られる | — | 兄弟/親/子の read-only クエリ |

結論: 「Component A → Component B に何かを伝えたい」場合、共有データを `Ubi.world.updateEntity` で書き換えて B が watch する、というデータ駆動の経路が現状の唯一の手段。直接呼び出し的なコマンドチャネルはない。

---

## 4. 命名リネーム (Pure ECS 用語への統一)

Stage 4 と同時に、Pure ECS 用語との整合を取るため大規模リネームを実施。

| Before | After | 意味 |
|---|---|---|
| `WorldEntity<T>` | `ComponentInstance<T>` | Worker 互換の flat ビュー |
| `WorldGameObject` | `WorldEntity` | GameObject == ECS の Entity |
| `Ubi.entityId` (flat 内部 ID) | `Ubi.componentInstanceId` | Worker / Component インスタンスを識別する flat ID |
| `Ubi.gameObjectId` | `Ubi.entityId` | Entity (GameObject) の id |
| field `gameObjectId` | `entityId` | 同上 |
| field `parentGameObjectId` | `parentEntityId` | 親 Entity の id |
| `PluginWorkerInfo.entityId` | `componentInstanceId` | — |
| `TickMetric.entityId` | `componentInstanceId` | — |
| `PluginHostManagerOptions` の `entityId` (flat) / `gameObjectId` | `componentInstanceId` / `entityId` | — |
| `EvtLifecycleInit.payload` の `entityId` (flat) / `gameObjectId` | `componentInstanceId` / `entityId` | — |

影響範囲: shared / sandbox / sdk / react / backend / frontend / plugins の約 30 ファイル。

### 4.1 リネーム取りこぼしバグ (sandbox.worker.ts)

リネーム後 `packages/sandbox/src/sandbox.worker.ts` の `EVT_LIFECYCLE_INIT` ハンドラで:

```ts
// バグ: 旧 entityId を 2 回代入していて componentInstanceId が永久に undefined
Ubi.entityId = event.payload.entityId;
Ubi.entityId = event.payload.entityId;
```

正しくは:

```ts
Ubi.componentInstanceId = event.payload.componentInstanceId;
Ubi.entityId = event.payload.entityId;
```

これが原因で **SDK 全体で `Ubi.componentInstanceId` が常に undefined**。`updateEntity` を自 Component に対して呼ぶ全ての処理が無音で失敗していた。pen:pen Worker の `selectMe()` / `releaseMe()` ガード (`if (!selfComponentId) return`) ですべてスルーになり、UI が描画されない症状で発覚。

教訓: リネーム時は **代入先側のフィールド名も grep で確認** すること。`Before` 側を全消去するだけでは、誤って同じフィールドへ二重代入してしまい型エラーも出ない (上書きされるだけ)。

---

## 5. Pure ECS 達成度 (現状)

| 項目 | 状態 | 備考 |
|---|---|---|
| Entity と Component の分離 | ✅ | `WorldEntity` ⇔ `ComponentInstance` の二重表現 |
| Worker 単位の Component 化 | ✅ | 1 Component = 1 Worker |
| 兄弟 / 親 / 子 Component アクセス | ✅ | `Ubi.entity.*` (Stage 4) |
| System のピュア関数化 | ⚠️ | `Ubi.registerSystem` はあるが、Worker 副作用 (描画/送信) は System 内 |
| pen plugin の完全 ECS 化 | ✅ | pen:pen Worker 追加、tray = 設定 UI、stroke = pen の子 Entity |
| video-player の完全 ECS 化 | 🟡 | screen / controls 分離は途中。次フェーズ |
| 依存関係宣言 (`requires`) | ❌ | Editor 警告のために必要 |
| 階層 D&D / 範囲外 Entity 警告 | ❌ | Editor 仕上げ |
| クロス Worker コマンドチャネル | ❌ | 現状は「entity state を書き換えて watcher に届ける」データ駆動のみ |

---

## 6. ペンプラグイン: 参照アーキテクチャ

pen plugin が完全 ECS 化された結果、他プラグインのテンプレートとして使える形になった。

### 階層

```
pen-tray Entity (pen:tray Worker)         ← 設定 UI (size selector) と背景容器
  ├── pen-black Entity (pen:pen Worker)   ← 自分のボタン描画 + 選択 lockedBy
  ├── pen-red Entity (pen:pen Worker)
  └── ...

pen-canvas Entity (pen:canvas Worker)     ← 入力 + 描画レイヤー
  └── (描画時) 持ち主の pen Entity 配下に pen:stroke Entity を生成
```

### 責務分割

| Component | 責務 | watchScope | UI |
|---|---|---|---|
| `pen:pen` | 自身のデータ・選択ロジック・ボタン描画 | `entity` | ✅ (自前) |
| `pen:tray` | 容器枠 + 自 subtree で held なペンの size 設定 | `subtree` | ✅ (枠 + 設定) |
| `pen:canvas` | グローバル入力 + canvas 描画 + stroke 永続化 | `world` | キャンバス (canvasTarget) |
| `pen:stroke` | 永続化されたストロークデータ | — | なし (canvas が描画) |

### 採用したパターン

1. **各 Component が自前 UI を持つ** — pen:pen はボタンを自分で描く。tray は size selector を自分で描く。「リスト UI を 1 つの親が一括描画」は避ける
2. **階層 = ECS 親子** — pen:pen が tray Entity の child。watchScope=`subtree` で親が子を捕捉
3. **設定 UI は親 Component に集約** — pen:tray が pen の strokeWidth 変更 UI を持つ。「pen 本体は自分の表示だけ、tray は周辺設定 UI」という分担
4. **書き込みは `Ubi.world.updateEntity` 経由** — pen:tray が pen のサイズを変える時も updateEntity。pen:pen の Worker は entity:pen:pen イベントで自動更新
5. **stroke は pen の子 Entity として永続化** — `parentEntityId = heldPen.entityId` + `entityId = crypto.randomUUID()`。階層クエリで誰の stroke か追跡可能

### 副作用最小化の指針 (pen から学んだこと)

- 共有 mutable state は Worker scope のローカル変数 1 箇所に閉じる (`state` オブジェクト 1 つ)
- レンダリングは `dirty` フラグで gate し、`dirty=true` の時だけ render
- イベントハンドラは `void asyncFn()` で起動するだけにし、awaited な処理は async function 内
- 初期化時の Ubi.ui.render は System 内 (dirty 初期値 true) で行う。module load 直接呼び出しは避ける (Worker 初期化タイミングが不安定)

---

## 7. Stage 4 サブステップ (継続中)

- [x] pen plugin の完全 ECS 化 (`pen:pen` Worker 追加、tray を size selector へ簡素化、stroke が pen の子 Entity)
- [ ] video-player の `screen` / `controls` 分離 + `targetEntityIds` 参照
- [ ] 依存関係宣言 (`requires` フィールド + Editor 警告)
- [ ] Editor 仕上げ (Hierarchy D&D 上 / 中 / 下 兄弟順序、範囲外 Entity 警告、inline style → cva)
- [ ] スナップ単位の設定 UI
- [ ] (将来) クロス Worker コマンドチャネル — 現状の制約を緩めたい場合
- [ ] (将来) Component UI のサムネイル化 — Editor の component picker で各 component の UI プレビューをキャッシュ表示
