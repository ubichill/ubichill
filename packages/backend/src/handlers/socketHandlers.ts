import {
    type ClientToServerEvents,
    DEFAULTS,
    type EntityEphemeralPayload,
    type EntityPatchPayload,
    type InterServerEvents,
    type ServerToClientEvents,
    type SocketData,
    type User,
    type WorldEntity,
} from '@ubichill/shared';
import type { Socket } from 'socket.io';
import { userManager } from '../services/userManager';
import {
    createEntity,
    deleteEntity,
    getWorldSnapshot,
    patchEntity,
} from '../services/worldState';
import { logger } from '../utils/logger';
import { validateCursorPosition, validateRoomId, validateUsername, validateUserStatus } from '../utils/validation';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * ルーム参加イベントを処理
 */
export function handleRoomJoin(socket: TypedSocket) {
    return (
        { roomId, user }: { roomId: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => {
        logger.debug('room:join イベント受信:', { roomId, user, socketId: socket.id });

        // ルームIDを検証
        const roomValidation = validateRoomId(roomId);
        if (!roomValidation.valid) {
            logger.debug('ルームID検証失敗:', roomValidation.error);
            callback({ success: false, error: roomValidation.error });
            return;
        }

        // ユーザー名を検証
        const usernameValidation = validateUsername(user.name);
        if (!usernameValidation.valid) {
            logger.debug('ユーザー名検証失敗:', usernameValidation.error);
            callback({ success: false, error: usernameValidation.error });
            return;
        }

        // ユーザーオブジェクトを作成
        const newUser: User = {
            id: socket.id,
            ...user,
            name: usernameValidation.data,
            position: user.position || DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        // ルームにユーザーを追加
        userManager.addUser(socket.id, roomValidation.data, newUser);
        socket.join(roomValidation.data);

        // ソケットデータに保存
        socket.data.userId = socket.id;
        socket.data.roomId = roomValidation.data;
        socket.data.user = newUser;

        // このルーム内の全ユーザーを取得
        const roomUsers = userManager.getUsersByRoom(roomValidation.data);

        // 成功レスポンスを送信
        callback({
            success: true,
            userId: socket.id,
        });

        // 新しいユーザーに現在のユーザー一覧を送信
        socket.emit('users:update', roomUsers);

        // 新しいユーザーにワールドスナップショットを送信（UEP）
        let entities = getWorldSnapshot(roomValidation.data);

        // ペンが1つもない場合、デフォルトのペンを作成（永続化対応）
        const existingPens = entities.filter(e => e.type === 'pen');
        if (existingPens.length === 0) {
            const defaultPens = [
                { color: '#000000', x: -150 },
                { color: '#FF0000', x: -50 },
                { color: '#0000FF', x: 50 },
                { color: '#00FF00', x: 150 },
            ];

            defaultPens.forEach(def => {
                createEntity(roomValidation.data, {
                    type: 'pen',
                    transform: {
                        x: 600 + def.x, // ステータスバーと被らないように少し右に移動
                        y: 40, // Trayの中央（Top: 20, Height: 80 -> Center: 60だがアイコンサイズ考慮して調整）
                        z: 0,
                        w: 48,
                        h: 48,
                        rotation: 0,
                    },
                    data: {
                        color: def.color,
                        strokeWidth: 4,
                        isHeld: false,
                    },
                    ownerId: 'system',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                } as any);
            });
            // 再取得
            entities = getWorldSnapshot(roomValidation.data);
            logger.info(`デフォルトペンを作成しました: ${entities.length}件`);
        }

        socket.emit('world:snapshot', entities);
        logger.debug(`ワールドスナップショット送信: ${entities.length}件のエンティティ`);

        // ルーム内の他のユーザーに参加を通知
        socket.to(roomValidation.data).emit('user:joined', newUser);

        logger.info(
            `✅ ユーザー「${newUser.name}」(${socket.id.substring(0, 8)}) がルーム「${roomValidation.data}」に参加しました`,
        );
    };
}

/**
 * カーソル移動イベントを処理
 */
export function handleCursorMove(socket: TypedSocket) {
    return (position: { x: number; y: number }) => {
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
            return;
        }

        // カーソル位置を検証
        const validation = validateCursorPosition(position);
        if (!validation.valid) {
            socket.emit('error', validation.error || '無効なカーソル位置です');
            return;
        }

        // 位置を更新
        const updated = userManager.updateUserPosition(socket.id, validation.data);
        if (!updated) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        // ルーム内の他のユーザーにブロードキャスト
        socket.to(roomId).emit('cursor:moved', {
            userId: socket.id,
            position: validation.data,
        });
    };
}

/**
 * ステータス更新イベントを処理
 */
export function handleStatusUpdate(socket: TypedSocket) {
    return (status: string) => {
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
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

        // ルーム内の他のユーザーにブロードキャスト
        socket.to(roomId).emit('status:changed', {
            userId: socket.id,
            status: validation.data,
        });
    };
}

/**
 * 切断イベントを処理
 */
export function handleDisconnect(socket: TypedSocket) {
    return () => {
        const roomId = socket.data.roomId;
        const user = userManager.removeUser(socket.id);

        if (roomId && user) {
            // 切断したユーザーがロックしていたエンティティを解放する
            const entities = getWorldSnapshot(roomId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === socket.id);

            userLockedEntities.forEach((entity) => {
                // ペンならトレイに戻すロジック（簡易実装: 色を見て位置を決める）
                // 汎用性を高めるなら、単に unlocked にするだけでも良いが、
                // 今回は「トレイに戻す」振る舞いが期待されているため位置もリセットする
                let targetX = entity.transform.x;
                let targetY = entity.transform.y;

                if (entity.type === 'pen') {
                    const data = entity.data as any;
                    let offsetX = 0;
                    if (data.color === '#FF0000') offsetX = -50;
                    else if (data.color === '#0000FF') offsetX = 50;
                    else if (data.color === '#00FF00') offsetX = 150;
                    else offsetX = -150; // 黒
                    targetX = 600 + offsetX;
                    targetY = 40;
                }

                patchEntity(roomId, entity.id, {
                    lockedBy: null,
                    transform: {
                        ...entity.transform,
                        x: targetX,
                        y: targetY,
                        rotation: 0,
                    },
                    data: {
                        ...entity.data,
                        isHeld: false,
                    } as any
                });

                // 他のユーザーに通知
                socket.to(roomId).emit('entity:patched', {
                    entityId: entity.id,
                    patch: {
                        lockedBy: null,
                        transform: {
                            ...entity.transform,
                            x: targetX,
                            y: targetY,
                            rotation: 0,
                        },
                        data: {
                            ...entity.data,
                            isHeld: false
                        } as any
                    }
                });
            });

            if (userLockedEntities.length > 0) {
                logger.info(`ユーザー ${user.name} がロックしていた ${userLockedEntities.length} 個のエンティティを解放しました`);
            }

            // ルーム内の他のユーザーに退出を通知
            socket.to(roomId).emit('user:left', socket.id);
            logger.info(
                `👋 ユーザー「${user.name}」(${socket.id.substring(0, 8)}) がルーム「${roomId}」から退出しました`,
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
        const roomId = socket.data.roomId;
        if (!roomId) {
            callback({ success: false, error: '最初にルームに参加する必要があります' });
            return;
        }

        try {
            // エンティティを作成（IDはサーバーで生成）
            const entity = createEntity(roomId, payload);

            // 成功レスポンスを送信
            callback({ success: true, entity });

            // ルーム内の他のユーザーにブロードキャスト
            socket.to(roomId).emit('entity:created', entity);

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
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
            return;
        }

        const { entityId, patch } = payload;

        // エンティティを更新
        const updated = patchEntity(roomId, entityId, patch);
        if (!updated) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        // ルーム内の他のユーザーにブロードキャスト
        socket.to(roomId).emit('entity:patched', payload);

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
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
            return;
        }

        // 保存せずにそのままブロードキャスト（土管）
        socket.to(roomId).emit('entity:ephemeral', payload);
    };
}

/**
 * エンティティ削除イベントを処理
 */
export function handleEntityDelete(socket: TypedSocket) {
    return (entityId: string) => {
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
            return;
        }

        // エンティティを削除
        const deleted = deleteEntity(roomId, entityId);
        if (!deleted) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        // ルーム内の他のユーザーにブロードキャスト
        socket.to(roomId).emit('entity:deleted', entityId);

        logger.debug(`エンティティ削除: ${entityId}`);
    };
}

/**
 * ワールドスナップショットを送信（ルーム参加時に呼び出す）
 */
export function sendWorldSnapshot(socket: TypedSocket, roomId: string): void {
    const entities = getWorldSnapshot(roomId);
    socket.emit('world:snapshot', entities);
    logger.debug(`ワールドスナップショット送信: ${entities.length}件のエンティティ`);
}
