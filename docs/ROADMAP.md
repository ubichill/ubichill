# ロードマップ

---

## Ubicrate CLI（`ubi`）

Helm のようにプラグインをパッケージ化し、GitHub Pages 等で公開できるエコシステム基盤。

```
ubi create my-plugin    # プロジェクト雛形生成
ubi build               # Worker + Frontend をバンドル
ubi deploy              # GitHub Pages / 任意ホストへ公開
```

### Phase 1 — 規約・型定義（✅ 完了）

- `plugin.json` スキーマ定義
- `frontend/` + `worker/` ディレクトリ構造の標準化
- `PluginWorkerMessage` 型システム

### Phase 2 — ビルド（✅ 完了）

- `build-workers.mjs`（esbuild）で Worker JS をバンドル
- TypeScript → IIFE 文字列として Sandbox に渡せる形式に変換

### Phase 3 — `ubi create`（次のブランチで実装）

動的プラグイン読み込み対応と同時に実装する。

- プロジェクト雛形生成コマンド
- `package.yaml` スキーマ実装
- GitHub Pages への公開フロー

### Phase 4 — ホットリロード

- Worker コード変更で自動再起動
- Frontend HMR

### Phase 5 — マーケットプレイス

- URL ベースのプラグイン検索・インストール
- バージョン管理・依存解決

---

## 機能ロードマップ

| 機能 | 状態 | 備考 |
|---|---|---|
| ECS プラグインモデル | ✅ 完了 | |
| DOM レンダリング | ✅ 完了 | |
| WebGL レンダリング | 将来 | wallpaper engine 相当の表現 |
| WASM サンドボックス（QuickJS） | 将来 | コスト高のため低優先度 |
| プラグインマーケットプレイス | 将来 | Phase 5 |
