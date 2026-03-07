# @ubichill/sdk — API リファレンス

プラグイン開発で使用できるすべての機能の一覧です。
プラグインは **`@ubichill/sdk` のみに依存**し、ここに記載されているAPIを通じて機能を実装してください。

---

## Hooks

### `useSocket()`
WebSocket接続情報と現在のユーザー情報を取得します。

```tsx
const {
    isConnected,      // boolean: サーバーに接続しているか
    currentUser,      // User | null: 自分のユーザー情報
    users,            // Map<string, User>: ルーム内の全ユーザー
    error,            // string | null: 接続エラー
} = useSocket();
```

---

### `useWorld()`
ワールド上のエンティティと操作関数を取得します。

```tsx
const {
    entities,         // Map<string, WorldEntity>: 全エンティティ
    environment,      // WorldEnvironmentData: 背景色・BGMなど
    createEntity,     // (type, transform, data) => Promise<WorldEntity>
    patchEntity,      // (id, patch) => void: 永続的な状態変更
    deleteEntity,     // (id) => void: エンティティ削除
    broadcastEphemeral, // (entityId, data) => void: 揮発的ブロードキャスト
    subscribeEphemeral, // (entityId, cb) => () => void: 揮発データ受信
} = useWorld();
```

---

### `useEntity(entityId)`
特定のエンティティの状態を購読します。

```tsx
const {
    entity,           // WorldEntity<T> | null
    update,           // (patch) => void
    broadcast,        // (data) => void
    ephemeral,        // unknown: 他クライアントからの揮発データ
    isLocked,         // boolean
} = useEntity<T>(entityId);
```

---

### `useObjectInteraction(entityId, type, isLockedByMe, options)`
オブジェクトのロック・解放・所有権管理を行います。

```tsx
const { releaseOthers } = useObjectInteraction(
    entity.id,
    'pen',         // type名
    isLockedByMe,
    {
        hideCursor: true,    // 持っている間カーソルを非表示にする
        singleHold: true,    // 他のものを持っていたら自動で離す
        onAutoRelease: (ent) => { ... }, // 自動解放時のパッチを返す
    }
);
```

---

### `usePluginWorker(options)`
Sandbox Web Worker を起動し、ロジックをメインスレッドから隔離します。

```tsx
const { sendEvent } = usePluginWorker({
    pluginCode: string,           // Worker内で実行するコード（文字列）
    pluginId?: string,            // デバッグ用ID
    onCommand?: (cmd) => void,    // Workerからのコマンドハンドラ
    fps?: number,                 // LIFECYCLE_TICK の送信レート (デフォルト: 60)
    maxExecutionTime?: number,    // 最大実行時間 (ms)
    onResourceLimitExceeded?: (reason) => void,
});

// Worker へイベントを送信する
sendEvent({ type: 'EVT_CUSTOM', payload: { type: 'MY_EVENT', data: ... } });
```

---

## 型定義

### `WorldEntity<T>`
ワールド上のすべてのオブジェクトの基本構造です。

```ts
interface WorldEntity<T = unknown> {
    id: string;
    type: string;           // 'pen:pen', 'stroke', etc.
    ownerId: string;
    lockedBy: string | null;
    transform: {
        x: number;
        y: number;
        z: number;
        rotation: number;
        w: number;
        h: number;
        scale: number;
    };
    data: T;               // プラグイン固有のデータ
}
```

---

### `WidgetDefinition<T>`
プラグインのメタデータ定義です。レジストリに登録する際に使います。

```ts
interface WidgetDefinition<T = unknown> {
    id: string;                        // 'namespace:name' 形式推奨
    name: string;
    icon?: ReactNode;
    defaultSize: { w: number; h: number };
    defaultData: T;
    Component: React.FC<WidgetComponentProps<T>>;
    SingletonComponent?: React.FC;     // オーバーレイUI（任意）
}
```

---

### `WidgetComponentProps<T>`
Widget コンポーネントが受け取る Props の型です。

```ts
interface WidgetComponentProps<T = unknown> {
    entity: WorldEntity<T>;
    isLocked: boolean;
    update: (patch: Partial<WorldEntity<T>>) => void;
    ephemeral?: unknown;
    broadcast?: (data: unknown) => void;
}
```

---

### `User`
ルーム内のユーザー情報です。

```ts
interface User {
    id: string;
    name: string;
    status: UserStatus;        // 'online' | 'away' | 'busy' | 'offline'
    position: CursorPosition;  // { x: number, y: number }
    cursorState: CursorState;
    avatar?: AppAvatarDef;
}
```

---

### その他の型
| 型名 | 説明 |
| :--- | :--- |
| `CursorPosition` | `{ x: number; y: number }` |
| `CursorState` | `'default'`, `'pointer'`, `'grab'` etc. |
| `UserStatus` | `'online' \| 'away' \| 'busy' \| 'offline'` |
| `EntityPatchPayload` | `patchEntity` に渡すパッチの型 |
| `EntityEphemeralPayload` | `broadcastEphemeral` に渡すデータの型 |
| `PluginGuestCommand` | Worker から Host へ送られるコマンドの型 |
| `PluginHostEvent` | Host から Worker へ送られるイベントの型 |

---

## Sandbox Worker (`Ubi.messaging`) API

Worker 内（`pluginCode` 文字列の中）では `Ubi.messaging` でメッセージを送受信します。

```js
// ホストからのイベントを受信
Ubi.messaging.on('CUSTOM_MESSAGE', (command) => {
    // command.type: イベント種別
    // command.data: イベントデータ
});

// ホストへコマンドを送信
Ubi.messaging.send('CUSTOM_MESSAGE', {
    type: 'MY_RESULT',
    data: { ... }
});

// フレームループ (60fpsで自動送信される)
Ubi.messaging.on('LIFECYCLE_TICK', (deltaTime) => {
    // deltaTime: 前フレームからの経過時間 (ms)
});

// 初期化完了イベント
Ubi.messaging.on('LIFECYCLE_INIT', (payload) => {
    // payload.worldId, payload.userId など
});
```

---

## 定数

### `Z_INDEX`
Reactコンポーネントで使用するCSSレイヤー定数です。

```ts
Z_INDEX.WORLD_ITEMS     // ワールド上の通常エンティティ
Z_INDEX.HELD_ITEM       // 自分が保持中のエンティティ
Z_INDEX.OVERLAY         // UIオーバーレイ
Z_INDEX.CURSOR          // カーソル・アバター
```

---

## 使用例（最小構成）

```tsx
import type { WidgetDefinition, WidgetComponentProps } from '@ubichill/sdk';

interface MyData { text: string; }

const MyWidget = ({ entity, update }: WidgetComponentProps<MyData>) => (
    <div onClick={() => update({ data: { text: 'clicked!' } })}>
        {entity.data.text}
    </div>
);

export const myPlugin: WidgetDefinition<MyData> = {
    id: 'my-plugin:widget',
    name: 'My Widget',
    defaultSize: { w: 200, h: 100 },
    defaultData: { text: 'Hello World' },
    Component: MyWidget,
};
```
