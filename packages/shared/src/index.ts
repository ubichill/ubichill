// ============================================
// User Types
// ============================================

/**
 * ユーザーのステータス
 */
export type UserStatus = 'online' | 'away' | 'busy' | 'offline';

/**
 * カーソル位置
 */
export interface CursorPosition {
    x: number;
    y: number;
}

/**
 * ユーザー情報
 */
export interface User {
    id: string;
    name: string;
    avatarUrl?: string;
    status: UserStatus;
    position: CursorPosition;
    lastActiveAt: number;
}

// ============================================
// UEP (Ubichill Entity Protocol) Types
// ============================================

/**
 * エンティティの変形情報（位置・サイズ・回転）
 */
export interface EntityTransform {
    x: number;
    y: number;
    z: number; // レイヤー順
    w: number; // 幅
    h: number; // 高さ
    rotation: number; // 回転角度（度）
}

/**
 * ワールドエンティティの共通コンテナ
 * @template T ウィジェット固有のデータ型
 */
export interface WorldEntity<T = unknown> {
    id: string; // UUID
    type: string; // プラグインID (例: "pen", "sticky")
    ownerId: string | null; // 作成者のユーザーID
    lockedBy: string | null; // 操作中のユーザーID（nullで未ロック）
    transform: EntityTransform;
    data: T; // ウィジェット固有データ
}

/**
 * エンティティパッチ（Reliable）のペイロード
 */
export interface EntityPatchPayload {
    entityId: string;
    patch: Partial<Omit<WorldEntity, 'id' | 'type'>>;
}

/**
 * エンティティエフェメラル（Volatile）のペイロード
 */
export interface EntityEphemeralPayload {
    entityId: string;
    data: unknown; // バックエンドはこの中身を解釈しない
}

// ============================================
// Socket.io Event Types
// ============================================

/**
 * サーバーからクライアントへ送信されるイベント
 */
export interface ServerToClientEvents {
    /** ユーザー一覧の更新 */
    'users:update': (users: User[]) => void;

    /** ユーザーが参加 */
    'user:joined': (user: User) => void;

    /** ユーザーが退出 */
    'user:left': (userId: string) => void;

    /** ユーザーのカーソル位置更新 */
    'cursor:moved': (data: { userId: string; position: CursorPosition }) => void;

    /** ユーザーのステータス更新 */
    'status:changed': (data: { userId: string; status: UserStatus }) => void;

    /** エラー通知 */
    error: (message: string) => void;

    // ============================================
    // UEP Events (Server -> Client)
    // ============================================

    /** ワールド状態のスナップショット（初期ロード時） */
    'world:snapshot': (entities: WorldEntity[]) => void;

    /** エンティティが作成された */
    'entity:created': (entity: WorldEntity) => void;

    /** エンティティが更新された（Reliable） */
    'entity:patched': (payload: EntityPatchPayload) => void;

    /** エンティティのリアルタイムデータ（Volatile） */
    'entity:ephemeral': (payload: EntityEphemeralPayload) => void;

    /** エンティティが削除された */
    'entity:deleted': (entityId: string) => void;
}

/**
 * クライアントからサーバーへ送信されるイベント
 */
export interface ClientToServerEvents {
    /** ルームに参加 */
    'room:join': (
        data: { roomId: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => void;

    /** ルームから退出 */
    'room:leave': () => void;

    /** カーソル位置を更新 */
    'cursor:move': (position: CursorPosition) => void;

    /** ステータスを更新 */
    'status:update': (status: UserStatus) => void;

    // ============================================
    // UEP Events (Client -> Server)
    // ============================================

    /** エンティティを作成 */
    'entity:create': (
        payload: Omit<WorldEntity, 'id'>,
        callback: (response: { success: boolean; entity?: WorldEntity; error?: string }) => void,
    ) => void;

    /** エンティティを更新（Reliable） */
    'entity:patch': (payload: EntityPatchPayload) => void;

    /** エンティティのリアルタイムデータ送信（Volatile） */
    'entity:ephemeral': (payload: EntityEphemeralPayload) => void;

    /** エンティティを削除 */
    'entity:delete': (entityId: string) => void;
}

/**
 * サーバー間イベント（Socket.io Adapter用）
 */
export interface InterServerEvents {
    ping: () => void;
}

/**
 * ソケットデータ（各接続に紐づくデータ）
 */
export interface SocketData {
    userId?: string;
    roomId?: string;
    user?: User;
}

// ============================================
// Constants
// ============================================

/**
 * デフォルト設定
 */
export const DEFAULTS = {
    /** デフォルトのルームID */
    ROOM_ID: 'main',

    /** ユーザーのデフォルトステータス */
    USER_STATUS: 'online' as UserStatus,

    /** カーソル位置の初期値 */
    INITIAL_POSITION: { x: 0, y: 0 } as CursorPosition,
} as const;

/**
 * サーバー設定
 */
export const SERVER_CONFIG = {
    /** バックエンドのポート番号 */
    PORT: 3001,

    /** 開発環境でのバックエンドURL */
    DEV_URL: 'http://localhost:3001',
} as const;

/**
 * すべてのエンティティのユニオン型
 * 特定のfeature型はこのファイルではなく、各featureの定義を参照してください。
 */
export type AnyWorldEntity = WorldEntity<unknown>;
