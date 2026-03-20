# World as Code (WaC)

ワールドは YAML ファイルで定義する。Zenn の記事が Markdown で書かれて DB に変換されるように、
YAML が唯一の真実（Source of Truth）であり、DB はランタイムが高速に読めるよう変換された形式に過ぎない。

```
world.yaml (人間が書く)
    │
    ▼  
    │
PostgreSQL (ランタイムが読む)
```

ワールドは**ステートレス**。インスタンスが生きている間だけ状態を保持し、終了すると消える。
`world.yaml` の `initialEntities` が毎回の初期状態になる。

---

## CRD 仕様

Kubernetes CRD と同じ構造を採用。`apiVersion` / `kind` / `metadata` / `spec` で統一。

### Room（ワールド定義）

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Room
metadata:
  name: my-world
  version: "1.0.0"
  author:
    name: yourname
spec:
  displayName: "マイワールド"
  description: "説明文"

  capacity:
    default: 10
    max: 20

  environment:
    backgroundColor: "#F0F8FF"
    backgroundImage: "https://..."   # オプション
    worldSize:
      width: 2000
      height: 1500

  # インストールするプラグイン
  plugins:
    - name: pen
      src: https://yourname.github.io/pen-plugin
      config:          # 作者のみ編集可能な初期値
        strokeWidth: 3

    - name: avatar
      src: https://ubichill.github.io/avatar-plugin

  # ワールド起動時の初期エンティティ
  initialEntities:
    - kind: "pen:stroke"
      transform: { x: 200, y: 300, z: 0, w: 100, h: 60, rotation: 0 }

  permissions:
    allowGuestCreate: false
    allowGuestDelete: false
```

### Package（プラグイン定義）

プラグイン作者が `plugin.json` ではなく将来的に `package.yaml` として公開する形式。
`ubi deploy` がこれを読んで GitHub Pages 等にデプロイする。

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Package
metadata:
  name: pen-plugin
  version: "1.2.0"
  author:
    name: yourname
    url: https://github.com/yourname
spec:
  displayName: "ペンツール"
  description: "ドローイング用プラグイン"
  license: "MIT"

  # Worker エントリポイント（esbuild でバンドルされた JS）
  worker: ./dist/worker.js

  # フロントエンドコンポーネント（npm パッケージまたは URL）
  frontend: ./dist/frontend.js

  # Host 側に要求する権限
  capabilities:
    - scene:read
    - scene:update
    - net:fetch
```

### Avatar（カーソル定義）

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Avatar
metadata:
  name: my-cursor
  version: "1.0.0"
spec:
  displayName: "カスタムカーソル"
  hideSystemCursor: true

  states:
    default:
      url: ./assets/normal.png
      hotspot: { x: 0, y: 0 }
    pointer:
      url: ./assets/pointer.png
      hotspot: { x: 6, y: 0 }
    busy:
      url: ./assets/busy.webp    # アニメーションは WebP / APNG
      hotspot: { x: 10, y: 10 }
```

#### 標準 Avatar State

| state | 用途 |
|---|---|
| `default` | 通常時 |
| `pointer` | クリック可能要素 |
| `busy` | 処理中（アニメーション推奨） |
| `text` | テキスト入力 |
| `not-allowed` | 操作不可 |
| `move` | 移動可能 |
| `grabbing` | ドラッグ中 |

---

## 認証・所有権

- YAML を `ubi deploy` したユーザーが **owner**（PostgreSQL レコードに `ownerId` を保存）
- `config` など作者専用フィールドの更新は `ownerId` 一致チェックで保護
- 将来的に OAuth（GitHub 等）と連携予定

---

## プラグイン配布

プラグインは URL ベースで配布する。GitHub Pages / 任意 CDN が使える。

```yaml
plugins:
  - name: pen
    src: https://yourname.github.io/pen-plugin   # GitHub Pages
  - name: custom
    src: https://cdn.example.com/my-plugin       # 任意ホスティング
```

`src` の URL から Worker JS と Frontend JS を取得する。
セキュリティ上、取得時に Content-Type 検証と `plugin.json` のチェックサム照合を行う（実装予定）。

---

## バリデーション

`ubi deploy` 実行時にサーバー側で以下を検証する。

| チェック | 目的 |
|---|---|
| YAML サイズ制限（100KB） | YAML Bomb 防止 |
| Alias 上限（100） | 再帰爆発防止 |
| URL ホワイトリスト | XSS / フィッシング防止 |
| 依存深度制限（3階層） | 無限ループ防止 |
| SemVer 形式 | バージョン解決の一貫性 |
