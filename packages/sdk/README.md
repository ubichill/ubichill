# @ubichill/sdk

Ubichill Plugin SDK - プラグイン開発のための公式 SDK

## 概要

`@ubichill/sdk` は、Ubichill プラグインを開発するための統合された SDK です。hooks、型定義、ユーティリティなど、プラグイン開発に必要なすべての機能を提供します。

## インストール

```bash
pnpm add @ubichill/sdk
```

## 主な機能

### Hooks

- **`useWorld()`** - ワールド全体の状態管理
- **`useSocket()`** - Socket.IO 接続管理
- **`useEntity(entityId, options?)`** - 特定のエンティティの操作
- **`useObjectInteraction()`** - オブジェクトとのインタラクション管理

### Providers

- **`WorldProvider`** - ワールドコンテキストを提供
- **`SocketProvider`** - ソケット接続を提供

### 型定義

- **`WidgetDefinition<T>`** - プラグインウィジェットの定義
- **`WorldEntity<T>`** - エンティティの型
- **`User`** - ユーザーの型
- その他の共有型

### 定数

- **`Z_INDEX`** - UI レイヤーの z-index 値

## 使用例

### 基本的なプラグインの作成

```typescript
import { 
  useWorld, 
  useSocket, 
  useEntity,
  Z_INDEX,
  type WidgetDefinition 
} from '@ubichill/sdk';

// ウィジェットコンポーネント
const MyWidget: React.FC<WidgetProps> = ({ entity, update }) => {
  const { currentUser } = useSocket();
  
  return (
    <div style={{ zIndex: Z_INDEX.WIDGET_BASE }}>
      {/* ウィジェットの UI */}
    </div>
  );
};

// プラグイン定義
export const myPluginDefinition: WidgetDefinition = {
  id: 'my:plugin',
  name: 'My Plugin',
  icon: <MyIcon />,
  defaultSize: { w: 200, h: 200 },
  defaultData: {},
  Component: MyWidget,
};
```

### SingletonComponent の使用

```typescript
// トレイなどのシングルトン UI
const MyTray: React.FC = () => {
  const { currentUser } = useSocket();
  const { entities } = useWorld();
  
  return (
    <div style={{ zIndex: Z_INDEX.UI_TRAY }}>
      {/* トレイの UI */}
    </div>
  );
};

export const myPluginDefinition: WidgetDefinition = {
  // ... 他の設定
  Component: MyWidget,
  SingletonComponent: MyTray, // 自動的にレンダリングされます
};
```

### エンティティの操作

```typescript
const MyComponent = () => {
  const { createEntity, patchEntity, deleteEntity } = useWorld();
  
  // エンティティの作成
  const handleCreate = async () => {
    const entity = await createEntity('my:type', 
      { x: 100, y: 100, width: 200, height: 200, rotation: 0 },
      { customData: 'value' }
    );
  };
  
  // エンティティの更新
  const handleUpdate = () => {
    patchEntity(entityId, {
      transform: { x: 150, y: 150 }
    });
  };
  
  // エンティティの削除
  const handleDelete = () => {
    deleteEntity(entityId);
  };
};
```

### リアルタイム同期

```typescript
const MyWidget = ({ entity }) => {
  const { syncState, syncStream } = useEntity(entity.id);
  
  // 状態を同期（Reliable）
  const handleMove = (x: number, y: number) => {
    syncState({
      transform: { x, y }
    });
  };
  
  // ストリームデータを送信（Volatile、間引き付き）
  const handleDraw = (data: DrawingData) => {
    syncStream(data);
  };
};
```

## プラグイン開発ガイド

### 1. プラグインプロジェクトの作成

```bash
mkdir plugins/my-plugin
cd plugins/my-plugin
mkdir frontend
cd frontend
pnpm init
```

### 2. package.json の設定

```json
{
  "name": "@ubichill/plugin-my-plugin",
  "version": "1.0.0",
  "main": "src/index.ts",
  "peerDependencies": {
    "@ubichill/sdk": "workspace:*",
    "@ubichill/shared": "workspace:*",
    "react": "^19.0.0"
  }
}
```

### 3. WidgetDefinition の実装

```typescript
// src/definition.tsx
import type { WidgetDefinition } from '@ubichill/sdk';
import { MyWidget } from './MyWidget';

export const myPluginDefinition: WidgetDefinition = {
  id: 'my:plugin',
  name: 'My Plugin',
  icon: <MyIcon />,
  defaultSize: { w: 200, h: 200 },
  defaultData: {},
  Component: MyWidget,
};
```

### 4. エクスポート

```typescript
// src/index.ts
export { myPluginDefinition } from './definition';
export { MyWidget } from './MyWidget';
```

### 5. プラグインの登録

```typescript
// packages/frontend/src/plugins/registry.ts
import { myPluginDefinition } from '@ubichill/plugin-my-plugin';

export const INSTALLED_PLUGINS = [
  // ...既存のプラグイン
  myPluginDefinition,
];
```

## API リファレンス

詳細な API ドキュメントは [SDK.md](../../frontend/src/plugins/SDK.md) を参照してください。

## ライセンス

MIT
