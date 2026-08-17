# ECS マイグレーション設計ノート

ubichill のmodモデルを Unity 風 (MonoBehaviour 寄り) の Component 駆動から、
Pure ECS の方向に漸近させていく一連の作業の記録。命名・責務・通信プロトコルを 1 箇所にまとめる。

関連: [ARCHITECTURE.md](../ARCHITECTURE.md) / [API.md](../API.md)

---

## 0. 用語と命名規約

ECS 業界標準では **Entity == GameObject**。ubichill では「Entity」を Pure ECS の
Entity の意味で使い、ランタイムで Worker に渡る flat ビューを `ComponentInstance` と呼ぶ。

| 概念 | 型 / 識別子 | 解説 |
|---|---|---|
| **Entity** (== GameObject) | `WorldEntity` / `entityId` | `transform` + `components[]` + `children[]` を持つ「箱」。kebab-case の人間可読 id。 |
| **Component (型)** | `EntityComponent` | Entity に貼り付く 1 つの振る舞い。`type = "modId:componentName"`。 |
| **Component インスタンス (実体)** | `ComponentInstance<T>` / `id` (= `componentInstanceId`) | Worker 1 つに 1:1 対応する flat ビュー。`entityId` (自身が乗る Entity) と `parentEntityId` (親 Entity) を持つ。 |
| Worker 識別子 | `Ubi.componentInstanceId` | サンドボックス内で「私はどの Component インスタンスか」を一意に示す。 |
| Entity 識別子 | `Ubi.entityId` | この Component が乗っている Entity (GameObject) の id。Pure ECS の Entity と一致。 |
| Component 型名 | `Ubi.componentType` | `"modId:componentName"` |

### よくある混乱と回避策

- **Worker 内では「自分」== Component インスタンス**。`Ubi.entityId` は「自分が乗っている箱」であって、同一 Entity 上には他の Component インスタンスも存在し得る。
- `ComponentInstance` の `id` フィールドが内部 flat ID (= `componentInstanceId`)、`entityId` が GameObject 側の id。命名が紛らわしいが、Worker 互換の flat 形を維持する以上どこかで一致しないキーが出る。**「Worker からは entityId が GameObject」**と覚える。

---

## 1. パッケージ責務 (再掲)

| パッケージ | 責務 | 依存禁止 |
|---|---|---|
| `@ubichill/ecs` | 純粋 ECS (Entity / Component / System / Query)。Worker 内ローカル ECS で使用。 | React / DOM / Worker / Network |
| `@ubichill/sandbox` | Worker ライフサイクル・Tick・入力収集・コマンドディスパッチ | React |
| `@ubichill/sdk` | mod公開 API (`Ubi`)。Worker 内のみで動く。 | Host 内部 |
| `@ubichill/react` | Host 側 React Hooks (`useModWorker` 他) | — |
| `@ubichill/shared` | 型・プロトコル定義 | — |
| `mods/*` | 各mod実装。`@ubichill/sdk` のみ依存。 | — |

---

## 2. Stage 1〜3 振り返り

### Stage 1: Entity / Component / System の分離

エディタ / DB レイヤでは GameObject (Entity) と Component の分離を導入し、
Worker への配信時に flat ビュー (`ComponentInstance`) に展開する非対称モデルを採用。

主な追加: `WorldEntity` (GameObject 側) と `ComponentInstance` (Worker flat 側) の二重表現、
`flattenGameObject` 純関数、`AvailableComponent` (Editor メタデータ)。

### Stage 2: 1 Component = 1 Worker

各 `ComponentInstance` ごとに 1 つの Sandbox Worker を立ち上げる方針に切替。
`ModHostManager` を `componentInstanceId` でレジストリ管理し、React 側で
`WorkerModHost` が Component インスタンスごとに mount する。

### Stage 3: watchScope + 通信プロトコル

各 Worker が自分にとって意味のある Entity だけを購読できるように `watchScope` を導入。

- `entity`: 自 Entity 上の Component インスタンスのみ
- `subtree`: 自 Entity + 子孫 (parentEntityId チェーン)
- `parent`: 自 Entity + 祖先 (Stage 4 で追加)
- `world`: ワールド全体

差分配信は `useModEntitySync` が `EVT_ENTITY_WATCH` として発火。Worker 再起動時
(`workerRevision` 変化) は範囲内全 Entity を再送。

---

## 3. Stage 4: Pure ECS 達成へ

### 主な追加

- **`watchScope: 'parent'`** — 子から親 Component の state を読めるように。`collectAncestorGameObjectIds` を新設、`isVisibleInScope` 拡張。
- **`Ubi.state.topLevel<T>(default)`** — `ComponentInstance` の `lockedBy` / `ownerId` を宣言的に同期。pen の選択ロックなどで使用。
- **SDK の target entity 解決バグ修正** — `e.id === Ubi.entityId` で GameObject id と ComponentInstance.id を取り違えていた致命的バグ。`e.entityId === ownGameObjectId && e.type === componentType` で解決。
- **API surface 再設計** — `Ubi.local` / 旧 `Ubi.entity` (read-only 版) / `Ubi.avatar` / `Ubi.world` / top-level `Ubi.spawn` / `Ubi.destroy` を撤去。`Ubi.network → Ubi.event`、`Ubi.presence → Ubi.player`。最終的に `Ubi.entity` は callable に統一 (`Ubi.entity()` = self、`Ubi.entity(id)` = other、`Ubi.entity.query/get/spawn` = static)。`Ubi.fetch` を top-level に。

### mod書き換え

- **pen**: pen:pen Worker を新設して各ペンが自前 UI + 選択ロジック。tray は size 設定のみ。canvas は systems/ を 1 ファイル化。stroke は pen の子 Entity として永続化。
- **video-player**: screen を親に、controls / playlist / search を子として `watchScope='parent'` で screen の state を共有。setInterval / 過剰 try-catch / 黒背景重ね問題などを修正。
- **avatar**: systems/ 撤去、`Ubi.state` で宣言的に。SettingsPanel を pure render 関数化。

### Worker 間通信の制約 (重要)

通信経路一覧 (`Ubi.event.emit` 実装後):

| 経路 | 同 tab sender | 他 tab/他ユーザー | 用途 |
|---|---|---|---|
| `Ubi.event.broadcast(type, data)` | ❌ (Socket.IO `socket.to(room)`) | ✅ 同 entity を見てる他ユーザーの Worker | クロスユーザー揮発性同期 |
| `Ubi.event.sendToHost(type, data)` | ✅ 自 Worker → 自 Host のみ | ❌ | host bridge |
| `Ubi.event.emit(type, data, { scope, targetType })` | ✅ 同 tab 内の他 Worker (scope + type 絞り込み) | ❌ | クロス Component コマンド |
| `Ubi.entity(id).update(patch)` | ✅ (ただし watchScope 内 または entityRef で明示配線された id のみ、Stage 5 参照) | ✅ Reliable State | 他エンティティの書き換え (escape hatch) |
| `Ubi.state.local.<key> = v` | ✅ onChange で全 watcher | ✅ sync 設定なら | 一番自然な自エンティティ書き換え経路 |

---

## 4. 命名リネーム (Pure ECS 用語への統一)

| Before | After |
|---|---|
| `WorldEntity<T>` | `ComponentInstance<T>` |
| `WorldGameObject` | `WorldEntity` |
| `Ubi.entityId` (旧 flat 内部 ID) | `Ubi.componentInstanceId` |
| `Ubi.gameObjectId` | `Ubi.entityId` |
| field `gameObjectId` | `entityId` |
| field `parentGameObjectId` | `parentEntityId` |
| `Ubi.network.*` | `Ubi.event.*` (broadcast / sendToHost / emit) + `Ubi.fetch` |
| `Ubi.presence.*` | `Ubi.player.*` |
| `Ubi.state.persistent / persistMine / shared / topLevel` | `Ubi.state.sync(value, options)` 1 本に統一 |
| `Ubi.world.createEntity` / `.destroyEntity` | `Ubi.entity().spawn` / `Ubi.entity().destroy` (自分) / `Ubi.entity.spawn` (parent 明示) / `Ubi.entity(id).destroy` (他) |
| `Ubi.world.queryEntities` / `.getEntity` | `Ubi.entity.query` / `Ubi.entity.get` |
| `Ubi.world.updateEntity` | `Ubi.entity().update` (自分) / `Ubi.entity(id).update` (他) |
| `Ubi.local` / `Ubi.world` / `Ubi.avatar.set` | **撤去** |

### 4.1 リネーム取りこぼしバグ (sandbox.worker.ts)

`Ubi.entityId = event.payload.entityId` を 2 回代入していて `Ubi.componentInstanceId` が永久 undefined。
SDK 全体で `updateEntity` を自 Component に対して呼ぶ処理が無音失敗。pen:pen の `selectMe()` ガードで全スルーになり UI が出ない症状で発覚。
**教訓**: リネーム時は代入先側のフィールド名も grep。型エラーが出ない (上書き) ので静的解析で防げない。

---

## 5. Pure ECS 達成度 (現状)

| 項目 | 状態 | 備考 |
|---|---|---|
| Entity / Component / data 分離 | ✅ | World YAML から直接読める |
| 1 Component = 1 Worker | ✅ | |
| 兄弟 / 親 / 子 アクセス | ✅ | `watchScope='parent' / 'siblings' / 'children' / 'subtree' / 'world'` |
| `Ubi.state` 宣言的同期 | ✅ | `sync(value, options)` 1 本に統一 (perUser / ephemeral / topLevel) |
| `Ubi.entity` 統一 CRUD | ✅ | callable `Ubi.entity()` / `Ubi.entity(id)` + static (query/get/spawn) |
| クロス Worker チャネル | ✅ | `Ubi.event.emit(type, data, { scope, targetType })` |
| pen 完全 ECS 化 | ✅ | |
| video-player 完全 ECS 化 | ✅ | 空 wrapper Entity + screen/controls/playlist/search 4 兄弟 + emit |
| avatar 完全 ECS 化 | ✅ | Ubi.state + SettingsPanel 純関数化 |
| **依存関係宣言 (`requires`)** | ❌ | Editor で `この Component は <type> 親が必要` 警告 |
| **Editor 兄弟順序 D&D** | ❌ | drop zone before/middle/after |
| **Component UI サムネイル** | ❌ | Editor の component picker でプレビュー画像キャッシュ |

---

## 6. ペンmod: 参照アーキテクチャ

pen が完全 ECS 化された結果、他modのテンプレートとして使える形になった。

```
pen-tray Entity (pen:tray Worker)         ← 設定 UI + 背景
  ├── pen-black Entity (pen:pen Worker)   ← 自分のボタン描画 + 選択 lockedBy
  ├── pen-red Entity (pen:pen Worker)
  └── ...

pen-canvas Entity (pen:canvas Worker)     ← 入力 + canvas 描画
  └── (描画時) 持ち主の pen Entity 配下に pen:stroke Entity を spawn
```

| Component | 責務 | watchScope | UI |
|---|---|---|---|
| `pen:pen` | data + 選択 + ボタン描画 | `entity` | ✅ |
| `pen:tray` | 容器枠 + 自 subtree で held なペンの size 設定 | `subtree` | ✅ |
| `pen:canvas` | グローバル入力 + canvas 描画 + stroke 永続化 | `world` | canvas target |
| `pen:stroke` | 永続化ストロークデータ | — | (canvas が描画) |

### 採用パターン

1. **各 Component が自前 UI を持つ** — 「親が子を一括描画」は避ける
2. **階層 = ECS 親子** — pen:pen が tray Entity の child
3. **設定 UI は親 Component に集約** — tray が pen の strokeWidth UI を持つ
4. **書き込みは `Ubi.state.local.x = v`** で完結 — `Ubi.entity().update` / `Ubi.entity(id).update` は escape hatch (Stage 5 で watchScope + entityRef 宣言に制限)
5. **新規 Entity は `Ubi.entity().spawn(child)`** (自分の子) または `Ubi.entity.spawn(...)` (parent 明示)

---

## 7. 達成済み API デザイン (本ブランチでの最終形)

### 7.1 `Ubi.event.emit` (クロス Worker チャネル)

```ts
Ubi.event.emit('PLAY_VIDEO', { url: '...' }, {
    scope: 'siblings' | 'parent' | 'children' | 'subtree' | 'world',
    targetType?: string,   // ComponentType フィルタ (`modId:componentName`)
});
```

- `targetType` は **ComponentType**。Entity (= GameObject) は型を持たない
- `scope='siblings'` は **Entity 階層レベルの兄弟** (同じ `parentEntityId` を持つ別 Entity)。空 wrapper 下の 4 兄弟構成で機能する
- Host (`ModHostManager.routeEmit`) が scope + targetType で対象 Worker 集合を解決し `EVT_CUSTOM` で配送
- 受信側は WorkerEvent として届く (`event.type === 'PLAY_VIDEO'`)
- broadcast (他ユーザー揮発) と emit (同 tab 狙い撃ち) は別 API として共存

### 7.2 `Ubi.state.sync(value, options)` 統一

```ts
Ubi.state.sync('#1a1a1a')                              // 全員共有 + DB 永続 (旧 persistent)
Ubi.state.sync(0.7, { perUser: true })                 // 旧 persistMine
Ubi.state.sync('default', { ephemeral: true })         // 旧 shared (volatile)
Ubi.state.sync<string|null>(null, { topLevel: 'lockedBy' })  // 旧 topLevel
```

4 マーカーを 1 関数 + options に統合。

### 7.3 `Ubi.entity` callable 統一

```ts
Ubi.entity().update(patch)        // 自分自身
Ubi.entity().destroy()
Ubi.entity().spawn(child)         // 自 Entity の子として spawn (parent 自動付与)
Ubi.entity(id).update(patch)      // 他 id (escape hatch)
Ubi.entity(id).destroy()
Ubi.entity.query<T>(type)         // 検索 (watchScope に応じた可視範囲)
Ubi.entity.get<T>(id)             // id で取得
Ubi.entity.spawn(entity)          // 親を明示指定して spawn
```

`Ubi.world` / top-level `Ubi.spawn` / `Ubi.destroy` を撤去し、ここに統合。

---

## 8. 残課題

- 依存関係宣言 (`requires` フィールド) + Editor 警告
- Editor の兄弟順序 D&D (before / middle / after drop zone)
- Component UI のサムネイル化 (一度レンダーした VNode を画像化キャッシュ)

---

## 9. Stage 5: 複数 Component 配置の安全化 + 明示的ターゲティング

「同一 Entity に複数 Component を配置できるようにしたい」という要望を調査した結果、
**その機能自体は Stage 1 から既に存在していた**（`EntityComponentSchema` は配列、Editor にも追加/削除 UI がある）。
実際に壊れていたのは以下の 2 点で、Stage 5 はこれを解消する。

### 9.1 Component 単位の transform 上書き

`flattenGameObject` は同一 GameObject の全 Component に**同じ transform オブジェクト**を配布していた。
tray (`w:60,h:240`) が乗った Entity に後から pen 等を追加すると、その Component 固有の
`defaultTransform` は無視され tray の transform を押し付けられていた（例: tray のクリック領域が
Entity 全体を専有し、後から追加した Component の見た目・当たり判定を破壊する）。

`EntityComponentSchema` に `transform: TransformSchema.partial().optional()` を追加し、
`flattenGameObject` で Entity の transform と Component 固有の上書きをマージするようにした。
x/y は Entity 位置からの相対オフセットとして加算、w/h/z/rotation/scale は上書き。未指定なら
Entity の transform をそのまま継承する（後方互換）。Editor の Component 追加時
(`handleAddComponentToEntity`) は、追加する mod の `defaultTransform` をこの Component 固有の
`transform` に書き込むようにし、Entity 全体の transform は書き換えない。

### 9.2 見た目 / ロジックの緩い区分

mod の manifest に描画方式を明示的に宣言させるのではなく、**実際に使っているものから自動判定**する。
`canvasTargets` があれば Canvas2D（WebGL 含む）、`ui:render` capability（`export default` / `Ubi.ui.render`）
があれば jsx（VNode）、どちらも無ければロジックのみ（見た目なし）として Editor がバッジを出し分ける。
「書かなくても使ってる方で分かる」ため、mod 開発者は描画方式を宣言する必要がない。

### 9.3 entityRef / entityRefArray — 明示的クロス Entity ターゲティング

Component の data フィールドに `entityRef`（単体）/ `entityRefArray`（複数）という新しい型を追加した。
値は entityId (群) で、World Editor の Inspector 上で Hierarchy から Entity を D&D すると
セットされる。これにより「1 つの UI Component が複数 Entity の見た目を動かす」「ロジック
Component が UI Component を駆動する」といった構成を、mod 側のコードではなく Editor 上の
宣言的な配線として組めるようになった。

`entityRef`/`entityRefArray` は manifest の `dataFields` への宣言が必須で、
`Ubi.state.sync(..., { type: 'entityRef' })` のような state 側宣言は禁止する（state 側は
`editable: false` で同期のみ行い、Editor 表示と `declaredTargets` は manifest の宣言に従う）。

manifest の `dataFields` はこれまで versioned manifest（Editor の HTTP fetch）止まりで、
実行時の Host 層（`WorkerModHost`/`ModHostManager`）には**届く前に握り潰されていた**
(`packages/loader/src/acquireMod.ts` が読み取っても `LoadedMod` に詰め替えていなかった)。
Stage 5 でこの配線を通した: `acquireMod.ts` → `LoadedMod.dataFields` → `toWorkerModDefinition()`
→ `WorkerModDefinition.dataFields`。

### 9.4 escape hatch の watchScope 制限

`Ubi.entity(id).update` が叩く `onUpdateEntity`（`useModWorld.ts`）は、読み取り系
(`onGetEntity`/`onQueryEntities`) と違い `watchScope` のチェックを一切していなかった。任意の
mod が任意の entityId に書き込める状態で、「勝手に他の mod が干渉してくる」という懸念に
直結していた。

`onUpdateEntity`/`onDestroyEntity` に、読み取りと同じ `isVisibleInScope` ベースの許可判定を
追加した（純関数 `isAccessible`、`packages/react/src/lib/entityScope.ts`）。scope 外への
書き込みは拒否されるが、9.3 の `entityRef`/`entityRefArray` フィールドで明示的にワイヤリングされた
entityId は `declaredTargets` として例外的に許可する。`WorkerModHost` が Worker 起動時に
`definition.dataFields` と `entity.data` の実値から `declaredTargets` を算出し、`useModWorld` に渡す。

これにより、クロス Entity 操作は「scope 内」か「Editor で明示的に配線された entityRef」の
どちらかを経由する必要があり、mod が無宣言のまま任意の entityId を書き換えることはできなくなった。
