# ubichill

[ubichill](https://github.com/ubichill/ubichill) 用の mod 開発 SDK。npm パッケージ名は
`ubichill`（unscoped）。ワークスペース内の実装は `@ubichill/sdk` という名前だが、公開物は
`ubichill` としてビルドされる。依存は無く、mod のバンドルに同梱される小さな実行時コードと型だけを持つ。
ビルド・署名・公開のコマンド（`ubichill`）は
[`@ubichill/cli`](https://www.npmjs.com/package/@ubichill/cli)。

ubichill は「URLで起動し、WebSocket で同期する、ゼロトラスト型のmod動的ロード2Dメタバース基盤」。
mod は Web Worker 内で動く独立したサンドボックスで、Host本体には直接アクセスできない。
`Ubi` グローバル（このSDKが注入する）経由でのみ Host とやり取りする。

## インストール

```bash
npm install ubichill            # SDK（mod が import する）
npm install -D @ubichill/cli    # 開発サーバー・ビルド・署名・公開のコマンド
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
| `Ubi.asset` | 同梱アセット（`assets/`）の読み込みと WASM のコンパイル。Host が manifest の integrity と照合して渡す |
| `Ubi.runtime` | 実行環境の能力判定（`supports('wasm:simd')` など）と、未対応時の明確なエラー（`require`） |
| `Ubi.fetch(url, options?)` | HTTP リクエスト（ドメイン単位でユーザー承認）。`responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal` |
| `Ubi.registerSystem(fn)` | ECS System登録（毎フレーム呼ばれる） |

- 権限（capability）はビルド時に使用APIから自動検出され、`export const config` で宣言したものと和集合される。
  一覧・危険度は [`docs/CAPABILITIES.md`](https://github.com/ubichill/ubichill/blob/main/docs/CAPABILITIES.md)。
- Worker→Host のワイヤープロトコルバージョンは `PROTOCOL_VERSION`（npm semverとは連動しない）。
- WASM・バイナリ・通信の境界（ブラウザの CORS は解除されない等）は
  [`docs/MOD_RUNTIME.md`](https://github.com/ubichill/ubichill/blob/main/docs/MOD_RUNTIME.md)。

### JSX（オプション）

`ubichill/jsx-runtime` を使えば `.tsx` で Worker UI を書ける（tsconfig の `jsxImportSource` に
`ubichill` を指定）。ドラッグ操作をJSXで宣言するための `<Gripable>` は `ubichill/gripable`。

## CLI: mod をビルド・配布する

開発サーバー（`ubichill dev`）・ビルド（`build`）・固定（`install`）・検証（`verify`）・署名と公開（`login` / `publish`）は [`@ubichill/cli`](https://www.npmjs.com/package/@ubichill/cli) にある。
このパッケージにコマンドは無い。

## ライセンス

MIT。ubichill 本体（Host/backend/frontend、AGPL-3.0-only）とは別ライセンス
（mod開発者が自分のコードへライセンス不問で組み込めるようにするため）。
