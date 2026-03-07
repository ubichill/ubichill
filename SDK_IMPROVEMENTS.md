# SDK 設計・改善まとめ

## アーキテクチャ

```
packages/sdk/src/plugin/
├── UbiSDK.ts          — 統合 SDK クラス（Sandbox/Guest 両用）
├── guest.ts           — UbiSDK のシングルトンエクスポート（Worker 外利用）
├── host.ts            — usePluginWorker + PluginHostManager（Host 側）
├── sandbox.worker.ts  — Sandbox Worker（UbiSDK を注入）
├── component.ts       — UbiBehaviour 基底クラス（Unity ライク）
├── fetchHandler.ts    — ホワイトリスト fetch ハンドラ
└── types.ts           — @ubichill/shared 型の再エクスポート
```

### 通信プロトコル

```
Host → Worker:  EVT_LIFECYCLE_INIT（コード実行）, EVT_LIFECYCLE_TICK, EVT_PLAYER_JOINED, ...
Worker → Host:  CMD_READY（初期化完了 ACK）, SCENE_GET_ENTITY（RPC）, CUSTOM_MESSAGE, ...
```

## プラグイン開発ガイド

### Sandbox Worker 内（`pluginCode` 文字列として記述）

プラグインコードには `Ubi`（UbiSDK インスタンス）と `UbiBehaviour`（基底クラス）が自動注入されます。

```js
// シンプルなフラットAPI
Ubi.onTick((dt) => {
    Ubi.scene.updateCursorPosition(x, y);
});

Ubi.onPlayerJoined((player) => {
    Ubi.ui.showToast(`${player.name} が入室しました`);
});

// コンポーネント指向（Unity ライク）
class MyBehaviour extends UbiBehaviour {
    start() {
        Ubi.ui.showToast('started!');
    }
    update(dt) {
        // 毎フレーム処理
    }
    onCustomEvent(type, data) {
        // ホストからのカスタムイベント
    }
}
Ubi.registerBehaviour(new MyBehaviour());
```

### Host 側（React）

```tsx
const { sendEvent } = usePluginWorker({
    pluginCode: myPluginCode,
    worldId,
    myUserId,
    onCommand: (cmd) => {
        if (cmd.type === 'CUSTOM_MESSAGE') {
            handleCustomMessage(cmd.payload.type, cmd.payload.data);
        }
    },
    tickFps: 60,
});

// イベント送信
sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'MOUSE_MOVE', data: { x, y } } });
```

### Host 側（React 不要）

```ts
import { PluginHostManager, createPluginFetchHandler, DEMO_ALLOWED_DOMAINS } from '@ubichill/sdk';

const manager = new PluginHostManager(workerUrl, {
    handlers: {
        onShowToast: (text) => toast(text),
        onGetEntity: (id) => store.getEntity(id),
        onFetch: createPluginFetchHandler(DEMO_ALLOWED_DOMAINS),
    },
    maxExecutionTime: 30_000,
    onResourceLimitExceeded: (reason) => console.error(reason),
});

manager.sendEvent({ type: 'EVT_LIFECYCLE_INIT', payload: { code, worldId, myUserId } });
```

## API リファレンス

### `Ubi.scene`

| メソッド | 説明 |
|---------|------|
| `getEntity(id)` | エンティティを取得（RPC → Promise） |
| `createEntity(entity)` | エンティティを作成（RPC → Promise<id>） |
| `updateEntity(id, patch)` | エンティティを更新（RPC → Promise） |
| `destroyEntity(id)` | エンティティを削除（RPC → Promise） |
| `updateCursorPosition(x, y)` | カーソル位置を更新（Fire & Forget） |

### `Ubi.ui`

| メソッド | 説明 |
|---------|------|
| `showToast(text)` | トースト通知を表示 |

### `Ubi.avatar`

| メソッド | 説明 |
|---------|------|
| `set(appDef)` | アバター（カーソル）設定を更新 |

### `Ubi.net`

| メソッド | 説明 |
|---------|------|
| `fetch(url, options?)` | ホワイトリスト URL に HTTP リクエスト（RPC → Promise） |

### `Ubi.messaging`

| メソッド | 説明 |
|---------|------|
| `send(type, data)` | ホストにカスタムメッセージを送信 |

### ライフサイクルイベント（フラット API）

| メソッド | 説明 |
|---------|------|
| `onTick(cb)` | 毎フレーム（deltaTime: ms）|
| `onPlayerJoined(cb)` | ユーザー入室 |
| `onPlayerLeft(cb)` | ユーザー退室 |
| `onPlayerCursorMoved(cb)` | カーソル移動 |
| `onEntityUpdated(id, cb)` | エンティティ更新（購読も自動開始） |
| `onCustomEvent(cb)` | カスタムイベント受信 |

全メソッドが**購読解除関数**を返します：
```js
const unsub = Ubi.onTick((dt) => { ... });
unsub(); // 購読解除
```

### Fetch ドメインホワイトリスト

```ts
import { PRODUCTION_ALLOWED_DOMAINS, DEMO_ALLOWED_DOMAINS, createPluginFetchHandler } from '@ubichill/sdk';

// 本番用（最小限）: api.github.com, cdn.jsdelivr.net, unpkg.com
createPluginFetchHandler(PRODUCTION_ALLOWED_DOMAINS);

// 開発・デモ用（+ 天気 API, JSONPlaceholder, PokéAPI など）
createPluginFetchHandler(DEMO_ALLOWED_DOMAINS);

// カスタム
createPluginFetchHandler(['api.myservice.com', ...PRODUCTION_ALLOWED_DOMAINS]);
```

## セキュリティ

- **HTTPS のみ**: HTTP リクエストは自動ブロック
- **ドメインホワイトリスト**: 許可ドメインのみアクセス可能
- **グローバル無効化**: `eval`, `Function`, `fetch`, `WebSocket` 等を Sandbox 内でブロック
- **プロトタイプフリーズ**: `Object.prototype`, `Array.prototype` 等をフリーズ

### ⚠ 既知の制限

`new Function()` ベースの Sandbox は完全な隔離ではありません。本番環境では：
1. プラグインコードの事前静的解析
2. コード署名の検証
3. ホワイトリスト化されたプラグインのみ許可

将来の改善候補:
- [ ] QuickJS + WASM によるサンドボックス移行
- [ ] プラグインコードの署名検証
- [ ] より細かい権限管理（オリジン単位）
