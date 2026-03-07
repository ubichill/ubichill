# Ubichill プラグイン開発ガイド

Ubichillのプラグインアーキテクチャは、「UI（メインスレッド）」と「ロジック（Sandbox Worker）」を明確に分離した設計になっています。状態同期には **UEP (Ubichill Entity Protocol)** をベースに、`@ubichill/sdk` が提供するAPIを利用します。

> [!IMPORTANT]
> **プラグインが依存して良いパッケージは `@ubichill/sdk` のみです。** `@ubichill/shared` など他パッケージへの直接依存は追加しないでください。型定義も含め、プラグインが必要とするものはすべてSDKから提供されます。

---

## ディレクトリ構造（新規約）

```
plugins/my-plugin/
├── plugin.json                       # プラグイン全体のメタデータ
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # エクスポート（Widget定義）
│       ├── definition.tsx            # WidgetDefinition
│       ├── MyWidget.tsx              # UI コンポーネント
│       ├── types.ts                  # フロント側の型定義
│       └── ...
│
└── worker/                           # ロジック層の分離
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                  # Worker のメイン実装
        ├── types.ts                  # Worker↔Host 通信型定義
        └── ...
```

**特徴：**
- **Worker が独立パッケージ化** → TypeScript の型補完が効く
- **通信型が明示的** → `types.ts` で Worker↔Host の互換性をチェック可能
- **CLI（Ubicrate）対応** → 将来的に `plugin.json` から自動ビルド可能

---

## 1. プラグインの種類

### 1-A. Widget プラグイン（エンティティ）
キャンバス（ワールド）上に配置するオブジェクトです。
- **例**: ペンの筆跡、動画プレイヤー、付箋
- **特徴**: `WorldEntity` として同期・永続化されます。

### 1-B. App プラグイン（オーバーレイ / シングルトン）
画面全体に被さる形で1つだけ存在するUI要素です。
- **例**: アバターカーソル、ペントレイ（ツールバー）
- **特徴**: `WidgetDefinition.SingletonComponent` に設定することでワールドに参加している間、自動的に1つだけレンダリングされます。

---

## 2. 開発の基本ステップ

### Step 1: パッケージの作成
`plugins/` ディレクトリ内に新しいフォルダを作成します。

```json
// plugins/my-plugin/plugin.json
{
    "id": "myplugin:widget",
    "name": "My Plugin",
    "version": "1.0.0",
    "entry": {
        "frontend": "./frontend/src/index.ts",
        "worker": "./worker/src/index.ts"
    }
}
```

```json
// plugins/my-plugin/frontend/package.json
{
    "name": "@ubichill/plugin-my-plugin",
    "dependencies": {},
    "peerDependencies": {
        "@ubichill/sdk": "workspace:*"
    }
}
```

```json
// plugins/my-plugin/worker/package.json
{
    "name": "@ubichill/plugin-my-plugin-worker",
    "dependencies": {},
    "peerDependencies": {
        "@ubichill/sdk": "workspace:*"
    }
}
```

### Step 2: Worker の通信型定義

Worker ↔ Host で送受信するメッセージの型を定義します：

```typescript
// plugins/my-plugin/worker/src/types.ts
import type {
    PluginHostMessage,
    PluginMessagingSchema,
    PluginWorkerMessage,
} from '@ubichill/sdk';

// Worker が Host へ送信するメッセージ
export type MyWorkerMessage = PluginWorkerMessage<
    'MY_EVENT_A' | 'MY_EVENT_B',
    {
        MY_EVENT_A: { data: string };
        MY_EVENT_B: { count: number };
    }
>;

// Host が Worker へ送信するメッセージ
export type MyHostMessage = PluginHostMessage<
    'HOST_EVENT_1',
    {
        HOST_EVENT_1: { param: string };
    }
>;

// スキーマ統合
export type MyMessagingSchema = PluginMessagingSchema<MyWorkerMessage, MyHostMessage>;
```

### Step 3: Worker の実装（ECS）

Worker ロジックは **Component**（データ）と **System**（ロジック）に分離します。

```typescript
// plugins/my-plugin/worker/src/components.ts
import type { ComponentDefinition } from '@ubichill/sdk';

export interface TransformData { x: number; y: number; }
export const Transform: ComponentDefinition<TransformData> = {
    name: 'Transform' as const,
    default: { x: 0, y: 0 },
};
```

```typescript
// plugins/my-plugin/worker/src/systems/MySystem.ts
import type { System, Entity, WorkerEvent } from '@ubichill/sdk';
import { Transform } from '../components';
import type { TransformData } from '../components';

declare const Ubi: any;

export const MySystem: System = (entities: Entity[], dt: number, events: WorkerEvent[]) => {
    // Host からのカスタムイベントを処理
    for (const event of events) {
        if (event.type === 'HOST_EVENT_1') {
            const { param } = event.payload as { param: string };
            Ubi.messaging.send('MY_EVENT_A', { data: param });
        }
    }

    // Transform を持つ Entity を毎フレーム処理
    for (const entity of entities) {
        const transform = entity.getComponent<TransformData>(Transform.name);
        if (transform) {
            // ロジック処理
        }
    }
};
```

```typescript
// plugins/my-plugin/worker/src/index.ts
import { MySystem } from './systems/MySystem';
import { Transform } from './components';

declare const Ubi: any;

if (typeof Ubi !== 'undefined') {
    // Entity を作成してコンポーネントを付与
    const entity = Ubi.world.createEntity('my-entity-1');
    entity.setComponent(Transform.name, { ...Transform.default });

    // System を登録（毎フレーム実行される）
    Ubi.world.registerSystem(MySystem);
}

export type { MyHostMessage, MyMessagingSchema, MyWorkerMessage } from './types';
```

### Step 4: `WidgetDefinition` の定義

```tsx
// plugins/my-plugin/frontend/src/definition.tsx
import type { WidgetDefinition } from '@ubichill/sdk';
import { MyWidget } from './MyWidget';
import { MyTray } from './MyTray';

export interface MyPluginData {
    label: string;
    color: string;
}

export interface MyPluginEphemeral {
    cursorPos: { x: number; y: number };
}

export const myPluginDefinition: WidgetDefinition<MyPluginData, MyPluginEphemeral> = {
    id: 'myplugin:widget',
    name: 'My Plugin',
    defaultSize: { w: 200, h: 100 },
    defaultData: { label: 'Hello', color: '#ff0000' },
    Component: MyWidget,
    SingletonComponent: MyTray,
    configPath: '../plugin.json', // CLI用
};
```

### Step 5: Widget コンポーネントの実装

```tsx
// plugins/my-plugin/frontend/src/MyWidget.tsx
import type { WidgetComponentProps } from '@ubichill/sdk';
import { useState } from 'react';
import type { MyPluginData, MyPluginEphemeral } from './definition';

export const MyWidget: React.FC<WidgetComponentProps<MyPluginData, MyPluginEphemeral>> = ({
    entity,
    update,
    broadcast,
    ephemeral,
    isLocked,
}) => {
    const { data } = entity;

    const handleColorChange = (color: string) => {
        // 永続状態を更新（全ユーザーに同期・保存）
        update({ data: { ...data, color } });
    };

    const handleMouseMove = (x: number, y: number) => {
        // リアルタイム同期（保存なし）
        broadcast?.({ cursorPos: { x, y } });
    };

    return (
        <div style={{ backgroundColor: data.color, padding: 16 }}>
            <p>{data.label}</p>
            {ephemeral?.cursorPos && (
                <span>Other user at: ({ephemeral.cursorPos.x}, {ephemeral.cursorPos.y})</span>
            )}
            <button onClick={() => handleColorChange('#00ff00')}>
                Change Color
            </button>
        </div>
    );
};
```

---

## 3. Worker とのメッセージング

### Host → Worker イベント

Host からのイベントは、Worker の System の `events` 引数で受信します：

```tsx
// Frontend（Host側）
const { sendEvent } = usePluginWorker({
    pluginCode: workerCode,
    onCommand: (cmd) => {
        if (cmd.type === 'CUSTOM_MESSAGE' && cmd.payload.type === 'MY_EVENT_A') {
            console.log('Received:', cmd.payload.data);
        }
    },
});

// Worker へイベント送信
sendEvent({
    type: 'EVT_CUSTOM',
    payload: {
        eventType: 'HOST_EVENT_1',
        data: { param: 'test' },
    },
});
```

```typescript
// Worker（System側）
export const MySystem: System = (entities, dt, events) => {
    for (const event of events) {
        if (event.type === 'HOST_EVENT_1') {
            const { param } = event.payload as { param: string };
            // 処理...
            Ubi.messaging.send('MY_EVENT_A', { data: param });
        }
    }
};
```

### リアルタイム入力（マウス等）

```tsx
// Frontend
const handleMouseMove = (e: React.MouseEvent) => {
    sendEvent({
        type: 'EVT_CUSTOM',
        payload: {
            eventType: 'MOUSE_MOVE',
            data: { x: e.clientX, y: e.clientY, buttons: e.buttons },
        },
    });
};
```

```typescript
// Worker System
export const InputSystem: System = (entities, dt, events) => {
    for (const event of events) {
        if (event.type === 'MOUSE_MOVE') {
            const { x, y, buttons } = event.payload as { x: number; y: number; buttons: number };
            // Component に書き込み → 次フレームで SyncSystem が同期
            for (const entity of entities) {
                const transform = entity.getComponent<TransformData>('Transform');
                if (transform) {
                    transform.x = x;
                    transform.y = y;
                }
            }
        }
    }
};
```

---

## 4. Widget の登録（現在の方法）

> [!NOTE]
> **将来的な仕様変更予定:** 現在は `packages/frontend/src/plugins/registry.ts` への手動登録が必要ですが、今後はワールド定義ファイル（YAML等）に必要なプラグインを列挙するだけで、ワールド読み込み時に動的にプラグインがインポートされる仕組みに移行する予定です。

現時点での登録方法:

```ts
// packages/frontend/src/plugins/registry.ts
import { myPluginDefinition } from '@ubichill/plugin-my-plugin';

export const INSTALLED_PLUGINS = [
    // ...
    myPluginDefinition,
];
```

---

## 5. UEP 通信のベストプラクティス

| API | 性質 | 利用シーン |
| :--- | :--- | :--- |
| `update(patch)` | 永続的・信頼性あり | 色・タイトル変更、移動完了時の位置確定 |
| `broadcast(data)` | 揮発的・リアルタイム | ドラッグ中の座標、描画中の軌跡 |
| `ephemeral` (受信) | 揮発的・他者からの受信 | 他ユーザーのリアルタイム状態を描画する |

*詳細なプロトコル仕様については [UEP.md](./UEP.md) を参照してください。*

---

## 6. 実装例：Pen プラグイン

プロジェクト内の `plugins/pen/` を参照してください。

- **frontend/src/**: React コンポーネント
- **worker/src/**: ロジック実装（独立）
- **plugin.json**: プラグイン設定

型安全なメッセージング、Worker の独立化の実装例になっています。

---

## 7. 設計原則

1. **`@ubichill/sdk` 以外に依存しない** — 型も含め、必要なものはすべてSDKからインポートします。
2. **React コンポーネントは純粋な描画に徹する** — マウスイベントのループ処理や計算は Worker（ECS System）へ。
3. **volatile 通信を適切にスロットリングする** — `broadcast` の呼び出し頻度は 30ms（33Hz）程度を上限として制限し、ネットワーク詰まりを防ぎましょう。
4. **Component はデータのみ** — System がロジックを持つ。Component にメソッドや副作用を持ち込まない。
