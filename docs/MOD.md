# mod パッケージ

mod は ubichill の**配布・信頼の単位**。1 つの mod が複数の Component（それぞれ 1 Worker）を束ねる。
ユーザーは mod 単位で信頼を判断し、権限も mod 単位で記憶される。ワールドは複数の mod を
URL から読み込んで構成する（→ [WORLD_AS_CODE.md](./WORLD_AS_CODE.md)）。

関連: [ARCHITECTURE.md](./ARCHITECTURE.md)（実行モデル）/ [CAPABILITIES.md](./CAPABILITIES.md)（権限）/
[API.md](./API.md)（`Ubi.*` SDK）

---

## mod.json（マニフェスト）

mod のソースは `mods/<name>/mod.json` で定義する。形式は Zod で検証される（唯一の真実源は
[`packages/shared/src/schemas/mod.schema.ts`](../packages/shared/src/schemas/mod.schema.ts) の
`ModManifestSchema`）。`ubi mod build`（`build-workers.mjs`）がこれを読み、Worker を esbuild で
バンドルして runtime 用の versioned manifest（`manifest.json`）を出力する。

```jsonc
{
  "id": "video-player",       // mod ID（配布単位・権限記憶のキー）
  "name": "VideoPlayer",      // 表示名（任意）
  "version": "2.1.0",         // SemVer
  "components": {
    "screen": {
      "src": "./src/screen.worker.tsx",   // Worker エントリ（ビルド時。runtime では workerUrl に変換）
      "watchEntityTypes": [],              // 同期監視する Component 型
      "watchScope": "entity",              // entity | subtree | parent | world
      "mediaTargets": ["main"],            // メディア描画ターゲット（任意）
      "defaultTransform": { "x": 0, "y": 0, "z": 2, "w": 640, "h": 360 }
    }
  }
}
```

### フィールド

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `id` | ✓ | mod ID。Component は `id:componentKey`（例 `video-player:screen`）で参照される |
| `name` | | 表示名 |
| `version` | ✓ | SemVer |
| `components` | | Component 名 → 定義のマップ |

Component 定義（`ComponentManifestEntry`）の主なフィールド:

| フィールド | 説明 |
| --- | --- |
| `src` | Worker エントリ（ビルド入力）。runtime manifest では `workerUrl` に変換される。無ければデータ専用 Component |
| `watchScope` | 同期の可視範囲。`entity`（自身のみ）/ `subtree`（既定・自身＋子孫）/ `parent`（自身＋祖先）/ `world`（全体） |
| `watchEntityTypes` | 起動時に同期反映する Component 型 |
| `mediaTargets` / `canvasTargets` | メディア/キャンバス描画ターゲット |
| `defaultTransform` | 配置の既定値（x/y/z/w/h/rotation） |
| `dataFields` | エディタ Inspector 用の編集可能フィールド定義 |
| `displayName` / `thumbnail` | エディタでの表示名・プレビュー画像 |
| `capabilities` | 通常は不要（自動生成）。手書きすると自動生成結果への補完になる |

> **形式は JSON で確定。** URL で動的ロードされ、ゼロトラストの信頼境界で `JSON.parse` される。
> 依存ゼロ・YAML 特有の地雷（アンカー爆弾・暗黙の型強制）を境界に持ち込まないため。

---

## 権限（capability）

mod 開発者は権限を宣言しない。使用している `Ubi.*` API からビルド時に自動生成され、実際の許可は
ユーザーが mod 読み込み時に一括承認する。全一覧・危険度・同意モデルは
**[CAPABILITIES.md](./CAPABILITIES.md)** を参照。

---

## バージョンと lock

- `version` は **SemVer**。runtime のアセットはバージョン付きパス（`/mods/<id>/v<version>/…`）で
  固定配信されるため、あるワールドが読み込む mod は再現性を持つ。
- **現状 mod は自己完結**で、mod → mod の依存関係は持たない。Component 間の連携は
  `Ubi.event`（scope / targetType）による**疎結合**で行い、相手が居なければ優雅に劣化する
  （ハードな依存解決はしない）。
- **依存が必要になった場合の方針（構想）**: ワールドが依存する mod のバージョンを
  ロックファイルで固定する（`package-lock` 相当）。ただしゼロトラストのため
  **capability は依存間で継承しない**（各 mod は独立ロード＋各自の承認）。
- **プロトコル互換**: mod は SDK 経由で Host と通信する。SDK と Host は独立更新されるため、
  初期化時に `PROTOCOL_VERSION` を突き合わせて非互換を検出する（→ [CAPABILITIES.md](./CAPABILITIES.md#プロトコルバージョン)）。

---

## 配布

mod は URL ベースで配布する（GitHub Pages / 任意 CDN）。ワールドの `mods[].src` にその URL を書く。

```yaml
mods:
  - name: pen
    src: https://yourname.github.io/pen-mod   # GitHub Pages
  - name: custom
    src: https://cdn.example.com/my-mod       # 任意ホスティング
```

`src` から versioned manifest と Worker JS を取得する。取得時に Content-Type 検証と
`mod.json` のチェックサム照合を行う（実装予定）。
