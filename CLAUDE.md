# ubichill
Viteベースの完全CSR。URLで起動しSocket.IOで同期する、ゼロトラスト型のmod動的ロード2Dメタバース基盤。webの思想を持ち中央集権を避ける

## コマンド
- `pnpm dev`: 開発サーバー・Docker実行
- `pnpm build:workers`: mods/*/worker を esbuild でバンドル
- `pnpm lint` / `pnpm lint:fix`: Biomeによる確認と自動フォーマット (コミット前に確認必須)

## 開発ガイドライン
- 機能をもとに理想のテストを書くこと
- UIでの絵文字の使用を禁止します。svgを使うことでモダンなUIにして
- 返答・解説・コミットメッセージは日本語で行うこと。褒めるなどは無駄なので批判的に考えること。
- **named exportのみ**。default export、`any`型は禁止。
- 責務分離を徹底し、神クラス/関数を防ぐ。mod開発者には内部構造を隠蔽する。分離するのではなく、層を分けつつまとめること。ハードコードは完全な悪ではない複雑な方が悪
- **スタイリング境界**:
  - Host本体 (`packages/frontend`) は **PandaCSS** のみ使用（`tokens.colors`使用必須、ハードコード禁止）。
- 他のファイルを確認して後方互換性などを全く担保せずに常に新しいロジックを書くこと
- **styleではなくclassName**
- コンポーネント実装では、レイアウトは css()、共通部品は cva() で切り分ける

## SDK・modアーキテクチャ (ゼロトラスト & ECS)
modは `@ubichill/sdk` のみに依存する。Host/本体との直接結合は禁止。

### パッケージ責務
- `@ubichill/ecs`: 純粋なECS計算エンジン (React/DOM/Network依存ゼロ)。
- `@ubichill/shared`: 全レイヤー共有の純粋知識。プロトコル(CommandType)・エラーコード・スキーマに加え、**権限の知識**（`CAPABILITY_CATALOG`・危険度・`permissionPolicy` の純粋関数）もここ。Worker/DOM非依存なので backend/CLI からも参照可。
- `@ubichill/sandbox`: Worker管理・隔離実行環境。権限の**実行時 enforcement**（`capabilityGate`）はここ（カタログ/ポリシーの知識は shared）。
- `@ubichill/react`: Host向けReact Hooks群。
- `@ubichill/ui-renderer`: VNode→DOM 描画・入力収集（host/guest 両側で共用）。
- `@ubichill/frontend`: Host クライアントアプリ本体（UI + Socket/セッション/ルーティング/mod レジストリ）。
- `@ubichill/sdk`: mod開発者向けAPI。

## ubisdkについては`@ubichill/sdk`を確認すること
ubi.uiなどでmodが操作できる

## 関数型プログラミング
- `let`は使わずにピュアファンクションを使って処理
- modで状態管理をubi.stateで行う
- 宣言型で記述できるようにすること
