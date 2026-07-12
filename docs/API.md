# Ubichill API リファレンス

> **🚧 API 安定性: alpha (v1.0.0 未満)**
>
> `@ubichill/sdk` は現在 v1 リリース前です。**ネームスペース構造とメソッド名は変わる可能性があります**。
> 直近で実施した breaking change の例: `Ubi.network → Ubi.event`, `Ubi.world → Ubi.entity()`,
> `Ubi.state.persistent / persistMine / shared / topLevel → Ubi.state.sync(value, options)`。
>
> **安定度の目安**:
> - 🟢 **コア設計思想** (Ubi.state による宣言的同期 / `watchScope` 階層スコープ /
>   `Ubi.event.emit` クロス Worker) は確定済み。これは変えない方針
> - 🟡 **隔離の単位** — 現状は「1 Component = 1 Worker」だが**確定ではない**。信頼境界は本来
>   **プラグイン (mod) 単位**であるべき（ユーザーはプラグインを単位に信頼/不信を判断し、権限の
>   grant も既に pluginId 単位で記憶している）。コンポーネント数に比例して Worker が増える
>   スケール問題 (`PERF_WORKER_LIMIT_REACHED`) もあるため、将来「1 プラグイン = 1 Worker」への
>   統合や Worker プーリングに変わり得る。プラグインコードはこの粒度に依存しないこと
> - 🟡 **ネームスペース構造** (`Ubi.state` / `.entity` / `.event` / `.ui` / `.media` / `.canvas` / `.player`) は
>   役割分担として合理的だが、追加/分割/rename はあり得る
> - 🔴 **個別メソッド名** (`Ubi.entity().spawn` 等) は使い込みで変わる可能性
> - 🔴 **内部プロトコル** (`PluginGuestCommand` / `PluginHostEvent`) は実装都合で随時変わる。
>   プラグインからは **必ず SDK 経由**でアクセスし、コマンド型を直接 import しないこと
>
> API 変更時は本ファイル + [`design/ecs-migration.md`](./design/ecs-migration.md) に履歴を残します。
> v1.0.0 リリース後は SemVer の breaking change ポリシーに従います。

## Plugin SDK — `Ubi.*`

API surface は意図的にコンパクト (7 ネームスペース + 数個のトップレベル shortcut):

```ts
// ──── 状態管理 (declarative)  ────────────────────────────
Ubi.state.define(schema)                          // EntityState<T> を返す。詳細は次セクション
Ubi.state.sync<T>(default, options?)              // 1 つの sync() で全スコープを表現:
//   default:                  全員共有 + DB 永続化 (entity.data)
//   { perUser: true }         全員共有 + per-user namespace
//   { ephemeral: true }       揮発性 broadcast (presence 経由)
//   { topLevel: 'lockedBy' }  ComponentInstance top-level (lockedBy / ownerId)

// ──── イベント (型付き registry — 推奨) ──────────────────
const MyEvents = Ubi.event.define<{
    'plugin:event:type': { payload: ... };           // type ↔ payload を 1 箇所に宣言
    'cross:user:msg':    { ... };
}>();
MyEvents.emit(type, data, { scope, targetType? })   // 同 tab の他 Worker に狙い撃ち
MyEvents.broadcast(type, data)                       // 他ユーザーの同 entity Worker へ (volatile)
MyEvents.sendToHost(type, data)                      // 自 Host (React 側) へ
MyEvents.on(type, (data) => {...})                   // emit / sendToHost / SDK 由来 (input:* / entity:* など) を受信
MyEvents.onBroadcast(type, (userId, data) => {...})  // broadcast を受信 (envelope を unwrap)

// ──── トリガー (untyped escape hatch — 互換用) ──────────
Ubi.event.sendToHost<T>(type, data)
Ubi.event.broadcast<T>(type, data)
Ubi.event.emit(type, data, { scope, targetType? })
//   scope: 'siblings' | 'parent' | 'children' | 'subtree' | 'world'
//   targetType: 受信側 Component type ("pluginId:componentName")

// ──── 自分中心の階層 CRUD ────────────────────────────────
await Ubi.entity().update(patch)                  // 自 ComponentInstance を更新
await Ubi.entity().destroy()                      // 自分を削除
await Ubi.entity().spawn(child)                   // 自 Entity の子として spawn

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

// ──── 掴む / 持つ (排他オーナーシップ) ────────────────────
const grip = Ubi.grip.exclusive()  // 世界中の同 Component type で 1 ユーザー 1 つだけ
grip.acquire()                      // 掴む (別 subtree でも自分が持ってる同種があれば自動で離す)
grip.release()                      // 離す
grip.holder                         // string | null
grip.isMine                         // boolean
grip.onChange((next, prev) => ...)  // 占有者の変化を監視
// 必要 capability: 'scene:update' (lockedBy 同期) + 'net:emit' (世界横断の調停 emit)

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
await Ubi.fetch(url, options?)                     // HTTP (外部はドメインごとにユーザー承認)
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
- 「ユーザーが今このエンティティを掴んでいる」状態は `Ubi.grip.exclusive()`。
  lockedBy + 1 ユーザー 1 本ルールを毎回書かない (競合条件取りこぼし防止)

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

// 複数 set を 1 トランザクションに集約 (onChange は最新値で 1 回ずつ発火、render の二重発火を防ぐ)
state.batch(() => {
    state.local.currentTime = 0;
    state.local.duration = 0;
    state.local.lastSyncedTime = 0;
});
```

### スコープの違い (重要)

| マーカー | 同期範囲 | 永続化 | バックエンド表現 | 用途 |
|---|---|---|---|---|
| `Ubi.state.sync(v)` | **全員共有** (同 entity を見てる全員に同じ値) | ✅ DB | `entity.data.<key>` | playlist / 色設定 / 再生中フラグ |
| `Ubi.state.sync(v, { perUser: true })` | **全員共有 + per-user namespace** | ✅ DB | `entity.data.<key>:<userId>` | 音量 / 個人のスタイル設定 |
| `Ubi.state.sync(v, { ephemeral: true })` | **揮発性 broadcast** (Reliable 永続化なし) | ❌ | `presence:sharedState` | カーソル状態 / 描画中ストローク |
| `Ubi.state.sync(v, { topLevel: 'lockedBy' })` | **全員共有** (ComponentInstance top-level) | ✅ DB | `entity.lockedBy` | 占有ロック |
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

### Worker 内で届くイベント

`Ubi.event.define<TMap>()` の `on(type, ...)` で型付き受信できる。`TMap` の key には以下の組み込み type も入れて OK。

| type 文字列 | payload | 由来 |
|---|---|---|
| `input:mouse_move` | `{ x, y, viewportX, viewportY, buttons }` | DOM mousemove |
| `input:mouse_down` | `{ x, y, button }` | DOM mousedown |
| `input:mouse_up` | `{ x, y, button }` | DOM mouseup |
| `input:key_down` | `{ key, code }` | DOM keydown |
| `input:key_up` | `{ key, code }` | DOM keyup |
| `input:cursor_style` | `{ style: string }` | カーソル CSS 変化 |
| `input:scroll` | `{ x, y }` | ワールドスクロール |
| `input:resize` | `{ width, height }` | ウィンドウリサイズ |
| `player:joined` | `User` | 新規ユーザー参加 |
| `player:left` | `userId: string` | ユーザー退出 |
| `player:cursor_moved` | `{ userId, position }` | リモートカーソル移動 |
| `entity:updated` | `ComponentInstance` | エンティティ更新 (any) |
| `entity:<pluginId>:<componentName>` | `ComponentInstance` | `watchEntityTypes` に登録した型の更新 |
| `media:timeUpdate` | `{ targetId, currentTime, duration }` | `<video>` timeupdate |
| `media:loaded` | `{ targetId, duration }` | `<video>` loadedmetadata |
| `media:ended` | `{ targetId }` | `<video>` ended |
| `media:error` | `{ targetId, message }` | `<video>` error |
| `<custom>` (emit/sendToWorker で指定した type) | 指定した payload | `Ubi.event.emit` / Host の `sendToWorker` |

`onBroadcast(type, (userId, data) => ...)` 専用:

| type 文字列 | payload (data) | 由来 |
|---|---|---|
| `<custom>` (broadcast で指定した type) | 指定した payload (envelope `{ userId, data }` は自動 unwrap) | `Ubi.event.broadcast` (cross-user) |

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

## 権限 (Capability) — 自動生成 + on-demand 承認

**プラグイン開発者は権限を宣言しない。** 使用している `Ubi.*` API からビルド時に capability を
自動生成し（`build-workers.mjs` の静的解析。情報表示用のマニフェスト）、実際の許可は
**実行時にユーザーが承認**する。ゼロトラストで、信頼境界は Worker→Host の postMessage 一点。

- **危険度ティア**: 🟢 `safe`（常に許可・ユーザーには見せない）/ 🟡 `sensitive`（既定で許可）/
  🔴 `dangerous`（既定で承認必須）。
- **同意モデルは on-demand**: プラグインがその権限を初めて使う瞬間に確認ダイアログを出す
  （ブラウザのカメラ許可風）。決定はユーザー所有ポリシー（localStorage）に記憶され次回から無音。
- **fetch はドメイン単位**: `net:fetch` 自体は capability レベルでは常に通し、実際の通信は
  **接続先ホスト名ごとにユーザー承認**する。ポリシーは普遍的（特定プラグインに依存しない）:
  ① 自プラグインのアセット領域 (pluginBase 配下) は承認不要 /
  ② 自プラグインの公開名前空間 `/plugins/<pluginId>/`（アプリ本体オリジン上・専用バックエンド含む）も承認不要 /
  ③ アプリ本体オリジンのそれ以外（コア `/api`・他プラグイン領域）は**禁止**（本体 API・認証 cookie 保護）/
  ④ それ以外の外部ドメインはドメイン単位で承認。
- **シールドレベル**（設定画面）: なし / 確認（既定・危険のみ確認）/ 厳格な確認（注意も確認）/ 拒否。
- enforcement は単一ゲート。未承認コマンドは拒否（RPC は `CAPABILITY_DENIED`、
  静的モードの未宣言は `CAPABILITY_NOT_DECLARED`）。

各 API が要求する capability と危険度（この表が「メソッド → 必要権限」の正）:

| capability | 危険度 | 要求する API |
|---|---|---|
| `net:fetch` | 🔴 dangerous | `Ubi.fetch`（外部通信。ドメインごとに承認） |
| `scene:update` | 🟡 sensitive | `Ubi.entity().update/destroy/spawn` / `Ubi.entity(id).update/destroy` / `Ubi.entity.spawn` / `Ubi.state.sync` の書き込み全般 |
| `net:broadcast` | 🟡 sensitive | `Ubi.event.broadcast` / `MyEvents.broadcast`（`Ubi.state.sync({ ephemeral: true })` も内部で使用） |
| `net:host-message` | 🟡 sensitive | `Ubi.event.sendToHost` / `MyEvents.sendToHost`（ホストへの片道通知＝自プレイヤー状態更新等） |
| `canvas:draw` | 🟡 sensitive | `Ubi.canvas.*` |
| `video:control` | 🟡 sensitive | `Ubi.media.*` |
| `avatar:set` | 🟡 sensitive | アバター表示の変更 |
| `scene:read` | 🟢 safe | `Ubi.entity.get` / `Ubi.entity.query` |
| `net:emit` | 🟢 safe | `Ubi.event.emit` / `MyEvents.emit`（クロス Worker 配送） |
| `ui:render` | 🟢 safe | `Ubi.ui.render` |
| `ui:toast` | 🟢 safe | `Ubi.ui.showToast` |

> capability カタログ（危険度・コマンド対応・表示情報）の単一の真実の源は
> [`packages/sandbox/src/host/capability.ts`](../packages/sandbox/src/host/capability.ts) の `CAPABILITY_CATALOG`。

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
