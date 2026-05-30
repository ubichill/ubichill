// ============================================
// User Types
// ============================================

/**
 * ユーザーのステータス
 * 'online' - オンライン
 * 'busy' - 作業中（カーソル固定）
 * 'dnd' - 話しかけないで（Do Not Disturb）
 * 'away' - 離席中
 * 'offline' - オフライン
 */
export type UserStatus = 'online' | 'busy' | 'dnd' | 'away' | 'offline';

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
export interface AvatarStateFrame {
    url: string;
    duration: number; // ms
}

export interface AvatarStateDef {
    /** 最初のフレームの PNG data URL（サーバー送信・他ユーザーへの表示用） */
    url: string;
    hotspot: { x: number; y: number };
    /**
     * 元ファイルの URL（ANI/CUR/PNG）。
     * cursor worker がアニメーションフレームをホストへ要求するときに使う。
     * サーバー経由で他ユーザーへも配信されるため軽量な文字列に限る。
     */
    sourceUrl?: string;
}

export interface AppAvatarDef {
    states: Partial<Record<CursorState, AvatarStateDef>>;
    hideSystemCursor?: boolean;
}

/**
 * ユーザー情報
 *
 * 画像系フィールドは「プロフィール画像」と「カーソル画像」を別ものとして扱う:
 *  - `avatarUrl`: ネームプレート / プロフィールページ / 設定画面に出る顔写真
 *  - `cursorUrl`: マウス先端に重ねる小型アイコン (ユーザーごとに自由設定)
 * どちらも null 可。未設定時は本体側がデフォルト SVG で代替する。
 */
export interface User {
    id: string;
    name: string;
    /** プロフィール画像 URL (ネームプレートやユーザーページに表示) */
    avatarUrl?: string;
    /** カーソル先端に重ねる画像 URL (avatarUrl とは別物・別に設定できる) */
    cursorUrl?: string | null;
    /** @deprecated 旧 avatar plugin の多状態カーソル定義。新規開発では使わない。 */
    avatar?: AppAvatarDef;
    /** @deprecated 旧 avatar plugin が使っていた CSS cursor state。 */
    cursorState?: CursorState;
    status: UserStatus;
    position: CursorPosition;
    lastActiveAt: number;
    isMenuOpen?: boolean;
    /** 現在持っているペンの色（ペンプラグインが設定・解除する） */
    penColor?: string | null;
    /**
     * 現在持っているエンティティの ComponentInstance ID。
     * Ubi.grip.exclusive() が hold/release 時に更新する。
     * share: 'local' の場合は送信しないため null のまま。
     */
    heldEntityId?: string | null;
}

/**
 * 絵文字イベント
 */
export interface EmojiEvent {
    userId: string;
    emoji: string;
    position: CursorPosition;
    timestamp: number;
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
    scale: number; // 拡大縮小
    rotation: number; // 回転角度（度）
}

/**
 * Worker 互換の flat エンティティ。
 *
 * 1 GameObject 上の 1 Component に 1:1 で対応する。GameObject の hierarchy は
 * `entityId` (自身が乗る GameObject) と `parentEntityId` (親 GameObject) で表現。
 *
 * @template T ウィジェット固有のデータ型
 */
export interface ComponentInstance<T = unknown> {
    id: string;
    type: string;
    /** 自身が乗る GameObject の id。 */
    entityId?: string;
    /** 親 GameObject の id (子孫判定用)。ルートなら undefined。 */
    parentEntityId?: string;
    ownerId: string | null;
    lockedBy: string | null;
    transform: EntityTransform;
    data: T;
}

/**
 * Entity (GameObject) に載る 1 つの Component。
 */
export interface EntityComponent<T = unknown> {
    type: string; // "pluginId:componentName"
    data: T;
}

/**
 * GameObject — `id` + `transform` を持つ「箱」。
 *
 * 振る舞いはすべて `components: EntityComponent[]` 経由で配布される。
 * Stage 1 ではエディタ / YAML / DB の表現のみで、runtime は flatten 後の ComponentInstance を使う。
 */
export interface WorldEntity {
    id: string;
    transform: EntityTransform;
    components: EntityComponent[];
    ownerId: string | null;
    lockedBy: string | null;
}

/**
 * エンティティパッチ（Reliable）のペイロード。
 * Stage 1 では flat ComponentInstance 単位の patch（旧形式維持）。
 */
export interface EntityPatchPayload {
    entityId: string;
    patch: Partial<Omit<ComponentInstance, 'id' | 'type'>>;
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
 * 利用可能な Component（ツールバー用）。
 * 1 component = 1 振る舞い。`id` は `pluginId:componentName` 形式。
 */
export interface AvailableComponent {
    id: string; // "pluginId:componentName"
    displayName: string;
    icon?: string;
    defaults?: Record<string, unknown>;
}

/**
 * ワールド環境設定
 */
export interface WorldEnvironmentData {
    backgroundColor: string;
    worldSize: { width: number; height: number };
}

/**
 * ワールドスナップショットペイロード（flat ComponentInstance 単位）。
 *
 * GameObject に複数 Component が載っている場合、バックエンドが
 * 各 Component を 1 つの flat ComponentInstance に展開してから配信する。
 */
export interface WorldSnapshotPayload {
    entities: ComponentInstance[];
    availableComponents: AvailableComponent[];
    /** アクティブなプラグインIDのリスト */
    activePlugins: string[];
    environment: WorldEnvironmentData;
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
    'cursor:moved': (data: {
        userId: string;
        position: CursorPosition;
        state?: CursorState;
        heldEntityId?: string | null;
    }) => void;

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
    // Video Player Events (Server -> Client)
    // ============================================

    /** 動画プレイヤーの状態同期 */
    'video-player:sync': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;

    /** 動画プレイヤーの再生状態リクエスト（参加時・Resync）*/
    'video-player:state-request': (data: { fromSocketId: string }) => void;

    /** 動画プレイヤーの再生状態レスポンス */
    'video-player:state-response': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;
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
    'cursor:move': (data: { position: CursorPosition; state?: CursorState; heldEntityId?: string | null }) => void;

    /** ステータスを更新 */
    'status:update': (status: UserStatus) => void;

    /** ユーザー情報を更新 */
    'user:update': (patch: Partial<User>) => void;

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
    // Video Player Events (Client -> Server)
    // ============================================

    /** 動画プレイヤーの状態を同期 */
    'video-player:sync': (data: { currentIndex: number; isPlaying: boolean; currentTime: number }) => void;

    /** 他のユーザーに現在の再生状態を要求 */
    'video-player:state-request': () => void;

    /** 再生状態リクエストへの応答 */
    'video-player:state-response': (data: {
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
// Re-export Schemas and Plugins
// ============================================

export * from './plugin/types';
export * from './plugin/vnode';
export * from './schemas';
