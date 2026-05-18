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
