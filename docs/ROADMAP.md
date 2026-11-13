# ロードマップ

---

## `ubichill` CLI

mod をパッケージ化し、GitHub Pages 等で公開できるエコシステム基盤。使い方は [packages/cli/README.md](../packages/cli/README.md)、配布は [MOD.md](MOD.md)。

```
ubichill init mod my-mod   # プロジェクト雛形生成
ubichill dev               # 本番と同じ Go のインスタンスサーバーで動かす
ubichill build             # Worker をバンドルし manifest・lock を作る
ubichill publish dist      # 作者署名。配布先への配置は作者のデプロイ処理
```

### Phase 1 — 規約・型定義（✅ 完了）

- `package.json` と Worker の `export const config` から manifest を作る（手書きの `mod.json` は廃止）
- `ModWorkerMessage` 型システム

### Phase 2 — ビルド（✅ 完了）

- `ubichill build`（esbuild）で Worker JS をバンドル。本体の `mods/` は `pnpm build:workers` が同じコマンドでビルドする

### Phase 3 — `ubichill init`（完了）

- プロジェクト雛形生成（`ubichill init mod|world`）
- 作者署名と GitHub Pages への公開フロー（`ubichill publish`・`--check-public`）

### Phase 4 — ホットリロード（完了）

- `ubichill dev` が保存のたびにビルドし直し、開いているページを読み直す

### Phase 5 — マーケットプレイス（一部）

- 作者参照（`@作者@サーバー/mod`）の検索・追加・更新は実装済み（[design/mod-discovery.md](design/mod-discovery.md)）
- 未実装の部分は design/mod-discovery.md の冒頭の状態を参照

---

## 権限・セキュリティ

ゼロトラストなmod権限。開発者は権限を宣言せず、使用 API から自動導出し、実行時に
ユーザーが承認する。信頼境界は Worker→Host の postMessage 一点。

### Phase 1 — 危険度ティアと enforcement（✅ 完了）

- 危険度ティア（safe / sensitive / dangerous）と単一カタログ `CAPABILITY_CATALOG`
- `capabilities` 未指定でも default-deny の単一ゲート（`createCapabilityGate`）

### Phase 2 — on-demand 承認とユーザー制御（✅ 完了）

- 初回使用時プロンプト（ブラウザのカメラ許可風）。決定はユーザー所有ポリシー（localStorage）に記憶
- fetch は接続先ドメインごとに承認。mod自身のアセット領域は無承認
- 設定画面：シールドレベル（なし / 確認 / 厳格な確認 / 拒否）、mod別の許可の確認・取り消し
- 内部 API 叩きの抜け道封鎖（相対 fetch をアセット領域に限定）

### Phase 3 — capability 自動生成（✅ 完了）

- ビルド時に Worker コードを静的解析して capability を自動生成（`mod.json` 手書き廃止）

### Phase 4 — 真正性と隔離強化（将来）

- **隔離単位を信頼境界（mod）に揃える**: 現状の「1 Component = 1 Worker」を見直し、
  「1 mod = 1 Worker」への統合 / Worker プーリングを検討。権限 grant は既に modId 単位
  であり、`PERF_WORKER_LIMIT_REACHED` のスケール問題も動機。
- WASM / QuickJS によるハード隔離（`new Function` ベースの限界を解消）
- メソッド → 必要権限を SDK の JSDoc / docs として開発者に公開
- ワールド / インスタンス単位の推奨シールドレベル配布（管理者プリセット）

---

## 機能ロードマップ

| 機能 | 状態 | 備考 |
|---|---|---|
| ECS modモデル | ✅ 完了 | |
| DOM レンダリング | ✅ 完了 | |
| mod権限（危険度ティア + on-demand 承認） | ✅ 完了 | 上記 権限・セキュリティ Phase 1–3 |
| capability 自動生成（静的解析） | ✅ 完了 | 開発者は権限宣言不要 |
| テスト基盤（vitest + testing-library） | ✅ 導入 | まず権限まわりから拡充中 |
| mod署名・改竄検知 | 完了 | lock の hash 固定と作者署名（[MOD.md](MOD.md#作者署名必須)） |
| WebGL レンダリング | 将来 | wallpaper engine 相当の表現 |
| WASM サンドボックス（QuickJS） | 将来 | ハード隔離。権限・セキュリティ Phase 4 |
| modマーケットプレイス | 一部 | `ubichill` CLI Phase 5 |
