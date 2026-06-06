/**
 * ユーザー個別の状態更新ハンドラ群。
 *  - cursor:move    : カーソル位置を peer に中継 (heldEntityId の中継含む)
 *  - status:update  : online/away/busy 等の status 切替
 *  - user:update    : ホワイトリスト経由の汎用ユーザー情報パッチ (penColor/heldEntityId など)
 */
import type { User } from '@ubichill/shared';
import { userManager } from '../services/userManager';
import { validateCursorPosition, validateUserStatus } from '../utils/validation';
import { stableUserId, type TypedSocket } from './_shared';

export function handleCursorMove(socket: TypedSocket) {
    return (payload: { position: { x: number; y: number }; heldEntityId?: string | null }) => {
        const { position, heldEntityId } = payload;
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

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
