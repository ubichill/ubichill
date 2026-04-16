/**
 * WorkerPluginHost — Worker ベースプラグイン向け React ホスト。
 *
 * 責務（orchestration のみ）:
 * - usePluginWorker でサンドボックスのライフサイクルを管理
 * - 各 usePlugin* hook を合成して handlers を組み立てる
 * - sendHostMessageRef を通じた Host → Worker カスタムメッセージ
 */

import type { CursorState, WorldEntity } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { usePluginBroadcast } from '../hooks/usePluginBroadcast';
import { usePluginCanvas } from '../hooks/usePluginCanvas';
import { usePluginEntitySync } from '../hooks/usePluginEntitySync';
import { usePluginFetch } from '../hooks/usePluginFetch';
import { usePluginMedia } from '../hooks/usePluginMedia';
import { usePluginPresence } from '../hooks/usePluginPresence';
import { usePluginUI } from '../hooks/usePluginUI';
import { usePluginWorld } from '../hooks/usePluginWorld';
import { useSocket } from '../hooks/useSocket';
import { useWorld } from '../hooks/useWorld';
import type { WorkerPluginDefinition } from '../types';
import { usePluginWorker } from '../usePluginWorker';
import { PluginUIMount } from './PluginUIMount';

export interface WorkerPluginHostProps {
    entityId: string;
    entity: WorldEntity;
    definition: WorkerPluginDefinition;
    /** Worker が sendToHost で送った未処理メッセージのカスタムハンドラ */
    onCustomMessage?: (type: string, payload: unknown) => void;
    /**
     * Host → Worker へメッセージを送る関数を受け取るための ref。
     * マウント時に `(type, payload) => void` がセットされ、
     * アンマウント時に null に戻る。
     */
    sendHostMessageRef?: React.RefObject<((type: string, payload: unknown) => void) | null>;
}

export const WorkerPluginHost: React.FC<WorkerPluginHostProps> = ({
    entityId,
    entity,
    definition,
    onCustomMessage,
    sendHostMessageRef,
}) => {
    const { users, currentUser, updatePosition, updateUser } = useSocket();
    const { entities } = useWorld();
    const hostDivRef = useRef<HTMLDivElement>(null);

    const onCustomMessageRef = useRef(onCustomMessage);
    useEffect(() => {
        onCustomMessageRef.current = onCustomMessage;
    });

    const updatePositionRef = useRef(updatePosition);
    const updateUserRef = useRef(updateUser);
    useEffect(() => {
        updatePositionRef.current = updatePosition;
        updateUserRef.current = updateUser;
    });

    // ── onNetworkBroadcast は usePluginWorker より後に確定するため ref で橋渡し ──
    const onNetworkBroadcastRef = useRef<((type: string, data: unknown) => void) | null>(null);

    // ── サブ hooks ─────────────────────────────────────────────────
    const { getCanvasRef, canvasHandlers } = usePluginCanvas(definition, hostDivRef);
    const { vnodes, onRender, sendAction, sendEventRef } = usePluginUI();
    const { getVideoRef, mediaHandlers } = usePluginMedia(definition, sendEventRef);
    const onFetch = usePluginFetch(definition, entity);
    const worldHandlers = usePluginWorld();

    // ── Worker ────────────────────────────────────────────────────
    const { sendEvent, workerRevision, setScrollElement } = usePluginWorker({
        pluginCode: definition.workerCode,
        pluginId: definition.id,
        entityId,
        capabilities: definition.capabilities,
        myUserId: currentUser?.id,
        pluginBase: definition.pluginBase,
        handlers: {
            ...canvasHandlers,
            ...mediaHandlers,
            ...worldHandlers,
            onRender,
            onFetch,
            onNetworkBroadcast: (type, data) => onNetworkBroadcastRef.current?.(type, data),
            onMessage: (msg) => {
                const m = msg as { type: string; payload: unknown };
                if (m.type === 'position:update') {
                    const { x, y, cursorState } = m.payload as { x: number; y: number; cursorState?: CursorState };
                    updatePositionRef.current({ x, y }, cursorState);
                } else if (m.type === 'user:update') {
                    updateUserRef.current(m.payload as Parameters<typeof updateUserRef.current>[0]);
                } else {
                    onCustomMessageRef.current?.(m.type, m.payload);
                }
            },
        },
    });

    sendEventRef.current = sendEvent;

    // ── broadcast ブリッジ（sendEvent 確定後に初期化）─────────────────
    const { onNetworkBroadcast } = usePluginBroadcast(entityId, sendEvent);
    onNetworkBroadcastRef.current = onNetworkBroadcast;

    useEffect(() => {
        const el = document.querySelector('[data-scroll-world]');
        if (el) setScrollElement(el);
        return () => setScrollElement(null);
    }, [setScrollElement]);

    usePluginPresence(definition, users, sendEvent, workerRevision);
    usePluginEntitySync(definition, entities, sendEvent, workerRevision);

    useEffect(() => {
        if (!sendHostMessageRef) return;
        sendHostMessageRef.current = (type: string, payload: unknown) => {
            sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'host:message', data: { type, payload } } });
        };
        return () => {
            sendHostMessageRef.current = null;
        };
    }, [sendEvent, sendHostMessageRef]);

    // ── レンダー ───────────────────────────────────────────────────
    return (
        <div
            ref={hostDivRef}
            data-entity-type={definition.id}
            data-entity-id={entityId}
            style={{ pointerEvents: 'none' }}
        >
            {definition.canvasTargets?.map((targetId) => (
                <canvas
                    key={targetId}
                    ref={getCanvasRef(targetId)}
                    data-canvas-target={targetId}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                />
            ))}
            {definition.mediaTargets?.map((targetId) => (
                // biome-ignore lint/a11y/useMediaCaption: plugin-managed video
                <video
                    key={targetId}
                    ref={getVideoRef(targetId)}
                    data-media-target={targetId}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'none',
                        pointerEvents: 'none',
                    }}
                />
            ))}
            {[...vnodes.entries()].map(([targetId, vnode]) => (
                <PluginUIMount key={targetId} targetId={targetId} vnode={vnode} sendAction={sendAction} />
            ))}
        </div>
    );
};
