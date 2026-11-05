# @ubichill/cli

[ubichill](https://github.com/ubichill/ubichill) の mod・ワールドを作る人のためのコマンド（`ubichill`）。
mod が import する SDK は別パッケージ [`ubichill`](https://www.npmjs.com/package/ubichill) で、こちらは
ビルド・固定・検証・署名・公開だけを持つ。

```bash
npm install ubichill            # mod が import する SDK（依存なし）
npm install -D @ubichill/cli    # このコマンド（Go のインスタンスサーバーも入る）
npx ubichill dev                # 手元の mod を、本番と同じ Go のインスタンスサーバーで動かす
```

```json
{
    "dependencies": { "ubichill": "^4" },
    "devDependencies": { "@ubichill/cli": "^1", "typescript": "^5" },
    "scripts": {
        "dev": "ubichill dev",
        "typecheck": "tsc --noEmit",
        "build": "npm run typecheck && ubichill build"
    }
}
```

## `ubichill dev`

```bash
ubichill dev [world.yaml] [--port=3333] [--mods-dir=<dir>] [--max-users=<n>]
```

Docker・DB・Go のツールチェーンは要らない。`http://localhost:3333/` を開くと、本番と同じ画面（`world.html`）と同じ判定
（lock の照合・権限・Go のロックと上限）で mod が動く。複数のタブ・ブラウザで同期する。

- **ワールド**: 引数か `./world.yaml`。無ければ、手元の mod の Component を 1 つずつ中央に置いたワールドを合成する。
- **保存すると**: その mod だけビルドし直し、全部そろったら「世代」（lock・manifest・Worker・asset）を切り替えて、
  開いているページを読み直す。entity と共有状態は Go にあるので残る（消えるのは Worker の中のローカルな状態だけ）。
  ビルドに失敗したら前の世代が動き続け、失敗は画面の診断に出る。
- **`world.yaml` を変えると**: 新しい部屋を作ってから切り替える（配置は初期状態に戻る）。Go が定義を断ったら前の部屋のまま。
  画面の「部屋を作り直す」も同じ。
- **署名**: 手元のビルドは署名が無いので「署名なし・ローカル」として動かす。lock の照合・権限の確認は本番と同じ。
- mod の外の共有コードも、import していれば監視する（その mod をビルドし直す）。
- Go のバイナリは `@ubichill/instance-<os>-<cpu>` から探す。自分でビルドしたものを使うなら `UBICHILL_INSTANCE_BIN=<path>`。

`@ubichill/cli` は Go のインスタンスサーバー（`ubichill-instance`）を optionalDependencies で持つ
（`@ubichill/instance-<os>-<cpu>`。macOS arm64/x64・Linux x64/arm64・Windows x64 のうち合う 1 つだけが入る）。
CI で `build` しか使わないなら `npm install --omit=optional` で外せる。

## コマンド

```bash
ubichill build   [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>] [--registry-url=<url>]
ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--check]
ubichill update  <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]
ubichill verify  [--dist-dir=<dir>] [--require-signatures]
ubichill verify  <world.yaml>
ubichill login   [--server=<url>] [--device] [--name=<表示名>] [--no-browser]
ubichill logout  [--server=<url>]
ubichill whoami  [--server=<url>]
ubichill ci create --name=<表示名> [--server=<url>] [--device]
ubichill publish <world.yaml>... [--server=<url>] [--out=<dir>] [--public-url=<url>] [--no-install]
ubichill publish <mods のビルド出力>... [--server=<url>] [--public-url=<url>]
ubichill world build <world.yaml> [--id=<instanceId>] [--max-users=<n>] [--out=<path>]
```

- **`build`**: `src/**/*.worker.ts(x)` のうち `export const config` を持つファイルを Component
  として esbuild でバンドルする。id/name/version は `package.json` から、Component ごとの
  メタデータ（`watchScope`/`dataFields`/`capabilities` 等）は各 Worker ファイル内の
  `export const config` から取得する。出力ごとに `manifest.json`（ランタイム用）と
  `lock.json`（バイト列の Subresource Integrity + capability 天井）を生成する。
  - **単一 mod（既定・外部リポジトリでの標準フロー）**: `mods/` ディレクトリが存在しない場合、
    cwd 自体を 1 つの mod のルートとみなし、`<cwd>/dist` にビルドする。
  - **モノレポの一括ビルド**: cwd に `mods/` ディレクトリがある場合、または `--mods-dir=<dir>` を
    明示した場合は、その配下の各サブディレクトリを個別の mod として一括ビルドする。既定の出力先は
    `--dist-dir`/`--public-mods-dir` ともに `<cwd>/dist/mods`。
  - **バージョン履歴 (`index.json` の `versions`)**: World Editor の「mod のバージョンを選ぶ」
    ドロップダウンは `index.json` の `versions` 配列から選択肢を作る。`package.json` の `"homepage"` を
    公開先の registry URL（例: GitHub Pages の `https://<user>.github.io/<repo>/`）にしておくと、`build` が
    ビルド前に `<homepage>/index.json` を取得して履歴を補う。`--registry-url=<url>` で明示もできる。
    取得に失敗しても（未公開・オフライン等）ビルド自体は失敗しない。
- **`verify`**: `build` の出力を fail-closed で再検証する。`lock.json` の integrity が
  実際に配布するバイト列と一致するかを独立に再計算して突き合わせ、ズレていれば非ゼロ終了する。
  作者署名（`lock.sig.json`）があれば今の lock に対して有効かも調べ、`--require-signatures` で署名の無い mod も不合格にする。
  `verify <world.yaml>` は、兄弟の `.sig.json` が今の `world.yaml` と `.lock.json` に対して有効か調べる。
- **`install`**: ワールド定義（YAML）が参照する mod の `lock.json` 断片を集約し、
  兄弟ファイル `<world>.lock.json` に書き出す。Host はこのロックで mod の完全性（hash 固定 + 権限天井）を強制する。
  - 外部配布するワールドでは、各 dependency の `source.url` に mod レジストリ URL を書く。
    その場合は `ubichill install world.yaml` だけでよく、`--base-url` は不要。
  - `--base-url` は、URL を持たない複数 dependency を同じ HTTP レジストリから取得する場合の
    一括 fallback。`--mods-dir` はローカルの mod を同時開発する場合の fallback。
  - lock を取得できない dependency が 1 つでもあれば、不完全な lock を書かず非ゼロ終了する。
- **`login` / `publish`**: ワールド・mod を作者アカウントで署名して公開する。
  - `login` はブラウザで承認して、この端末を「公開環境」にする（鍵はこの端末だけにあり、サーバーには公開鍵だけが登録される）。
    ブラウザを開けない環境では `--device` で、表示したコードを別の端末で承認する。認証情報は
    `~/.config/ubichill/credentials.json`（0600）に保存する。
  - `publish <world.yaml>` は mod の固定（`install`）・作者アカウント付きの署名・公開を一度に行う。
    `--out=<dir>` なら GitHub Pages など外部に置く `world.yaml` / `.lock.json` / `.sig.json` を書き出す。
  - `publish <ビルド出力>` は mod の配布物に `v<version>/lock.sig.json` を書き出す（mod はサーバーへ送らない）。
    Host は作者署名を確認できた mod だけを実行する。
  - `--public-url=<url>` を渡すと、署名したときに作者アカウントのサーバーへ登録され、ユーザーページに出る。
- **`dev`**: 上の「`ubichill dev`」。
- **`world build`**: 手元の `world.yaml` と兄弟の `.lock.json` から、Go のインスタンスサーバー（`ubichill-instance`）に
  渡す定義 JSON を作る。本体がインスタンスを作るときと同じ変換なので、`ubichill-instance --guests --world=<出力>` で
  起動した部屋は本体と同じ初期状態を持つ。`--id` は省略時 `metadata.name`、`--max-users` は省略時ワールドの定員の上限。
  lock に無い mod を参照していれば失敗する（先に `ubichill install`）。
- **CI から公開する**: 手元で `ubichill ci create --name="GitHub Actions: owner/repo"` を実行してブラウザで承認すると、
  CI 用の公開環境の認証情報（1 本の文字列）が表示される。CI の Secret `UBICHILL_CREDENTIALS` に入れて `publish` する。

```yaml
# mod のリポジトリの公開ワークフロー（抜粋）
      - run: npm ci
      - run: npx ubichill build
      - run: npx ubichill publish dist          # 複数 mod の出力なら dist/mods
        env:
          UBICHILL_CREDENTIALS: ${{ secrets.UBICHILL_CREDENTIALS }}
      - run: npx ubichill verify --dist-dir=dist --require-signatures
      # このあと dist を GitHub Pages などへ置く
```

## 型チェックを `build` の前段に入れる

`ubichill build` は esbuild で bundle するだけで型チェックは行わない。`import` 先の
パッケージ名間違いや `ComponentConfig` のフィールド名間違いは、放置すると esbuild の
bundle エラーとしてしか出てこず、原因が分かりにくい。`typescript` を devDependency に入れ、
`build` の前に `tsc --noEmit` を挟む（冒頭の `package.json`）。

`tsconfig.json` の `target`/`lib` は `ubichill build` が esbuild に渡す `target: 'es2022'`
と合わせておく。`jsxImportSource` は `ubichill`（SDK の公開名）にする。

## ライセンス

MIT。ubichill 本体（Host/backend/frontend、AGPL-3.0-only）とは別ライセンス。
