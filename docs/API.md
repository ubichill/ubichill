# Ubichill API リファレンス

## Plugin SDK — `Ubi.*`

API surface は意図的にコンパクト (8 ネームスペース + 数個のトップレベル shortcut):

```ts
// ──── 状態管理 (declarative)  ────────────────────────────
Ubi.state.define(schema)                          // EntityState<T> を返す。詳細は次セクション
Ubi.state.sync<T>(default, options?)              // 1 つの sync() で全スコープを表現:
//   default:                  全員共有 + DB 永続化 (entity.data)
//   { perUser: true }         全員共有 + per-user namespace
//   { ephemeral: true }       揮発性 broadcast (presence 経由)
//   { topLevel: 'lockedBy' }  ComponentInstance top-level (lockedBy / ownerId)

// ──── トリガー (events) ──────────────────────────────────
Ubi.event.sendToHost<T>(type, data)               // 自 Worker → 自 Host (タブ内ローカル)
Ubi.event.broadcast<T>(type, data)                // 自 Worker → 他ユーザーの同 entity Worker
Ubi.event.emit(type, data, { scope, targetType? }) // 同 tab 内の他 Worker に狙い撃ち送信
//   scope: 'siblings' | 'parent' | 'children' | 'subtree' | 'world'
//   targetType: 受信側 Component type ("pluginId:componentName")

// ──── 自分中心の階層 CRUD ────────────────────────────────
await Ubi.entity.update(patch)                    // 自 ComponentInstance を更新
await Ubi.entity.destroy()                        // 自分を削除
await Ubi.entity.spawn(child)                     // 自 Entity の子として spawn

// ──── UI ─────────────────────────────────────────────────
Ubi.ui.render(factory, targetId?)
Ubi.ui.showToast(text)
Ubi.ui.unmount(targetId?)

// ──── メディア (video / HLS) ─────────────────────────────
Ubi.media.load(url, targetId, mediaType?)
Ubi.media.play(targetId) / Ubi.media.pause(targetId)
Ubi.media.seek(time, targetId)
Ubi.media.setVolume(v, targetId) / Ubi.media.setVisible(visible, targetId)

// ──── canvas 描画 ────────────────────────────────────────
Ubi.canvas.frame(targetId, { activeStroke, cursor })
Ubi.canvas.commitStroke(targetId, strokeData)

// ──── プレイヤー (presence) ──────────────────────────────
Ubi.player.others() / .all() / .scroll() / .syncCursor({ throttleMs })

// ──── エンティティ (callable + static) ──────────────────
Ubi.entity()                                       // SelfEntityRef (自分自身)
Ubi.entity(id)                                     // OtherEntityRef (他 id)
await Ubi.entity().update(patch)                   // 自 ComponentInstance を更新
await Ubi.entity().destroy()                       // 自分を削除
await Ubi.entity().spawn(child)                    // 自 Entity の子として spawn
await Ubi.entity(otherId).update(patch)            // 他 id を更新 (escape hatch)
await Ubi.entity(otherId).destroy()                // 他 id を削除
await Ubi.entity.query<T>(type)                    // type 検索
await Ubi.entity.get<T>(id)                        // id で取得
await Ubi.entity.spawn(entity)                     // 親を明示指定して自由 spawn

// ──── その他 ──────────────────────────────────────────
await Ubi.fetch(url, options?)                     // HTTP (capability whitelist 経由)
Ubi.registerSystem((entities, dt, events) => {...}) // ECS System 登録
Ubi.log(message, level?)                           // ログ ('debug' | 'info' | 'warn' | 'error')

// ──── 読み取り専用プロパティ (初期化後に自動セット) ──────
Ubi.worldId               // string | undefined
Ubi.myUserId              // string | undefined
Ubi.pluginId              // string | undefined
Ubi.componentInstanceId   // string | undefined — 自 Worker (Component インスタンス) の flat ID
Ubi.entityId              // string | undefined — 自 Worker が乗っている Entity (GameObject) の id
Ubi.componentType         // string | undefined — "pluginId:componentName"
Ubi.pluginBase            // string — プラグインアセットのバージョン付きベース URL
```

**設計方針:**
- 基本は `Ubi.state.local.x = v` で宣言的に書く。`onChange` で副作用を局所化
- 他コンポーネント宛のトリガーは `Ubi.event.emit` / `broadcast` / `sendToHost`
- 自エンティティの CRUD は `Ubi.entity()`。他は `Ubi.entity(id)` (escape hatch)
- 新規 Entity は `Ubi.entity().spawn(child)` (自分の子) または `Ubi.entity.spawn(...)` (parent 明示)

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
    // マーカーなし = Worker 内ローカル (同期しない)
    loaded:       false,
    localTime:    0,

    // ─── Ubi.state.sync(value, options?) で同期スコープを指定 ───
    color:        Ubi.state.sync('#1a1a1a'),                                // 全員共有 + DB 永続化
    strokeWidth:  Ubi.state.sync(4),
    myVolume:     Ubi.state.sync(0.7, { perUser: true }),                   // per-user namespace
    cursorState:  Ubi.state.sync<'default' | 'pen'>('default', { ephemeral: true }),  // 揮発性 broadcast
    lockedBy:     Ubi.state.sync<string | null>(null, { topLevel: 'lockedBy' }),       // top-level field
});

// 読み取り
state.local.color;          // 現在値 (proxy 経由)

// 書き込み (スコープに応じて自動で flush)
state.local.color = '#ff0000';   // → updateEntity でリモート伝搬

// リアクティブ購読
state.onChange('color', (next, prev) => { /* ... */ });

// 他ユーザーの値を見る (perUser / ephemeral 用)
state.for('user-123').myVolume;
```

### スコープの違い (重要)

| マーカー | 同期範囲 | 永続化 | バックエンド表現 | 用途 |
|---|---|---|---|---|
| `Ubi.state.sync(v)` | **全員共有** (同 entity を見てる全員に同じ値) | ✅ DB | `entity.data.<key>` | playlist / 色設定 / 再生中フラグ |
| `Ubi.state.sync(v, { perUser: true })` | **全員共有 + per-user namespace** | ✅ DB | `entity.data.<key>:<userId>` | 音量 / 個人のスタイル設定 |
| `Ubi.state.sync(v, { ephemeral: true })` | **揮発性 broadcast** (Reliable 永続化なし) | ❌ | `presence:sharedState` | カーソル状態 / 描画中ストローク |
| `Ubi.state.sync(v, { topLevel: 'lockedBy' })` | **全員共有** (ComponentInstance top-level) | ✅ DB | `entity.lockedBy` | 占有ロック |
| `Ubi.state.topLevel(v)` | **全員共有** (data ではなく ComponentInstance top-level) | ✅ DB | `entity.lockedBy` / `entity.ownerId` | 占有ロック / 所有者 |
| マーカーなし | **Worker ローカルのみ** | ❌ | — | 内部キャッシュ / 一時値 |

**頻出する誤解:**

- "sync = 親と共有" は誤り。「同じ Entity を target にしている全 Worker (全ユーザー含む) と共有」が正確。
- 別 Component を覗き見たい場合 (例: 子 controls が親 screen.data を読みたい) は、`watchEntityTypes: [parentType]` + `watchScope: 'parent'` を設定し、その Worker の `Ubi.state.sync` が parent を target にする。

### Target Entity 解決ルール

`Ubi.state.sync(...)` 経由で書き込んだとき、**どの ComponentInstance を更新するか** は以下で決まる:

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
- **targetEntityId が GameObject id になっている**: 内部の updateEntity 経路 (`Ubi.entity(id).update`) は ComponentInstance.id (flat) を要求。GameObject id を渡しても backend は見つけられず黙殺される。

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
| `net:send` | `Ubi.event.sendToHost` |
| `net:broadcast` | `Ubi.event.broadcast` (`Ubi.state.shared` も内部で使用) |
| `net:fetch` | `Ubi.fetch` |
| `scene:read` | `Ubi.entity.get` / `Ubi.entity.query` |
| `scene:update` | `Ubi.entity().update/destroy/spawn` / `Ubi.entity(id).update/destroy` / `Ubi.entity.spawn` / `Ubi.state.sync` の書き込み全般 |
| `net:emit` | `Ubi.event.emit` (クロス Worker 配送) |
| `ui:render` | `Ubi.ui.render` |
| `ui:toast` | `Ubi.ui.showToast` |
| `canvas:draw` | `Ubi.canvas.*` |
| `video:control` | `Ubi.media.*` |

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
