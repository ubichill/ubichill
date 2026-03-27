/**
 * @ubichill/sdk/ui — Custom Elements 向けコンテキスト型定義
 *
 * プラグイン開発者はこのモジュールから UbiWidget / UbiSingleton を継承して UI を実装する。
 * React / Socket.IO には依存しない（注入されたコンテキストで受け取る）。
 */

import type { CursorState, User, WorldEntity } from '@ubichill/shared';

export interface SocketLike {
    emit(event: string, ...args: unknown[]): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    readonly id: string | undefined;
}

export interface UbiEntityContext<TData = unknown, TEphemeral = unknown> {
    /** このウィジェットが表すエンティティ */
    entity: WorldEntity<TData>;
    /** 他ユーザーからのエフェメラルデータ */
    ephemeral: TEphemeral | undefined;

    /** エンティティを部分更新する */
    patchEntity: (patch: Partial<WorldEntity<TData>>) => void;
    /** エフェメラルデータを全ユーザーにブロードキャスト */
    broadcast: (data: TEphemeral) => void;

    /** このエンティティが（誰かによって）ロック中か */
    isLocked: boolean;
    /** 自分がこのエンティティをロック中か */
    isLockedByMe: boolean;
    /** 他ユーザーがこのエンティティをロック中か */
    isLockedByOther: boolean;
    /** エンティティを自分でロック */
    lockEntity: () => void;
    /** エンティティのロックを解除 */
    unlockEntity: () => void;
    /**
     * 自分がロックしている他エンティティを解放する（singleHold 制御用）
     * onAutoRelease でリリース時のパッチを返せる。
     */
    releaseOtherLocks: (options?: { onAutoRelease?: (entity: WorldEntity) => Partial<WorldEntity> }) => void;

    /** 新しいエンティティをワールドに作成する */
    createEntity: (type: string, transform: WorldEntity['transform'], data: unknown) => Promise<WorldEntity | null>;

    /** ログイン中のユーザー ID */
    currentUserId: string | null | undefined;
    /** ワールド内の全ユーザー */
    users: ReadonlyMap<string, User>;

    /** Socket.IO クライアント（プラグイン固有のソケットイベントに使用） */
    socket: SocketLike | null;
}

export interface UbiInstanceContext {
    /** ログイン中のユーザー情報 */
    currentUser: User | null;
    /** ワールド内の全ユーザー */
    users: ReadonlyMap<string, User>;
    /** Socket が接続中か */
    isConnected: boolean;

    /** 自ユーザー情報を更新する */
    updateUser: (patch: Partial<User>) => void;
    /** カーソル位置を送信する */
    updatePosition: (pos: { x: number; y: number }, cursorState: CursorState) => void;

    /** ワールド内の全エンティティ */
    entities: ReadonlyMap<string, WorldEntity>;
    /** エンティティを部分更新する */
    patchEntity: (id: string, patch: Partial<WorldEntity>) => void;
    /** 新しいエンティティをワールドに作成する */
    createEntity: (type: string, transform: WorldEntity['transform'], data: unknown) => Promise<WorldEntity | null>;

    /** エフェメラルデータマップ (entityId → data) */
    ephemeralData: ReadonlyMap<string, unknown>;
    /** エンティティにエフェメラルデータをブロードキャスト */
    broadcastEphemeral: (entityId: string, data: unknown) => void;
    /**
     * ブロードキャストチャンネルを購読する。戻り値の関数で購読解除。
     * `socket.on('entity:ephemeral')` の直接使用の代わりに使う。
     */
    onBroadcast: (channel: string, handler: (data: unknown) => void) => () => void;

    /** @deprecated プラグイン固有イベントには onBroadcast / broadcastEphemeral を使用 */
    socket: SocketLike | null;
}
