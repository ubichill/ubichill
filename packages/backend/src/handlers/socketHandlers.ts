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
import { createEntity, deleteEntity, getWorldSnapshot, patchEntity } from '../services/worldState';
import { logger } from '../utils/logger';
import {
    validateCursorPosition,
    validateCursorState,
    validateRoomId,
    validateUsername,
    validateUserStatus,
} from '../utils/validation';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * ルーム参加イベントを処理
 */
export function handleRoomJoin(socket: TypedSocket) {
    return (
        { roomId, instanceId, user }: { roomId: string; instanceId?: string; user: Omit<User, 'id'> },
        callback: (response: { success: boolean; userId?: string; error?: string }) => void,
    ) => {
        logger.debug('room:join イベント受信:', { roomId, instanceId, user, socketId: socket.id });

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

        // インスタンスIDを使ってSocket.IOルームとワールド状態を管理
        // instanceIdがある場合はそれを使い、ない場合はroomIdにフォールバック
        const socketRoom = instanceId || roomValidation.data;
        const worldStateKey = instanceId || roomValidation.data;

        // ルームにユーザーを追加
        userManager.addUser(socket.id, socketRoom, newUser);
        socket.join(socketRoom);

        // ソケットデータに保存
        socket.data.userId = socket.id;
        socket.data.roomId = socketRoom;
        socket.data.instanceId = instanceId;
        socket.data.user = newUser;

        // インスタンスのユーザー数を更新
        if (instanceId) {
            instanceManager.updateUserCount(instanceId, 1);
        }

        // このルーム内の全ユーザーを取得
        const roomUsers = userManager.getUsersByRoom(socketRoom);

        // 成功レスポンスを送信
        callback({
            success: true,
            userId: socket.id,
        });

        // 新しいユーザーに現在のユーザー一覧を送信
        socket.emit('users:update', roomUsers);

        // 新しいユーザーにワールドスナップショットを送信（UEP）
        // instanceIdをキーにしてワールド状態を取得（インスタンスごとに独立した状態）
        const entities = getWorldSnapshot(worldStateKey);
        const environment = instanceManager.getRoomEnvironment(roomValidation.data);

        // ワールドスナップショット（拡張版）を送信
        const snapshotPayload: WorldSnapshotPayload = {
            entities,
            availableKinds: [], // 将来的にルーム定義から取得
            environment,
        };
        socket.emit('world:snapshot', snapshotPayload);
        logger.debug(`ワールドスナップショット送信: ${entities.length}件のエンティティ (instance: ${worldStateKey})`);

        // ルーム内の他のユーザーに参加を通知
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

        // ルーム内の他のユーザーにブロードキャスト
        socket.to(roomId).emit('cursor:moved', {
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
 * ユーザー情報の更新イベントを処理
 */
export function handleUserUpdate(socket: TypedSocket) {
    return (patch: Partial<User>) => {
        const roomId = socket.data.roomId;
        if (!roomId) {
            socket.emit('error', '最初にルームに参加する必要があります');
            return;
        }

        // ユーザー情報を更新
        // userManager側でホワイトリストベースのフィルタリングを実施
        const updatedUser = userManager.updateUser(socket.id, patch);

        if (!updatedUser) {
            socket.emit('error', 'ユーザーが見つかりません');
            return;
        }

        // ルーム内の全員（自分含む）にブロードキャスト
        // 自分にも送ることで、サーバー側で正規化された状態（もしあれば）を反映できる
        // また、他のクライアントと同じイベントフローで更新を受け取れるメリットがある
        socket.nsp.to(roomId).emit('user:updated', updatedUser);
    };
}

/**
 * 切断イベントを処理
 */
export function handleDisconnect(socket: TypedSocket) {
    return () => {
        const roomId = socket.data.roomId;
        const instanceId = socket.data.instanceId;
        const user = userManager.removeUser(socket.id);

        // インスタンスのユーザー数を更新
        if (instanceId) {
            instanceManager.updateUserCount(instanceId, -1);
        }

        if (roomId && user) {
            // 切断したユーザーがロックしていたエンティティを解放する
            const entities = getWorldSnapshot(roomId);
            const userLockedEntities = entities.filter((e) => e.lockedBy === socket.id);

            userLockedEntities.forEach((entity) => {
                // ロックを解除するだけ（位置はそのまま）
                patchEntity(roomId, entity.id, {
                    lockedBy: null,
                    data: {
                        ...(entity.data as Record<string, unknown>),
                        isHeld: false,
                    },
                });

                // 他のユーザーに通知
                socket.to(roomId).emit('entity:patched', {
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
 * @param instanceOrRoomId インスタンスIDまたはルームID（ワールド状態のキー）
 * @param roomId 環境設定取得用のルームID
 */
export function sendWorldSnapshot(socket: TypedSocket, instanceOrRoomId: string, roomId?: string): void {
    const entities = getWorldSnapshot(instanceOrRoomId);
    const environment = instanceManager.getRoomEnvironment(roomId || instanceOrRoomId);

    const snapshotPayload: WorldSnapshotPayload = {
        entities,
        availableKinds: [],
        environment,
    };
    socket.emit('world:snapshot', snapshotPayload);
    logger.debug(`ワールドスナップショット送信: ${entities.length}件のエンティティ (key: ${instanceOrRoomId})`);
}
