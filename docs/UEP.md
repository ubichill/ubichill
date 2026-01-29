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
        rotation: number; // 向き (描画時のペン先や、スタンプの角度など)
        z: number;       // World Layer内での表示順序 (CSSのz-indexとは別)
    };
    data: T;             // エンティティ固有データ (色、Strokeの点群など)
}

### 1.3 レイヤー戦略 (z-index vs transform.z)
二つの「重なり順」を明確に区別します。

1.  **Application Layer (`layers.ts`)**:
    *   **目的**: UIアーキテクチャとしての階層管理。
    *   **範囲**: オーバーレイUI > 自分が持っている物体 > 他人が持っている物体 > 床にある物体。
    *   **実装**: CSS `z-index`。

2.  **World Layer (`entity.transform.z`)**:
    *   **目的**: 空間内でのオブジェクト同士の前後関係。
    *   **範囲**: 「床にある物体」または「トレイ」の中での相対順序（例: カードの上にコインを置く）。
    *   **実装**: React側で `.sort((a, b) => a.z - b.z)` してレンダリング順を制御（現在は簡易実装のため未厳密）。
```

## 2. インタラクションフロー

オブジェクト操作は **Lock -> Mutate -> Release** のサイクルで行われます。

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
    *   これをもってデータが永続化される。
    *   `lockedBy: null` を送信してロック解除。

## 3. ライフサイクル

### 3.1 Create (生成)
新しいデータが確定したときに発生します。
*   **API**: `createEntity(type, transform, data)` via `WorldContext`
*   **タイミング**:
    *   `PenWidget`: ストロークを描き終わった瞬間 (MouseUp) に `stroke` エンティティを作成。
    *   `ImageWidget`: ドラッグ＆ドロップで画像を配置した瞬間。
*   **フロー**: Client -> Server (DB Insert) -> Broadcast -> All Clients (Add to State)

### 3.2 Update / Patch (更新)
既存のエンティティの状態を変更します。
*   **API**: `patchEntity(id, patch)` via `WorldContext`
*   **タイミング**:
    *   移動終了時 (Drag End)。
    *   所有権の変更 (Lock/Unlock)。
    *   プロパティ変更 (色変更など)。
*   **フロー**: Client -> Server (DB Update) -> Broadcast -> All Clients (Merge to State)
*   **注意**: 頻繁な更新（ドラッグ中）は `patch` ではなく `stream` を使用します。

### 3.3 Delete (削除)
*   **API**: `deleteEntity(id)`
*   **タイミング**: ゴミ箱に入れた時、またはリセット時。

## 4. 所有権とロック機構 (Ownership)

UEPでは「早い者勝ち (First-come, first-served)」の排他制御を採用しています。

### 4.1 `lockedBy` プロパティ
各エンティティは `lockedBy: string | null` (User ID) を持ちます。

*   `null`: 誰でも触れる状態（Free）。
*   `"user_id"`: 特定のユーザーが操作中（Locked）。

### 4.2 ロックの取得フロー (`useEntity`)
1.  **ユーザー操作**: オブジェクトをクリック。
2.  **楽観的UI**: フロント側で即座に `isLockedByMe = true` と判定し、操作を受け付ける。
3.  **サーバー同期**: 背後で `patchEntity({ lockedBy: me })` を送信。
4.  **競合解決**: もしサーバー側ですでに他人がロックしていた場合、Patchは拒否され、ロールバックされる（操作がキャンセルされる）。

### 4.3 「使用中」の判定
コード上では以下のように判定されています（`useEntity.ts`）。

```typescript
const isLockedByMe = entity.lockedBy === currentUser.id;
const isLockedByOther = !!entity.lockedBy && entity.lockedBy !== currentUser.id;
```

### 4.4 自動開放 (Auto Release)
*   **切断時**: WebSocket切断時、サーバーはそのユーザーが `lockedBy` している全エンティティを強制的に `null` に戻します（デッドロック防止）。
*   **Single Hold**: `useObjectInteraction` フックにより、「新しい物を掴んだら、古い物を離す」処理が自動で行われます。

