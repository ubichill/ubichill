/**
 * WorkerPluginHost — Worker ベースプラグイン向け React ホスト。
 *
 * 責務（orchestration のみ）:
 * - usePluginWorker でサンドボックスのライフサイクルを管理
 * - 各 usePlugin* hook を合成して handlers を組み立てる
 * - definition.onHostMessage を通じたカスタムメッセージのプラグイン側委譲
 */

import { PluginHostManager } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
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
import {
    collectAncestorGameObjectIds,
    collectSubtreeGameObjectIds,
    isVisibleInScope,
    type WatchScope,
} from '../lib/entityScope';
import type { WorkerPluginDefinition } from '../types';
import { usePluginWorker } from '../usePluginWorker';
import { useWorkerLoading } from '../WorkerLoadingContext';
import { useHold } from './HoldContext';
import { PluginUIMount } from './PluginUIMount';

export interface WorkerPluginHostProps {
    entityId: string;
    entity: ComponentInstance;
    definition: WorkerPluginDefinition;
}

export const WorkerPluginHost: React.FC<WorkerPluginHostProps> = ({ entityId, entity, definition }) => {
    const { users, currentUser, updatePosition, updateUser } = useSocket();
    const { entities, patchEntity } = useWorld();
    const { handleGripCommand } = useHold();
    const hostDivRef = useRef<HTMLDivElement>(null);
    const workerLoading = useWorkerLoading();

    // Context changes immediately notify the parent via prop
    const workerRegistrationRef = useRef<{ markReady: () => void; unregister: () => void } | null>(null);

    useEffect(() => {
        if (workerLoading) {
            const reg = workerLoading.registerWorker();
            workerRegistrationRef.current = reg;
            return () => reg.unregister();
        }
    }, [workerLoading]);

    const updatePositionRef = useRef(updatePosition);
    const updateUserRef = useRef(updateUser);
    const patchEntityRef = useRef(patchEntity);
    const currentUserRef = useRef(currentUser);
    useEffect(() => {
        updatePositionRef.current = updatePosition;
        updateUserRef.current = updateUser;
        patchEntityRef.current = patchEntity;
        currentUserRef.current = currentUser;
    });

    // ── onNetworkBroadcast は usePluginWorker より後に確定するため ref で橋渡し ──
    const onNetworkBroadcastRef = useRef<((type: string, data: unknown) => void) | null>(null);

    // ── サブ hooks ─────────────────────────────────────────────────
    const { getCanvasRef, canvasHandlers } = usePluginCanvas(definition, hostDivRef);
    const { vnodes, onRender, sendAction, sendEventRef } = usePluginUI();
    const { getVideoRef, mediaHandlers } = usePluginMedia(definition, sendEventRef);
    const onFetch = usePluginFetch(definition, entity);
    const worldHandlers = usePluginWorld(definition.watchScope ?? 'subtree', entity.entityId);

    // ── Worker 起動時点の watchEntityTypes マッチ分を抽出 ──────────────
    // watchScope='subtree' (default) は自 GameObject + 子孫 の Component を可視。
    // watchScope='parent' は自 GameObject + 祖先 の Component を可視。
    const scope: WatchScope = definition.watchScope ?? 'subtree';
    const scopedIds = useMemo(() => {
        if (!entity.entityId) return null;
        if (scope === 'subtree') return collectSubtreeGameObjectIds(entities.values(), entity.entityId);
        if (scope === 'parent') return collectAncestorGameObjectIds(entities.values(), entity.entityId);
        return null;
    }, [entities, scope, entity.entityId]);
    const initialEntities = useMemo<ComponentInstance[]>(() => {
        const types = definition.watchEntityTypes;
        if (!types?.length) return [];
        const typeSet = new Set(types);
        const out: ComponentInstance[] = [];
        for (const e of entities.values()) {
            if (!typeSet.has(e.type)) continue;
            if (!isVisibleInScope(e, scope, entity.entityId, scopedIds)) continue;
            out.push(e);
        }
        return out;
    }, [entities, definition.watchEntityTypes, scope, entity.entityId, scopedIds]);

    // ── Worker ────────────────────────────────────────────────────
    const { sendEvent, workerRevision, setScrollElement } = usePluginWorker({
        pluginCode: definition.workerCode,
        pluginId: definition.id,
        componentInstanceId: entityId,
        entityId: entity.entityId,
        parentEntityId: entity.parentEntityId,
        componentType: entity.type,
        capabilities: definition.capabilities,
        myUserId: currentUser?.id,
        pluginBase: definition.pluginBase,
        watchEntityTypes: definition.watchEntityTypes,
        initialEntities,
        handlers: {
            ...canvasHandlers,
            ...mediaHandlers,
            ...worldHandlers,
            onReady: () => workerRegistrationRef.current?.markReady(),
            onRender,
            onFetch,
            onNetworkBroadcast: (type, data) => onNetworkBroadcastRef.current?.(type, data),
            onEventEmit: (type, data, scope, targetType, senderId) =>
                PluginHostManager.routeEmit({
                    senderComponentInstanceId: senderId,
                    type,
                    data,
                    scope,
                    targetType,
                }),
            onGripCommand: (payload) => {
                handleGripCommand(payload);
                // persistent share: lockedBy をサーバー永続化
                if (payload.action === 'hold' && payload.share === 'persistent') {
                    const myId = currentUserRef.current?.id ?? null;
                    patchEntityRef.current(payload.entityId, {
                        lockedBy: myId,
                        data: { isHeld: true },
                    });
                    // user:update で heldEntityId を同期（cursor:move でも送るが初期値として）
                    updateUserRef.current({ heldEntityId: payload.entityId });
                } else if (payload.action === 'release') {
                    patchEntityRef.current(payload.entityId, {
                        lockedBy: null,
                        data: { isHeld: false },
                    });
                    updateUserRef.current({ heldEntityId: null });
                }
            },
            onMessage: (msg) => {
                const m = msg as { type: string; payload: unknown };
                if (m.type === 'position:update') {
                    const { x, y } = m.payload as { x: number; y: number };
                    updatePositionRef.current({ x, y });
                } else if (m.type === 'user:update') {
                    updateUserRef.current(m.payload as Parameters<typeof updateUserRef.current>[0]);
                } else {
                    definition.onHostMessage?.(m.type, m.payload, {
                        updateUser: (patch) =>
                            updateUserRef.current(patch as Parameters<typeof updateUserRef.current>[0]),
                        sendToWorker: (type, payload) =>
                            // 旧仕様: eventType: 'host:message', data: { type, payload } という入れ子だったが
                            // Worker 側で常に switch(payload.type) を書かされる二度手間だったので、
                            // type を eventType に直接昇格させて Worker は Ubi.event.on(type, ...) で
                            // フラットに受けられるようにした。
                            sendEventRef.current?.({
                                type: 'EVT_CUSTOM',
                                payload: { eventType: type, data: payload },
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
    usePluginEntitySync(definition, entities, sendEvent, workerRevision, entity.entityId);

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
                        backgroundColor: '#000',
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
