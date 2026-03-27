# ubichill

URLで起動できるワールド(World as Code)に、Socket.IO で同期し、URL 配布型プラグインを動的ロードできる 2D メタバース基盤。

## コマンド

```bash
pnpm dev               # package 内でそれぞれ開発サーバー・docker 実行
pnpm build:workers     # plugins/*/worker を esbuild でバンドル
pnpm lint              # Biome でlintを確認（Windows での直接実行は非推奨）
pnpm lint:fix          # Biome による自動フォーマット（Windows での直接実行は非推奨）
```

## 解説、返答、コミットメッセージ
- ユーザーが理解して開発をできるように日本語で行ってください

## コードスタイル
- mac,linuxの場合`pnpm lint`で確認してそれの指示に従うこと
- **named export のみ**。default export 禁止。
- `any` 型禁止
- Frontend は **PandaCSS**。カスタム CSS を書く場合は `globals.css` のみ。
- アーキテクチャは動作することを重視せずに、クリーンでcoreとuiや繋ぎ込みなどを意識すること。神関数、神クラスの誕生は防いで責務を分離し、特にsdkではプラグイン開発者がubichillの内部構造をあまり知らなくても開発できるようにする

### カラーシステム（PandaCSS）
**方針**: `panda.config.ts` の `tokens` で色を一元管理。ハードコード禁止。

#### トークン構造
```typescript
// panda.config.ts の tokens.colors
primary       // #1b2a44 - ダークネイビー（ボタン、アクセント）
secondary     // #d4c4ab - ベージュ（カード背景）
background    // #faf6f0 - 全体背景
surface       // #f5ecdf - カード/パネル背景
surfaceHover  // #ede4d6 - ホバー時の背景
text          // #1b2a44 - メインテキスト
textMuted     // #5e6a82 - サブテキスト
textSubtle    // #8a7e6d - ヒントテキスト
textOnPrimary // #f8f3ea - primary背景上のテキスト
border        // #cebca2 - ボーダー
borderStrong  // #b0a48e - 強調ボーダー
primaryHover  // #1e3155 - ボタンホバー
primaryActive // #263d68 - ボタンアクティブ
success       // #8ad29b - 成功ステータス
warning       // #f1c86c - 警告ステータス
error         // #c0392b - エラー
```

#### 使用方法
```tsx
// PandaCSS の css() や flex() 内でトークン名を直接指定
const cardStyle = css({
    backgroundColor: 'surface',      // トークン名
    color: 'text',
    borderColor: 'border',
    _hover: { bg: 'surfaceHover' },
});

// ボタン
const buttonStyle = css({
    bg: 'primary',
    color: 'textOnPrimary',
    _hover: { bg: 'primaryHover' },
});
```

#### ❌ 禁止事項
```tsx
// NG: ハードコード
backgroundColor: '#f5ecdf'
color: '#1b2a44'

// OK: トークン使用
backgroundColor: 'surface'
color: 'text'
```

#### 配色変更
全体の配色を変更する場合は `packages/frontend/panda.config.ts` の `tokens.colors` のみを編集する。各コンポーネントは変更不要。

## SDK・ワールドのアーキテクチャ

### パッケージの責務分離
モノレポ内のパッケージは以下の責務を守ること。依存関係の逆転や密結合は許容しない。
- `@ubichill/engine`: 純粋なECS計算エンジン。React・DOM・Worker・Networkを一切知ってはならない。
- `@ubichill/sandbox`: Workerの管理と隔離実行環境。
- `@ubichill/react`: フロントエンド向けのReact Hooks群。
- `@ubichill/sdk`: 外部プラグイン開発者が参照する

### プラグイン依存関係
- `plugins/*` は **`@ubichill/sdk` のみ**依存。`@ubichill/shared` など本体と直接依存禁止。

### プラグイン実行モデル（ECS）
- Worker コードは ECS（Entity / Component / System）で実装する。
- `Ubi.local.createEntity` → `entity.setComponent` → `Ubi.registerSystem(fn)` が基本形。
- Worker は esbuild IIFE バンドル済みの JS 文字列として Sandbox に渡される。

### SDK の名前空間設計
- `Ubi.local.*` — Worker 内だけのプライベート ECS（揮発性・非共有・同期）
  - `Ubi.local.createEntity(id)` / `Ubi.local.getEntity(id)` / `Ubi.local.query(...)`
  - `Ubi.registerSystem(fn)` — `Ubi.local` にシステムを登録するショートカット
- `Ubi.world.*` — インスタンス全体で共有されるエンティティ（全員に見える・DB 永続・async）
  - `Ubi.world.getEntity(id)` / `Ubi.world.createEntity(...)` / `Ubi.world.updateEntity(...)` / `Ubi.world.destroyEntity(id)`
- `Ubi.network.*` — Host・他ユーザーとの通信
  - `Ubi.network.sendToHost(type, data)` — 自分の Host (React) だけに送る
  - `Ubi.network.broadcast(type, data)` — ワールド内全員の Worker に揮発性配信
  - `Ubi.network.fetch(url, options?)` — ホワイトリスト URL への HTTP プロキシ

### Host ↔ Guest 通信
- `EVT_LIFECYCLE_INIT` は **キュー非経由**で Worker へ直接 postMessage（キュー経由にすると deadlock）。
- `CMD_READY` 受信後にキューをフラッシュする。`CMD_READY` が来ない = プラグイン初期化失敗。
- `plugin.json` の `capabilities` を `PluginHostManager` に渡すと、未宣言コマンドを RPC エラーで弾く。

## プラグイン開発ロードマップ

### 現在（Phase 1）— CE ベース
プラグインは2つのファイルで構成される。

| ファイル | 役割 | 実行場所 |
|---|---|---|
| `worker/src/index.ts` | ロジック（ECS） | Sandbox Worker（隔離） |
| `frontend/src/*.tsx` | UI（Custom Element） | メインスレッド（信頼前提） |

CE は `UbiWidget` / `UbiSingleton` を継承して実装する。
ホストとの通信には `ctx.broadcastEphemeral` / `ctx.onBroadcast` を使う（`socket` 直接アクセス禁止）。

### 今後（Phase 2）— Worker 統合 UI
UI も Worker 内で記述し、メインスレッドへのアクセスをなくす。

```
プラグイン（独自 JSX / 軽量 vDOM）
  → Worker 内でレンダリング → UI パッチ命令列
  → postMessage → ホストが実 DOM に適用
```

- プラグイン開発者は Worker 1 ファイルだけ書けば完結する
- DOM・React・Socket の知識は不要
- `Ubi.*` API のみで完結する
- CE (`UbiWidget` / `UbiSingleton`) は段階的に廃止

### URL 配布
プラグインは CDN の URL 1 本で配布する。

```
plugin.json（マニフェスト）
  worker: https://cdn.example.com/myplugin/worker.js   ← サンドボックスで実行
  frontend: https://cdn.example.com/myplugin/ui.js     ← Phase 2 以降は worker のみ
```

`PLUGIN_LOADERS`（registry.ts のハードコード）は将来的に廃止し、ワールド設定の URL から動的ロードする。

### プラグイン開発者が意識すること（現在）
1. `@ubichill/sdk` のみ依存（`@ubichill/shared` など本体への直接依存禁止）
2. Worker コードは ECS で書く（`Ubi.local` / `Ubi.world` / `Ubi.network`）
3. UI は CE で書き、ホストとのやり取りは `ctx.broadcastEphemeral` / `ctx.onBroadcast`
4. `socket` 直接アクセス禁止（`@deprecated`）

## パフォーマンス設計（engine / sandbox レイヤーで完結、プラグイン側は意識不要）

### InputCollector — MOUSE_MOVE O(1) デデュプ
`packages/sandbox/src/host/InputCollector.ts`
- フレーム内で mousemove が何件来ても Worker に届くのは **最終位置 1 件のみ**。
- `_latestMousePos` スロットへ上書きし続けるだけ（配列 push なし）。
- クリック・キーなどの離散イベントは `_discreteEvents[]` に全件保持。
- `flushEvents()` コスト: O(k)、k = 離散イベント数（通常 0〜3）。

### PluginHostManager — rAF バインドレス（GC ゼロ）
`packages/sandbox/src/host/PluginHostManager.ts`
- `_animate`, `_intervalTick`, `_onVisibilityChange` を **arrow function class field** で定義。
- `requestAnimationFrame(this._animate)` のように bind() を毎フレーム呼ばない。
- タブ非アクティブ時は rAF → `setInterval` にフォールバック（`visibilitychange` 監視）。

### EcsWorld — エンティティ配列キャッシュ（dirty flag）
`packages/engine/src/ecs/world.ts`
- `createEntity` / `clear` 時のみ `_cacheIsDirty = true` をセット。
- `tick()` は `_snapshot()` を呼ぶ: dirty でなければ `_entitiesCache` をそのまま返す（O(1)）。
- dirty 時のみ `Array.from(this._entities.values())` を実行してキャッシュを再構築（O(n)）。
- エンティティ数が変わらない限り毎フレームの tick は O(1)。

### useCursorPosition — DOM 直接書き込み（re-render ゼロ）
`packages/react/src/hooks/useCursorPosition.ts`
- カーソル位置更新に React state を使わず、`divRef.current.style.transform` を直接書き換え。
- 60fps でカーソルが動いても React re-render は **0回/秒**。
- 初期表示は `visibility: hidden`、初回 `onCursorUpdate` 呼び出し時に `visible` へ切替。

### useEntity — shallow equality（JSON.stringify 排除）
`packages/react/src/hooks/useEntity.ts`
- `syncState` の重複送信防止を `JSON.stringify` 比較から **shallow equality** へ変更。
- O(k)（k = patch のキー数）で比較でき、文字列シリアライズのアロケーションが不要。
