# mod.json 廃止 & コード内構成への移行

## 目的
mod 開発における設定ファイル（`mod.json`）を廃止し、**「コードが構成を兼ねる」**状態へ移行することで、開発体験（DX）の向上とセキュリティの厳格化を同時に実現する。

## 変更内容

### 削除されたファイル
- `mods/pen/mod.json`
- `mods/video-player/mod.json`
- `packages/sdk/mod.config.schema.json`

### 新規追加されたファイル
- `packages/sdk/src/ubi/config.ts` — `ComponentConfig` 型 + `DataField` 型群

### 変更されたファイル
- `packages/sdk/src/index.ts` — `ComponentConfig`, `DataField`, `DataFieldType` を re-export
- `mods/pen/src/canvas.worker.ts` — `export const config` を追加
- `mods/pen/src/tray.worker.tsx` — `export const config` を追加
- `mods/pen/src/pen.worker.tsx` — `export const config` を追加
- `mods/video-player/src/screen.worker.tsx` — `export const config` を追加
- `mods/video-player/src/controls.worker.tsx` — `export const config` を追加
- `mods/video-player/src/playlist.worker.tsx` — `export const config` を追加
- `mods/video-player/src/search.worker.tsx` — `export const config` を追加
- `packages/sdk/cli/build.ts` — 全面書き換え（`mod.json` 廃止、自動スキャン、capability 突合せ）
- `packages/sdk/cli/build.test.ts` — `buildWorker` → `buildMod` API 変更に追従
- `packages/sdk/cli/verify.ts` — 既定パスのみ調整
- `scripts/watch-workers.mjs` — `mod.json` 監視 → `package.json` + `src/` 監視に変更

## 新しいビルドフロー

1. `mods/*/package.json` を読み込み → `id`, `name`, `version` を取得
2. `mods/*/src/*.worker.ts(x)` を自動スキャン
3. `export const config` を持つファイルのみを Worker として扱う
4. esbuild でバンドル
5. `detectCapabilities()` でコードから自動検出
6. `config.capabilities`（宣言）と `detectCapabilities()`（検出）を突き合わせて警告
7. `manifest.json` と `lock.json` を自動生成

## 修正が必要だった箇所

### `export const config` の型注釈が正規表現にマッチしなかった

Worker ファイルでは `export const config: ComponentConfig = { ... }` のように型注釈を付けていたが、正規表現 `/export\s+const\s+config\s*(?::\s*[^=]+)?\s*=/` に修正して対応した。

### `Set<string>` のスプレッド演算子が TypeScript でコンパイルエラー

`const capabilities = [...new Set([...detected, ...declaredCapabilities])].sort();` の箇所で `Set` のスプレッド演算子が `--target es2022` では許可されていないため、以下のように修正した：

```typescript
const capabilitySet = new Set<string>();
for (const cap of detected) capabilitySet.add(cap);
for (const cap of declaredCapabilities) capabilitySet.add(cap);
const capabilities = Array.from(capabilitySet).sort();
```

## 残課題

### `data-only` コンポーネントの扱い
pen の `stroke` は Worker を持たない data-only コンポーネントだった。現状の自動探索では `*.worker.ts` ファイルがないため拾えない。対応案：

- 案A: `src/stroke.data.ts` で `export const config: ComponentConfig = { dataOnly: true }` を書く
- 案B: `src/*.data.ts` という別規約を作る

### ビルドパス構成
現状 `dist/mods/<modId>/v<version>/` に配置される。npm publish 時に `dist/` 直下にフラット配置したい場合は `--dist-dir=dist` を指定する。

## 手元でのビルド確認方法

```bash
cd ~/Documents/GitHub/ubichill

# ビルド
node packages/sdk/cli/index.ts build \
  --mods-dir=mods \
  --dist-dir=dist/mods \
  --public-mods-dir=packages/frontend/public/mods

# 検証
node packages/sdk/cli/index.ts verify --dist-dir=dist/mods

# テスト
pnpm --filter @ubichill/sdk test
```
