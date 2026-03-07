# プラグインシステム アーキテクチャ

プラグインロジックは **Sandbox Worker** 内で ECS (Entity Component System) として動作し、
UI レンダリングのみをメインスレッド（React）が担う。

## 全体構成

```
┌────────────────────────────────────────┐
│         フロントエンド (Host)            │
│                                        │
│  React コンポーネント（UI のみ）          │
│    └─ usePluginWorker()                │
│         └─ PluginHostManager           │
│               │                        │
│         postMessage ↕                  │
│               │                        │
│  ┌────────────▼───────────────────┐    │
│  │   Sandbox Worker (Guest)       │    │
│  │                                │    │
│  │  sandbox.worker.ts             │    │
│  │  ├─ セキュリティ設定             │    │
│  │  ├─ コード評価 (SafeFunction)   │    │
│  │  └─ UbiSDK._dispatchEvent()    │    │
│  │                                │    │
│  │  UbiSDK (Ubi)                  │    │
│  │  ├─ registerSystem()           │    │
│  │  ├─ world (EcsWorld)           │    │
│  │  ├─ scene / ui / avatar / net  │    │
│  │  └─ messaging.send()           │    │
│  └────────────────────────────────┘    │
└────────────────────────────────────────┘
```

---

## 初期化フロー

```
Host                                   Worker
 │                                       │
 ├─ new Worker(sandbox.worker.ts)        │
 │                                       │
 ├─ postMessage(EVT_LIFECYCLE_INIT) ────►│
 │   { code, worldId, myUserId }         │
 │                                       ├─ checkDangerousPatterns(code)
 │                                       ├─ new SafeFunction('Ubi', ...)(Ubi)
 │                                       ├─ プラグインコード実行
 │                                       │
 │◄───────────────────── CMD_READY ──────┤
 │                                       │
 ├─ eventQueue をフラッシュ               │
 └─ 以降 sendEvent() は直接 postMessage  │
```

CMD_READY 受信前に溜まった EVT_LIFECYCLE_TICK 等は Host 側 eventQueue に積まれ、
初期化完了後にまとめて送信される。失敗時は CMD_READY が来ないのでキューはそのまま。

---

## メッセージプロトコル

### Guest → Host (`PluginGuestCommand`)

| type | 分類 | 用途 |
|------|------|------|
| `CMD_READY` | Fire & Forget | 初期化完了通知 |
| `SCENE_GET_ENTITY` | **RPC** | エンティティ取得 |
| `SCENE_CREATE_ENTITY` | **RPC** | エンティティ作成 |
| `SCENE_UPDATE_ENTITY` | **RPC** | エンティティ更新（部分） |
| `SCENE_DESTROY_ENTITY` | **RPC** | エンティティ削除 |
| `SCENE_SUBSCRIBE_ENTITY` | Fire & Forget | 更新通知の購読開始 |
| `SCENE_UNSUBSCRIBE_ENTITY` | Fire & Forget | 購読解除 |
| `SCENE_UPDATE_CURSOR` | Fire & Forget | カーソル位置（高頻度） |
| `UI_SHOW_TOAST` | Fire & Forget | トースト通知 |
| `AVATAR_SET` | Fire & Forget | アバター設定 |
| `NET_FETCH` | **RPC** | HTTP リクエスト（ホワイトリスト） |
| `CUSTOM_MESSAGE` | Fire & Forget | プラグイン独自メッセージ（`Ubi.messaging.send` 経由） |

**RPC**: `id` フィールド付き。Host は `EVT_RPC_RESPONSE` で結果を返す（タイムアウト 10s）。
**Fire & Forget**: `id` なし。結果を待たない高頻度 or 通知系。

### Host → Guest (`PluginHostEvent`)

| type | 用途 |
|------|------|
| `EVT_LIFECYCLE_INIT` | 初期化（code, worldId, myUserId） |
| `EVT_LIFECYCLE_TICK` | フレーム更新（deltaTime ms） |
| `EVT_PLAYER_JOINED` | ユーザー入室 |
| `EVT_PLAYER_LEFT` | ユーザー退室 |
| `EVT_PLAYER_CURSOR_MOVED` | カーソル移動 |
| `EVT_SCENE_ENTITY_UPDATED` | 購読中エンティティ更新 |
| `EVT_RPC_RESPONSE` | RPC 応答 |
| `EVT_CUSTOM` | プラグイン独自イベント（`sendEvent` 経由） |

---

## Worker 内 API（プラグインコードで使用）

Worker 内では `Ubi`（UbiSDK インスタンス）が自動注入される。すべてのロジックは ECS System で実装する。

### ECS

```ts
// System 登録（毎フレーム実行）
Ubi.registerSystem((entities: Entity[], dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type === EcsEventType.PLAYER_JOINED) { ... }
        if (event.type === 'MOUSE_MOVE') { ... }  // EVT_CUSTOM 由来
    }
    for (const entity of entities) {
        const pos = entity.getComponent<PositionData>('Position');
        if (pos) entity.setComponent('Position', { x: pos.x + 1, y: pos.y });
    }
});

// Entity・Component 操作
const entity = Ubi.world.createEntity('my-entity');
entity.setComponent('Position', { x: 0, y: 0 });
const query = Ubi.world.query(['Position', 'Velocity']);
```

EcsEventType 定数（`@ubichill/sdk` からインポート可能）:

| 定数 | 値 | 用途 |
|------|----|------|
| `EcsEventType.PLAYER_JOINED` | `'player:joined'` | 入室ユーザー情報 |
| `EcsEventType.PLAYER_LEFT` | `'player:left'` | 退室ユーザー ID |
| `EcsEventType.PLAYER_CURSOR_MOVED` | `'player:cursor_moved'` | `{ userId, position }` |
| `EcsEventType.ENTITY_UPDATED` | `'entity:updated'` | 購読エンティティの更新 |

プラグイン固有の入力イベント（`EVT_CUSTOM` 由来）は `event.type` に `eventType` 文字列が入る。

### scene

```ts
Ubi.scene.getEntity(id)                 // Promise<WorldEntity | null>  ← RPC
Ubi.scene.createEntity(entity)          // Promise<string>              ← RPC（ID を返す）
Ubi.scene.updateEntity(id, patch)       // Promise<void>                ← RPC
Ubi.scene.destroyEntity(id)             // Promise<void>                ← RPC
Ubi.scene.updateCursorPosition(x, y)   // void                         ← Fire & Forget（毎フレーム OK）
Ubi.scene.subscribeEntity(id)          // void — 更新を ENTITY_UPDATED として受け取る
Ubi.scene.unsubscribeEntity(id)        // void
```

### その他

```ts
Ubi.ui.showToast(text)                   // トースト表示
Ubi.avatar.set(appDef)                   // アバター設定
Ubi.net.fetch(url, options?)             // Promise<FetchResult>  ← ホワイトリスト検証済み
Ubi.messaging.send(type, payload)        // Host の onMessage に届く（型安全）
```

---

## Host 側インターフェース

### HostHandlers

```ts
type HostHandlers<TMsg extends PluginWorkerMessage = PluginWorkerMessage> = {
    onMessage?: (msg: TMsg) => void;       // Worker からの型付きメッセージ
    onUpdateCursor?: (x: number, y: number) => void;
    onShowToast?: (text: string) => void;
    onGetEntity?: (id: string) => WorldEntity | undefined;
    onCreateEntity?: (entity: Omit<WorldEntity, 'id'>) => Promise<WorldEntity>;
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    onDestroyEntity?: (id: string) => Promise<void>;
    onSetAvatar?: (appDef: AppAvatarDef) => void;
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
};
```

### PluginHostManager（React 非依存）

Worker ライフサイクル・TICK ループ・メッセージ処理を管理するコアクラス。

```ts
const manager = new PluginHostManager<MyWorkerMessage>({
    pluginCode,
    pluginId: entity.id,
    handlers: {
        onMessage: (msg) => { /* msg は MyWorkerMessage 型 */ },
        onUpdateCursor: (x, y) => { ... },
    },
});
manager.sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'MOUSE_DOWN', data: { x, y } } });
manager.destroy();
```

TICK ループ: rAF でアクティブなタブは高精度タイミング、タブ非アクティブ時は setInterval にフォールバック。

### usePluginWorker（React ラッパー）

`PluginHostManager` を React ライフサイクルで管理する薄いラッパー。
`pluginCode` / `pluginId` が変わると Worker を再起動する。handlers はレンダーごとに ref 経由で最新版を使う（Worker は再起動しない）。

```ts
const { sendEvent } = usePluginWorker<MyWorkerMessage>({
    pluginCode,
    pluginId: entityId,
    handlers: {
        onMessage: (msg) => { ... },
        onUpdateCursor: (x, y) => { ... },
    },
    tickFps: 60,           // デフォルト 60。0 = TICK 無効
    disableAutoTick: false,
    maxExecutionTime: 30_000,
    onResourceLimitExceeded: (reason) => { ... },
});
```

---

## 型安全メッセージング

Worker → Host のカスタムメッセージを型で定義する。

```ts
// plugins/my-plugin/worker/src/types.ts
import type { PluginWorkerMessage } from '@ubichill/sdk';

export type MyWorkerMessage = PluginWorkerMessage<
    'MY_EVENT_A' | 'MY_EVENT_B',
    {
        MY_EVENT_A: { data: string };
        MY_EVENT_B: { count: number };
    }
>;
```

```ts
// Worker 内
Ubi.messaging.send('MY_EVENT_A', { data: 'hello' });

// Host 側
usePluginWorker<MyWorkerMessage>({
    handlers: {
        onMessage: (msg) => {
            if (msg.type === 'MY_EVENT_A') console.log(msg.payload.data); // 型安全
        },
    },
});
```

---

## プラグインのディレクトリ構造

```
plugins/my-plugin/
├── plugin.json                    # メタデータ（id, name, version）
├── frontend/
│   └── src/
│       ├── index.ts               # エクスポート（WidgetDefinition）
│       ├── definition.tsx         # WidgetDefinition
│       ├── MyWidget.tsx           # UI コンポーネント（描画のみ）
│       └── MyWorker.tsx           # usePluginWorker ラッパー（null を返す）
└── worker/
    └── src/
        ├── index.ts               # エントリ（Ubi.registerSystem 呼び出し）
        ├── types.ts               # PluginWorkerMessage 型定義
        └── systems/               # ECS System 群
```

**ルール**:
- `frontend/` は React / UI のみ。計算ロジック・イベントループは Worker へ。
- `worker/` は `@ubichill/sdk` のみに依存。`@ubichill/shared` に直接依存しない。
- `WidgetComponentProps<T>` を Widget コンポーネントの Props 型に使う。

---

## 永続 vs 揮発の使い分け

| API | 性質 | 用途 |
|-----|------|------|
| `update(patch)` | 永続・サーバー同期 | 色変更、移動確定 |
| `broadcast(data)` | 揮発・リアルタイム | ドラッグ中座標、描画中軌跡 |
| `ephemeral`（受信）| 揮発・他者から | 他ユーザーのリアルタイム状態 |

`broadcast` は 30ms（33Hz）を目安にスロットリングすること。

---

## セキュリティレイヤー（sandbox.worker.ts）

1. **グローバル無効化**: `fetch`, `WebSocket`, `eval`, `Function`, `importScripts` 等を `undefined` に書き換え
2. **プロトタイプ凍結**: `Object.freeze(Object.prototype)` 等でプロトタイプチェーン操作をブロック
3. **postMessage 直接呼び出し禁止**: `self.postMessage` を警告のみの関数に差し替え（実際の送信は内部の `securePostMessage` のみ）
4. **危険パターン検出**: `importScripts`, `eval(`, `Function(`, `constructor(`, `__proto__`, `prototype[` を正規表現でチェック
5. **コード評価**: `new SafeFunction()` で `"use strict"` + try/catch ラップして実行

> `SafeFunction` は `nullifyGlobals()` の前に `const SafeFunction = Function` として保存する。Worker 内での唯一の `new Function()` 使用箇所。

**本番環境での追加対策（現状未実装）**: 静的解析、コード署名検証、ホワイトリスト化、CSP、QuickJS + WASM サンドボックスへの移行。

---

## 動的プラグイン読み込みの準備状況

**現状**: プラグインコードは文字列として `pluginCode` に渡す（ビルド時に埋め込み）。

**動的読み込みに必要なこと**（実装不要、設計メモ）:
- プラグインコード配信 CDN または Plugin Registry API
- コード署名・ハッシュ検証（改ざん防止）
- ドメインホワイトリストの動的設定（`createPluginFetchHandler(allowedDomains)` は既に対応済み）

**プラグイン登録の動的化**:
[packages/frontend/src/plugins/registry.ts](../packages/frontend/src/plugins/registry.ts) の静的 `INSTALLED_PLUGINS` 配列を動的 Map に置き換えるだけでよい。ランタイムは既に対応済み。
