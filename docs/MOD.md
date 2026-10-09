# mod パッケージ

mod は ubichill の**配布・信頼の単位**。1 つの mod が複数の Component（それぞれ 1 Worker）を束ねる。
ユーザーは mod 単位で信頼を判断し、権限も mod 単位で記憶される。ワールドは複数の mod を
URL から読み込んで構成する（→ [WORLD_AS_CODE.md](./worlds/WORLD_AS_CODE.md)）。

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

### 同梱アセット

`mods/<id>/assets/` に置いたファイル（WASM・データ・zip など）は、ビルドで versioned ディレクトリへコピーされ、
各ファイルの sha256 が manifest の `assetIntegrity` に載る。manifest は lock で固定されるので、アセットの中身も
lock に連なって固定される。Worker からは `Ubi.asset.bytes(path)` / `Ubi.asset.wasm(path)` で読み、Host が
integrity と照合してから渡す（→ [MOD_RUNTIME.md](./MOD_RUNTIME.md)）。サンプルは `mods/wasm-demo`。

---

## 権限（capability）

mod 開発者は権限を宣言しない。使用している `Ubi.*` API からビルド時に自動生成され、実際の許可は
ユーザーが mod 読み込み時に一括承認する。全一覧・危険度・同意モデルは
**[CAPABILITIES.md](./CAPABILITIES.md)** を参照。

---

## バージョンと lock

mod は URL で動的に読み込まれるため、**バージョン番号を固定するだけでは不十分**。
同じ `version` でも、URL のドメインが乗っ取られたり CDN 上の内容が差し替えられれば
「同じバージョンの別物（悪意あるコード）」が配信され得る。

そこで **`package-lock` / SRI 相当の内容ハッシュで固定する**（構想）:

- ワールドが依存する各 mod を **`{ id, version, url, integrity: "sha384-…" }`** としてロックファイルに記録する。
- 読み込み時、Host は取得した mod の内容ハッシュを計算し、ロック値と照合する。
  **不一致なら実行しない**（改竄・乗っ取りを検出）。
- `version` は **SemVer**。runtime アセットはバージョン付きパス（`/mods/<id>/v<version>/…`）で
  固定配信されるが、その内容もハッシュで縛ることで「バージョンは同じだが中身が変わった」を弾く。
- lock の更新は**明示的な再ロック時のみ**。それ以外は承認済みの内容と bit 単位で同一であることが保証される。

**lock が守るもの / 守らないもの**（役割の分離）:

| | 担当 |
| --- | --- |
| **内容整合性（integrity）**: 承認したものと同一のコードか | ← lock（本節） |
| **信頼性（trust）**: そもそも承認してよい mod か | ← capability 同意（[CAPABILITIES.md](./CAPABILITIES.md)） |

lock は「最初から悪意ある mod」は防げない（それは capability 同意とレビューの領分）。
lock が防ぐのは「一度承認した mod が、後から URL 乗っ取り・CDN 改竄ですり替わる」こと。
ロックファイルはワールドが依存する mod 群を固定するもので、world owner が所有する
（→ [WORLD_AS_CODE.md](./worlds/WORLD_AS_CODE.md)）。

### 依存関係

現状 mod は自己完結で、mod → mod の依存は持たない。Component 間の連携は `Ubi.event`
（scope / targetType）の**疎結合**で行い、相手が居なければ優雅に劣化する（ハードな依存解決はしない）。
将来 mod → mod 依存を入れる場合も、ゼロトラストのため **capability は依存間で継承しない**
（各 mod は独立ロード＋各自の承認＋各自の integrity 照合）。

### プロトコル互換

mod は SDK 経由で Host と通信する。SDK と Host は独立更新されるため、初期化時に
`PROTOCOL_VERSION` を突き合わせて非互換を検出する
（→ [CAPABILITIES.md](./CAPABILITIES.md#プロトコルバージョン)）。

---

## 作者署名（必須）

mod の配布物には**作者アカウントの署名が必須**。Host は、署名で作者を確認できた mod だけを実行する。
鍵・作者アカウント・公開環境・取り消しはワールドの署名と同じ仕組みを使う（→ [author-publishing.md](./design/author-publishing.md)）。

| | 担当 |
| --- | --- |
| 承認したものと同一のコードか | lock（ワールドが固定） |
| そのコードをだれが出したか | 作者署名（本節） |
| 何をしてよいか | capability の同意 |

- **署名するもの**: `v<version>/lock.json` のうち実行内容を決める部分（id・version・manifest の hash・各 worker の hash と
  権限の上限）。置き場所（URL）は含めないので、同じ配布物をどこに置いても同じ署名で確かめられる。
- **置き場所**: `lock.json` の兄弟の `v<version>/lock.sig.json`。
- **署名の方法**: `ubichill build` のあとに `ubichill publish <ビルド出力>`（`ubichill login` したアカウント。CI は
  Secret `UBICHILL_CREDENTIALS`）。mod はサーバーへ送らない。署名済みの出力をそのまま GitHub Pages などへ置く。
- **Host の確認**: ワールドの lock と一致した mod について `lock.sig.json` を取得し、サーバー
  （`POST /api/v1/mods/signature/verify`）で署名と作者（署名鍵が作者の有効な公開環境の鍵か）を確かめる。
  署名が無い・lock と合わない・作者の鍵ではない・鍵が取り消されている・作者をいま確認できない mod は実行しない。
- **表示**: 権限の確認画面と World Editor の mod 一覧（選んでいる版）に、確認できた作者（`@ID@ドメイン`）を出す。名乗っているだけの作者は出さない。
  実行しなかった mod は、理由つきで画面に出す（いまは確認できない場合は再試行できる）。
- **権限の許可は「作者＋mod の ID」に付く**: 利用者が許可・拒否した記録（capability・外部通信のドメイン）は、確認できた作者と mod の ID の組に
  結び付ける。同じ作者の新しい版は許可を引き継ぎ、同じ ID を名乗る別の作者の mod は引き継がない。
  作者署名が必須になる前の記録（ID だけ）は、どの mod にも使われない（もう一度確認する）。
- **取り消しが届くまで**: 作者が公開環境を取り消すと、作者のサーバーが動いていれば 1 時間以内に Host のサーバーへ届く。ブラウザは確認できた結果を
  5 分だけ使い回し、それを過ぎた読み込み（ワールドの移動・入り直し）で確認し直す。実行中の mod は止めない。

```bash
npx ubichill login                 # 1 回だけ（CI は ubichill ci create で作った UBICHILL_CREDENTIALS）
npx ubichill build
npx ubichill publish dist          # 単体 mod の出力。複数 mod なら dist/mods
npx ubichill verify --dist-dir=dist --require-signatures
```

内容が変わるビルドをすると、以前の内容に付けた `lock.sig.json` は消える（署名し直す）。同じ内容の再ビルドでは残る。

### 開発中の mod

開発用の Host（`pnpm dev`、または `VITE_ENVIRONMENT=development` でビルドしたプレビュー）は、**自分のオリジンから配る mod に
限って**、署名ファイルの無い mod を「署名なし（開発）」として動かす。署名ファイルがあれば開発用の Host でも必ず確かめる。
本番としてビルドした Host（`VITE_ENVIRONMENT` を指定しないビルドを含む）に例外は無い。

自分でビルドしたイメージに自分の mod を同梱して本番運用するときは、自分のサーバーのアカウントで署名する
（`ubichill login --server=<自分のサーバー>` → `ubichill publish packages/frontend/public/mods` → イメージをビルド。
`--build-arg REQUIRE_MOD_SIGNATURES=true` で、署名の無い mod があればビルドを止められる）。
公式イメージに同梱の mod は公式アカウント（`ubichill@ubichill.com`）の署名なので、サーバーが `ubichill.com` に
問い合わせられる必要がある（確認できた結果はサーバーに保存される）。

---

## 配布

mod は URL ベースで配布する（GitHub Pages / 任意 CDN）。ワールドは `spec.dependencies[].source` にその URL を書く。

```yaml
mods:
  - name: pen
    src: https://yourname.github.io/pen-mod   # GitHub Pages
  - name: custom
    src: https://cdn.example.com/my-mod       # 任意ホスティング
```

`src` から versioned manifest と Worker JS を取得する。取得時に Content-Type 検証と、
ロックファイルの `integrity` ハッシュ照合を行う（→ [バージョンと lock](#バージョンと-lock)。実装予定）。
これにより、同一 URL・同一バージョンでも内容がすり替わっていれば検出できる。
