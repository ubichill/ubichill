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
 * カーソルの状態の定数配列（単一の情報源）
 * CSS cursor values + customized
 */
export const CURSOR_STATES = ['default', 'pointer', 'text', 'wait', 'help', 'not-allowed', 'move', 'grabbing'] as const;

/**
 * カーソルの状態 (CSS cursor values + customized)
 */
export type CursorState = (typeof CURSOR_STATES)[number];

/**
 * アプリケーション側で定義するアバター（カーソル）設定
 */
export interface AppAvatarDef {
    states: Partial<Record<CursorState, { url: string; hotspot: { x: number; y: number } }>>;
}

/**
 * ユーザー情報
 */
export interface User {
    id: string;
    name: string;
    avatarUrl?: string;
    /** @deprecated Use avatar.states.default instead */
    cursorUrl?: string | null;
    avatar?: AppAvatarDef;
    cursorState?: CursorState;
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
// World Snapshot (拡張版)
// ============================================

/**
 * 利用可能なKind（ツールバー用）
 */
export interface AvailableKind {
    id: string; // "package-name:kind-id"
    displayName: string;
    baseType: string;
    icon?: string;
    defaults?: Record<string, unknown>;
}

/**
 * ルーム環境設定
 */
export interface RoomEnvironmentData {
    backgroundColor: string;
    backgroundImage: string | null;
    bgm: string | null;
    worldSize: { width: number; height: number };
}

/**
 * ワールドスナップショットペイロード（拡張版）
 */
export interface WorldSnapshotPayload {
    entities: WorldEntity[];
    availableKinds: AvailableKind[];
    environment: RoomEnvironmentData;
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
    'cursor:moved': (data: { userId: string; position: CursorPosition; state?: CursorState }) => void;

    /** ユーザーのステータス更新 */
    'status:changed': (data: { userId: string; status: UserStatus }) => void;

    /** ユーザー情報の更新 */
    'user:updated': (user: User) => void;

    /** エラー通知 */
    error: (message: string) => void;

    // ============================================
    // UEP Events (Server -> Client)
    // ============================================

    /** ワールド状態のスナップショット（拡張版） */
    'world:snapshot': (payload: WorldSnapshotPayload) => void;

    /** エンティティが作成された */
    'entity:created': (entity: WorldEntity) => void;

    /** エンティティが更新された（Reliable） */
    'entity:patched': (payload: EntityPatchPayload) => void;

    /** エンティティのリアルタイムデータ（Volatile） */
    'entity:ephemeral': (payload: EntityEphemeralPayload) => void;

    /** エンティティが削除された */
    'entity:deleted': (entityId: string) => void;

    // ============================================
    // Instance Events (Server -> Client)
    // ============================================

    /** インスタンス状態更新 */
    'instance:updated': (stats: { currentUsers: number }) => void;

    /** インスタンス終了通知 */
    'instance:closing': (reason: string) => void;
}

/**
 * クライアントからサーバーへ送信されるイベント
 */
export interface ClientToServerEvents {
    /** ルームに参加 */
    'room:join': (
        data: { roomId: string; instanceId?: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => void;

    /** ルームから退出 */
    'room:leave': () => void;

    /** カーソル位置を更新 */
    'cursor:move': (data: { position: CursorPosition; state?: CursorState }) => void;

    /** ステータスを更新 */
    'status:update': (status: UserStatus) => void;

    /** ユーザー情報を更新 */
    'user:update': (patch: Partial<User>) => void;

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
    instanceId?: string;
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
    ROOM_ID: 'default',

    /** ユーザーのデフォルトステータス */
    USER_STATUS: 'online' as UserStatus,

    /** カーソル位置の初期値 */
    INITIAL_POSITION: { x: 0, y: 0 } as CursorPosition,

    /** デフォルトのルーム環境 */
    ROOM_ENVIRONMENT: {
        backgroundColor: '#F0F8FF',
        backgroundImage: null,
        bgm: null,
        worldSize: { width: 2000, height: 1500 },
    } as RoomEnvironmentData,
} as const;

/**
 * 環境変数キー定数
 * 各パッケージで散らばらないよう、ここで一元管理する
 */
export const ENV_KEYS = {
    /** バックエンドのポート番号 */
    PORT: 'PORT',

    /** ルーム定義ディレクトリのパス */
    ROOMS_DIR: 'ROOMS_DIR',

    /** バックエンドAPI URL（フロントエンド用、Next.js の NEXT_PUBLIC_ プレフィックス） */
    API_URL: 'NEXT_PUBLIC_API_URL',
} as const;

/**
 * サーバー設定（デフォルト値）
 */
export const SERVER_CONFIG = {
    /** バックエンドのポート番号 */
    PORT: 3001,

    /** 開発環境でのバックエンドURL */
    DEV_URL: 'http://localhost:3001',

    /** ルーム定義ディレクトリのデフォルト相対パス（バックエンドcwd基準） */
    ROOMS_DIR_DEFAULT: '../../rooms',
} as const;

/**
 * すべてのエンティティのユニオン型
 * 特定のfeature型はこのファイルではなく、各featureの定義を参照してください。
 */
export type AnyWorldEntity = WorldEntity<unknown>;

// ============================================
// Re-export Schemas
// ============================================

export * from './schemas';
