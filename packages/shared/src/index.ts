import type { ModLock } from './schemas/modLock.schema';

// ゼロ依存の素朴な型（User/ComponentInstance/EntityTransform 等）は mod/entities.ts に分離。
// barrel（このファイル）を経由せず SDK 側から直接 import できるようにするため
// （dts-bundle-generator が schemas/* の zod スキーマまで読み込まずに済む、詳細は同ファイル参照）。
export * from './mod/entities';

import type {
    AvailableComponent,
    ComponentInstance,
    CursorPosition,
    EntityEphemeralPayload,
    EntityPatchPayload,
    User,
    UserStatus,
    WorldEnvironmentData,
} from './mod/entities';

// ============================================
// World Snapshot (拡張版)
// ============================================

/**
 * ワールドスナップショットペイロード（flat ComponentInstance 単位）。
 *
 * GameObject に複数 Component が載っている場合、バックエンドが
 * 各 Component を 1 つの flat ComponentInstance に展開してから配信する。
 */
export interface WorldSnapshotPayload {
    entities: ComponentInstance[];
    availableComponents: AvailableComponent[];
    /** アクティブなmodIDのリスト */
    activeMods: string[];
    environment: WorldEnvironmentData;
    /** ワールドに焼かれた mod 完全性ロック（あれば）。ロード時の hash 照合に使う。 */
    lock?: ModLock;
    /** ワールドの provenance kind（local/github/...）。lock enforcement の分岐に使う。 */
    sourceKind?: string;
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
    'cursor:moved': (data: { userId: string; position: CursorPosition; heldEntityId?: string | null }) => void;

    /** ユーザーのステータス更新 */
    'status:changed': (data: { userId: string; status: UserStatus }) => void;

    /** エラー通知 */
    error: (message: string) => void;

    // ============================================
    // UEP Events (Server -> Client)
    // ============================================

    /** ワールド状態のスナップショット（拡張版） */
    'world:snapshot': (payload: WorldSnapshotPayload) => void;

    /** エンティティが作成された (flat ComponentInstance 単位) */
    'entity:created': (entity: ComponentInstance) => void;

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

    // ============================================
    // Media (video / audio etc.) ピア間同期 (Server -> Client)
    // 任意のメディア系modの「再生状態を peer 間で揃える」ためのルーム broadcast。
    // ============================================

    /** メディア再生状態の同期 */
    'media:sync': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;

    /** 再生状態のリクエスト (参加時 / Resync で発火) */
    'media:state-request': (data: { fromSocketId: string }) => void;

    /** リクエストへの応答 (要求者だけに DM) */
    'media:state-response': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;
}

/**
 * クライアントからサーバーへ送信されるイベント
 */
export interface ClientToServerEvents {
    /** ワールドに参加 */
    'world:join': (
        data: { worldId: string; instanceId: string; password?: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; instanceId?: string; error?: string }) => void,
    ) => void;

    /** ワールドから退出 */
    'world:leave': (callback?: (response: { success: boolean }) => void) => void;

    /** カーソル位置を更新 */
    'cursor:move': (data: { position: CursorPosition; heldEntityId?: string | null }) => void;

    /** ステータスを更新 */
    'status:update': (status: UserStatus) => void;

    // ============================================
    // UEP Events (Client -> Server)
    // ============================================

    /** エンティティを作成 (flat ComponentInstance 単位) */
    'entity:create': (
        payload: Omit<ComponentInstance, 'id'>,
        callback: (response: { success: boolean; entity?: ComponentInstance; error?: string }) => void,
    ) => void;

    /** エンティティを更新（Reliable） */
    'entity:patch': (payload: EntityPatchPayload) => void;

    /** エンティティのリアルタイムデータ送信（Volatile） */
    'entity:ephemeral': (payload: EntityEphemeralPayload) => void;

    /** エンティティを削除 */
    'entity:delete': (entityId: string) => void;

    // ============================================
    // Media (video / audio etc.) ピア間同期 (Client -> Server)
    // ============================================

    /** メディア再生状態を peer に流す */
    'media:sync': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;

    /** 他参加者に現在の再生状態を尋ねる */
    'media:state-request': () => void;

    /** リクエスト元への応答 */
    'media:state-response': (data: {
        toSocketId: string;
        currentIndex: number;
        isPlaying: boolean;
        currentTime: number;
    }) => void;
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
    /** 参加中のインスタンスID。Socket.IO ルームキー兼エンティティ状態キー */
    instanceId?: string;
    user?: User;
    /** better-auth で認証されたユーザー情報（接続時にセット、以降不変） */
    authUser?: {
        id: string;
        email: string;
        name: string;
        image: string | null;
    };
}

// ============================================
// Constants
// ============================================

/**
 * デフォルト設定
 */
export const DEFAULTS = {
    /** デフォルトのワールドID */
    WORLD_ID: 'default',

    /** ユーザーのデフォルトステータス */
    USER_STATUS: 'online' as UserStatus,

    /** カーソル位置の初期値 */
    INITIAL_POSITION: { x: 0, y: 0 } as CursorPosition,

    /** デフォルトのワールド環境 */
    WORLD_ENVIRONMENT: {
        backgroundColor: '#F0F8FF',
        worldSize: { width: 2000, height: 1500 },
    } as WorldEnvironmentData,
} as const;

/**
 * 環境変数キー定数
 * 各パッケージで散らばらないよう、ここで一元管理する
 */
export const ENV_KEYS = {
    /** バックエンドのポート番号 */
    PORT: 'PORT',

    /** ワールド定義ディレクトリのパス（ローカルファイル用、レガシー） */
    WORLDS_DIR: 'WORLDS_DIR',

    /** ワールドレジストリURL（カンマ区切り複数指定可） */
    WORLDS_REGISTRY_URLS: 'WORLDS_REGISTRY_URLS',

    /** ワールドレジストリ認証トークン（プライベートリポジトリ向け） */
    WORLDS_REGISTRY_TOKEN: 'WORLDS_REGISTRY_TOKEN',

    /** 本体の外部到達 base URL。ローカル/ユーザー作成ワールドの正規 URL 生成に使う */
    PUBLIC_BASE_URL: 'PUBLIC_BASE_URL',

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

    /** Video Player開発環境URL */
    VIDEO_PLAYER_DEV_URL: 'http://localhost:8000',

    /** Video Player本番環境パス */
    VIDEO_PLAYER_PROD_PATH: '/video-player-api',

    /** ワールド定義ディレクトリのデフォルト相対パス（バックエンドcwd基準） */
    WORLDS_DIR_DEFAULT: '../../worlds',
} as const;

// ============================================
// Re-export Schemas and Mods
// ============================================

export * from './mod/capability';
export * from './mod/errors';
export * from './mod/modLock';
export * from './mod/permission';
export * from './mod/protocol';
export * from './mod/types';
export * from './mod/vnode';
export * from './schemas';
