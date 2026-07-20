# ワールド URL ネイティブ化（分散・provenance・DB 最小化）

対象ブランチ: `feat/worlds-url-native`

## 目的

- **ワールド＝URL**。engine/instance は常にワールドを URL で扱う。
- official / 外部 / ユーザー作成、すべて URL で addressable にする。
- official・外部ワールドは **DB に upsert しない**（メモリ解決＋キャッシュ）。孤児・preview seed・分散不可の根絶。
- 各ワールドに **provenance（どのソース/レジストリ由来か）＋著者** をデータとして持たせる（フェデレーション：他インスタンス製ワールドを URL で閲覧）。
- storage を差し替え可能に：デフォルト＝本体、オプションで **S3**、外部ホスト（GitHub 等）も可。

## DB 必要性の結論

| 対象 | DB | 理由 |
|------|----|------|
| ワールドの内容・配布 | 不要 | URL で自己記述。official は upsert しない |
| instances（ライブ状態） | 要 | leader/参加者/アクセスは複数レプリカで共有必須。worldId は URL 参照で足りる |
| accounts / 所有権 | 要 | 分散不可 |
| ユーザー作成ワールドの実体 | 要（DB でなくてよい） | 本体 / S3 / 外部ホストのいずれか。上限ありなので DB でも軽い |

## モデル

### ワールド識別子（WorldRef）
- ワールドの正体は **正規化された URL**。
- 本体がホストするワールド（official / ユーザー作成）: `{PUBLIC_BASE_URL}/api/v1/worlds/{id}/world.yaml`
- 外部: その URL 直（GitHub / 他インスタンス）。
- `instances.worldId`(FK→worlds.id) を **`instances.worldRef`(text, URL, FK なし)** に変更。favorites も worldRef で持つ。

### provenance（WorldSource）
`ResolvedWorld` / `WorldListItem` に付与する:
```
WorldSource = {
  kind: 'local' | 'github' | 'registry' | 'remote-instance' | 'url'
  url: string             // 正規 fetch URL
  registryName?: string   // 例: "ubichill official"
  originInstance?: string // 由来 ubichill インスタンスの base URL（フェデレーション）
}
```
著者は YAML `metadata.author`（外部）または DB `authorId`（本体作成）から。

### 解決層（worldResolver）
URL → 検証済み `ResolvedWorld`（メモリキャッシュ、remote は TTL）。対応:
- 本体ローカル `worlds/*.yaml`（本体 URL で配信）
- `https://` 直 YAML
- GitHub blob→raw（既存）＋ **GitHub dir/tree → Contents API 列挙（新規実装）**
- 他 ubichill インスタンス `/api/v1/worlds/...`

### レジストリ設定
`WORLDS_REGISTRY_URLS` は「ソース」のリストへ。各要素は 直 YAML URL / GitHub dir URL（Contents API で列挙）/ 他インスタンス base。**worlds.json は廃止**（二重役割＝ローカル索引＋配布マニフェストを解消）。

### storage 抽象（WorldStore, ユーザー作成用）
```
interface WorldStore {
  put(id, def): Promise<url>
  get(id): Promise<WorldDefinition>
  delete(id): Promise<void>
  list(authorId?): Promise<WorldMeta[]>
}
```
- `LocalDbWorldStore`（デフォルト）: definition は DB、`/api/v1/worlds/:id/world.yaml` で URL 公開。
- `S3WorldStore`（オプション、env 設定）。

### listWorlds
メモリの official/registry 索引（DB 非依存）＋ WorldStore のユーザーワールド。各要素に `source` と著者を含める。

## Discovery レイヤ（将来像・core とは別レイヤ）

「ワールド＝URL」である以上、discovery（探す）は自前インフラを持たず**オープンウェブ＋既存検索エンジンに委譲**できる。
レジストリも検索も「ワールド URL を見つける手段（discovery アダプタ）」の違いにすぎない、と統一する：

```
GitHub tree / index JSON / インスタンス連合 / Web検索  →  すべて「ワールド URL」を返すだけ
```

### 中立性の原則
- **GitHub / Google など特定サービスへの依存は core に持ち込まない。** core（URL で解決して入る）は検索・レジストリがゼロでも動く。
- discovery は差し替え可能なアダプタに閉じ込める（GitHub Contents API をアダプタ化したのと同じ扱い）。
- レジストリの**正規形式は index JSON（任意の CDN/S3/Web で配信可）とインスタンス連合**。GitHub Contents API は便利アダプタの一つ。

### Web 検索 discovery（案）
検索エンジンに拾わせるには、ワールドが**クロール可能なページ＋構造化メタ**を持つ必要がある：
1. **公開ワールドページ** `/worlds/:id`（人間＆クローラ向け HTML、「ubichill で開く」ボタン）。インスタンスホストのワールドは自動で得られる。
   - `raw.githubusercontent.com` は `X-Robots-Tag: none` でインデックス拒否 → GitHub raw 直は SEO 向きでない。インスタンス配信ページが本命。
2. **構造化データ**: OGP（共有リッチプレビュー）＋ JSON-LD/Schema.org ＋「ubichill world」マーカー（検索で world 絞り込み用）。
3. **sitemap.xml / canonical**。
4. **アプリ内検索**は discovery プロバイダ（Google Programmable Search Engine 等）を薄くラップ。または Web 検索へのディープリンク。

### 注意点
- 依存のすり替え防止（Google 依存を core に入れない）。即時性なし（インデックス遅延、作成直後は自インスタンス一覧で担保）。公開ワールドのみ対象。ランキングは検索エンジン依存。CSE 無料枠 100 クエリ/日。

**第一歩**: 公開ワールドページ＋OGP/JSON-LD/sitemap（P2/P3 のフロント作業と相性が良い独立タスク）。core（P1/P3）はこの構想の影響を受けない。

## 段階（すべて本ブランチ）

- **P1**: shared 型（WorldSource / WorldRef、ResolvedWorld・WorldListItem 拡張）。worldResolver（URL 解決＋GitHub Contents API＋キャッシュ）。worldRegistry を resolver ベースへ書き換え、official/registry をメモリ索引化（DB upsert 廃止）。worlds.json 廃止。
- **P2**: WorldStore 抽象。LocalDbWorldStore＋S3WorldStore。ユーザーワールド CRUD を store 経由に。`/:id/world.yaml` 配信。
- **P3**: `instances.worldRef` 移行（schema＋backfill＋コード、FK 撤去）。favorites を ref 化。frontend で source/著者表示＋URL 入室。

CLAUDE.md 方針により後方互換は担保しない（worlds.json・旧 schema をきれいに置換）。
