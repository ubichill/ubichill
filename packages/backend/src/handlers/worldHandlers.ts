/**
 * ワールド / セッションのライフサイクルを扱うハンドラ群。
 *  - world:join        : インスタンス参加 (snapshot 送信、再接続/別インスタンス移動の整合性管理)
 *  - world:leave       : 明示退出 (SPA 内でロビーに戻る等)
 *  - disconnect        : ソケット切断 (grace period → 自動退出)
 *  - sendWorldSnapshot : 任意のタイミングでスナップショットを再送
 */
import { DEFAULTS, type User, type WorldSnapshotPayload } from '@ubichill/shared';
import { appConfig } from '../config';
import { instanceManager } from '../services/instanceManager';
import { getInstanceSnapshot, patchEntity } from '../services/instanceState';
import { userManager } from '../services/userManager';
import { worldRegistry } from '../services/worldRegistry';
import { logger } from '../utils/logger';
import { validateUsername, validateWorldId } from '../utils/validation';
import { activeUserSockets, disconnectTimers, stableUserId, type TypedSocket } from './_shared';

/**
 * 切断/退出時に user が掴んでいた entity をすべて解放し、ルームへ entity:patched を流す。
 * handleWorldJoin (instance move)・handleWorldLeave・handleDisconnect (grace timer) の共通処理。
 */
function releaseUserLocks(socket: TypedSocket, instanceId: string, userId: string): number {
    const entities = getInstanceSnapshot(instanceId);
    const locked = entities.filter((e) => e.lockedBy === userId);
    locked.forEach((entity) => {
        const data = { ...(entity.data as Record<string, unknown>), isHeld: false };
        patchEntity(instanceId, entity.id, { lockedBy: null, data });
        socket.nsp.to(instanceId).emit('entity:patched', {
            entityId: entity.id,
            patch: { lockedBy: null, data },
        });
    });
    return locked.length;
}

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
        // 存在確認は world 解決に依存しない軽量版を使う
        // (getWorldByDbId が一時的に失敗しても join できるようにするため)
        const instance = await instanceManager.findInstanceForJoin(instanceId);
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

        if (instance.hasPassword) {
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

        // 別 instance に居たなら、そこの後始末 (ロック解放 + user:left + ルーム退出)。
        // 空になった instance の削除は instanceReaper の定期スイープが回収する。
        const isInstanceMove = prevInstanceId !== undefined && prevInstanceId !== effectiveInstanceId;
        if (isInstanceMove && prevInstanceId) {
            releaseUserLocks(socket, prevInstanceId, userId);
            socket.leave(prevInstanceId);
            socket.nsp.to(prevInstanceId).emit('user:left', userId);
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

        const roomUsers = userManager.getUsersByWorld(effectiveInstanceId);

        // instanceId が要求と異なる場合（自動再作成）はクライアントへ新しい ID を通知
        callback({ success: true, userId, instanceId: effectiveInstanceId });

        socket.emit('users:update', roomUsers);

        await sendWorldSnapshot(socket, effectiveInstanceId, worldValidation.data);

        socket.to(effectiveInstanceId).emit('user:joined', newUser);

        logger.info(
            `✅ ユーザー「${newUser.name}」(${socket.id.substring(0, 8)}) がインスタンス「${effectiveInstanceId}」に参加しました`,
        );
    };
}

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

        // 空になった instance の削除は instanceReaper の定期スイープが回収する。
        if (instanceId && user && userId) {
            socket.leave(instanceId);
            releaseUserLocks(socket, instanceId, userId);
            socket.to(instanceId).emit('user:left', userId);
            logger.info(`🚪 ユーザー「${user.name}」がインスタンス「${instanceId}」から退出しました`);
        }

        socket.data.instanceId = undefined;
        socket.data.user = undefined;

        callback?.({ success: true });
    };
}

export function handleDisconnect(socket: TypedSocket) {
    return async () => {
        const instanceId = socket.data.instanceId;
        const userId = stableUserId(socket);

        if (!instanceId || !userId) {
            logger.info(`👋 ユーザーが切断しました: ${socket.id.substring(0, 8)}`);
            return;
        }

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

            // 空になった instance の削除は instanceReaper の定期スイープが回収する。
            const releasedCount = releaseUserLocks(socket, instanceId, userId);
            if (releasedCount > 0) {
                logger.info(
                    `ユーザー ${removedUser.name} がロックしていた ${releasedCount} 個のエンティティを解放しました`,
                );
            }

            socket.nsp.to(instanceId).emit('user:left', userId);
            logger.info(
                `👋 ユーザー「${removedUser.name}」がインスタンス「${instanceId}」から退出しました (タイムアウト)`,
            );
        }, timeoutMs);

        disconnectTimers.set(userId, timer);
    };
}

/**
 * ワールドスナップショットを送信。
 * @param instanceId Socket.IO ルームキー兼エンティティ状態キー
 * @param worldId ワールド定義取得用の worldId
 */
export async function sendWorldSnapshot(socket: TypedSocket, instanceId: string, worldId: string): Promise<void> {
    const entities = getInstanceSnapshot(instanceId);
    const environment = await instanceManager.getWorldEnvironment(worldId);
    const world = await worldRegistry.getWorld(worldId);
    const activeMods = world?.dependencies?.map((d) => d.name) || [];

    const snapshotPayload: WorldSnapshotPayload = {
        entities,
        availableComponents: [],
        activeMods,
        environment,
    };
    socket.emit('world:snapshot', snapshotPayload);
    logger.debug(
        `ワールドスナップショット送信: ${entities.length}件のエンティティ, mods: ${activeMods.length} (instanceId: ${instanceId})`,
    );
}
