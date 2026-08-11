# @ubichill/sdk

## 0.4.0

### Minor Changes

- 3b15235: `Ubi.ui.render(factory, targetId)` が `factory()` 実行中に読んだ `Ubi.state` のキーを自動追跡し、そのキーが変わったときだけ自動で再描画するようになりました。`state.onChange(key, render)` による手動の再描画結線は不要になります（既存の呼び出しを残しても害はありません）。読まなかったキーの変化では再描画されないため、postMessage の送信数は増えません。

  さらに、Worker ファイルが `export default function() { return <jsx/> }` のように UI をデフォルトエクスポートすると、初回の `Ubi.ui.render()` 呼び出しも不要になり自動でマウントされます。`Ubi.grip` の `isMine`/`holder` 等は内部で `Ubi.state` を読むため、これらも自動追跡の対象です。

## 0.3.0

### Minor Changes

- a896802: `ubichill build` が `index.json`（レジストリ一覧: `id`/`name`/`version`/`components`）を自動生成するようになった。

  - 単一 mod（外部リポジトリ）: 自分自身を 1 件だけ含む配列を `distDir`/`publicDir` に出力する。World Editor の「レジストリ URL を追加」機能にそのまま渡せる。
  - モノレポの一括ビルド: 全 mod を集約した配列をバッチルートに出力する。

  `buildMod()` の戻り値が `void` から `{ id, name, version, components }`（`ModIndexEntry`）に変わった。

## 0.2.0

### Minor Changes

- b801fc9: mod.json 廃止に伴う SDK 公開 API の追加:
  - `export type { ComponentConfig, DataField, DataFieldType }` を追加（Worker コード内の config 宣言用）
  - `export type { Ubi }` を追加（mod から見た Ubi グローバルの公開型）
  - `cli/build.ts` が `mod.json` に代わり `package.json` + `export const config` からビルドするよう変更
