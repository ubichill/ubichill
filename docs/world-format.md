# ubichill ワールド定義フォーマット (`ubichill.com/v1alpha1`)

ワールドは 1 つの YAML（または JSON）ドキュメントで自己記述する。**この仕様に従っていれば、誰がどこにホストしても、任意の ubichill インスタンスが URL からそのワールドを解決してインスタンスを立てられる**（連合）。

- **ワールド＝URL**：ワールドの一意キーは、その定義を返す URL。
- 取得は素の `GET <url>`（`Accept: application/yaml` で YAML、既定 JSON のホストもある）。
- インスタンス側は取得した定義を検証し、`initialEntities` を配置してインスタンスを生成する。

## 最小例

```yaml
apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: my-world            # kebab-case（[a-z0-9-]、1–50 文字）。ワールド id
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

## `spec.initialEntities`（ECS 配置）

ワールドの中身は Entity（＝GameObject）の木で表す。

- **Entity**：`id`＋`transform`＋`components[]` を持つ「箱」。`children[]` で入れ子。id はツリー全体で一意。
- **Component**：`type: "<modId>:<componentName>"`（例 `pen:tray`）で振る舞いを配布。1 Entity に複数可。`data` は Component ごとの初期値。

```yaml
initialEntities:
  - id: screen-1
    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }   # w/h は任意
    tags: [surface]                                          # 任意（kebab 系）
    components:
      - type: video-player:screen
        data: { url: "https://..." }
    children:
      - id: controls-1
        transform: { x: 0, y: 320 }
        components:
          - type: video-player:controls
            data: {}
```

上限（`LIMITS`）: initialEntities 最大 500、Component/Entity 最大 32、tags 最大 10、YAML 100KB。

## その他の `spec` フィールド（任意）

- `dependencies[]`：`{ name, source: { type: 'repository'|'npm'|'url', path?/url?/version? } }`。mod の入手元ヒント。
- `permissions`：`{ allowGuestCreate: bool, allowGuestDelete: bool }`。

## 連合（他インスタンス／外部ホスト）

- ワールドを配信できる URL の例：
  - 本体がホストするワールド：`https://<host>/api/v1/worlds/<id>`（`?format=yaml` or `Accept: */yaml` で YAML）
  - GitHub の生 YAML：`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/worlds/<name>.yaml`（`blob` URL も可、自動で raw 化）
  - GitHub ディレクトリ（複数ワールド）：`https://github.com/<owner>/<repo>/tree/<ref>/worlds`（Contents API で列挙）
  - 任意 CDN のインデックス JSON：`[{ "url": "..." }] | [{ "file": "..." }]`
- 受け手のインスタンスは URL を渡すだけでインスタンスを作成できる（`worldId` に id ではなく URL を渡す）。取得した定義は取り込み元（provenance）を `source`（`local`/`github`/`registry`/`remote-instance`/`url`）として保持する。

## 正準スキーマ

Zod スキーマが唯一の真実源：`packages/shared/src/schemas/world.schema.ts`（`WorldDefinitionSchema`）。互換性はこの `apiVersion` で管理する。
