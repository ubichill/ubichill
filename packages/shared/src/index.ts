// ゼロ依存の素朴な型（User/ComponentInstance/EntityTransform 等）は mod/entities.ts に分離。
// barrel（このファイル）を経由せず SDK 側から直接 import できるようにするため
// （dts-bundle-generator が schemas/* の zod スキーマまで読み込まずに済む、詳細は同ファイル参照）。
export * from './mod/entities';

import type {
    ComponentInstance,
    CursorPosition,
    EntityEphemeralPayload,
    EntityPatchPayload,
    User,
    UserStatus,
} from './mod/entities';
import type { WorldSnapshotPayload } from './world/instanceDefinition';

// ============================================
// 部屋の共有状態
// ============================================

/**
 * 部屋の共有状態の 1 件。インスタンスサーバーは値を解釈せず、revision による比較と交換と、
 * 書き込みの時刻（updatedAt・サーバー時刻の ms）・書いた参加者（updatedBy）だけを付ける。
 * キーの名前空間と値の意味は Host が決める（例: メディアのタイムラインは `media:<session>`）。
 */
export interface SharedStateEntry {
    key: string;
    value: unknown;
    revision: number;
    updatedAt: number;
    updatedBy: string;
}

/** `state:get` / `state:update` の応答。競合（code: 'conflict'）では今の entry を返す。 */
export type SharedStateResult =
    | { success: true; entry: SharedStateEntry | null; serverTime: number }
    | { success: false; error: string; code?: 'conflict'; entry?: SharedStateEntry | null; serverTime?: number };

export interface SharedStateUpdate {
    key: string;
    value: unknown;
    /** 今の revision（無いキーは 0）。一致しなければ書かずに競合を返す。 */
    expectedRevision: number;
}

// ============================================
// Instance WebSocket Event Types
// ============================================

/** 他の参加者のカーソル 1 件（cursor:moved・cursors:moved の要素） */
export interface CursorMovedPayload {
    userId: string;
    position: CursorPosition;
    heldEntityId?: string | null;
}

/**
 * world:join で宣言する、クライアントが受け取れる形。Go のインスタンスとフロントは別々にデプロイされるので、
 * 配り方を変えるときは宣言したクライアントにだけ新しい形で送る（docs/PROTOCOLS.md の D）。
 * - `cursors:batch`: カーソルを cursor:moved の代わりに cursors:moved でまとめて受ける
 */
export type InstanceFeature = 'cursors:batch';

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
    'cursor:moved': (data: CursorMovedPayload) => void;

    /**
     * まとめたカーソル（features に `cursors:batch` を宣言した接続だけが受ける）。利用者ごとに最新の 1 件で、自分の分は含まない。
     * InstanceSocket が個々の cursor:moved に展開して配るので、このイベント自体は購読側に届かない。
     */
    'cursors:moved': (data: CursorMovedPayload[]) => void;

    /** ユーザーのステータス更新 */
    'status:changed': (data: { userId: string; status: UserStatus }) => void;

    /** エラー通知 */
    error: (message: string) => void;

    /** 同じアカウントが別のタブ・端末で参加したので、この接続は切られる（1 アカウント 1 接続） */
    'session:replaced': () => void;

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

    /** インスタンス終了通知 */
    'instance:closing': (reason: string) => void;

    /** 共有状態が他の参加者に更新された（書いた本人へは応答で返すので送らない） */
    'state:changed': (entry: SharedStateEntry) => void;

    /** その場だけの知らせ（切断の予告など）。知らない種類も届くので parseServerNotice で読む */
    'server:notice': (notice: unknown) => void;
}

/**
 * クライアントからサーバーへ送信されるイベント
 */
export interface ClientToServerEvents {
    /** ワールドに参加 */
    'world:join': (
        data: {
            instanceId: string;
            user: Omit<User, 'id'>;
            /** 受け取れる形の宣言。InstanceSocket が付けるので呼び出し側は指定しない。 */
            features?: InstanceFeature[];
        },
        callback: (response: {
            success: boolean;
            userId?: string;
            instanceId?: string;
            error?: string;
            /** チケット再取得で復旧できる入室失敗。 */
            code?: 'ticket_invalid' | 'instance_unavailable';
        }) => void,
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
    // 部屋の共有状態 (Client -> Server)
    // ============================================

    /** 共有状態の今の値を取得する（入室・再接続の直後に使う） */
    'state:get': (data: { key: string }, callback: (result: SharedStateResult) => void) => void;

    /** expectedRevision が一致したときだけ共有状態を書き換える */
    'state:update': (data: SharedStateUpdate, callback: (result: SharedStateResult) => void) => void;
}

// ============================================
// Constants
// ============================================

/**
 * 環境変数キー定数
 * 各パッケージで散らばらないよう、ここで一元管理する
 */
export const ENV_KEYS = {
    /** バックエンドのポート番号 */
    PORT: 'PORT',

    /** ワールド定義ディレクトリのパス（ローカルファイル用、レガシー） */
    WORLDS_DIR: 'WORLDS_DIR',

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

    /** ワールド定義ディレクトリのデフォルト相対パス（バックエンドcwd基準） */
    WORLDS_DIR_DEFAULT: '../../worlds',
} as const;

// ============================================
// Re-export Schemas and Mods
// ============================================

export * from './federation';
export type { components as InstanceAPI } from './generated/instance';
export * from './mod/capability';
export * from './mod/componentRefs';
export * from './mod/errors';
export * from './mod/modLock';
export * from './mod/modSignature';
export * from './mod/permission';
export * from './mod/protocol';
export * from './mod/sandboxPolicy';
export * from './mod/serviceToken';
export * from './mod/types';
export * from './mod/vnode';
export * from './notification/activity';
export * from './notification/serverNotice';
export * from './schemas';
export {
    confirmEnvelopeAuthor,
    type EnvelopeInvalidReason,
    type EnvelopeVerdict,
    type SignatureFields,
    type SignatureTarget,
    SignedAuthorSchema,
    signaturePayload,
    signEnvelope,
    verifyEnvelope,
} from './signature/envelope';
export * from './user/authorKeyDirectory';
export * from './user/cliAuth';
export * from './user/displayNameChange';
export * from './user/externalWorks';
export * from './user/favoritesVisibility';
export * from './user/fediverse';
export * from './user/friends';
export * from './user/handle';
export * from './user/home';
export * from './user/instanceAccess';
export * from './user/limits';
export * from './user/presence';
export * from './user/profile';
export * from './user/profileLanguages';
export * from './user/profileLinks';
export * from './user/roles';
export * from './user/signingKeys';
export * from './user/userSearch';
export * from './world/devEvents';
export * from './world/identity';
export * from './world/instanceDefinition';
export * from './world/pagePath';
export * from './world/resolve';
