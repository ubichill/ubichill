# Ubichill アーキテクチャ

## システム全体像

```
Browser (Main Thread)
  └─ React Host
       └─ PluginHostManager          packages/sandbox
            │  postMessage
            ▼
       Sandbox Worker (Guest)         packages/sandbox
            └─ UbiSDK (Ubi)          packages/sdk
                 ├─ Ubi.local         packages/engine  (Worker 内プライベート ECS)
                 ├─ Ubi.world         → RPC → Host → Socket.IO → Backend
                 └─ Ubi.network       → postMessage → Host
```

ロジックはすべて **Sandbox Worker** 内の ECS で処理し、React はレンダリングのみを担う。
Socket.IO によるワールド同期はメインスレッドが担い、Worker は知らない。

### SDK 名前空間（プラグイン開発者向け）

| 名前空間 | 特性 | 用途 |
|---|---|---|
| `Ubi.local.*` | 揮発性・非共有・同期 | Worker 内だけの ECS 計算 |
| `Ubi.world.*` | 永続・全員共有・async | インスタンス全体のエンティティ操作 |
| `Ubi.network.*` | 揮発性・通信 | Host / 他ユーザーへのメッセージ送信 |
| `Ubi.ui.*` | Fire & Forget | UI 操作（トースト等） |
| `Ubi.avatar.*` | Fire & Forget | アバター設定 |
| `Ubi.registerSystem(fn)` | — | `Ubi.local` にシステムを登録するショートカット |

---

## パッケージ責務

| パッケージ | 責務 | 依存禁止 |
|---|---|---|
| `@ubichill/engine` | 純粋 ECS（Entity / Component / System / Query） | React・DOM・Worker・Network |
| `@ubichill/sandbox` | Worker ライフサイクル・Tick ループ・入力収集 | React |
| `@ubichill/react` | React Hooks 群（usePluginWorker / useEntity 等） | — |
| `@ubichill/sdk` | プラグイン開発者向け公開 API（Ubi） | `@ubichill/shared` などの内部パッケージ |
| `@ubichill/shared` | 型定義・プロトコル定義 | — |
| `plugins/*` | 各プラグイン実装 | `@ubichill/sdk` のみ |

---

## プラグイン実行モデル（ECS）

Worker 内では `Ubi`（UbiSDK インスタンス）が自動注入される。
プラグインは ECS System として実装し、毎フレーム `entities` / `deltaTime` / `events` を受け取る。

- **Entity**: 識別子を持つオブジェクト（ローカル）
- **Component**: Entity に付与するデータの断片（型付き）
- **System**: 毎フレーム全 Entity を走査して処理を行う関数
- **Query**: 特定 Component を持つ Entity を絞り込むキャッシュ付きフィルタ

ECS は `@ubichill/engine` で完結し、ネットワーク・DOM を一切知らない。

---

## Host ↔ Guest 通信プロトコル

### Guest → Host（PluginGuestCommand）

| type | 分類 | 説明 |
|---|---|---|
| `CMD_READY` | Fire & Forget | Worker 初期化完了通知 |
| `SCENE_GET_ENTITY` | RPC | 共有エンティティ取得（`Ubi.world.getEntity`） |
| `SCENE_CREATE_ENTITY` | RPC | 共有エンティティ作成（`Ubi.world.createEntity`） |
| `SCENE_UPDATE_ENTITY` | RPC | 共有エンティティ更新（`Ubi.world.updateEntity`） |
| `SCENE_DESTROY_ENTITY` | RPC | 共有エンティティ削除（`Ubi.world.destroyEntity`） |
| `SCENE_SUBSCRIBE_ENTITY` | Fire & Forget | エンティティ更新購読開始 |
| `SCENE_UNSUBSCRIBE_ENTITY` | Fire & Forget | 購読解除 |
| `NETWORK_SEND_TO_HOST` | Fire & Forget | 自分の Host にのみ送る（`Ubi.network.sendToHost`） |
| `NETWORK_BROADCAST` | Fire & Forget | ワールド全員の Worker に揮発性配信（`Ubi.network.broadcast`） |
| `UI_SHOW_TOAST` | Fire & Forget | トースト通知（`Ubi.ui.showToast`） |
| `AVATAR_SET` | Fire & Forget | アバター設定（`Ubi.avatar.set`） |
| `NET_FETCH` | RPC | HTTP リクエスト（`Ubi.network.fetch`） |

**RPC** は `id` フィールドを持ち、Host が `EVT_RPC_RESPONSE` で応答する（タイムアウト 10s）。

### Host → Guest（PluginHostEvent）

| type | 説明 |
|---|---|
| `EVT_LIFECYCLE_INIT` | 初期化（code / worldId / myUserId） |
| `EVT_LIFECYCLE_TICK` | フレーム更新（deltaTime ms） |
| `EVT_INPUT` | 入力イベントバッチ（MOUSE_MOVE / MOUSE_DOWN / KEY_DOWN 等） |
| `EVT_PLAYER_JOINED` | ユーザー入室 |
| `EVT_PLAYER_LEFT` | ユーザー退室 |
| `EVT_PLAYER_CURSOR_MOVED` | 他ユーザーのカーソル移動 |
| `EVT_SCENE_ENTITY_UPDATED` | 購読中エンティティ更新 |
| `EVT_NETWORK_BROADCAST` | 他ユーザーからのブロードキャスト受信 |
| `EVT_RPC_RESPONSE` | RPC 応答 |
| `EVT_CUSTOM` | プラグイン独自イベント（Host → Worker） |

### 初期化シーケンスの注意点

`EVT_LIFECYCLE_INIT` は **キューを通さず** Worker へ直接 postMessage する。
キュー経由にすると `CMD_READY` が返ってこないまま Tick がキューに積まれ deadlock になる。

`CMD_READY` 受信後にキューをフラッシュする。`CMD_READY` が届かない = 初期化失敗。

### Capability ホワイトリスト

`plugin.json` で宣言した `capabilities` に含まれないコマンドは Host 側でブロックされ、RPC エラーとして返る。

---

## リアルタイム同期（UEP）

同期には 2 つのチャネルがある。

| チャネル | 用途 | 保存 | 頻度 |
|---|---|---|---|
| **Reliable State** | 位置確定・色変更・ロック | PostgreSQL | 低（1-10Hz / アクション終了時） |
| **Volatile Stream** | ドラッグ中・カーソル・描画軌跡 | なし（ブロードキャストのみ） | 高（30-60Hz） |

`stream` は 30ms（33Hz）を目安にスロットリングする。

### 楽観的ロック（Lock → Mutate → Release）

1. ユーザーがオブジェクトに触れる → フロントで即座に `lockedBy: me` と仮定（レイテンシ隠蔽）
2. 操作中は `stream` チャネルで座標・軌跡を配信
3. 操作終了時に確定データを `PATCH`・`lockedBy: null` でロック解除

切断時はサーバーが全 `lockedBy` を強制 `null` にリセット（デッドロック防止）。

---

## Sandbox セキュリティ

5 層構造でプラグインコードを隔離する。

1. **グローバル無効化** — `fetch` / `WebSocket` / `eval` / `Function` / `importScripts` を `undefined` に書き換え
2. **プロトタイプ凍結** — `Object.prototype` 等をフリーズしてプロトタイプチェーン汚染をブロック
3. **postMessage 直接呼び出し禁止** — `self.postMessage` を警告のみの関数に差し替え（内部の `securePostMessage` のみが実際に送信）
4. **危険パターン検出** — `importScripts` / `eval(` / `Function(` / `__proto__` / `prototype[` を正規表現でチェック
5. **SafeFunction 評価** — `"use strict"` + try/catch ラップで実行（`SafeFunction` は `nullifyGlobals()` 前に保存した唯一の `Function` 参照）

**既知の限界**: `new Function()` ベースのため完全な VM 隔離ではない。
将来の改善候補: QuickJS + WASM による完全隔離（コスト高のため未実装）。

---

## パフォーマンス設計

詳細は `CLAUDE.md` のパフォーマンス設計セクションを参照。

| 最適化 | 場所 | 効果 |
|---|---|---|
| InputCollector MOUSE_MOVE デデュプ | `packages/sandbox` | フレームあたり mousemove を 1 件に集約（O(1)） |
| rAF バインドレス arrow field | `packages/sandbox` | 毎フレームの `bind()` アロケーション排除 |
| ECS エンティティ配列 dirty flag キャッシュ | `packages/engine` | エンティティ変化なし時の tick を O(1) に |
| useCursorPosition DOM 直接書き込み | `packages/react` | カーソル 60fps 更新で React re-render ゼロ |
| useEntity shallow equality | `packages/react` | `JSON.stringify` 比較を O(k) に置き換え |
