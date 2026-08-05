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

function render(): void {
    Ubi.ui.render(() => <button onClick={() => counter.local.count++}>count: {counter.local.count}</button>, 'counter-root');
}
counter.onChange('count', render);
render();
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

- 権限（capability）はビルド時に使用APIから自動検出され、`mod.json`で宣言したものと和集合される。
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

- **`build`**: `<mods-dir>` 配下の各 `mod.json` を自動探索し、Component の Worker コードを
  esbuild でバンドルする。出力ごとに `manifest.json`（ランタイム用）と `lock.json`
  （バイト列のSubresource Integrity + capability 天井）を生成する。既定は全て `process.cwd()`
  相対（`--mods-dir` 既定はcwd自身、`--dist-dir`/`--public-mods-dir` 既定は `<cwd>/dist/mods`）。
- **`verify`**: `build` の出力を fail-closed で再検証する。`lock.json` の integrity が
  実際に配布するバイト列と一致するかを独立に再計算して突き合わせ、ズレていれば非ゼロ終了する。
  CI の配布前ゲートに使う想定。
- **`lock`**: ワールド定義（YAML）が参照する mod の `lock.json` 断片を集約し、
  兄弟ファイル `<world>.lock.json` に書き出す。ホストはこのロックでmodの完全性
  （hash固定 + 権限天井）を強制する。

## ライセンス

MIT。ubichill 本体（Host/backend/frontend、AGPL-3.0-only）とは別ライセンス
（mod開発者が自分のコードへライセンス不問で組み込めるようにするため）。
