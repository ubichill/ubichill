'use client';

import { useSocket, useWorld, Z_INDEX } from '@ubichill/sdk/react';
import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import React, { useLayoutEffect, useRef } from 'react';
import { EntityRenderer } from '@/core/components/EntityRenderer';
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
        broadcastEphemeral: (entityId, data) => {
            socket?.emit('entity:ephemeral', { entityId, data });
        },
        socket: socket
            ? {
                  emit: (event, ...args) => (socket.emit as (ev: string, ...a: unknown[]) => void)(event, ...args),
                  on: (event, handler) => socket.on(event as never, handler as never),
                  off: (event, handler) => socket.off(event as never, handler as never),
                  get id() {
                      return socket.id;
                  },
              }
            : null,
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
        <EntityRenderer key={entity.id} entityId={entity.id} />
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
