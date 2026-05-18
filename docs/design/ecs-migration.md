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
- Backend での flatten 処理: `WorldEntity` → `ComponentInstance[]`

### Stage 2: Worker 単位の Component 化 (1 Component = 1 Worker)

各 `ComponentInstance` ごとに 1 つの Sandbox Worker を立ち上げる方針に切替。
- `PluginHostManager` を `componentInstanceId` でレジストリ管理
- React 側で `WorkerPluginHost` が Component インスタンスごとに mount
- Component 型別の `WorkerPluginDefinition`

### Stage 3: 通信プロトコル整備と watchScope

各 Worker が自分にとって意味のある Entity だけを購読できるように `watchScope` を導入。

- `watchScope: 'entity' | 'subtree' | 'world'`
  - `entity`: 自 Entity 上の Component インスタンスのみ
  - `subtree`: 自 Entity + 子孫
  - `world`: ワールド全体 (重いので限定使用)
- `watchEntityTypes: string[]` で受け取りたい Component 型を宣言
- 初期スナップショット `initialEntities` を Worker 起動時に渡す
- Host 側 `useWorld` の差分配信ループ (`usePluginEntitySync`) で `EVT_SCENE_ENTITY_UPDATED` を発火

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
const stroke = await Ubi.entity.getChildren<StrokeData>('pen:stroke');

// 自 Entity + 子孫 から type 一致を集める
const allStrokes = await Ubi.entity.queryInSubtree<StrokeData>('pen:stroke');
```

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
| `PluginHostManagerOptions.entityId` / `.gameObjectId` | `componentInstanceId` / `entityId` | — |
| `EvtLifecycleInit.payload.entityId` / `.gameObjectId` | `componentInstanceId` / `entityId` | — |

影響範囲: shared / sandbox / sdk / react / backend / frontend / plugins の約 30 ファイル。

`pnpm typecheck` / `pnpm lint` / `pnpm build:workers` すべてクリーン。

---

## 5. Pure ECS 達成度 (現状)

| 項目 | 状態 | 備考 |
|---|---|---|
| Entity と Component の分離 | ✅ | `WorldEntity` ⇔ `ComponentInstance` の二重表現 |
| Worker 単位の Component 化 | ✅ | 1 Component = 1 Worker |
| 兄弟 / 親 / 子 Component アクセス | ✅ | `Ubi.entity.*` (Stage 4) |
| System のピュア関数化 | ⚠️ | `Ubi.registerSystem` はあるが、`Ubi.local` 経由でしか純粋にならず、副作用は Component 側にある |
| 依存関係宣言 (`requires`) | ❌ | Editor 警告のために必要 (Stage 4 サブ) |
| 階層 D&D / 範囲外 Entity 警告 | ❌ | Editor 仕上げ |
| プラグインの完全 ECS 化 | 🟡 | pen / video-player は部分的に Component 分離済み。完全分離は次フェーズ |

---

## 6. Stage 4 サブステップ (継続中)

- [ ] pen plugin の完全 ECS 化 (`pen:pen` Worker 追加、canvas スリム化、`Ubi.entity.commitStroke` 経路)
- [ ] video-player の `screen` / `controls` 分離 + `targetEntityIds` 参照
- [ ] 依存関係宣言 (`requires` フィールド + Editor 警告)
- [ ] Editor 仕上げ (Hierarchy D&D 上 / 中 / 下 兄弟順序、範囲外 Entity 警告、inline style → cva)
- [ ] スナップ単位の設定 UI
