# ubichill ワールド定義フォーマット (`ubichill.com/v1alpha1`)

これは**正確なフィールド定義（正準リファレンス）**。思想・全体像は [WORLD_AS_CODE.md](./WORLD_AS_CODE.md)。

ワールドは 1 つの YAML（または JSON）ドキュメントで自己記述する。**この仕様に従っていれば、誰がどこにホストしても、任意の ubichill インスタンスが URL からそのワールドを解決してインスタンスを立てられる**（連合）。

- **ワールド＝URL**：ワールドの一意キーは、その定義を返す URL。
- 取得は素の `GET <url>`（`Accept: application/yaml` で YAML、既定 JSON のホストもある）。
- インスタンス側は取得した定義を検証し、`initialEntities` を配置してインスタンスを生成する。

## 最小例

```yaml
apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: my-world            # kebab-case（[a-z0-9-]、1–50 文字）。ワールドの名前で、本体での URL は /@<ID>/my-world
  version: 1.0.0            # SemVer
  author:                   # 任意
    name: Alice
    url: https://example.com   # 任意
spec:
  displayName: マイワールド    # 表示名（必須）
  description: 説明            # 任意
  thumbnail: https://.../thumb.png  # 任意（URL）
  capacity:
    default: 10             # 既定人数
    max: 20                 # 上限人数
  environment:              # 任意
    backgroundColor: "#F0F8FF"   # HEX
    worldSize: { width: 2000, height: 1500 }
  initialEntities: []       # 後述（既定 []）
```

### `environment.worldSize` と `Ubi.ride`

既定では自分の位置はマウス追従（`pointermove` + ネイティブスクロール）で、`worldSize` はスクロールコンテナの初期サイズのヒントに過ぎず強制力は無い。

乗り物 Entity を持つ mod が `Ubi.ride.exclusive()` を宣言すると、ユーザーがそれに乗っている間だけアバターが OS カーソルから切り離され、矢印キーでの移動＋カメラ追従（このときだけ `worldSize` がパン可能範囲としてクランプされる）に切り替わる。降りると通常のマウス追従に戻る。マウス操作とキーボード操作はワールド単位の排他設定ではなく、乗車状態によって動的に切り替わる。

## `spec.initialEntities`（ECS 配置）

ワールドの中身は Entity（＝GameObject）の木で表す。

- **Entity**：`id`＋`transform`＋`components[]` を持つ「箱」。`children[]` で入れ子。id はツリー全体で一意。
- **Component**：`type: "<modId>:<componentName>"`（例 `pen:tray`）で振る舞いを配布。1 Entity に複数可。`data` は Component ごとの初期値。

```yaml
initialEntities:
  - id: tv
    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }   # w/h は任意
    tags: [surface]                                          # 任意（kebab 系）
    components:
      - type: example:screen
    children:
      - id: remote
        transform: { x: 0, y: 320 }
        components:
          - type: example:remote
            data:
              screen: tv          # 参照フィールド: example:screen を持つ Entity の id
```

### 参照フィールド（Component 同士の配線）

Component が別の Component と連携するときは、mod が `dataFields` に参照フィールド（`entityRef` / `entityRefArray`）を
宣言し、作者が値に **Entity の id** を書く（World Editor では Hierarchy からドロップする）。

- 参照が `component: <型>` を宣言していれば、指す Entity はその型の Component を持っていなければならない。
- `required` の参照が未設定・指す Entity が無い・型が合わないときは、World Editor（Hierarchy の印と Inspector）と
  `ubichill dev`（ターミナル）が知らせる。ワールドは作れるが、その参照に送るイベントは届かない。
- 相手を置く場所は自由（同じ Entity・子・別の木のどこでもよい）。親子や兄弟の形で連携を決める mod では、
  その mod の説明に書かれた形に従う。

上限（`LIMITS`）: initialEntities 最大 500、Component/Entity 最大 32、tags 最大 10、YAML 100KB。

### 組み込み Component（`core:*`）

Host が持つ Component。mod を読み込まずに使え、`dependencies` にも書かない。`core:` は予約名で、ここに無い型は検証で落ちる。
クライアントからは作成・変更できない（ワールド定義でだけ置ける）。

| 型 | 役割 | `data` |
|---|---|---|
| `core:collider` | 当たり判定の形 | `shape: rect`（`size: { w, h }` か `entity`）または `shape: circle`（`radius`）。`offset`・`isTrigger`・`layer`・`mask` |
| `core:media` | 動画を描く場所（Unity の MeshRenderer に当たる）。何を再生するかは、参照フィールドでこの Entity を指した mod が決める。1 つの面を指せる出力は 1 つだけ（2 つ以上が指す・1 Entity に 2 つ置くと何も描かない）。描けるのはワールド定義に置いた Component の出力だけ（部屋の中で作られた Component は数えない） | `fit: contain`（既定・全体を見せる）か `cover`（枠を埋める） |
| `core:ui` | 作者が書く UI（看板・説明・リンクなど）。mod を作らずに置ける | `markup`: HTML 風の文字列（2 万文字まで） |

```yaml
- id: tv
  transform: { x: 100, y: 100, w: 640, h: 360 }
  components:
    - type: core:media
      data: { fit: contain }
- id: player
  transform: { x: 100, y: 480 }
  components:
    - type: video-player:controls
      data:
        screen: tv            # core:media を持つ Entity
```

`core:ui` の `markup` は、mod の UI と同じ描画（Shadow DOM・許可リスト）で描く。

- 使えるタグ・属性は mod の UI と同じ（`div`・`p`・`h1`〜`h6`・`a`・`img`・`ul`・`table`・`svg` など）。SVG の `viewBox`・`linearGradient` など大文字を含む名前もそのまま書ける。
- 使えないタグ（`b`・`i`・`center`・`font` など）は、タグを外して中身の文字だけを描く（太字にしたいときは `strong`）。
- `script`・`style`・`template`・`iframe` などは中身ごと捨てる。`on*` 属性も捨てる（押しても何も動かない）。
- 要素名でない `<`（`x<y` など）は文字として描く。
- `style` 属性は使える。ただし外部の取得を起こす値（`url(...)` など）は描かない。
- リンク（`a href`）と画像（`img src`）は **https だけ**（画像は `data:image/` も可）。http・相対パス・`javascript:` などは描かない（mod の UI より狭い）。
  リンクは新しいタブで開き、参照元を送らない。
- 画像は利用者のブラウザが置き場所に直接取りに行く。参照元（部屋の URL・名前）は送らない（`referrerpolicy` は `no-referrer` に固定し、作者の指定は使わない）が、
  置き場所のサーバーには利用者の IP アドレスと読み込んだ時刻が見える。
- 入れ子は 32 段・要素は 2000 個まで。深すぎる部分は中身ごと描かない（浅い部分は描く）。
- 閉じ忘れなどの壊れた書き方でも、読める範囲で描く。World Editor の Inspector が、描かれないものを知らせる。

```yaml
- id: sign
  transform: { x: 100, y: 100, w: 360, h: 140 }
  components:
    - type: core:ui
      data:
        markup: |
          <div style="padding: 12px; background: #fff7e6; border-radius: 8px">
            <h2>ようこそ</h2>
            <p>ルールは<a href="https://example.com/rules">こちら</a></p>
          </div>
```

## その他の `spec` フィールド（任意）

- `dependencies[]`：`{ name, source: { url?, version? } }`。`url` があれば外部 mod（GitHub Pages 等）をその URL から取得し、無ければローカル（public mods）から解決する。mod の入手元ヒント。
- `permissions`：`{ allowGuestCreate: bool, allowGuestDelete: bool }`。

## 連合（他インスタンス／外部ホスト）

- ワールドを配信できる URL の例：
  - 本体がホストするワールド：`https://<host>/api/v1/authors/<ID>/worlds/<name>.yaml`（外部ホストと同じ形。共有 URL `https://<host>/@<ID>/<name>` も受け付ける）
  - GitHub の生 YAML：`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/worlds/<name>.yaml`（`blob` URL も可、自動で raw 化）
- ほかの ubichill サーバーのワールドを一覧（グローバル）に出すには、公式アカウントが設定の「連合」でそのサーバーをフォローする。
- 受け手のインスタンスは URL を渡すだけでインスタンスを作成できる（`worldId` に id ではなく URL を渡す）。取得した定義は取り込み元（provenance）を `source`（`local`/`github`/`registry`/`remote-instance`/`url`）として保持する。

## 作者署名（`<world>.sig.json`）

- ワールドと同じ場所に兄弟ファイルとして置く（本体ホストも `.../worlds/<name>.sig.json` で同じ）。`ubichill publish --out` で生成する。
- 形式は mod と共通の作者署名（`format: "ubichill-signature"`・`version: 2`・`kind: "world"`。docs/PROTOCOLS.md）。作者アカウント（`author`）は必須で、正規の表記（`handle@domain`、ドメインは小文字）だけ。`subject` は `metadata.name`。
- 内容のハッシュ（`contentHash`）は `{ definition: <YAML をパースした生の値>, lock: <兄弟 lock の生 JSON | null> }` を正規化 JSON（RFC 8785 相当）にした sha256。
- 版 1 の署名（2026-10 より前の形式）は読まない。`ubichill publish` で署名し直す。
- ワールドの同一性は `ed25519:<公開鍵>/<metadata.name>`。URL が変わっても同じデータ・同じ鍵なら同じワールド。
- 署名に作者アカウント `author: handle@domain` を含めると、受け手は `https://<domain>/.well-known/webfinger?resource=acct:handle@domain` の links（rel `https://ubichill.com/ns/signing-keys`）から作者の鍵一覧 `{ account, issuedAt, keys: [{ publicKey, addedAt?, revokedAt? }] }` を取得し、署名鍵が取り消されていない鍵なら作者として表示し同一性を `acct:handle@domain/<metadata.name>` にする（鍵が変わっても変わらない）。一覧に無い・取り消された鍵なら作者は表示しない。
- 署名があって検証に失敗したワールドは解決を拒否する。
- **署名を検証できないワールド（未署名）は公開しない**：ワールド一覧・連合（global）一覧・プロフィール・インスタンス一覧に出さない。URL を直接指定すれば入れるが、入室前に確認を求める。
- 連合ピアの一覧に書かれた署名状態は信用せず、受け手が各ワールドを取得して検証する。
- サーバーは署名しない（鍵を持たない）。本体で作ったワールドも外部と同じく、作者が手元（ブラウザ・CLI）で「定義・lock」に署名し、`PUT /api/v1/worlds` に `{ yaml, lock, signature }` を一緒に送る（サーバーは中身を書き換えない。署名が通らなければ何も保存しない）。同じ作者・同じ `metadata.name` なら同じワールドの更新になる。エディタで `metadata.name` を変えると名前の変更（URL が変わり、以前の URL からもたどれる）。署名なしで送ると、公開中のワールドなら公開中の版を残して下書きになる。
- 公式ワールド（`worlds/`）は main に入ったら CI が公式アカウントで署名し（`ubichill publish worlds/*.yaml --out=worlds`）、イメージに同梱する。署名はコミットしない。ほかのリポジトリも同じ方法で公開できる（`packages/sdk/README.md` の CI の例）。
- 本体は YAML・lock・署名をファイル（DB）の生の値のまま配信する（既定値で補うと署名と一致しなくなるため）。

## 正準スキーマ

Zod スキーマが唯一の真実源：`packages/shared/src/schemas/world.schema.ts`（`WorldDefinitionSchema`）。互換性はこの `apiVersion` で管理する。
