# ubichill
Viteベースの完全CSR。URLで起動しSocket.IOで同期する、ゼロトラスト型のプラグイン動的ロード2Dメタバース基盤。

## コマンド
- `pnpm dev`: 開発サーバー・Docker実行
- `pnpm build:workers`: plugins/*/worker を esbuild でバンドル
- `pnpm lint` / `pnpm lint:fix`: Biomeによる確認と自動フォーマット (コミット前に確認必須)

## 開発ガイドライン
- UIでの絵文字の使用を禁止します。svgを使うことでモダンなUIにして
- 返答・解説・コミットメッセージは日本語で行うこと。
- **named exportのみ**。default export、`any`型は禁止。
- 責務分離を徹底し、神クラス/関数を防ぐ。プラグイン開発者には内部構造を隠蔽する。
- **スタイリング境界**:
  - Host本体 (`packages/frontend`) は **PandaCSS** のみ使用（`tokens.colors`使用必須、ハードコード禁止）。
- 他のファイルを確認して後方互換性などを全く担保せずに常に新しいロジックを書くこと

## SDK・プラグインアーキテクチャ (ゼロトラスト & ECS)
プラグインは `@ubichill/sdk` のみに依存する。Host/本体との直接結合は禁止。

### パッケージ責務
- `@ubichill/engine`: 純粋なECS計算エンジン (React/DOM/Network依存ゼロ)。
- `@ubichill/sandbox`: Worker管理・隔離実行環境。
- `@ubichill/react`: Host向けReact Hooks群。
- `@ubichill/sdk`: プラグイン開発者向けAPI。

## ubisdkについては`@ubichill/sdk`を確認すること
ubi.uiなどでプラグインが操作できる

## 関数型プログラミング
- `let`は使わずにピュアファンクションを使って処理
- プラグインで状態管理をubi.stateで行う
- 宣言型で記述できるようにすること