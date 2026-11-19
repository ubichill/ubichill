/**
 * useModBroadcast
 *
 * entity:ephemeral ↔ Ubi.network.broadcast のインスタンス通信ブリッジ。
 *
 * 責務:
 * - 他ユーザーの entity:ephemeral を EVT_NETWORK_BROADCAST として Worker へ転送
 * - Worker の onNetworkBroadcast を entity:ephemeral としてインスタンスサーバーへ送出
 */

import type { EntityEphemeralPayload, ModHostEvent } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';

/** senderId は Go が中継のときに付ける送信者。data の中の userId は送り手が自由に書けるので、senderId を付けない古い Go のときだけ使う。 */
type ReceivedEphemeral = EntityEphemeralPayload & { senderId?: string };

export function toNetworkBroadcast(
    payload: ReceivedEphemeral,
    entityId: string,
    selfId: string | undefined,
): ModHostEvent | null {
    if (payload.entityId !== entityId) return null;
    const d = payload.data as { type: string; userId: string; data: unknown } | null | undefined;
    if (!d?.type) return null;
    const userId = payload.senderId ?? d.userId;
    if (userId === selfId) return null;
    return { type: 'EVT_NETWORK_BROADCAST', payload: { type: d.type, userId, data: d.data } };
}

export function useModBroadcast(
    entityId: string,
    sendEvent: (event: ModHostEvent) => void,
): { onNetworkBroadcast: (type: string, data: unknown) => void } {
    const { socket, currentUser } = useSocket();

    const currentUserIdRef = useRef(currentUser?.id);
    useEffect(() => {
        currentUserIdRef.current = currentUser?.id;
    });

    const socketRef = useRef(socket);
    useEffect(() => {
        socketRef.current = socket;
    });

    useEffect(() => {
        const sock = socket;
        if (!sock) return;
        const handler = (payload: ReceivedEphemeral) => {
            const event = toNetworkBroadcast(payload, entityId, currentUserIdRef.current);
            if (event) sendEvent(event);
        };
        sock.on('entity:ephemeral', handler);
        return () => {
            sock.off('entity:ephemeral', handler);
        };
    }, [socket, entityId, sendEvent]);

    return {
        onNetworkBroadcast: (type: string, data: unknown): void => {
            if (!currentUserIdRef.current) return;
            socketRef.current?.emit('entity:ephemeral', {
                entityId,
                data: { type, userId: currentUserIdRef.current, data },
            });
        },
    };
}
