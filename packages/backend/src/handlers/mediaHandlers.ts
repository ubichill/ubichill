/**
 * メディア (動画 / 音声 / 配信など) の参加者間同期ハンドラ。
 * バックエンドは中身を解釈せず、純粋にルーム broadcast / DM のリレーをするだけ。
 *
 *  - media:sync           : 再生状態 (mediaId / isPlaying / currentTime) を peer に broadcast
 *  - media:state-request  : 参加時 / Resync で「今の状態を教えて」と他参加者に問い合わせる
 *  - media:state-response : リクエスト元の socket だけに状態を DM で返す
 */

import type { MediaSyncState } from '@ubichill/shared';
import { logger } from '../utils/logger';
import type { TypedSocket } from './_shared';

export function handleMediaSync(socket: TypedSocket) {
    return async (syncData: MediaSyncState) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            logger.warn('media:sync - インスタンスIDが設定されていません');
            return;
        }

        logger.debug('media:sync イベント受信:', {
            instanceId,
            syncData,
            fromSocketId: socket.id,
            fromUserId: socket.data.userId,
        });

        socket.to(instanceId).emit('media:sync', syncData);
    };
}

export function handleMediaStateRequest(socket: TypedSocket) {
    return () => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) return;
        socket.to(instanceId).emit('media:state-request', { fromSocketId: socket.id });
    };
}

/**
 * Socket.IO では socket.id = プライベートルーム名なので socket.to(id) で DM 可能。
 */
export function handleMediaStateResponse(socket: TypedSocket) {
    return (payload: MediaSyncState & { toSocketId: string }) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) return;
        const { toSocketId, ...syncState } = payload;
        socket.to(toSocketId).emit('media:state-response', syncState);
    };
}
