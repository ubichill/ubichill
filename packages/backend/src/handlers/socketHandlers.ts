import {
    type ClientToServerEvents,
    type ComponentInstance,
    DEFAULTS,
    type EntityEphemeralPayload,
    type EntityPatchPayload,
    type InterServerEvents,
    type ServerToClientEvents,
    type SocketData,
    type User,
    type WorldSnapshotPayload,
} from '@ubichill/shared';
import type { Socket } from 'socket.io';
import { appConfig } from '../config';
import { instanceManager } from '../services/instanceManager';
import { createEntity, deleteEntity, getInstanceSnapshot, patchEntity } from '../services/instanceState';
import { userManager } from '../services/userManager';
import { worldRegistry } from '../services/worldRegistry';
import { logger } from '../utils/logger';

const disconnectTimers = new Map<string, NodeJS.Timeout>();
const activeUserSockets = new Map<string, TypedSocket>();

import { validateCursorPosition, validateUsername, validateUserStatus, validateWorldId } from '../utils/validation';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * ID 統一: User.id / userManager のキー / broadcast の userId は
 * すべて DB の users.id (better-auth セッションの user.id) に統一する。
 * これにより、フロントの currentUser.id と worldRecord.authorId が直接比較できる。
 *
 * NOTE: Socket.IO のルーミング・DM (socket.to(socket.id)) には引き続き socket.id を使う。
 *       socket.id は接続単位、stableUserId はユーザー単位（同一ユーザーが複数 socket を持ちうる）。
 */
function stableUserId(socket: TypedSocket): string | undefined {
    return socket.data.authUser?.id;
}

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
        callback: (response: { success: boolean; userId?: string; instanceId?: string; error?: string }) => void,
    ) => {
        logger.debug('world:join イベント受信:', { worldId, instanceId, user, socketId: socket.id });

        // 認証済みユーザー確認（socketAuthMiddleware が先に実行されているはず）
        const authUser = socket.data.authUser;
        if (!authUser) {
            callback({ success: false, error: '認証が必要です' });
            return;
        }

        // インスタンスの存在確認: 存在しない場合はエラー（自動再作成しない）
        const instance = await instanceManager.getInstance(instanceId);
        if (!instance) {
            callback({ success: false, error: 'インスタンスが見つかりません。ロビーから参加してください。' });
            return;
        }

        // インスタンスはDBに存在するが、サーバー再起動でインメモリ状態が消えた場合は
        // 初期エンティティを再配置する
        const existingEntities = getInstanceSnapshot(instance.id);
        if (existingEntities.length === 0) {
            await instanceManager.reinitializeEntities(instance.id, worldId);
            logger.info(`🔄 ワールド状態を再初期化しました: ${instance.id} (worldId: ${worldId})`);
        }

        const effectiveInstanceId = instance.id;

        if (instance.access.password) {
            if (!password) {
                callback({ success: false, error: 'パスワードが必要です' });
                return;
            }
            const isPasswordValid = await instanceManager.verifyInstancePassword(effectiveInstanceId, password);
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

        // ID 統一: User.id = DB users.id (authUser.id)。socket.id は接続単位の別概念。
        const userId = authUser.id;

        // ── 旧セッションの状態を確定 ───────────────────────────────
        // grace timer (切断後の猶予待ち) は無条件にキャンセルし、
        // 旧 instance が分かるなら別 instance への移動かどうかを判定する。
        const reconnectTimer = disconnectTimers.get(userId);
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            disconnectTimers.delete(userId);
            logger.info(`✅ ユーザーが猶予期間内に再接続しました: ${userId}`);
        }
        const prevInstanceId = userManager.getUserWorld(userId);

        // 同一 userId で別 socket が既にアクティブな場合は、旧 socket を蹴る。
        // 旧 socket の handleDisconnect は activeUserSockets ガードで no-op になる。
        const oldSocket = activeUserSockets.get(userId);
        if (oldSocket && oldSocket.id !== socket.id) {
            oldSocket.disconnect(true);
        }

        // 別 instance に居たなら、そこの後始末 (ロック解放 + user:left + ルーム退出 + emptyTimer 再評価)
        const isInstanceMove = prevInstanceId !== undefined && prevInstanceId !== effectiveInstanceId;
        if (isInstanceMove && prevInstanceId) {
            const prevEntities = getInstanceSnapshot(prevInstanceId);
            const userLockedEntities = prevEntities.filter((e) => e.lockedBy === userId);
            userLockedEntities.forEach((entity) => {
                patchEntity(prevInstanceId, entity.id, {
                    lockedBy: null,
                    data: { ...(entity.data as Record<string, unknown>), isHeld: false },
                });
                socket.nsp.to(prevInstanceId).emit('entity:patched', {
                    entityId: entity.id,
                    patch: { lockedBy: null, data: { ...(entity.data as Record<string, unknown>), isHeld: false } },
                });
            });
            socket.leave(prevInstanceId);
            socket.nsp.to(prevInstanceId).emit('user:left', userId);
            instanceManager.syncEmptyTimer(prevInstanceId);
        }

        // userManager を新 instance に切り替え
        userManager.removeUser(userId);

        const newUser: User = {
            id: userId,
            ...user,
            name: usernameValidation.data,
            position: user.position || DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        // effectiveInstanceId が Socket.IO ルームキー兼エンティティ状態キー
        userManager.addUser(userId, effectiveInstanceId, newUser);
        socket.join(effectiveInstanceId);

        socket.data.userId = userId;
        socket.data.instanceId = effectiveInstanceId;
        socket.data.user = newUser;

        // activeUserSockets の差し替えは「旧 socket の disconnect ハンドラ」より後で良い:
        // handleDisconnect は activeUserSockets.get(userId) === socket か否かで判定するため、
        // ここで上書きした瞬間に旧 socket は「現役ではない」状態になる (= 死神タイマー化を阻止)。
        activeUserSockets.set(userId, socket);

        // emptyTimer が走っていたらキャンセル (userManager に人がいるので削除予約は不要)
        instanceManager.syncEmptyTimer(effectiveInstanceId);

        const roomUsers = userManager.getUsersByWorld(effectiveInstanceId);

        // instanceId が要求と異なる場合（自動再作成）はクライアントへ新しい ID を通知
        callback({ success: true, userId, instanceId: effectiveInstanceId });

        socket.emit('users:update', roomUsers);

        const entities = getInstanceSnapshot(effectiveInstanceId);
        const environment = await instanceManager.getWorldEnvironment(worldValidation.data);

        // ワールド定義から依存関係を取得（worldId で引く。instanceId は不可）
        const world = await worldRegistry.getWorld(worldValidation.data);
        const activePlugins = world?.dependencies?.map((d) => d.name) || [];

        const snapshotPayload: WorldSnapshotPayload = {
            entities,
            availableComponents: [],
            activePlugins,
            environment,
        };
        socket.emit('world:snapshot', snapshotPayload);
        logger.debug(
            `ワールドスナップショット送信: ${entities.length}件のエンティティ, plugins: ${activePlugins.length} (instanceId: ${effectiveInstanceId})`,
        );

        socket.to(effectiveInstanceId).emit('user:joined', newUser);

        logger.info(
            `✅ ユーザー「${newUser.name}」(${socket.id.substring(0, 8)}) がインスタンス「${effectiveInstanceId}」に参加しました`,
        );
    };
}

/**
 * カーソル移動イベントを処理
 */
export function handleCursorMove(socket: TypedSocket) {
    return (payload: { position: { x: number; y: number }; heldEntityId?: string | null }) => {
        const { position, heldEntityId } = payload;
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

        const userId = stableUserId(socket);
        if (!userId) {
            socket.emit('error', '認証が必要です');
            return;
        }

        // 位置を更新
        const updated = userManager.updateUserPosition(userId, validation.data);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        // heldEntityId: 文字列なら 1〜64 文字を中継、null は中継、それ以外 (空文字 / undefined / 不正型) は無視
        const safeHeldEntityId =
            typeof heldEntityId === 'string' && heldEntityId.length > 0 && heldEntityId.length <= 64
                ? heldEntityId
                : heldEntityId === null
                  ? null
                  : undefined;

        socket.to(instanceId).emit('cursor:moved', {
            userId,
            position: validation.data,
            ...(safeHeldEntityId !== undefined && { heldEntityId: safeHeldEntityId }),
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

        const userId = stableUserId(socket);
        if (!userId) {
            socket.emit('error', '認証が必要です');
            return;
        }

        const updated = userManager.updateUserStatus(userId, validation.data);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        socket.to(instanceId).emit('status:changed', {
            userId,
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

        const userId = stableUserId(socket);
        if (!userId) {
            socket.emit('error', '認証が必要です');
            return;
        }

        const updatedUser = userManager.updateUser(userId, patch);

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
    return async (callback?: (response: { success: boolean }) => void) => {
        const instanceId = socket.data.instanceId;
        const userId = stableUserId(socket);

        // 旧 socket からの leave (= takeover 済み) は無視: 現役セッションを巻き込まないため
        if (userId) {
            const currentSocket = activeUserSockets.get(userId);
            if (currentSocket && currentSocket !== socket) {
                callback?.({ success: true });
                return;
            }
        }

        // grace timer が走っているなら止める (これから明示退出するので)
        if (userId) {
            const pending = disconnectTimers.get(userId);
            if (pending) {
                clearTimeout(pending);
                disconnectTimers.delete(userId);
            }
        }

        const user = userId ? userManager.removeUser(userId) : undefined;
        if (userId) {
            activeUserSockets.delete(userId);
        }

        // 実際にメモリから誰かを消したときだけ emptyTimer 再評価
        if (instanceId && user) {
            instanceManager.syncEmptyTimer(instanceId);
        }

        if (instanceId && user && userId) {
            socket.leave(instanceId);

            const entities = getInstanceSnapshot(instanceId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === userId);
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

            socket.to(instanceId).emit('user:left', userId);
            logger.info(`🚪 ユーザー「${user.name}」がインスタンス「${instanceId}」から退出しました`);
        }

        socket.data.instanceId = undefined;
        socket.data.user = undefined;

        callback?.({ success: true });
    };
}

/**
 * 切断イベントを処理
 */
export function handleDisconnect(socket: TypedSocket) {
    return async () => {
        const instanceId = socket.data.instanceId;
        const userId = stableUserId(socket);

        if (instanceId && userId) {
            // takeover で蹴られた旧 socket の遺言処理を阻止する。
            // activeUserSockets が指している socket が自分でないなら、自分はもう現役ではない
            //  → grace timer を仕掛けてはならない (= 仕掛けるとアクティブセッションを殺す死神になる)。
            const currentSocket = activeUserSockets.get(userId);
            if (currentSocket && currentSocket !== socket) {
                logger.info(`👻 takeover された旧 socket の disconnect: 無視 (userId: ${userId})`);
                return;
            }

            const user = userManager.getUser(userId);
            if (!user) return; // 既に退出済み

            const existingTimer = disconnectTimers.get(userId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timeoutMs = appConfig.instance.disconnectGracePeriodMs;
            logger.info(
                `🔄 ユーザーが切断しました (猶予期間開始 - ${timeoutMs / 1000}秒): ${socket.id.substring(0, 8)} (userId: ${userId})`,
            );

            const timer = setTimeout(async () => {
                disconnectTimers.delete(userId);

                // grace 中に別 socket で再接続して同 userId のセッションが復活している場合は何もしない
                // (handleWorldJoin が disconnectTimers.delete を先にやってくれているので
                //  通常は到達しないが、ここでも防衛しておく)
                const liveSocket = activeUserSockets.get(userId);
                if (liveSocket && liveSocket !== socket) {
                    logger.info(`✅ grace timer 発火時に再接続済を検出: 削除を取消 (userId: ${userId})`);
                    return;
                }

                const removedUser = userManager.removeUser(userId);
                activeUserSockets.delete(userId);
                if (!removedUser) return; // 他の手段（handleWorldLeave等）で既に削除された

                instanceManager.syncEmptyTimer(instanceId);

                const entities = getInstanceSnapshot(instanceId);
                const userLockedEntities = entities.filter((e) => e.lockedBy === userId);

                userLockedEntities.forEach((entity) => {
                    patchEntity(instanceId, entity.id, {
                        lockedBy: null,
                        data: { ...(entity.data as Record<string, unknown>), isHeld: false },
                    });

                    socket.nsp.to(instanceId).emit('entity:patched', {
                        entityId: entity.id,
                        patch: {
                            lockedBy: null,
                            data: { ...(entity.data as Record<string, unknown>), isHeld: false },
                        },
                    });
                });

                if (userLockedEntities.length > 0) {
                    logger.info(
                        `ユーザー ${removedUser.name} がロックしていた ${userLockedEntities.length} 個のエンティティを解放しました`,
                    );
                }

                socket.nsp.to(instanceId).emit('user:left', userId);
                logger.info(
                    `👋 ユーザー「${removedUser.name}」がインスタンス「${instanceId}」から退出しました (タイムアウト)`,
                );
            }, timeoutMs);

            disconnectTimers.set(userId, timer);
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
        payload: Omit<ComponentInstance, 'id'>,
        callback: (response: { success: boolean; entity?: ComponentInstance; error?: string }) => void,
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
    const entities = getInstanceSnapshot(instanceId);
    const environment = await instanceManager.getWorldEnvironment(worldId);
    const world = await worldRegistry.getWorld(worldId);
    const activePlugins = world?.dependencies?.map((d) => d.name) || [];

    const snapshotPayload: WorldSnapshotPayload = {
        entities,
        availableComponents: [],
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

        logger.debug('video-player:sync イベント受信:', {
            instanceId,
            syncData,
            fromSocketId: socket.id,
            fromUserId: socket.data.userId,
        });

        socket.to(instanceId).emit('video-player:sync', syncData);
    };
}

/**
 * 再生状態リクエスト：参加時・Resync ボタンで呼ばれる
 * ルーム内の他ユーザーへ「今の状態を教えて」とブロードキャスト
 */
export function handleVideoPlayerStateRequest(socket: TypedSocket) {
    return () => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) return;
        socket.to(instanceId).emit('video-player:state-request', { fromSocketId: socket.id });
    };
}

/**
 * 再生状態レスポンス：リクエスト元のソケットへピンポイントで届ける
 * Socket.IO では socket.id = プライベートルーム名なので socket.to(id) でDM可能
 */
export function handleVideoPlayerStateResponse(socket: TypedSocket) {
    return (payload: { toSocketId: string; currentIndex: number; isPlaying: boolean; currentTime: number }) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) return;
        socket.to(payload.toSocketId).emit('video-player:state-response', {
            currentIndex: payload.currentIndex,
            isPlaying: payload.isPlaying,
            currentTime: payload.currentTime,
        });
    };
}
