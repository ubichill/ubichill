# mod package を作る・使う

mod は作者が配布する package。Component、Worker、アセット、プレハブをまとめる。
Component と mod は同じ単位ではない。Worker を持たず、標準 Component のプレハブだけを配る package も作れる。

## ワールドを作る

ブラウザではワールド編集の「mod管理」から名前・完全な作者参照・作品URLで探し、作者・版・権限を確認して追加する。
アセット欄には本体の標準部品と、追加した package の Component・プレハブが並ぶ。

```sh
ubichill init world my-world
cd my-world
npm install
ubichill install @youkan@ubichill.com/pen --world=world.yaml
ubichill dev world.yaml
ubichill login
ubichill publish world.yaml
```

共有ページは `https://ubichill.com/@youkan/mods/pen`、完全な参照は `@youkan@ubichill.com/pen`。
正確な版は `@youkan@ubichill.com/pen@1.2.3`。作者参照は作者のホームの WebFinger・カタログを経由して解決し、
配布先の署名と内容 hash を確認する。名前検索は指定サーバーの公開作品だけを調べ、他サーバーへの検索をばらまかない。

```sh
ubichill search pen --server=https://ubichill.com
```

既存の `dependencies[].source.url` による依存も使える。
`install @作者@サーバー/mod`（作品ページの URL も可）は作者署名と manifest hash を確かめ、`source.version` に正確な版を書く。
`install world.yaml` は明示的に lock を再生成する。手元の再ビルドや、`source.version: latest` の依存の最新版を取り込む。
このとき署名と作者は確かめない。作者参照の依存も lock に `author` を書くだけで、照合は実行時に Host が行う。
ブラウザの保存と CLI のワールド公開は、取得元・作者・指定した版が同じなら既存 lock を保つ。
そのため `latest` の依存が新しい版に移るのは、明示的な `install world.yaml` と `update` のときだけ。
更新するときは `ubichill update world.yaml pen`。作者参照の依存は作者のカタログの版を確かめて取り込み、`latest` も正確な版に書き換える。
対象外の依存は更新せず、権限が増える場合は内容を確認して `--accept-capabilities` を指定する。取得失敗では YAML と lock を書き換えない。
既存依存の権限が増える場合は install でも `--accept-capabilities` を必要とする。

手元のビルドを固定し直す場合は `install world.yaml --mods-dir=<ビルド出力>`。対象は `source.url` の無い依存だけで、
`<ビルド出力>/<modId>/`（`mod.json` と `v<version>/lock.json`）を読む。`build --layout=registry` か複数 mod の出力が必要で、単体の既定の出力（`dist/v<version>/`）は読めない。
作者参照の依存は必ず `source.url` を持つので、`--mods-dir` では手元のビルドに差し替わらない。

## mod を作る

```sh
ubichill init mod my-tools
cd my-tools
npm install
npm run dev
npm run build      # 雛形は ubichill build --layout=registry
ubichill login
ubichill publish dist --public-url=https://example.com/mods
# dist 全体を https://example.com/mods に配置する（--layout=registry の出力の場合）
ubichill publish dist --public-url=https://example.com/mods --check-public
```

`package.json` の `ubichill.id`（無ければ `name`。`@ubichill/`・`@ubichill/mod-` の接頭辞は外す）が mod ID、`version` が版。
mod ID は英小文字・数字を `-` でつないだ 50 文字までの名前で、`core` は使えない。作者参照とカタログは `x.y.z` の版だけを扱う。
`src/**/*.worker.ts(x)` の `export const config` が Component のメタデータ。
SDK は `ubichill` を import する。雛形には JSX と TypeScript の設定があり、型チェック後にビルドする。
権限は使用する SDK API から検出され、`config.capabilities` で補完できる。

```tsx
import type { ComponentConfig } from 'ubichill';
export const config: ComponentConfig = {
    defaultTransform: { x: 40, y: 40, w: 320, h: 100 },
};
export default function Hello() { return <div>Hello</div>; }
```

単体の `build` は従来どおり `dist/v<version>/…` を出力する。この出力は `<public-url>/<modId>/` の下に置く
（Host とカタログは `<public-url>/<modId>/v<version>/` から取得する）。
`build --layout=registry` は単体でも `dist/<modId>/v<version>/…` と一覧を出力し、dist 全体を `<public-url>` に置ける。
新しい mod の雛形の `npm run build` はこの形式を明示する。

`publish dist` は dist にあるすべての `v<version>/lock.json` に署名し、兄弟に `lock.sig.json` を書く（過去の版も署名し直す）。
外部ホストへのアップロードは作者のデプロイ処理が行う。`--public-url` を省くと `package.json` の `homepage` を使う。
内容が変わるビルドをすると、その版の以前の `lock.sig.json` は消える（署名し直す）。同じ内容の再ビルドでは残る。
作品のカタログ登録は配置後の `--check-public` が成功したときに行う。登録APIも依頼された内容が公開先にあることを検証し、未配置・取得失敗では既存の登録を維持する。
`--check-public` は配置後の lock・manifest・Worker・アセット・作者署名を取得して確認する。
Worker とアセットは 1 ファイルも合計も 32 MiB までしか調べない。実行時のアセットの上限（1 ファイル 256 MiB、[MOD_RUNTIME.md](MOD_RUNTIME.md#制限値fetch_limits)）より小さいので、これを超える mod は `--check-public` を通らず、カタログに登録できない。
公開先（`--public-url` か `homepage`）があれば、同じ版に違う内容が既に公開されているとき署名前に失敗する。版を上げて公開すること。
カタログ登録と update は版を比較し、古い修正版の公開で利用中の版へ自動的に差し戻さない。
既知の問題: カタログへの登録が失敗しても警告を出すだけで、`publish` は成功（終了コード 0）で終わる。CI ではログの警告を確かめる。

配布先は以前の版のディレクトリを消さず、新しい版を追加して置く。既存ワールドは以前の版を使い続ける。
`build` は手元の dist にある過去の版を残すが、CI の新しいチェックアウトでは新しい版だけを出力する（過去の版は `index.json` の履歴にしか残らない）。
その出力だけで配布先を丸ごと置き換えると、以前の版に固定したワールドが読めなくなる。CI の例は [CLI の README](../packages/cli/README.md#ci-から公開する)。

`ubichill dev` は DB・Docker・Go のツールチェーンなしで、本番と同じインスタンスサーバーを起動する。
複数タブ・ブラウザで同期を試せる。`--host` で LAN の端末からも試せる。
開発用 Host が同じオリジンから読む mod だけは、署名ファイルが無くても未署名で動かせる（[作者署名](#作者署名必須)）。lock に作者を固定した依存はこの例外を使わない。
ただし `ubichill dev` は手元でビルドした mod を同じ ID の依存より優先する。作者を固定した依存でも、手元に同じ ID の mod があれば
作者の固定を外した手元のビルドを未署名で動かす。dev の中だけの挙動で、world.yaml と lock は書き換えない。

## 本体の標準 Component

`core:` は本体の予約名前空間。`core:collider`・`core:media`・`core:ui` はインストールも mod の署名も不要。
Collider の検証・メディア描画・静的UIは本体が担当し、mod は必要な振る舞いを追加する。
package ID `core` と、未知の `core:*` Component は受け付けない。

## プレハブ

`prefabs/<名前>.json` に配置済み Entity の構成を書く。ビルド時に検証され、署名対象の versioned manifest に含まれる。
各プレハブは 200 Entity・ファイル 100 KB、package あたり50プレハブまで。ネスト参照と別 package の暗黙依存は扱わない。
manifest はプレハブを含めて 1 MiB まで。`build` は超えると失敗し、`install @作者@サーバー/mod`・ブラウザの追加とアセット欄・
`prefab add` / `prefab update`・`--check-public` も 1 MiB を超える manifest を読まない。実行時の Worker の読み込みはこの上限を確かめない。
自身の Component と本体の `core:*` を使える。

```json
{
  "name": "案内板",
  "entities": [{
    "id": "sign",
    "transform": { "x": 0, "y": 0, "w": 320, "h": 100 },
    "components": [{
      "id": "label",
      "type": "core:ui",
      "data": { "markup": "<div>ようこそ</div>" }
    }]
  }]
}
```

ブラウザのアセット欄でプレハブを押すと、一式が元との関連を持ったまま配置される。
`dataFields` に宣言した `entityRef`・`entityRefArray` は配置ごとに付け替え、複数配置で参照が混ざらない。
同じ Entity に同型の Component が複数ある場合は、一意な `id` を明示する。

```sh
ubichill prefab add my-tools/sign --world=world.yaml
ubichill update world.yaml my-tools
ubichill prefab update prefab-xxxxxxxxxxxx --world=world.yaml
ubichill prefab update prefab-xxxxxxxxxxxx --world=world.yaml --apply
ubichill prefab unpack prefab-xxxxxxxxxxxx --world=world.yaml
```

更新では、配置元の版・ワールド側の変更・更新先の版を比較する。元の版は保存した manifest hash と照合して取得し、
DB に元データのスナップショットを重複保存しない。配置側の編集を保ち、競合した項目は配置側を優先して一覧に出す。
ブラウザでは変更差分を確認してから適用する。Unpack は関連を外し、通常の編集可能な Entity 一式にする。
元の版が配布先から消えた場合は差分更新できないが、配置済みの内容は残り、Unpackできる。

## 配布と信頼

Worker・アセット・プレハブ・版履歴は作者の配布先に置く。作者のホームのDBは作者＋mod IDごとの登録ポインタだけを持ち、
既存の利用者ごとの登録上限を適用する。検索・表示の検証キャッシュにも件数と期限の上限がある。
カタログは取得先の案内で、署名・作者・hash を確かめずに実行する根拠にはしない。
作者の WebFinger が案内するカタログ（rel `https://ubichill.com/ns/mods`）は、作者アカウントのドメインと同じオリジンでなければならない。配布先は別のホストでよい。
作者参照の解決（`install @…`・ブラウザの追加・作品ページ・`--check-public`）は、https で小文字のホスト名の URL だけを、
リダイレクトを追わずに 1 回 8 秒まで取得する。WebFinger・カタログ・lock・署名・manifest は 1 MiB まで。

署名の検証で分かった作者は表示に使い、依存に自動付与しない。作者参照または作品ページから明示的に追加した依存の作者固定は lock v2 の `packages` に保存する。旧 Host が参照する `mods` は空にし、作者固定を読み飛ばした実行を防ぐ。
新 Host は従来の URL 依存・lock v1 も読む。作者の確認、公開環境の取り消し、利用者の権限承認は共通の仕組みを使う。
署名は作者を示し、内容の安全性を保証するものではない。

アセットは `assets/` に置き、Worker から `Ubi.asset.bytes` / `Ubi.asset.wasm` を使う。
manifest に各アセットの hash が入り、その manifest をワールドの lock が固定する。

## 作者署名（必須）

mod の配布物には作者アカウントの署名が必須。Host は、署名で作者を確認できた mod だけを実行する。
鍵・作者アカウント・公開環境・取り消しはワールドの署名と同じ仕組みを使う（[author-publishing.md](design/author-publishing.md)）。
署名は `ubichill login`（CI は `ubichill ci create` で作った Secret `UBICHILL_CREDENTIALS`）のあと `ubichill publish <ビルド出力>` で行う。mod はサーバーへ送らない。

- **署名するもの**: `v<version>/lock.json` のうち実行内容を決める部分（id・版・manifest の hash・各 Worker の hash と権限の上限）。
  置き場所（URL）は含めないので、同じ配布物をどこに置いても同じ署名で確かめられる。署名は `v<version>/lock.sig.json` に置く。
- **Host の確認**: ワールドの lock と一致した mod の `lock.sig.json` をブラウザで照合し、作者のサーバーの WebFinger から鍵の一覧を取って作者を確かめる。
  署名が無い・lock と合わない・作者の鍵ではない・鍵が取り消された・作者をいま確認できない mod は実行しない。
  lock v2 で作者を固定した依存は、署名の作者が固定した作者と違えば実行しない。
- **権限の許可は「作者＋mod ID」に付く**: 利用者の許可・拒否は、確認できた作者と mod ID の組に記録する。
  同じ作者の新しい版は許可を引き継ぎ、同じ ID を名乗る別の作者の mod は引き継がない。
- **開発用の Host**: `pnpm dev`、または `VITE_ENVIRONMENT=development` でビルドした Host は、自分のオリジンから配る mod に限り、
  署名ファイルの無い mod を未署名として動かす。署名ファイルがあれば必ず確かめる。lock に作者を固定した mod には例外を使わない。
  本番としてビルドした Host（`VITE_ENVIRONMENT` を指定しないビルドを含む）に例外は無い。
- **本体のイメージに同梱する mod**: イメージのビルド前に `packages/frontend/public/mods` へ署名を置く。
  `--build-arg REQUIRE_MOD_SIGNATURES=true` を付けると、署名の無い mod・内容と合わない署名があればビルドを止める（`Dockerfile`）。

関連: [CLI](../packages/cli/README.md)、[実行モデル](MOD_RUNTIME.md)、[権限](CAPABILITIES.md)、
[作者参照と発見の設計](design/mod-discovery.md)。
