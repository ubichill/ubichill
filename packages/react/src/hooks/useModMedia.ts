/** React adapter for the framework-independent media runtime. */
import type { MediaTimeline, ModHostEvent } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { createMediaRuntime, type MediaHandlers } from '../media/createMediaRuntime';
import type { WorkerModDefinition } from '../types';
import { useExternalUrlAuthorization } from './useExternalUrlAuthorization';
import { useSocket } from './useSocket';

export interface UseModMediaResult {
    getVideoRef: (targetId: string) => (el: HTMLVideoElement | null) => void;
    mediaHandlers: MediaHandlers;
    mediaVisibilityRef: React.RefObject<Map<string, boolean>>;
}

export function useModMedia(
    definition: WorkerModDefinition,
    sendEventRef: React.RefObject<((event: ModHostEvent) => void) | null>,
    syncScopeId: string = definition.id,
): UseModMediaResult {
    const { socket } = useSocket();
    const authorizeUrl = useExternalUrlAuthorization(definition);
    const socketRef = useRef(socket);
    const authorizeUrlRef = useRef(authorizeUrl);
    const mediaVisibilityRef = useRef<Map<string, boolean>>(new Map());
    socketRef.current = socket;
    authorizeUrlRef.current = authorizeUrl;

    const modId = definition.id.split(':')[0];
    const runtime = useMemo(
        () =>
            createMediaRuntime({
                definitionId: definition.id,
                syncScopeId,
                modId,
                mediaVisibility: mediaVisibilityRef.current,
                getSocket: () => socketRef.current,
                authorizeUrl: (url) => authorizeUrlRef.current(url),
                sendEvent: (event) => sendEventRef.current?.(event),
            }),
        [definition.id, modId, sendEventRef, syncScopeId],
    );

    useEffect(() => {
        if (!socket) return;
        const onTimeline = (timeline: MediaTimeline): void => runtime.acceptTimeline(timeline);
        const refreshTimelines = (): void => runtime.refreshTimelines();
        socket.on('media:timeline', onTimeline);
        socket.on('connect', refreshTimelines);
        if (socket.connected) refreshTimelines();
        return () => {
            socket.off('media:timeline', onTimeline);
            socket.off('connect', refreshTimelines);
        };
    }, [runtime, socket]);

    useEffect(() => {
        const timer = setInterval(() => runtime.tick(), 250);
        return () => clearInterval(timer);
    }, [runtime]);

    useEffect(() => () => runtime.destroy(), [runtime]);

    return { getVideoRef: runtime.getVideoRef, mediaHandlers: runtime.mediaHandlers, mediaVisibilityRef };
}
