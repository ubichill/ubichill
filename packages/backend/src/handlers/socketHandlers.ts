import {
    type ClientToServerEvents,
    DEFAULTS,
    type InterServerEvents,
    type ServerToClientEvents,
    type SocketData,
    type User,
} from '@ubichill/shared';
import type { Socket } from 'socket.io';
import { userManager } from '../services/userManager';
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
