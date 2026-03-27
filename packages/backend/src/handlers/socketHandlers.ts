import {
    type ClientToServerEvents,
    type CursorState,
    DEFAULTS,
    type EntityEphemeralPayload,
    type EntityPatchPayload,
    type InterServerEvents,
    type ServerToClientEvents,
    type SocketData,
    type User,
    type WorldEntity,
    type WorldSnapshotPayload,
} from '@ubichill/shared';
import type { Socket } from 'socket.io';
import { instanceManager } from '../services/instanceManager';
import { userManager } from '../services/userManager';
import { worldRegistry } from '../services/worldRegistry';
import { createEntity, deleteEntity, getWorldSnapshot, patchEntity } from '../services/worldState';
import { logger } from '../utils/logger';
import {
    validateCursorPosition,
    validateCursorState,
    validateUsername,
    validateUserStatus,
    validateWorldId,
} from '../utils/validation';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * ワールド参加イベントを処理
 */
export function handleWorldJoin(socket: TypedSocket) {
    return async (
        {
            worldId,
            instanceId,
            password,
            user,
        }: { worldId: string; instanceId: string; password?: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => {
        logger.debug('world:join イベント受信:', { worldId, instanceId, user, socketId: socket.id });

        // 認証済みユーザー確認（socketAuthMiddleware が先に実行されているはず）
        const authUser = socket.data.authUser;
        if (!authUser) {
            callback({ success: false, error: '認証が必要です' });
            return;
        }

        // インスタンスの存在確認とパスワード検証
        const instance = await instanceManager.getInstance(instanceId);
        if (!instance) {
            callback({ success: false, error: 'インスタンスが見つかりません' });
            return;
        }

        if (instance.access.password) {
            if (!password) {
                callback({ success: false, error: 'パスワードが必要です' });
                return;
            }
            const isPasswordValid = await instanceManager.verifyInstancePassword(instanceId, password);
            if (!isPasswordValid) {
                callback({ success: false, error: 'パスワードが正しくありません' });
                return;
            }
        }

        // ワールドIDを検証
        const worldValidation = validateWorldId(worldId);
        if (!worldValidation.valid) {
            logger.debug('ワールドID検証失敗:', worldValidation.error);
            callback({ success: false, error: worldValidation.error });
            return;
        }

        // 表示名: クライアント指定があれば優先（ニックネーム機能）、なければ DB の名前を使用
        const displayName = user.name?.trim() || authUser.name;

        // ユーザー名を検証
        const usernameValidation = validateUsername(displayName);
        if (!usernameValidation.valid) {
            logger.debug('ユーザー名検証失敗:', usernameValidation.error);
            callback({ success: false, error: usernameValidation.error });
            return;
        }

        // socket.id をユーザーIDとして使用する。
        // cursor:moved / user:left / user:updated などすべてのイベントは socket.id で
        // ユーザーを識別するため、User.id を socket.id に統一しないとクライアントの
        // users Map が正しく更新されず、カーソルが動かない / 退出が反映されない。
        const newUser: User = {
            id: socket.id,
            ...user,
            name: usernameValidation.data,
            position: user.position || DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        // instanceId が Socket.IO ルームキー兼エンティティ状態キー
        userManager.addUser(socket.id, instanceId, newUser);
        socket.join(instanceId);

        socket.data.userId = socket.id;
        socket.data.instanceId = instanceId;
        socket.data.user = newUser;

        await instanceManager.updateUserCount(instanceId, 1);

        const roomUsers = userManager.getUsersByWorld(instanceId);

        callback({ success: true, userId: socket.id });

        socket.emit('users:update', roomUsers);

        const entities = getWorldSnapshot(instanceId);
        const environment = await instanceManager.getWorldEnvironment(worldValidation.data);

        // ワールド定義から依存関係を取得（worldId で引く。instanceId は不可）
        const world = await worldRegistry.getWorld(worldValidation.data);
        const activePlugins = world?.dependencies?.map((d) => d.name) || [];

        const snapshotPayload: WorldSnapshotPayload = {
            entities,
            availableKinds: [],
            activePlugins,
            environment,
        };
        socket.emit('world:snapshot', snapshotPayload);
        logger.debug(
            `ワールドスナップショット送信: ${entities.length}件のエンティティ, plugins: ${activePlugins.length} (instanceId: ${instanceId})`,
        );

        socket.to(instanceId).emit('user:joined', newUser);

        logger.info(
            `✅ ユーザー「${newUser.name}」(${socket.id.substring(0, 8)}) がインスタンス「${instanceId}」に参加しました`,
        );
    };
}

/**
 * カーソル移動イベントを処理
 */
export function handleCursorMove(socket: TypedSocket) {
    return (payload: { position: { x: number; y: number }; state?: CursorState }) => {
        const { position, state } = payload;
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        // カーソル位置を検証
        const validation = validateCursorPosition(position);
        if (!validation.valid) {
            socket.emit('error', validation.error || '無効なカーソル位置です');
            return;
        }

        // カーソル状態を検証（存在する場合のみ）
        let validatedState: CursorState | undefined;
        if (state !== undefined) {
            const stateValidation = validateCursorState(state);
            if (!stateValidation.valid) {
                socket.emit('error', stateValidation.error || '無効なカーソル状態です');
                return;
            }
            validatedState = stateValidation.data;
        }

        // 位置と状態を更新
        const updated = userManager.updateUserPosition(socket.id, validation.data, validatedState);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        socket.to(instanceId).emit('cursor:moved', {
            userId: socket.id,
            position: validation.data,
            state: validatedState,
        });
    };
}

/**
 * ステータス更新イベントを処理
 */
export function handleStatusUpdate(socket: TypedSocket) {
    return (status: string) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const validation = validateUserStatus(status);
        if (!validation.valid) {
            socket.emit('error', validation.error || '無効なステータスです');
            return;
        }

        const updated = userManager.updateUserStatus(socket.id, validation.data);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        socket.to(instanceId).emit('status:changed', {
            userId: socket.id,
            status: validation.data,
        });
    };
}

/**
 * ユーザー情報の更新イベントを処理
 */
export function handleUserUpdate(socket: TypedSocket) {
    return (patch: Partial<User>) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const updatedUser = userManager.updateUser(socket.id, patch);

        if (!updatedUser) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        socket.nsp.to(instanceId).emit('user:updated', updatedUser);
    };
}

/**
 * ワールド退出イベントを処理（SPA内でロビーに戻る場合など、ソケットを切断せずに退出するケース）
 */
export function handleWorldLeave(socket: TypedSocket) {
    return async () => {
        const instanceId = socket.data.instanceId;
        const user = userManager.removeUser(socket.id);

        if (instanceId) {
            await instanceManager.updateUserCount(instanceId, -1);
        }

        if (instanceId && user) {
            socket.leave(instanceId);

            const entities = getWorldSnapshot(instanceId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === socket.id);
            userLockedEntities.forEach((entity) => {
                patchEntity(instanceId, entity.id, {
                    lockedBy: null,
                    data: { ...(entity.data as Record<string, unknown>), isHeld: false },
                });
                socket.to(instanceId).emit('entity:patched', {
                    entityId: entity.id,
                    patch: { lockedBy: null, data: { ...(entity.data as Record<string, unknown>), isHeld: false } },
                });
            });

            socket.to(instanceId).emit('user:left', socket.id);
            logger.info(
                `🚪 ユーザー「${user.name}」(${socket.id.substring(0, 8)}) がインスタンス「${instanceId}」から退出しました`,
            );
        }

        socket.data.instanceId = undefined;
        socket.data.user = undefined;
    };
}

/**
 * 切断イベントを処理
 */
export function handleDisconnect(socket: TypedSocket) {
    return async () => {
        const instanceId = socket.data.instanceId;
        const user = userManager.removeUser(socket.id);

        if (instanceId) {
            await instanceManager.updateUserCount(instanceId, -1);
        }

        if (instanceId && user) {
            const entities = getWorldSnapshot(instanceId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === socket.id);

            userLockedEntities.forEach((entity) => {
                patchEntity(instanceId, entity.id, {
                    lockedBy: null,
                    data: {
                        ...(entity.data as Record<string, unknown>),
                        isHeld: false,
                    },
                });

                socket.to(instanceId).emit('entity:patched', {
                    entityId: entity.id,
                    patch: {
                        lockedBy: null,
                        data: {
                            ...(entity.data as Record<string, unknown>),
                            isHeld: false,
                        },
                    },
                });
            });

            if (userLockedEntities.length > 0) {
                logger.info(
                    `ユーザー ${user.name} がロックしていた ${userLockedEntities.length} 個のエンティティを解放しました`,
                );
            }

            socket.to(instanceId).emit('user:left', socket.id);
            logger.info(
                `👋 ユーザー「${user.name}」(${socket.id.substring(0, 8)}) がインスタンス「${instanceId}」から退出しました`,
            );
        } else {
            logger.info(`👋 ユーザーが切断しました: ${socket.id.substring(0, 8)}`);
        }
    };
}

// ============================================
// UEP (Ubichill Entity Protocol) Handlers
// ============================================

/**
 * エンティティ作成イベントを処理
 */
export function handleEntityCreate(socket: TypedSocket) {
    return (
        payload: Omit<WorldEntity, 'id'>,
        callback: (response: { success: boolean; entity?: WorldEntity; error?: string }) => void,
    ) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            callback({ success: false, error: '最初にワールドに参加する必要があります' });
            return;
        }

        try {
            const entity = createEntity(instanceId, payload);
            callback({ success: true, entity });
            socket.to(instanceId).emit('entity:created', entity);
            logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type})`);
        } catch (error) {
            logger.error('エンティティ作成エラー:', error);
            callback({ success: false, error: 'エンティティの作成に失敗しました' });
        }
    };
}

/**
 * エンティティパッチイベントを処理（Reliable）
 */
export function handleEntityPatch(socket: TypedSocket) {
    return (payload: EntityPatchPayload) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const { entityId, patch } = payload;

        const updated = patchEntity(instanceId, entityId, patch);
        if (!updated) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        socket.to(instanceId).emit('entity:patched', payload);
        logger.debug(`エンティティパッチ: ${entityId}`);
    };
}

/**
 * エンティティエフェメラルイベントを処理（Volatile）
 */
export function handleEntityEphemeral(socket: TypedSocket) {
    return (payload: EntityEphemeralPayload) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        socket.to(instanceId).emit('entity:ephemeral', payload);
    };
}

/**
 * エンティティ削除イベントを処理
 */
export function handleEntityDelete(socket: TypedSocket) {
    return (entityId: string) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const deleted = deleteEntity(instanceId, entityId);
        if (!deleted) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        socket.to(instanceId).emit('entity:deleted', entityId);
        logger.debug(`エンティティ削除: ${entityId}`);
    };
}

/**
 * ワールドスナップショットを送信
 * @param instanceId Socket.IO ルームキー兼エンティティ状態キー
 * @param worldId ワールド定義取得用の worldId
 */
export async function sendWorldSnapshot(socket: TypedSocket, instanceId: string, worldId: string): Promise<void> {
    const entities = getWorldSnapshot(instanceId);
    const environment = await instanceManager.getWorldEnvironment(worldId);
    const world = await worldRegistry.getWorld(worldId);
    const activePlugins = world?.dependencies?.map((d) => d.name) || [];

    const snapshotPayload: WorldSnapshotPayload = {
        entities,
        availableKinds: [],
        activePlugins,
        environment,
    };
    socket.emit('world:snapshot', snapshotPayload);
    logger.debug(
        `ワールドスナップショット送信: ${entities.length}件のエンティティ, plugins: ${activePlugins.length} (instanceId: ${instanceId})`,
    );
}

/**
 * ビデオプレイヤーの同期イベントを処理
 */
export function handleVideoPlayerSync(socket: TypedSocket) {
    return async (syncData: { currentIndex: number; isPlaying: boolean; currentTime: number }) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            logger.warn('video-player:sync - インスタンスIDが設定されていません');
            return;
        }

        const roomSockets = await socket.in(instanceId).fetchSockets();
        const otherSockets = roomSockets.filter((s) => s.id !== socket.id);

        logger.debug('video-player:sync イベント受信:', {
            instanceId,
            syncData,
            fromSocketId: socket.id,
            fromUserId: socket.data.userId,
            totalSocketsInRoom: roomSockets.length,
            otherSocketsCount: otherSockets.length,
        });

        socket.to(instanceId).emit('video-player:sync', syncData);
    };
}
