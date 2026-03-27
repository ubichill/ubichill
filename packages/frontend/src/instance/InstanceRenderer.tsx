'use client';

import { useSocket, useWorld, Z_INDEX } from '@ubichill/sdk/react';
import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { EntityRenderer } from '@/core/components/EntityRenderer';
import { wrapSocket } from '@/core/utils/socket';
import { usePluginRegistry } from '@/plugins/PluginRegistryContext';

// ============================================
// シングルトン CE をマウントし instanceCtx を注入するコンポーネント
// ============================================

interface SingletonMountProps {
    tag: string;
    ctx: UbiInstanceContext;
}

const SingletonMount: React.FC<SingletonMountProps> = ({ tag, ctx }) => {
    const ref = useRef<HTMLElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        // @ts-expect-error — CE に instanceCtx を注入
        el.instanceCtx = ctx;
    });

    return React.createElement(tag, {
        ref,
        style: { display: 'contents' },
    });
};

// ============================================
// InstanceRenderer — インスタンス参加中のオーバーレイ全体
// ============================================

export const InstanceRenderer: React.FC = () => {
    const { isConnected, socket, currentUser, users, updateUser, updatePosition } = useSocket();
    const { entities, patchEntity, createEntity, ephemeralData } = useWorld();
    const { pluginMap } = usePluginRegistry();
    const pendingEphemeralRef = useRef<Map<string, unknown>>(new Map());
    const flushRafRef = useRef<number | null>(null);

    // ブロードキャストチャンネル登録: channel → handler set
    const broadcastHandlersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());

    const onBroadcast = useCallback((channel: string, handler: (data: unknown) => void) => {
        const handlers = broadcastHandlersRef.current.get(channel) ?? new Set();
        handlers.add(handler);
        broadcastHandlersRef.current.set(channel, handlers);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) broadcastHandlersRef.current.delete(channel);
        };
    }, []);

    useEffect(() => {
        if (!socket) return;
        const handler = ({ entityId, data }: { entityId: string; data: unknown }) => {
            for (const h of broadcastHandlersRef.current.get(entityId) ?? []) {
                h(data);
            }
        };
        const h = handler as (...args: unknown[]) => void;
        socket.on('entity:ephemeral', h);
        return () => { socket.off('entity:ephemeral', h); };
    }, [socket]);

    const flushEphemeralQueue = useCallback(() => {
        if (!socket) {
            pendingEphemeralRef.current.clear();
            return;
        }

        for (const [entityId, data] of pendingEphemeralRef.current.entries()) {
            socket.emit('entity:ephemeral', { entityId, data });
        }
        pendingEphemeralRef.current.clear();
    }, [socket]);

    const scheduleEphemeralFlush = useCallback(() => {
        if (flushRafRef.current !== null) return;
        flushRafRef.current = requestAnimationFrame(() => {
            flushRafRef.current = null;
            flushEphemeralQueue();
        });
    }, [flushEphemeralQueue]);

    const enqueueEphemeral = useCallback(
        (entityId: string, data: unknown) => {
            pendingEphemeralRef.current.set(entityId, data);
            scheduleEphemeralFlush();
        },
        [scheduleEphemeralFlush],
    );

    useEffect(() => {
        return () => {
            if (flushRafRef.current !== null) {
                cancelAnimationFrame(flushRafRef.current);
                flushRafRef.current = null;
            }
            pendingEphemeralRef.current.clear();
        };
    }, []);

    const wrappedSocket = useMemo(() => (socket ? wrapSocket(socket) : null), [socket]);

    if (!isConnected) {
        return null;
    }

    // インスタンスコンテキストを構築（UbiSingleton へ注入）
    const instanceCtx: UbiInstanceContext = {
        currentUser,
        users,
        isConnected,
        updateUser,
        updatePosition,
        entities,
        patchEntity,
        createEntity: async (type, transform, data) => {
            const result = await createEntity(type, transform, data);
            return result ?? null;
        },
        ephemeralData,
        broadcastEphemeral: enqueueEphemeral,
        onBroadcast,
        socket: wrappedSocket,
    };

    // ロード済みプラグインのシングルトンタグを収集
    const singletonTags: string[] = [];
    for (const plugin of pluginMap.values()) {
        if (plugin.singletonTag) {
            singletonTags.push(plugin.singletonTag);
        }
        if (plugin.singletonTags) {
            singletonTags.push(...plugin.singletonTags);
        }
    }

    const renderEntities = Array.from(entities.values()).map((entity) => (
        <EntityRenderer
            key={entity.id}
            entityId={entity.id}
            broadcastEphemeral={enqueueEphemeral}
            wrappedSocket={wrappedSocket}
            currentUser={currentUser}
            users={users}
        />
    ));

    return (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: Z_INDEX.UI_BASE }}>
            {renderEntities}
            {singletonTags.map((tag) => (
                <SingletonMount key={tag} tag={tag} ctx={instanceCtx} />
            ))}
        </div>
    );
};
