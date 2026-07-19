/**
 * WorkerModHost — Worker ベースmod向け React ホスト。
 *
 * 責務（orchestration のみ）:
 * - useModWorker でサンドボックスのライフサイクルを管理
 * - 各 useMod* hook を合成して handlers を組み立てる
 * - definition.onHostMessage を通じたカスタムメッセージのmod側委譲
 */

import { routeEmit } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { editorSchemaRegistry } from '../editorSchemaRegistry';
import { useModBroadcast } from '../hooks/useModBroadcast';
import { useModCanvas } from '../hooks/useModCanvas';
import { useModEntitySync } from '../hooks/useModEntitySync';
import { useModFetch } from '../hooks/useModFetch';
import { useModMedia } from '../hooks/useModMedia';
import { useModPresence } from '../hooks/useModPresence';
import { useModUI } from '../hooks/useModUI';
import { useModWorld } from '../hooks/useModWorld';
import { useSocket } from '../hooks/useSocket';
import { useWorld } from '../hooks/useWorld';
import {
    collectAncestorGameObjectIds,
    collectSubtreeGameObjectIds,
    isVisibleInScope,
    type WatchScope,
} from '../lib/entityScope';
import type { WorkerModDefinition } from '../types';
import { useModWorker } from '../useModWorker';
import { useWorkerLoading } from '../WorkerLoadingContext';
import { useHold } from './HoldContext';
import { ModUIMount } from './ModUIMount';
import { useUbiPermissions } from './PermissionContext';

export interface WorkerModHostProps {
    entityId: string;
    entity: ComponentInstance;
    definition: WorkerModDefinition;
}

export const WorkerModHost: React.FC<WorkerModHostProps> = ({ entityId, entity, definition }) => {
    const { users, currentUser, updatePosition, updateUser } = useSocket();
    const { entities, patchEntity } = useWorld();
    const { handleGripCommand } = useHold();
    const permissions = useUbiPermissions();

    // on-demand 認可: Provider があるときだけ authorizeCapability を渡す（無い場合は
    // 宣言 capability の静的判定にフォールバック）。modId 束縛済みで identity 安定。
    // definition.id は "mod:component" 形式。信頼境界はmod単位なので ":" の前を使う
    // （同一modの全コンポーネントで許可を共有する）。
    const modId = definition.id.split(':')[0];
    const authorizeCapability = useMemo(
        () => (permissions ? (capability: string) => permissions.authorizeCapability(modId, capability) : undefined),
        [permissions, modId],
    );

    // 読み込み時に要求 capability をまとめて承認してもらい、**決定が済むまで Worker を実行しない**。
    // ダウンロード済みコードは保持されるが、実行（Worker 生成）は enabled=true になってから。
    // 決定後は許可/拒否どちらでも実行する（拒否した権限は実行時ゲートが個別に拒否）。
    // Provider 不在（エディタ Preview 等）は即実行。
    const authorizeMod = permissions?.authorizeMod;
    const declaredCapabilities = definition.capabilities;
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        if (!authorizeMod) {
            setEnabled(true);
            return;
        }
        let cancelled = false;
        setEnabled(false);
        authorizeMod(modId, declaredCapabilities ?? []).then(() => {
            if (!cancelled) setEnabled(true); // 決定後は許可/拒否とも実行
        });
        return () => {
            cancelled = true;
        };
    }, [authorizeMod, modId, declaredCapabilities]);
    const hostDivRef = useRef<HTMLDivElement>(null);
    const workerLoading = useWorkerLoading();

    // Context changes immediately notify the parent via prop
    const workerRegistrationRef = useRef<{ markReady: () => void; unregister: () => void } | null>(null);

    useEffect(() => {
        // 実行が始まる（enabled）ときだけロード対象に数える。承認待ち/拒否のmodで
        // ワールドのロード表示がハングしないようにする。
        if (workerLoading && enabled) {
            const reg = workerLoading.registerWorker();
            workerRegistrationRef.current = reg;
            return () => reg.unregister();
        }
    }, [workerLoading, enabled]);

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

    // ── onNetworkBroadcast は useModWorker より後に確定するため ref で橋渡し ──
    const onNetworkBroadcastRef = useRef<((type: string, data: unknown) => void) | null>(null);

    // ── サブ hooks ─────────────────────────────────────────────────
    const { getCanvasRef, canvasHandlers } = useModCanvas(definition, hostDivRef);
    const { vnodes, onRender, sendAction, sendEventRef } = useModUI();
    const { getVideoRef, mediaHandlers } = useModMedia(definition, sendEventRef);
    const onFetch = useModFetch(definition);
    const worldHandlers = useModWorld(definition.watchScope ?? 'subtree', entity.entityId);

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
    const { sendEvent, workerRevision, setScrollElement } = useModWorker({
        modCode: definition.workerCode,
        modId: definition.id,
        componentInstanceId: entityId,
        entityId: entity.entityId,
        parentEntityId: entity.parentEntityId,
        componentType: entity.type,
        capabilities: definition.capabilities,
        authorizeCapability,
        enabled,
        myUserId: currentUser?.id,
        modBase: definition.modBase,
        watchEntityTypes: definition.watchEntityTypes,
        initialEntities,
        handlers: {
            ...canvasHandlers,
            ...mediaHandlers,
            ...worldHandlers,
            onReady: () => workerRegistrationRef.current?.markReady(),
            onRender,
            // worker が報告した Inspector 用スキーマをレジストリへ。World エディタが参照する。
            onEditorSchema: (componentType, schema) => editorSchemaRegistry.set(componentType, schema),
            onFetch,
            onNetworkBroadcast: (type, data) => onNetworkBroadcastRef.current?.(type, data),
            onEventEmit: (type, data, scope, targetType, senderId) =>
                routeEmit({
                    senderComponentInstanceId: senderId,
                    type,
                    data,
                    scope,
                    targetType,
                }),
            onGripCommand: (payload) => {
                handleGripCommand(payload);
                // 永続化は share='persistent' のときだけ。
                // share='local'/'presence' で持っているものは他クライアントには影響しないので、
                // ここで lockedBy / heldEntityId を server に書くと、別人が persistent で持ってる
                // 同 entity の状態を上書きしてしまう可能性がある (= Copilot 指摘の bug)。
                if (payload.action === 'hold' && payload.share === 'persistent') {
                    const myId = currentUserRef.current?.id ?? null;
                    patchEntityRef.current(payload.entityId, {
                        lockedBy: myId,
                        // heldOffset: リモートクライアントが追従先を計算するのに使う (CursorLayer +
                        // EntityRenderer の初期位置)。grip ごとに違うオフセットを共通ソースから読めるように。
                        data: { isHeld: true, heldOffset: { x: payload.offsetX, y: payload.offsetY } },
                    });
                    updateUserRef.current({ heldEntityId: payload.entityId });
                } else if (payload.action === 'release' && payload.share === 'persistent') {
                    patchEntityRef.current(payload.entityId, {
                        lockedBy: null,
                        data: { isHeld: false, heldOffset: null },
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
    const { onNetworkBroadcast } = useModBroadcast(entityId, sendEvent);
    onNetworkBroadcastRef.current = onNetworkBroadcast;

    useEffect(() => {
        const el = document.querySelector('[data-scroll-world]');
        if (el) setScrollElement(el);
        return () => setScrollElement(null);
    }, [setScrollElement]);

    useModPresence(definition, users, sendEvent, workerRevision);
    useModEntitySync(definition, entities, sendEvent, workerRevision, entity.entityId);

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
                // biome-ignore lint/a11y/useMediaCaption: mod-managed video
                <video
                    key={targetId}
                    ref={getVideoRef(targetId)}
                    data-media-target={targetId}
                    // preload="auto": ロード後すぐにバッファリングを開始 (デフォルト "metadata" は
                    // duration だけ取って待機するので、再生開始時のもたつきが大きい)。
                    // playsInline: モバイル Safari でフルスクリーン強制を防ぐ。
                    preload="auto"
                    playsInline
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
                <ModUIMount key={targetId} targetId={targetId} vnode={vnode} sendAction={sendAction} />
            ))}
        </div>
    );
};
