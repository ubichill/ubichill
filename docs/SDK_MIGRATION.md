# Ubichill SDK Migration Guide

## 概要

`@ubichill/sdk` パッケージを作成し、プラグイン開発をより簡単にしました。

## 変更内容

### 1. 新しいパッケージ: `@ubichill/sdk`

独立した SDK パッケージを `packages/sdk/` に作成しました。以下を含みます：

- **Hooks**: `useWorld`, `useSocket`, `useEntity`, `useObjectInteraction`
- **Providers**: `WorldProvider`, `SocketProvider`
- **Types**: `WidgetDefinition`, `WorldEntity`, `User`, など
- **Constants**: `Z_INDEX`

### 2. プラグインの更新

すべてのプラグインが `@ubichill/sdk` から直接インポートするようになりました：

**Before:**
```typescript
import { useWorld } from '../../../../packages/frontend/src/core/hooks/useEntity';
import { useSocket } from '../../../../packages/frontend/src/core/hooks/useSocket';
import { Z_INDEX } from '../../../../packages/frontend/src/styles/layers';
```

**After:**
```typescript
import { useWorld, useSocket, Z_INDEX } from '@ubichill/sdk';
```

### 3. Frontend の更新

Frontend も `@ubichill/sdk` を使用するようになりました。既存の `core/` ディレクトリのファイルは後方互換性のために残されており、SDK から再エクスポートしています。

### 4. SingletonComponent の自動レンダリング

`WidgetDefinition` に `SingletonComponent` を追加すると、`UbichillOverlay` で自動的にレンダリングされるようになりました。これにより、プラグイン固有の UI を `UbichillOverlay` に直接書く必要がなくなりました。

**Example:**
```typescript
export const penWidgetDefinition: WidgetDefinition<PenData> = {
  id: 'pen:pen',
  name: 'Pen',
  // ...
  Component: PenWidget,
  SingletonComponent: PenTray, // 自動的にレンダリング
};
```

## 利点

1. **シンプルなインポート**: 長い相対パスではなく `@ubichill/sdk` から直接インポート
2. **明確な API**: プラグイン開発に必要なすべてが1つのパッケージに
3. **バージョン管理**: SDK を独立してバージョン管理可能
4. **ドキュメント**: SDK 専用の README とドキュメント
5. **拡張性**: 新しい機能を SDK に追加しやすい

## マイグレーションパス

### 既存のプラグインを更新する場合

1. `package.json` に `@ubichill/sdk` を追加:
```json
{
  "peerDependencies": {
    "@ubichill/sdk": "workspace:*"
  }
}
```

2. インポートを更新:
```typescript
// Old
import { useWorld } from '../../../../packages/frontend/src/core/hooks/useEntity';

// New
import { useWorld } from '@ubichill/sdk';
```

3. TypeScript 設定を更新:
```jsonc
{
  "compilerOptions": {
    "paths": {
      "@ubichill/sdk": ["../../../packages/sdk/src/index.ts"]
    }
  }
}
```

### 新しいプラグインを作成する場合

[packages/sdk/README.md](../sdk/README.md) のプラグイン開発ガイドを参照してください。

## 構造

```
packages/
  sdk/
    src/
      index.ts              # メインエクスポート
      types.ts              # 型定義
      constants.ts          # 定数
      hooks/
        useWorld.tsx        # World hook
        useSocket.tsx       # Socket hook
        useEntity.ts        # Entity hook
        useObjectInteraction.ts  # Interaction hook
    package.json
    tsconfig.json
    README.md
```

## 次のステップ

- [ ] SDK のドキュメントをさらに充実させる
- [ ] SDK にテストを追加
- [ ] SDK のバージョニング戦略を決定
- [ ] 他の共通機能を SDK に追加（例: カーソル管理、レンダリングユーティリティなど）

## 参考資料

- [SDK README](../sdk/README.md) - SDK の使い方
- [SDK.md](../frontend/src/plugins/SDK.md) - 詳細な API リファレンス
