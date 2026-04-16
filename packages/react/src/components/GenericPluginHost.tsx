/**
 * GenericPluginHost — Worker のみで動作するプラグイン向けの汎用 React ホスト。
 *
 * 責務（orchestration のみ）:
 * - usePluginWorker でサンドボックスのライフサイクルを管理
 * - usePluginCanvas / usePluginUI / usePluginEntitySync / usePluginPresence を合成
 * - entity:ephemeral ↔ Ubi.network.broadcast の Socket.IO ブリッジ
 * - Ubi.world.* ↔ Socket.IO UEP ブリッジ
 * - sendHostMessageRef を通じた Host → Worker カスタムメッセージ
 */

import { createPluginFetchHandler } from '@ubichill/sandbox/host';
import type { CursorState, EntityEphemeralPayload, FetchOptions, FetchResult, WorldEntity } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { usePluginCanvas } from '../hooks/usePluginCanvas';
import { usePluginEntitySync } from '../hooks/usePluginEntitySync';
import { usePluginMedia } from '../hooks/usePluginMedia';
import { usePluginPresence } from '../hooks/usePluginPresence';
import { usePluginUI } from '../hooks/usePluginUI';
import { useSocket } from '../hooks/useSocket';
import { useWorld } from '../hooks/useWorld';
import type { WorkerPluginDefinition } from '../types';
import { usePluginWorker } from '../usePluginWorker';
import { PluginUIMount } from './PluginUIMount';

export interface GenericPluginHostProps {
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

async function _fetchLocal(url: string, options?: FetchOptions): Promise<FetchResult> {
    try {
        const response = await fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body,
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            body: await response.text(),
        };
    } catch (error) {
        return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: {},
            body: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
        };
    }
}

export const GenericPluginHost: React.FC<GenericPluginHostProps> = ({
    entityId,
    entity: _entity,
    definition,
    onCustomMessage,
    sendHostMessageRef,
}) => {
    const onCustomMessageRef = useRef(onCustomMessage);
    useEffect(() => {
        onCustomMessageRef.current = onCustomMessage;
    });

    const {
        entities,
        createEntity: worldCreateEntity,
        patchEntity: worldPatchEntity,
        deleteEntity: worldDeleteEntity,
    } = useWorld();
    const { socket, currentUser, users, updatePosition, updateUser } = useSocket();

    const hostDivRef = useRef<HTMLDivElement>(null);

    // ── stale closure 防止用 refs ──────────────────────────────────
    const worldOpsRef = useRef({
        createEntity: worldCreateEntity,
        patchEntity: worldPatchEntity,
        deleteEntity: worldDeleteEntity,
    });
    useEffect(() => {
        worldOpsRef.current = {
            createEntity: worldCreateEntity,
            patchEntity: worldPatchEntity,
            deleteEntity: worldDeleteEntity,
        };
    });
    const socketRef = useRef(socket);
    useEffect(() => {
        socketRef.current = socket;
    });
    const currentUserIdRef = useRef(currentUser?.id);
    useEffect(() => {
        currentUserIdRef.current = currentUser?.id;
    });
    const updatePositionRef = useRef(updatePosition);
    const updateUserRef = useRef(updateUser);
    useEffect(() => {
        updatePositionRef.current = updatePosition;
        updateUserRef.current = updateUser;
    });

    // ── フェッチハンドラ ─────────────────────────────────────────────
    // 許可ドメインの優先順位:
    //   1. plugin.json の fetchDomains（プラグイン発行者が制御）
    //   2. entity.data.fetchDomains（ワールド作成者が制御・外部バックエンド用）
    // 相対 URL（/、./、../）は常に _fetchLocal を経由してチェックをスキップ。
    const entityFetchDomains = useMemo(() => {
        const raw = (_entity.data as Record<string, unknown>).fetchDomains;
        return Array.isArray(raw) ? (raw as string[]) : [];
    }, [_entity.data]);

    const onFetch = useMemo(() => {
        const mergedDomains = [...(definition.fetchDomains ?? []), ...entityFetchDomains];
        const externalHandler = createPluginFetchHandler(mergedDomains);
        return (url: string, options?: FetchOptions): Promise<FetchResult> => {
            if (url.startsWith('/') || url.startsWith('./')) {
                return _fetchLocal(url, options);
            }
            return externalHandler(url, options);
        };
    }, [definition.fetchDomains, entityFetchDomains]);

    // ── サブ hooks ─────────────────────────────────────────────────
    const { getCanvasRef, canvasHandlers } = usePluginCanvas(definition, hostDivRef);
    const { vnodes, onRender, sendAction, sendEventRef } = usePluginUI();
    const { getVideoRef, mediaHandlers } = usePluginMedia(definition, sendEventRef);

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
            onRender,
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
            onFetch,
            onGetEntity: (id) => entities.get(id),
            onQueryEntities: (entityType) => Array.from(entities.values()).filter((e) => e.type === entityType),
            onNetworkBroadcast: (type, data) => {
                socketRef.current?.emit('entity:ephemeral', {
                    entityId,
                    data: { type, userId: currentUserIdRef.current ?? '', data },
                });
            },
            onCreateEntity: async (entity) =>
                worldOpsRef.current.createEntity(entity.type, entity.transform, entity.data as Record<string, unknown>),
            onUpdateEntity: async (_id, patch) => {
                worldOpsRef.current.patchEntity(patch.entityId, patch.patch);
            },
            onDestroyEntity: async (id) => {
                worldOpsRef.current.deleteEntity(id);
            },
        },
    });

    // sendEvent を sendEventRef に同期（レンダー中・副作用なし）
    sendEventRef.current = sendEvent;

    // ── スクロール要素を InputCollector に登録 ──────────────────────
    useEffect(() => {
        const el = document.querySelector('[data-scroll-world]');
        if (el) setScrollElement(el);
        return () => setScrollElement(null);
    }, [setScrollElement]);

    // ── 同期 effects ───────────────────────────────────────────────
    usePluginPresence(definition, users, sendEvent, workerRevision);
    usePluginEntitySync(definition, entities, sendEvent, workerRevision);

    // entity:ephemeral → 他ユーザーのブロードキャストを Worker へ転送
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

    // sendHostMessageRef: Host → Worker カスタムメッセージの外部公開
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
            style={{
                pointerEvents: 'none',
            }}
        >
            {definition.canvasTargets?.map((targetId) => (
                <canvas
                    key={targetId}
                    ref={getCanvasRef(targetId)}
                    data-canvas-target={targetId}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                    }}
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
