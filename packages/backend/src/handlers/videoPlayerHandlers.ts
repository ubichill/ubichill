/**
 * ビデオプレイヤー (動画/HLS) の参加者間同期ハンドラ。
 *  - video-player:sync           : 再生状態を peer へ broadcast
 *  - video-player:state-request  : 参加時/Resync で他参加者に「今の状態を教えて」と要求
 *  - video-player:state-response : リクエスト元の socket へ DM で返答
 */
import { logger } from '../utils/logger';
import type { TypedSocket } from './_shared';

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

export function handleVideoPlayerStateRequest(socket: TypedSocket) {
    return () => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) return;
        socket.to(instanceId).emit('video-player:state-request', { fromSocketId: socket.id });
    };
}

/**
 * Socket.IO では socket.id = プライベートルーム名なので socket.to(id) でDM可能。
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
