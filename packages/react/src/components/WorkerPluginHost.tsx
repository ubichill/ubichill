/**
 * WorkerPluginHost — Worker ベースプラグイン向け React ホスト。
 *
 * 責務（orchestration のみ）:
 * - usePluginWorker でサンドボックスのライフサイクルを管理
 * - 各 usePlugin* hook を合成して handlers を組み立てる
 * - definition.onHostMessage を通じたカスタムメッセージのプラグイン側委譲
 */

import type { CursorState, WorldEntity } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
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
}

export const WorkerPluginHost: React.FC<WorkerPluginHostProps> = ({ entityId, entity, definition }) => {
    const { users, currentUser, updatePosition, updateUser } = useSocket();
    const { entities } = useWorld();
    const hostDivRef = useRef<HTMLDivElement>(null);

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

    // ── Worker 起動時点の watchEntityTypes マッチ分を抽出 ──────────────
    // initialEntities は Worker 生成の瞬間だけ読まれるため、
    // ここでは毎レンダー計算しても（Worker は再作成されず）問題ない。
    const initialEntities = useMemo<WorldEntity[]>(() => {
        const types = definition.watchEntityTypes;
        if (!types?.length) return [];
        const set = new Set(types);
        const out: WorldEntity[] = [];
        for (const e of entities.values()) if (set.has(e.type)) out.push(e);
        return out;
    }, [entities, definition.watchEntityTypes]);

    // ── Worker ────────────────────────────────────────────────────
    const { sendEvent, workerRevision, setScrollElement } = usePluginWorker({
        pluginCode: definition.workerCode,
        pluginId: definition.id,
        entityId,
        capabilities: definition.capabilities,
        myUserId: currentUser?.id,
        pluginBase: definition.pluginBase,
        watchEntityTypes: definition.watchEntityTypes,
        initialEntities,
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
                    definition.onHostMessage?.(m.type, m.payload, {
                        updateUser: (patch) =>
                            updateUserRef.current(patch as Parameters<typeof updateUserRef.current>[0]),
                        sendToWorker: (type, payload) =>
                            sendEventRef.current?.({
                                type: 'EVT_CUSTOM',
                                payload: { eventType: 'host:message', data: { type, payload } },
                            }),
                    });
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
