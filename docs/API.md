# Ubichill API リファレンス

## Plugin SDK — `Ubi.*`

```ts
// Worker 内プライベート ECS（揮発性・非共有・同期）
Ubi.local.createEntity(id)          // Entity
Ubi.local.getEntity(id)             // Entity | null
Ubi.local.query(...componentNames)  // Query

// System 登録（Ubi.local のショートカット）
Ubi.registerSystem((entities, deltaTime, events) => { ... })

// 共有エンティティ（全員に見える・インスタンス内永続・async）
await Ubi.world.getEntity(id)               // ComponentInstance | null
await Ubi.world.createEntity(entity)        // string（生成された ID）
await Ubi.world.updateEntity(id, patch)     // void
await Ubi.world.destroyEntity(id)           // void
Ubi.world.subscribeEntity(id)               // 更新を EVT_SCENE_ENTITY_UPDATED で受け取る
Ubi.world.unsubscribeEntity(id)

// 自 Entity (GameObject) 周辺の Component アクセス（Stage 4: Pure ECS 漸近）
await Ubi.entity.getSiblings<T>()                  // 自 Entity 上の他 Component (自分は除く)
await Ubi.entity.getSibling<T>(type)               // type 指定で最初の 1 件
await Ubi.entity.getParent<T>(type?)               // 親 Entity 上の Component (type で絞り込み可)
await Ubi.entity.getParentComponent<T>(type)       // 親 Entity 上の type 最初の 1 件
await Ubi.entity.getChildren<T>(type?)             // 直接の子 Entity 上の Component
await Ubi.entity.queryInSubtree<T>(type)           // 自 Entity + 子孫から type 一致を集める

// 通信
Ubi.network.sendToHost<TPayloadMap>(type, data)   // 自分の Host（React）にのみ送る
Ubi.network.broadcast<TPayloadMap>(type, data)    // ワールド全員の Worker に揮発性配信
await Ubi.network.fetch(url, options?)             // ホワイトリスト URL へ HTTP

// UI
Ubi.ui.showToast(text)

// アバター
Ubi.avatar.set(appDef)

// 読み取り専用プロパティ（初期化後に自動セット）
Ubi.worldId               // string | undefined
Ubi.myUserId              // string | undefined
Ubi.pluginId              // string | undefined
Ubi.componentInstanceId   // string | undefined — 自 Worker (Component インスタンス) の flat ID
Ubi.entityId              // string | undefined — 自 Worker が乗っている Entity (GameObject) の id
Ubi.componentType         // string | undefined — "pluginId:componentName"
```

> 命名規約: ubichill では **Entity == GameObject** (Pure ECS 標準)。Worker からは
> `Ubi.entityId` が GameObject の id を指す。Worker 自身 (= 1 Component インスタンス)
> を識別する flat ID は `Ubi.componentInstanceId`。詳細は
> [design/ecs-migration.md](./design/ecs-migration.md) を参照。

---

## Ubi.state — 宣言的リアクティブ状態

ubichill の Worker で状態を扱う第一の手段。`updateEntity` / `applyEntityData` を直接書く代わりに、
schema 宣言で同期スコープを指定し、`state.local.x = v` で透過的に同期させる。

### スキーマ宣言

```ts
const state = Ubi.state.define({
    // ┌────────────── スコープマーカー ──────────────┐
    color:        Ubi.state.persistent('#1a1a1a'),    // 全員と共有 + 永続化 (entity.data)
    strokeWidth:  Ubi.state.persistent(4),
    myVolume:     Ubi.state.persistMine(0.7),         // 全員と共有だが per-user (entity.data["myVolume:<userId>"])
    cursorState:  Ubi.state.shared<'default' | 'pen'>('default'),  // 揮発性 broadcast (Reliable 永続化なし)
    lockedBy:     Ubi.state.topLevel<string | null>(null),  // ComponentInstance top-level (lockedBy / ownerId)
    // └─────────────────────────────────────────────┘
    // マーカーなし = Worker 内ローカル (同期しない)
    loaded:       false,
    localTime:    0,
});

// 読み取り
state.local.color;          // 現在値 (proxy 経由)

// 書き込み (スコープに応じて自動で flush)
state.local.color = '#ff0000';   // → updateEntity でリモート伝搬

// リアクティブ購読
state.onChange('color', (next, prev) => { /* ... */ });

// 他ユーザーの値を見る (persistMine / shared 用)
state.for('user-123').myVolume;
```

### スコープの違い (重要)

| マーカー | 同期範囲 | 永続化 | バックエンド表現 | 用途 |
|---|---|---|---|---|
| `Ubi.state.persistent(v)` | **全員共有** (同 entity を見てる全員に同じ値) | ✅ DB | `entity.data.<key>` | playlist / 色設定 / 再生中フラグ |
| `Ubi.state.persistMine(v)` | **全員共有 + per-user namespace** (他人の値も読めるが各自独立) | ✅ DB | `entity.data.<key>:<userId>` | 音量 / 個人のスタイル設定 |
| `Ubi.state.shared(v)` | **揮発性 broadcast** (Reliable 永続化なし) | ❌ | `presence:sharedState` | カーソル状態 / 描画中ストローク |
| `Ubi.state.topLevel(v)` | **全員共有** (data ではなく ComponentInstance top-level) | ✅ DB | `entity.lockedBy` / `entity.ownerId` | 占有ロック / 所有者 |
| マーカーなし | **Worker ローカルのみ** | ❌ | — | 内部キャッシュ / 一時値 |

**頻出する誤解:**

- "persistent = 親と共有" は誤り。「同じ Entity を target にしている全 Worker (全ユーザー含む) と共有」が正確。
- 別 Component を覗き見たい場合 (例: 子 controls が親 screen.data を読みたい) は、`watchEntityTypes: [parentType]` + `watchScope: 'parent'` を設定し、その Worker の `Ubi.state.persistent` が parent を target にする。

### Target Entity 解決ルール

`Ubi.state.persistent` / `persistMine` / `topLevel` を書き込んだとき、**どの ComponentInstance を更新するか** は以下で決まる:

1. **自 Component を watch している場合** (`watchEntityTypes.includes(Ubi.componentType)`)
   → 自分自身の Component インスタンスを target に。
   `find(e => e.entityId === Ubi.entityId && e.type === Ubi.componentType)` で解決。
2. **他 Component を覗き見ている場合**
   → `watchEntityTypes[0]` の type に最初に一致する Component を target に。
   `watchScope` (`entity` / `subtree` / `parent` / `world`) で可視範囲を制限する。

target が見つかるまでは flush は遅延される (次の tick で再試行)。

### onChange タイミング

- 初期反映: プラグインコード実行**前**に Ubi.state が initialEntities から target を解決し state を埋める。なので `state.onChange` の listener は初期値変化では発火しない。
- 外部から target Component が更新されたとき: `EVT_ENTITY_WATCH` 受信 → `applyEntity` → 差分検知 → `onChange` 発火。
- 自分が書き込んだとき: ローカルでは即時 `onChange` 発火 + tick 終了時に updateEntity flush。

### よくあるバグ

- **Ubi.componentInstanceId が undefined**: sandbox.worker.ts での代入忘れ。修正済みだが今後の SDK 改修時に注意。
- **targetEntityId が GameObject id になっている**: `Ubi.world.updateEntity(id, ...)` は ComponentInstance.id (flat) を要求。GameObject id を渡しても backend は見つけられず黙殺される。

---

### Entity メソッド

```ts
entity.setComponent(name, data)   // void
entity.getComponent<T>(name)      // T | null
entity.hasComponent(name)         // boolean
entity.removeComponent(name)      // void
```

### Worker 内で届く EcsEventType

| type | payload |
|---|---|
| `INPUT_MOUSE_MOVE` | `{ x, y }` |
| `INPUT_MOUSE_DOWN` | `{ x, y, button }` |
| `INPUT_MOUSE_UP` | `{ x, y, button }` |
| `INPUT_KEY_DOWN` | `{ key, code }` |
| `INPUT_KEY_UP` | `{ key, code }` |
| `PLAYER_JOINED` | `User` |
| `PLAYER_LEFT` | `userId: string` |
| `PLAYER_CURSOR_MOVED` | `{ userId, position }` |
| `ENTITY_UPDATED` | `ComponentInstance` |
| `network:broadcast` | `{ userId, data }` |

---

## React Hooks — `@ubichill/react`

```ts
// プラグイン Worker を起動・管理
const { sendEvent } = usePluginWorker<TPayloadMap>(options)

// usePluginWorker + World エンティティ CRUD を自動配線
const { sendEvent } = useWorldPlugin<TPayloadMap>(options)

// カーソルオーバーレイを re-render ゼロで更新
const { divRef, onCursorUpdate } = useCursorPosition({ hotspot?: { x, y } })

// ワールドのエンティティ状態と CRUD
const { entities, createEntity, patchEntity, deleteEntity } = useWorld()

// 特定エンティティの状態変化を監視
const entity = useEntity(entityId)
```

---

## Capability ホワイトリスト

`plugin.json` の `capabilities` に含まれないコマンドは Host 側でブロックされる。

| capability | 有効になる API |
|---|---|
| `net:send` | `Ubi.network.sendToHost` |
| `net:broadcast` | `Ubi.network.broadcast` |
| `net:fetch` | `Ubi.network.fetch` |
| `world:entity` | `Ubi.world.*` (write 系) |
| `scene:read` | `Ubi.world.getEntity` / `Ubi.entity.*` |

---

## Socket.IO イベント（フロントエンド向け）

詳細は [`ARCHITECTURE.md`](./ARCHITECTURE.md) を参照。

**Client → Server**: `world:join` / `cursor:move` / `entity:create` / `entity:patch` / `entity:ephemeral` / `entity:delete`

**Server → Client**: `world:snapshot` / `user:joined` / `user:left` / `entity:created` / `entity:patched` / `entity:deleted`

---

## HTTP REST API — `/api/v1`

全エンドポイント認証必須。

| リソース | GET | POST | PUT / DELETE |
|---|---|---|---|
| `/worlds` | 一覧・詳細 | 作成 | 更新・削除（**作成者のみ**） |
| `/instances` | 一覧・詳細 | 作成（10件/h） | 削除（**リーダーのみ**） |
| `/users/me` | 自分の情報 | — | — |
