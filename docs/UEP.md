# Ubichill Entity Protocol (UEP)

UEP (Ubichill Entity Protocol) は、Ubichill におけるリアルタイムなオブジェクト同期とインタラクションを支えるプロトコルおよびアーキテクチャの総称です。

「永続的な状態」と「揮発性の高いストリーム」を明確に分離することで、データベースへの負荷を抑えつつ、60fps の滑らかなインタラクションを実現しています。

## 1. コアコンセプト

### 1.1 ハイブリッド同期モデル
UEP は2つの異なる同期チャネルを併用します。

| 特性 | **Reliable State (信頼性)** | **Volatile Stream (即時性)** |
| :--- | :--- | :--- |
| **用途** | 位置座標、確定した色、所有権、DB保存データ | 描画中の軌跡、カーソル位置、ドラッグ中の座標 |
| **頻度** | 低 (1-10Hz, またはアクション終了時) | 高 (30-60Hz) |
| **保存** | **あり** (PostgreSQL / Redis) | **なし** (メモリ上でブロードキャストのみ) |
| **保証** | 到達保証あり (ACK/Retry) | 到達保証なし (最新が正義) |

### 1.2 エンティティ (Entity)
すべての同期オブジェクトは以下の構造を持ちます。

```typescript
interface WorldEntity<T = any> {
    id: string;
    type: string;        // 'pen', 'stroke', 'image' 等
    lockedBy: string | null; // 排他制御用 (User ID)
    transform: {
        x: number;
        y: number;
        rotation: number;
        z: number;       // World Layer 内での表示順序
    };
    data: T;             // エンティティ固有データ
}
```

### 1.3 レイヤー戦略 (z-index vs transform.z)

1.  **Application Layer (`layers.ts`)**: CSS `z-index` によるUI階層（オーバーレイ > 持ち物 > ワールドアイテム）
2.  **World Layer (`entity.transform.z`)**: 空間内オブジェクト同士の前後関係。React側で `.sort((a, b) => a.z - b.z)` してレンダリング順を制御。

---

## 2. プラグイン実行モデル (ECS)

プラグインロジックは **ECS (Entity Component System)** アーキテクチャで実装されます。
ロジックは Worker Sandbox 内で実行され、React Host とはメッセージパッシングのみで通信します。

### 2.1 レイヤー分離

```
┌─────────────────────────────────────────────┐
│  React Host (メインスレッド)                  │
│  - UI レンダリング                            │
│  - WorldEntity 同期 (UEP)                    │
│  - PenWorker → onCommand で描画データ受信     │
└──────────────┬──────────────────────────────┘
               │ EVT_CUSTOM (sendEvent)
               │ postMessage
               ▼
┌─────────────────────────────────────────────┐
│  Worker Sandbox                              │
│  ┌─────────────────────────────────────────┐│
│  │  ECS World (Ubi.world)                  ││
│  │  ┌──────────────────────────────────┐   ││
│  │  │  Entity: pen-main                │   ││
│  │  │    Transform { x, y }            │   ││
│  │  │    PenState  { isDrawing, ... }  │   ││
│  │  │    SyncState { lastSyncTime }    │   ││
│  │  └──────────────────────────────────┘   ││
│  │                                         ││
│  │  Systems (登録順に毎フレーム実行):        ││
│  │    1. PenInputSystem  ← events[]        ││
│  │    2. PenSyncSystem   → messaging.send  ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### 2.2 イベントフロー (EVT_CUSTOM → ECS)

```
Host                         UbiSDK (sandbox内)              ECS Systems
  │                               │                               │
  │─ EVT_CUSTOM ─────────────────▶│                               │
  │  { eventType: 'MOUSE_MOVE',   │ _pendingWorkerEvents.push()   │
  │    data: { x, y, buttons } }  │ { type: 'MOUSE_MOVE',         │
  │                               │   payload: { x, y, buttons }} │
  │                               │                               │
  │─ EVT_LIFECYCLE_TICK ─────────▶│                               │
  │                               │─ world.tick(dt, events) ─────▶│
  │                               │  _pendingWorkerEvents = []    │ PenInputSystem
  │                               │                               │ PenSyncSystem
  │                               │◀─ Ubi.messaging.send() ───────│
  │◀─ CUSTOM_MESSAGE ─────────────│  (DRAWING_UPDATE等)           │
  │◀─ SCENE_UPDATE_CURSOR ────────│  Ubi.scene.updateCursorPos()  │
```

### 2.3 Component 設計

| Component | データ | 責務 |
| :--- | :--- | :--- |
| `Transform` | `{ x, y }` | 空間上の位置 |
| `PenState` | `{ isDrawing, currentStroke, ... }` | 描画ロジックの状態 |
| `SyncState` | `{ lastSyncTime }` | Host への送信レート制御 |

### 2.4 System 責務分離

| System | 入力 | 出力 |
| :--- | :--- | :--- |
| `PenInputSystem` | `WorkerEvent[]` (MOUSE_*) | Component 更新、カーソル位置送信 |
| `PenSyncSystem` | Component 読み取り | `Ubi.messaging.send()` (DRAWING_UPDATE / STROKE_COMPLETE) |

---

## 3. インタラクションフロー

オブジェクト操作は **Lock → Mutate → Release** のサイクルで行われます。

1.  **Try Lock (楽観的ロック)**
    *   ユーザーがオブジェクトをクリック。
    *   フロントエンドで即座に `lockedBy: me` と仮定して操作開始（レイテンシ隠蔽）。
    *   サーバーに `PATCH { lockedBy: userId }` を送信。他人がロック中なら拒否される。

2.  **Ephemera (揮発的操作)**
    *   ドラッグ中や描画中は、`Stream` チャネルで座標や点群を送信。
    *   DBには書き込まず、他のクライアントにのみブロードキャスト。
    *   受信側はこれを `ephemeral` レイヤーとして描画（DBデータより優先表示）。

3.  **Commit / Release**
    *   操作終了時（MouseUp）、最終的な `transform` や生成された `stroke` データを `PATCH` または `Create` でサーバーに送信。
    *   `lockedBy: null` を送信してロック解除。

---

## 4. ライフサイクル

### 4.1 Create (生成)
*   **API**: `createEntity(type, transform, data)` via `WorldContext`
*   **タイミング**: ストローク完成時 (STROKE_COMPLETE)、画像ドロップ時など
*   **フロー**: Client → Server (DB Insert) → Broadcast → All Clients

### 4.2 Update / Patch (更新)
*   **API**: `patchEntity(id, patch)` via `WorldContext`
*   **タイミング**: 移動終了、ロック変更、プロパティ変更
*   **注意**: 高頻度更新（描画中）は `stream` を使用。

### 4.3 Delete (削除)
*   **API**: `deleteEntity(id)`

---

## 5. 所有権とロック機構 (Ownership)

UEP では「早い者勝ち (First-come, first-served)」の排他制御を採用しています。

### 5.1 `lockedBy` プロパティ
各エンティティは `lockedBy: string | null` (User ID) を持ちます。

*   `null`: 誰でも触れる状態（Free）
*   `"user_id"`: 特定のユーザーが操作中（Locked）

### 5.2 ロックの取得フロー

1.  ユーザーがオブジェクトをクリック
2.  フロント側で即座に `isLockedByMe = true` と判定（楽観的UI）
3.  背後で `patchEntity({ lockedBy: me })` を送信
4.  競合時はサーバーが拒否 → ロールバック

```typescript
const isLockedByMe = entity.lockedBy === currentUser.id;
const isLockedByOther = !!entity.lockedBy && entity.lockedBy !== currentUser.id;
```

### 5.3 自動開放

*   **切断時**: WebSocket切断時、サーバーが全エンティティの `lockedBy` を強制 `null` に戻す（デッドロック防止）
*   **Single Hold**: `useObjectInteraction` フックにより、新しい物を掴んだら古い物を自動で離す

---

## 6. 将来のプラグイン実行モデル

現在の ECS Worker (JavaScript 文字列評価) に加え、以下の実行モデルを段階的に対応予定です。

### 6.1 TypeScript / React モード (近期)

```
plugins/my-plugin/
  frontend/        ← React + TypeScript (現在も使用)
  worker/
    src/
      components.ts  ← ECS Component 定義 (TypeScript)
      systems/       ← ECS System (TypeScript)
      index.ts       ← エントリポイント
```

ビルドパイプライン (Ubicrate CLI) が worker を bundle し、sandbox に渡す文字列を自動生成します。

### 6.2 WASM モード (中期)

```
plugins/my-plugin/
  worker/
    src/
      lib.rs         ← Rust で ECS を実装
```

```
Worker Sandbox
  ├── ECS World (JS)
  └── WASM Module ← Rust/C++ でコンパイルされた System
```

WASM System は JS ECS World の Entity に直接アクセスし、高パフォーマンスな処理（物理演算、AI、複雑な描画）を実現します。

| モード | 言語 | 用途 | 状態 |
| :--- | :--- | :--- | :--- |
| ECS (JS string) | JavaScript | 軽量プラグイン | ✅ 現在 |
| ECS (TypeScript bundle) | TypeScript + React | 標準プラグイン | 🔄 準備中 |
| ECS (WASM) | Rust / C++ | 高性能プラグイン | 📋 計画中 |

