# ubichill

URLで起動できるワールド(World as Code)に、Socket.IO で同期し、URL 配布型プラグインを動的ロードできる 2D メタバース基盤。

## コマンド

```bash
pnpm dev               # package 内でそれぞれ開発サーバー・docker 実行
pnpm build:workers     # plugins/*/worker を esbuild でバンドル
pnpm lint              # Biome でlintを確認（Windows での直接実行は非推奨）
pnpm lint:fix          # Biome による自動フォーマット（Windows での直接実行は非推奨）
```

## コードスタイル

- **named export のみ**。default export 禁止。
- `any` 型禁止
- Frontend は **PandaCSS**。カスタム CSS を書く場合は `globals.css` のみ。
- アーキテクチャは動作することを重視せずに、クリーンでcoreとuiや繋ぎ込みなどを意識すること。神関数、神クラスの誕生は防いで責務を分離し、特にsdkではプラグイン開発者がubichillの内部構造をあまり知らなくても開発できるようにする

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
- `Ubi.world.createEntity` → `entity.setComponent` → `Ubi.registerSystem(fn)` が基本形。
- Worker は esbuild IIFE バンドル済みの JS 文字列として Sandbox に渡される。

### Host ↔ Guest 通信
- `EVT_LIFECYCLE_INIT` は **キュー非経由**で Worker へ直接 postMessage（キュー経由にすると deadlock）。
- `CMD_READY` 受信後にキューをフラッシュする。`CMD_READY` が来ない = プラグイン初期化失敗。
- `plugin.json` の `capabilities` を `PluginHostManager` に渡すと、未宣言コマンドを RPC エラーで弾く。
