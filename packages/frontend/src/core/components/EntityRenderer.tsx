'use client';

import type { WorldEntity } from '@ubichill/sdk';
import { useWorld } from '@ubichill/sdk/react';
import type { SocketLike, UbiEntityContext } from '@ubichill/sdk/ui';
import React, { useLayoutEffect, useRef } from 'react';
import type { User } from '@ubichill/shared';
import { usePluginRegistry } from '../../plugins/PluginRegistryContext';

interface EntityRendererProps {
    entityId: string;
    broadcastEphemeral: (entityId: string, data: unknown) => void;
    wrappedSocket: SocketLike | null;
    currentUser: User | null;
    users: Map<string, User>;
}

export const EntityRenderer: React.FC<EntityRendererProps> = ({
    entityId,
    broadcastEphemeral,
    wrappedSocket,
    currentUser,
    users,
}) => {
    const { entities, patchEntity, createEntity, ephemeralData } = useWorld();
    const { pluginMap, loadPlugin } = usePluginRegistry();
    const ref = useRef<HTMLElement>(null);

    const entity = entities.get(entityId);

    // エンティティが存在しない場合は何も描画しない
    if (!entity) return null;

    const plugin = pluginMap.get(entity.type);
    if (!plugin) {
        // 未ロードの場合は動的ロードを試みる
        loadPlugin(entity.type);
        return null;
    }

    return (
        <EntityCEBridge
            key={plugin.elementTag}
            tag={plugin.elementTag}
            entityId={entityId}
            broadcastEphemeral={broadcastEphemeral}
            entity={entity}
            entities={entities}
            patchEntity={patchEntity}
            createEntity={createEntity}
            ephemeralData={ephemeralData}
            socket={wrappedSocket}
            currentUser={currentUser}
            users={users}
            ref={ref}
        />
    );
};

// ============================================
// CE ブリッジ — コンテキストを注入する内部コンポーネント
// ============================================

interface BridgeProps {
    tag: string;
    entityId: string;
    broadcastEphemeral: (entityId: string, data: unknown) => void;
    entity: WorldEntity;
    entities: Map<string, WorldEntity>;
    patchEntity: (id: string, patch: Partial<WorldEntity>) => void;
    createEntity: (type: string, transform: WorldEntity['transform'], data: unknown) => Promise<WorldEntity | null>;
    ephemeralData: Map<string, unknown>;
    socket: SocketLike | null;
    currentUser: User | null;
    users: Map<string, User>;
    ref: React.RefObject<HTMLElement | null>;
}

const EntityCEBridge: React.FC<BridgeProps> = ({
    tag,
    entityId,
    broadcastEphemeral,
    entity,
    entities,
    patchEntity,
    createEntity,
    ephemeralData,
    socket,
    currentUser,
    users,
    ref,
}) => {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        const isLockedByMe = !!entity.lockedBy && entity.lockedBy === currentUser?.id;
        const isLockedByOther = !!entity.lockedBy && entity.lockedBy !== currentUser?.id;

        const ctx: UbiEntityContext = {
            entity,
            ephemeral: ephemeralData.get(entityId),
            patchEntity: (patch) => patchEntity(entityId, patch as Partial<WorldEntity>),
            broadcast: (data) => broadcastEphemeral(entityId, data),
            isLocked: !!entity.lockedBy,
            isLockedByMe,
            isLockedByOther,
            lockEntity: () => {
                if (currentUser) {
                    patchEntity(entityId, { lockedBy: currentUser.id });
                }
            },
            unlockEntity: () => {
                patchEntity(entityId, { lockedBy: null });
            },
            releaseOtherLocks: (options) => {
                for (const [id, e] of entities) {
                    if (e.lockedBy !== currentUser?.id || id === entityId) continue;
                    const additionalPatch = options?.onAutoRelease?.(e) ?? {};
                    patchEntity(id, {
                        lockedBy: null,
                        ...additionalPatch,
                        data: {
                            ...(e.data as Record<string, unknown>),
                            isHeld: false,
                            ...(additionalPatch.data as Record<string, unknown>),
                        },
                    });
                }
            },
            createEntity: async (type, transform, data) => {
                const result = await createEntity(type, transform, data);
                return result ?? null;
            },
            currentUserId: currentUser?.id,
            users,
            socket,
        };

        // @ts-expect-error — CE に ubiCtx を注入
        el.ubiCtx = ctx;
    });

    return React.createElement(tag, {
        ref,
        style: {
            position: 'absolute',
            left: 0,
            top: 0,
        },
    });
};
