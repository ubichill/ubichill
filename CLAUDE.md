# ubichill
Viteベースの完全CSR。URLで起動しSocket.IOで同期する、ゼロトラスト型のプラグイン動的ロード2Dメタバース基盤。

## コマンド
- `pnpm dev`: 開発サーバー・Docker実行
- `pnpm build:workers`: plugins/*/worker を esbuild でバンドル
- `pnpm lint` / `pnpm lint:fix`: Biomeによる確認と自動フォーマット (Win直接実行非推奨・コミット前に確認必須)

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

### プラグインUIの2大原則 (メインスレッドでのJS実行厳禁)
1. **静的UI (宣言的HTML)**: パネル等はWorkerからHTML(JSX)文字列を送信。Hostはサニタイズして表示。クリック処理は `ubi-action="ID"` 属性を用いてHostからWorkerへイベント文字列を委譲する。
2. **リッチUI (OffscreenCanvas)**: ペンや3D描画等は、Hostが `transferControlToOffscreen()` で生成したCanvas権限をWorkerへ渡し、Worker内で直接描画処理を行う。

### パッケージ責務
- `@ubichill/engine`: 純粋なECS計算エンジン (React/DOM/Network依存ゼロ)。
- `@ubichill/sandbox`: Worker管理・隔離実行環境。
- `@ubichill/react`: Host向けReact Hooks群。
- `@ubichill/sdk`: プラグイン開発者向けAPI。

### SDK 名前空間設計
- `Ubi.local.*`: Worker内ローカルECS (揮発性・同期)。
- `Ubi.world.*`: ワールド共有ECS (DB永続・非同期)。
- `Ubi.network.*`: 通信 (Hostへの送信、全体ブロードキャスト、外部Fetch)。
- `Ubi.ui.*`: UI操作 (HTML文字列の送信、`ubi-action`イベントの受信)。
