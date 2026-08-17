# ubichill

[ubichill](https://github.com/ubichill/ubichill) 用の mod 開発SDK + CLI。npm パッケージ名は
`ubichill`（unscoped）。ワークスペース内の実装は `@ubichill/sdk` という名前だが、公開物は
`ubichill` としてビルドされる。

ubichill は「URLで起動し、Socket.IO で同期する、ゼロトラスト型のmod動的ロード2Dメタバース基盤」。
mod は Web Worker 内で動く独立したサンドボックスで、Host本体には直接アクセスできない。
`Ubi` グローバル（このSDKが注入する）経由でのみ Host とやり取りする。

## インストール

```bash
npm install ubichill
# or
pnpm add ubichill
```

## SDK: mod を書く

mod の Worker コード内では `Ubi` グローバル（型は `import('ubichill').Ubi`）が使える。
DOM/React には依存しない（`ubichill/gripable` だけ JSX を使う）。

```tsx
// mods/my-mod/src/counter.worker.tsx（jsxImportSource: "ubichill" を tsconfig で指定）
const counter = Ubi.state.define({
    count: Ubi.state.sync(0), // 共有 + 永続。ホスト再起動後も保持される
});

// export default = このWorkerのUI。ビルド時にバンドルされ、初回のみ自動で描画される。
// この中で読んだ Ubi.state のキー（ここでは count）は自動で依存追跡され、
// 変化時だけ自動的に再実行される（onChange での手動結線・初期呼び出しは不要）。
export default function Counter() {
    return <button onClick={() => counter.local.count++}>count: {counter.local.count}</button>;
}
```

主要なネームスペース（詳細は `Ubi` 型の docstring を参照）:

| namespace | 用途 |
| --- | --- |
| `Ubi.state` | 宣言的リアクティブ状態。`define`/`sync` で共有・永続・ユーザー別を選ぶ |
| `Ubi.event` | `sendToHost`（本体へ）/ `broadcast`（他ユーザーへ）/ `emit`（同タブ内他Worker） |
| `Ubi.entity` | エンティティ操作。`Ubi.entity()`＝自分、`Ubi.entity(id)`＝他、`query`/`get`/`spawn` |
| `Ubi.ui` | VNode描画（`render`）・トースト通知（`showToast`） |
| `Ubi.grip` | 「掴む/離す」操作の宣言的ライフサイクル（ドラッグ系UIに使う） |
| `Ubi.canvas` | 共有キャンバス描画（`frame`/`commitStroke`） |
| `Ubi.player` | 参加者情報・スクロール位置・カーソル同期 |
| `Ubi.media` | 動画/音声/HLSの読み込みと再生制御 |
| `Ubi.fetch(url)` | HTTP リクエスト（ドメイン単位でユーザー承認を経由） |
| `Ubi.registerSystem(fn)` | ECS System登録（毎フレーム呼ばれる） |

- 権限（capability）はビルド時に使用APIから自動検出され、`export const config` で宣言したものと和集合される。
  一覧・危険度は [`docs/CAPABILITIES.md`](https://github.com/ubichill/ubichill/blob/main/docs/CAPABILITIES.md)。
- Worker→Host のワイヤープロトコルバージョンは `PROTOCOL_VERSION`（npm semverとは連動しない）。

### JSX（オプション）

`ubichill/jsx-runtime` を使えば `.tsx` で Worker UI を書ける（tsconfig の `jsxImportSource` に
`ubichill` を指定）。ドラッグ操作をJSXで宣言するための `<Gripable>` は `ubichill/gripable`。

## CLI: mod をビルド・配布する

このパッケージは `ubichill` コマンド（`build`/`lock`/`verify`）も提供する。

```bash
npx ubichill build  [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>]
npx ubichill lock   <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]
npx ubichill verify [--dist-dir=<dir>]
```

- **`build`**: `src/**/*.worker.ts(x)` のうち `export const config` を持つファイルを Component
  として esbuild でバンドルする。id/name/version は `package.json` から、Component ごとの
  メタデータ（`watchScope`/`dataFields`/`capabilities` 等）は各 Worker ファイル内の
  `export const config` から取得する（`mod.json` は廃止）。出力ごとに `manifest.json`
  （ランタイム用）と `lock.json`（バイト列のSubresource Integrity + capability 天井）を生成する。
  - **単一 mod（既定・外部リポジトリでの標準フロー）**: `mods/` ディレクトリが存在しない場合、
    cwd 自体を 1 つの mod のルートとみなし、`<cwd>/dist` にビルドする。外部で mod を開発する
    ときはリポジトリのルートで package.json + src/ を用意して `npx ubichill build` を叩くだけでよい。
  - **モノレポの一括ビルド**: cwd に `mods/` ディレクトリがある場合、または `--mods-dir=<dir>` を
    明示した場合は、その配下の各サブディレクトリを個別の mod として一括ビルドする
    （このリポジトリの `pnpm build:workers` はこちらを使う）。既定の出力先は
    `--dist-dir`/`--public-mods-dir` ともに `<cwd>/dist/mods`。
  - **バージョン履歴 (`index.json` の `versions`)**: World Editor の「mod のバージョンを選ぶ」
    ドロップダウンは `index.json` の `versions` 配列から選択肢を作る。ローカルの
    `dist/index.json`（直前ビルドの成果物）があればそこから履歴を引き継ぐが、CI の
    クリーンチェックアウトのように毎回まっさらな状態でビルドする場合はこれが空になり、
    「latest」しか選べなくなってしまう。`package.json` に `"homepage"` を公開先の registry URL
    （例: GitHub Pages の `https://<user>.github.io/<repo>/`）にしておくと、`build` が
    ビルド前に `<homepage>/index.json` を取得して履歴を補う（mod 開発者が意識する必要はない）。
    `homepage` を使いたくない場合は `npx ubichill build --registry-url=<url>` で明示できる。
    取得に失敗しても（未公開・オフライン等）ビルド自体は失敗しない。
- **`verify`**: `build` の出力を fail-closed で再検証する。`lock.json` の integrity が
  実際に配布するバイト列と一致するかを独立に再計算して突き合わせ、ズレていれば非ゼロ終了する。
  CI の配布前ゲートに使う想定。
- **`lock`**: ワールド定義（YAML）が参照する mod の `lock.json` 断片を集約し、
  兄弟ファイル `<world>.lock.json` に書き出す。ホストはこのロックでmodの完全性
  （hash固定 + 権限天井）を強制する。

### 型チェックを `build` の前段に入れる

`ubichill build` は esbuild で bundle するだけで型チェックは行わない。`import` 先の
パッケージ名間違いや `ComponentConfig` のフィールド名間違いは、放置すると esbuild の
bundle エラー（unresolved import 等）としてしか出てこず、原因が分かりにくい。
`package.json` に `typescript` を devDependency として追加し、`build` の前に
`tsc --noEmit` を挟むと、エディタの型チェックと同じ内容がコマンドラインでも早い段階で
（bundleを試みる前に）分かる。

```json
{
    "devDependencies": { "typescript": "^5.9.0" },
    "scripts": {
        "typecheck": "tsc --noEmit",
        "build": "npm run typecheck && npx ubichill build"
    }
}
```

（pnpm を使う場合は `pnpm typecheck && pnpm exec ubichill build`。`npm run`/`npx` と `pnpm` を
混在させると、`pnpm build` 経由で実行しても内部で実際に npm/npx が起動し、無関係な
npm 自身の更新通知等が出ることがある。使っているパッケージマネージャに揃えること。）

`tsconfig.json` の `target`/`lib` は `ubichill build` が esbuild に渡す `target: 'es2022'`
と合わせておく（`ES2022` 以外、特に未リリースの target を指定すると安定版 `typescript` が
解釈できずエラーになる）。

## ライセンス

MIT。ubichill 本体（Host/backend/frontend、AGPL-3.0-only）とは別ライセンス
（mod開発者が自分のコードへライセンス不問で組み込めるようにするため）。
