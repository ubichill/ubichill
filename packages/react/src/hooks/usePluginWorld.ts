/**
 * Ubi.world.* RPC のハンドラ群。watchScope='entity' なら同 GameObject 内に絞る。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { useWorld } from './useWorld';

export function usePluginWorld(
    scope: 'entity' | 'world' = 'entity',
    gameObjectId?: string,
): Pick<HostHandlers, 'onGetEntity' | 'onQueryEntities' | 'onCreateEntity' | 'onUpdateEntity' | 'onDestroyEntity'> {
    const { entities, createEntity, patchEntity, deleteEntity } = useWorld();

    const worldOpsRef = useRef({ createEntity, patchEntity, deleteEntity });
    useEffect(() => {
        worldOpsRef.current = { createEntity, patchEntity, deleteEntity };
    });

    const entitiesRef = useRef(entities);
    useEffect(() => {
        entitiesRef.current = entities;
    });

    const scopeRef = useRef({ scope, gameObjectId });
    useEffect(() => {
        scopeRef.current = { scope, gameObjectId };
    });

    const isVisible = (e: WorldEntity): boolean => {
        const s = scopeRef.current;
        if (s.scope === 'world' || !s.gameObjectId) return true;
        return e.gameObjectId === s.gameObjectId;
    };

    return {
        onGetEntity: (id: string): WorldEntity | undefined => {
            const e = entitiesRef.current.get(id);
            return e && isVisible(e) ? e : undefined;
        },
        onQueryEntities: (entityType: string): WorldEntity[] =>
            Array.from(entitiesRef.current.values()).filter((e) => e.type === entityType && isVisible(e)),
        onCreateEntity: async (entity: Omit<WorldEntity, 'id'>): Promise<WorldEntity> => {
            const result = await worldOpsRef.current.createEntity(
                entity.type,
                entity.transform,
                entity.data as Record<string, unknown>,
            );
            if (!result) throw new Error('エンティティの作成に失敗しました');
            return result;
        },
        onUpdateEntity: async (_id: string, patch: import('@ubichill/shared').EntityPatchPayload): Promise<void> => {
            worldOpsRef.current.patchEntity(patch.entityId, patch.patch);
        },
        onDestroyEntity: async (id: string): Promise<void> => {
            worldOpsRef.current.deleteEntity(id);
        },
    };
}
