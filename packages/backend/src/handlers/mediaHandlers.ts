/**
 * メディア (動画 / 音声 / 配信など) の参加者間同期ハンドラ。
 * 旧 API は純粋なルーム relay として維持し、v3 API は Server が revision と時刻を確定する。
 *
 *  - media:sync           : 再生状態 (mediaId / isPlaying / currentTime) を peer に broadcast
 *  - media:state-request  : 参加時 / Resync で「今の状態を教えて」と他参加者に問い合わせる
 *  - media:state-response : リクエスト元の socket だけに状態を DM で返す
 *  - media:timeline:*     : revision 付き正規タイムラインの update/get
 */

import type { MediaSyncState, MediaTimelineIntent, MediaTimelineResult } from '@ubichill/shared';
import { applyMediaTimelineIntent, getMediaTimeline } from '../services/mediaTimelineState';
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

/** Client の再生意図を Server 時刻ベースの正規 timeline に変換する。 */
export function handleMediaTimelineUpdate(socket: TypedSocket) {
    return (intent: MediaTimelineIntent, callback?: (result: MediaTimelineResult) => void) => {
        const respond = typeof callback === 'function' ? callback : () => undefined;
        const instanceId = socket.data.instanceId;
        const userId = socket.data.userId;
        if (!instanceId || !userId) {
            respond({
                success: false,
                error: '最初にワールドに参加してください',
                timeline: null,
                serverTime: Date.now(),
            });
            return;
        }
        const result = applyMediaTimelineIntent(instanceId, intent, userId);
        respond(result);
        if (result.success && result.timeline) socket.to(instanceId).emit('media:timeline', result.timeline);
    };
}

/** 遅参加/再接続用 snapshot。 */
export function handleMediaTimelineGet(socket: TypedSocket) {
    return (payload: { sessionId?: unknown } | null, callback?: (result: MediaTimelineResult) => void) => {
        const respond = typeof callback === 'function' ? callback : () => undefined;
        const now = Date.now();
        const instanceId = socket.data.instanceId;
        const sessionId = payload?.sessionId;
        if (!instanceId || typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256) {
            respond({ success: false, error: 'sessionId が不正です', timeline: null, serverTime: now });
            return;
        }
        respond({ success: true, timeline: getMediaTimeline(instanceId, sessionId), serverTime: now });
    };
}
