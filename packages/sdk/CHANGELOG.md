# @ubichill/sdk

## 0.5.0

### Minor Changes

- 13aee7d: メディア同期プロトコルを一般化し、バックグラウンド再生を整備した。

  - `media:sync` / `media:state-response` のペイロードを `currentIndex`（動画プレイリスト前提）から `MediaSyncState`（`mediaId` ベース、`duration` / `playbackRate` を任意付加）へ一般化。バックエンドは引き続き中身を解釈しないリレーのみ。
  - `Ubi.media.load()` に `kind`（`'audio' | 'video'`）を追加。`'audio'` はデバイス操作（メディアキー/ロック画面）を既定で許可し、`navigator.mediaSession.playbackState` を設定してバックグラウンド再生を継続する。`'video'`（既定）は明示許可までデバイス操作をロックする。

- 24c4c3e: `ubichill lock` を `ubichill install` に改名し、world.yaml の `dependencies[].source.version`（完全一致 `x.y.z` のみ）を実際に解決するようにした。従来はこのフィールドが lock 生成時に一切参照されず、常に最新版が固定されていた。

  - `ubichill install <world.yaml>`: `source.version` が pin されていればそのバージョンを直接取得して lock する。`ubichill lock` は非推奨エイリアスとして残る（既存スクリプトを壊さないため）。
  - `ubichill update <world.yaml> [<modName>]`: pin 済みバージョンが古ければ最新へ world.yaml を書き換え（コメント/フォーマットは保持）、lock を再生成する。
  - `ubichill build` が出力する `index.json` に、過去にビルドした全バージョンの履歴（`versions`）を追加した（トップレベルの `id`/`name`/`version`/`components` は従来通り現行最新のまま）。

  `DependencySourceSchema.version` は `SemVer`（`x.y.z`）または明示的な `'latest'` のどちらかで検証されるようになった（`^`/`~` などのレンジ指定は非対応）。省略時も解決後は必ず `'latest'` になる（zod default）ため、「省略＝常に最新を追う」という暗黙の意味を読み手が推測する必要がない。

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/ecs@1.0.1
  - @ubichill/shared@1.0.1
  - @ubichill/loader@1.0.1

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
