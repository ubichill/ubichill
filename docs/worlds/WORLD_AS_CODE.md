# World as Code (WaC)

このドキュメントは **思想/全体像**。正確なフィールド定義は [FORMAT.md](./FORMAT.md)（正準リファレンス）を参照。

ワールドは YAML で定義する。**YAML が唯一の真実（Source of Truth）**であり、ワールドは URL で識別される
（＝「ワールド＝URL」）。engine は URL からワールド定義を取得・検証してインスタンスを立てる。

```
world.yaml (人間が書く / どこかにホスト)
    │  URL で取得（自ホスト bundle / GitHub / 他インスタンス＝連合）
    ▼
worldRegistry（メモリ解決）→ instance
```

- **official ワールド**（本体にバンドルした `worlds/*.yaml`）や外部ワールドは **DB に保存しない**（メモリ解決＋URL 配信）。
- **ユーザーが本体で作成したワールド**だけが DB に保存される（所有権付き）。
- ワールドは**ステートレス**。インスタンスが生きている間だけ状態を保持し、終了すると消える。
  `initialEntities` が毎回の初期状態になる。

---

## CRD 仕様

Kubernetes CRD と同じ構造を採用。`apiVersion` / `kind` / `metadata` / `spec` で統一。

### World（ワールド定義）

```yaml
apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: my-world           # kebab-case（ワールド id）
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
    worldSize:
      width: 2000
      height: 1500

  # 依存する mod の入手元ヒント（任意）。実際にどの Component を載せるかは
  # initialEntities の component type で決まる。
  dependencies:
    - name: pen
      source: { type: url, url: "https://yourname.github.io/pen-mod" }

  # ワールド起動時の初期エンティティ（Entity=箱、component が振る舞いを配布）
  initialEntities:
    - id: pen-1
      transform: { x: 200, y: 300, z: 0, w: 100, h: 60, rotation: 0 }
      components:
        - type: "pen:stroke"     # <modId>:<componentName>
          data: { strokeWidth: 3 }  # 初期値（旧 spec.mods[].config 相当）

  permissions:
    allowGuestCreate: false
    allowGuestDelete: false
```

> **mod の定義（`mod.json`）は [../MOD.md](../MOD.md) を参照。** ワールドは複数の mod を URL から
> 読み込んで構成する。ワールド YAML は初期エンティティに載せる Component（`<modId>:<name>`）と
> 入手元 `dependencies` を宣言し、各 mod の中身（Component・権限・配布形式）は mod 側の関心事として分離している。
> フィールドの完全な定義は [FORMAT.md](./FORMAT.md)。

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

- YAML を `ubi mod deploy` したユーザーが **owner**（PostgreSQL レコードに `ownerId` を保存）
- `config` など作者専用フィールドの更新は `ownerId` 一致チェックで保護
- 将来的に OAuth（GitHub 等）と連携予定

---

## mod の読み込み

ワールドは初期エンティティの Component（`<modId>:<name>`）と `spec.dependencies[].source` の URL から
mod を読み込む。配布方法（GitHub Pages / CDN・versioned manifest）は mod 側の関心事なので
[MOD.md](../MOD.md#配布) を参照。

依存する mod は **ロックファイルで内容ハッシュ（integrity）ごと固定**する（world owner が所有）。
URL のドメイン乗っ取りや CDN 改竄で「同じバージョンの別物」が配信されても、ハッシュ不一致で
実行を拒否できる。詳細は [MOD.md（バージョンと lock）](../MOD.md#バージョンと-lock)。

---

## バリデーション

ワールド YAML を `ubi mod deploy` した際、サーバー側で以下を検証する。

| チェック | 目的 |
|---|---|
| YAML サイズ制限（100KB） | YAML Bomb 防止 |
| Alias 上限（100） | 再帰爆発防止 |
| URL ホワイトリスト | XSS / フィッシング防止 |
| 依存深度制限（3階層） | 無限ループ防止 |
| SemVer 形式 | バージョン解決の一貫性 |
