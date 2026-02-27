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
        { worldId, instanceId, user }: { worldId: string; instanceId?: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => {
        logger.debug('world:join イベント受信:', { worldId, instanceId, user, socketId: socket.id });

        // 認証済みユーザー確認（socketAuthMiddleware が先に実行されているはず）
        const authUser = socket.data.authUser;
        if (!authUser) {
            callback({ success: false, error: '認証が必要です' });
            return;
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

        // ユーザーオブジェクトを作成（DB由来のIDを使用）
        const newUser: User = {
            id: authUser.id, // socket.id ではなく DB の user.id を使用
            ...user,
            name: usernameValidation.data,
            position: user.position || DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        // インスタンスIDを使ってSocket.IOルームとワールド状態を管理
        // instanceIdがある場合はそれを使い、ない場合はworldIdにフォールバック
        const socketRoom = instanceId || worldValidation.data;
        const worldStateKey = instanceId || worldValidation.data;

        // ワールドにユーザーを追加
        userManager.addUser(socket.id, socketRoom, newUser);
        socket.join(socketRoom);

        // ソケットデータに保存
        socket.data.userId = socket.id;
        socket.data.worldId = socketRoom;
        socket.data.instanceId = instanceId;
        socket.data.user = newUser;

        // インスタンスのユーザー数を更新
        if (instanceId) {
            await instanceManager.updateUserCount(instanceId, 1);
        }

        // このワールド内の全ユーザーを取得
        const worldUsers = userManager.getUsersByWorld(socketRoom);

        // 成功レスポンスを送信
        callback({
            success: true,
            userId: socket.id,
        });

        // 新しいユーザーに現在のユーザー一覧を送信
        socket.emit('users:update', worldUsers);

        // 新しいユーザーにワールドスナップショットを送信（UEP）
        // instanceIdをキーにしてワールド状態を取得（インスタンスごとに独立した状態）
        const entities = getWorldSnapshot(worldStateKey);
        const environment = await instanceManager.getWorldEnvironment(worldValidation.data);

        // ワールド定義から依存関係を取得
        const world = await worldRegistry.getWorld(worldValidation.data);
        const activePlugins = world?.dependencies?.map((d) => d.name) || [];

        // ワールドスナップショット（拡張版）を送信
        const snapshotPayload: WorldSnapshotPayload = {
            entities,
            availableKinds: [], // 将来的にワールド定義から取得
            activePlugins,
            environment,
        };
        socket.emit('world:snapshot', snapshotPayload);
        logger.debug(
            `ワールドスナップショット送信: ${entities.length}件のエンティティ, plugins: ${activePlugins.length} (instance: ${worldStateKey})`,
        );

        // ワールド内の他のユーザーに参加を通知
        socket.to(socketRoom).emit('user:joined', newUser);

        logger.info(
            `✅ ユーザー「${newUser.name}」(${socket.id.substring(0, 8)}) がインスタンス「${socketRoom}」に参加しました`,
        );
    };
}

/**
 * カーソル移動イベントを処理
 */
export function handleCursorMove(socket: TypedSocket) {
    return (payload: { position: { x: number; y: number }; state?: CursorState }) => {
        const { position, state } = payload;
        const worldId = socket.data.worldId;
        if (!worldId) {
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

        // ワールド内の他のユーザーにブロードキャスト
        socket.to(worldId).emit('cursor:moved', {
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
        const worldId = socket.data.worldId;
        if (!worldId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        // ステータスを検証
        const validation = validateUserStatus(status);
        if (!validation.valid) {
            socket.emit('error', validation.error || '無効なステータスです');
            return;
        }

        // ステータスを更新
        const updated = userManager.updateUserStatus(socket.id, validation.data);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        // ワールド内の他のユーザーにブロードキャスト
        socket.to(worldId).emit('status:changed', {
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
        const worldId = socket.data.worldId;
        if (!worldId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        // ユーザー情報を更新
        // userManager側でホワイトリストベースのフィルタリングを実施
        const updatedUser = userManager.updateUser(socket.id, patch);

        if (!updatedUser) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        // ワールド内の全員（自分含む）にブロードキャスト
        // 自分にも送ることで、サーバー側で正規化された状態（もしあれば）を反映できる
        // また、他のクライアントと同じイベントフローで更新を受け取れるメリットがある
        socket.nsp.to(worldId).emit('user:updated', updatedUser);
    };
}

/**
 * 切断イベントを処理
 */
export function handleDisconnect(socket: TypedSocket) {
    return async () => {
        const worldId = socket.data.worldId;
        const instanceId = socket.data.instanceId;
        const user = userManager.removeUser(socket.id);

        // インスタンスのユーザー数を更新
        if (instanceId) {
            await instanceManager.updateUserCount(instanceId, -1);
        }

        if (worldId && user) {
            // 切断したユーザーがロックしていたエンティティを解放する
            const entities = getWorldSnapshot(worldId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === socket.id);

            userLockedEntities.forEach((entity) => {
                // ロックを解除するだけ（位置はそのまま）
                patchEntity(worldId, entity.id, {
                    lockedBy: null,
                    data: {
                        ...(entity.data as Record<string, unknown>),
                        isHeld: false,
                    },
                });

                // 他のユーザーに通知
                socket.to(worldId).emit('entity:patched', {
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

            // ワールド内の他のユーザーに退出を通知
            socket.to(worldId).emit('user:left', socket.id);
            logger.info(
                `👋 ユーザー「${user.name}」(${socket.id.substring(0, 8)}) がワールド「${worldId}」から退出しました`,
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
        const worldId = socket.data.worldId;
        if (!worldId) {
            callback({ success: false, error: '最初にワールドに参加する必要があります' });
            return;
        }

        try {
            // エンティティを作成（IDはサーバーで生成）
            const entity = createEntity(worldId, payload);

            // 成功レスポンスを送信
            callback({ success: true, entity });

            // ワールド内の他のユーザーにブロードキャスト
            socket.to(worldId).emit('entity:created', entity);

            logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type})`);
        } catch (error) {
            logger.error('エンティティ作成エラー:', error);
            callback({ success: false, error: 'エンティティの作成に失敗しました' });
        }
    };
}

/**
 * エンティティパッチイベントを処理（Reliable）
 * - サーバーに状態を保存する
 * - 送信者以外の全員にブロードキャストする
 */
export function handleEntityPatch(socket: TypedSocket) {
    return (payload: EntityPatchPayload) => {
        const worldId = socket.data.worldId;
        if (!worldId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const { entityId, patch } = payload;

        // エンティティを更新
        const updated = patchEntity(worldId, entityId, patch);
        if (!updated) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        // ワールド内の他のユーザーにブロードキャスト
        socket.to(worldId).emit('entity:patched', payload);

        logger.debug(`エンティティパッチ: ${entityId}`);
    };
}

/**
 * エンティティエフェメラルイベントを処理（Volatile）
 * - サーバーに保存しない
 * - 送信者以外の全員にブロードキャストする
 */
export function handleEntityEphemeral(socket: TypedSocket) {
    return (payload: EntityEphemeralPayload) => {
        const worldId = socket.data.worldId;
        if (!worldId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        // 保存せずにそのままブロードキャスト（土管）
        socket.to(worldId).emit('entity:ephemeral', payload);
    };
}

/**
 * エンティティ削除イベントを処理
 */
export function handleEntityDelete(socket: TypedSocket) {
    return (entityId: string) => {
        const worldId = socket.data.worldId;
        if (!worldId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        // エンティティを削除
        const deleted = deleteEntity(worldId, entityId);
        if (!deleted) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        // ワールド内の他のユーザーにブロードキャスト
        socket.to(worldId).emit('entity:deleted', entityId);

        logger.debug(`エンティティ削除: ${entityId}`);
    };
}

/**
 * ワールドスナップショットを送信（ワールド参加時に呼び出す）
 * @param instanceOrWorldId インスタンスIDまたはワールドID（ワールド状態のキー）
 * @param worldId 環境設定取得用のワールドID
 */
export async function sendWorldSnapshot(
    socket: TypedSocket,
    instanceOrWorldId: string,
    worldId?: string,
): Promise<void> {
    const entities = getWorldSnapshot(instanceOrWorldId);

    // WorldIDを解決
    let targetWorldId = worldId;
    if (!targetWorldId) {
        if (await worldRegistry.hasWorld(instanceOrWorldId)) {
            targetWorldId = instanceOrWorldId;
        } else {
            // インスタンスIDからワールドIDを特定を試みる
            const instance = await instanceManager.getInstance(instanceOrWorldId);
            if (instance) {
                targetWorldId = instance.world.id;
            }
        }
    }

    // 環境設定とプラグイン情報を取得
    const finalWorldId = targetWorldId || instanceOrWorldId;
    const environment = await instanceManager.getWorldEnvironment(finalWorldId);
    const world = await worldRegistry.getWorld(finalWorldId);
    const activePlugins = world?.dependencies?.map((d) => d.name) || [];

    const snapshotPayload: WorldSnapshotPayload = {
        entities,
        availableKinds: [],
        activePlugins,
        environment,
    };
    socket.emit('world:snapshot', snapshotPayload);
    logger.debug(
        `ワールドスナップショット送信: ${entities.length}件のエンティティ, plugins: ${activePlugins.length} (key: ${instanceOrWorldId})`,
    );
}

/**
 * ビデオプレイヤーの同期イベントを処理
 */
export function handleVideoPlayerSync(socket: TypedSocket) {
    return async (syncData: { currentIndex: number; isPlaying: boolean; currentTime: number }) => {
        const worldId = socket.data.worldId;
        if (!worldId) {
            logger.warn('video-player:sync - ワールドIDが設定されていません');
            return;
        }

        // ワールド内の全ソケットを取得
        const worldSockets = await socket.in(worldId).fetchSockets();
        const otherSockets = worldSockets.filter((s) => s.id !== socket.id);

        logger.debug('video-player:sync イベント受信:', {
            worldId,
            syncData,
            fromSocketId: socket.id,
            fromUserId: socket.data.userId,
            totalSocketsInWorld: worldSockets.length,
            otherSocketsCount: otherSockets.length,
            otherSocketIds: otherSockets.map((s) => s.id),
            timestamp: new Date().toISOString(),
        });

        // 同じワールド内の他のユーザーに同期データをブロードキャスト
        const emitResult = socket.to(worldId).emit('video-player:sync', syncData);

        logger.debug('video-player:sync ブロードキャスト完了:', {
            worldId,
            targetSocketsCount: otherSockets.length,
            emitResult: emitResult ? 'success' : 'no-result',
        });
    };
}
