/**
 * usePluginBroadcast
 *
 * entity:ephemeral ↔ Ubi.network.broadcast の Socket.IO ブリッジ。
 *
 * 責務:
 * - 他ユーザーの entity:ephemeral を EVT_NETWORK_BROADCAST として Worker へ転送
 * - Worker の onNetworkBroadcast を entity:ephemeral として Socket.IO へ送出
 */

import type { EntityEphemeralPayload, PluginHostEvent } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';

export function usePluginBroadcast(
    entityId: string,
    sendEvent: (event: PluginHostEvent) => void,
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
        const handler = (payload: EntityEphemeralPayload) => {
            if (payload.entityId !== entityId) return;
            const d = payload.data as { type: string; userId: string; data: unknown };
            if (!d?.type) return;
            if (d.userId === currentUserIdRef.current) return;
            sendEvent({ type: 'EVT_NETWORK_BROADCAST', payload: { type: d.type, userId: d.userId, data: d.data } });
        };
        sock.on('entity:ephemeral', handler);
        return () => {
            sock.off('entity:ephemeral', handler);
        };
    }, [socket, entityId, sendEvent]);

    return {
        onNetworkBroadcast: (type: string, data: unknown): void => {
            socketRef.current?.emit('entity:ephemeral', {
                entityId,
                data: { type, userId: currentUserIdRef.current ?? '', data },
            });
        },
    };
}
