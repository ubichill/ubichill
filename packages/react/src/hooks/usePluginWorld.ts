/**
 * Ubi.world.* RPC のハンドラ群。watchScope に応じて可視範囲を絞る。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import { collectSubtreeGameObjectIds, isVisibleInScope, type WatchScope } from '../lib/entityScope';
import { useWorld } from './useWorld';

export function usePluginWorld(
    scope: WatchScope = 'subtree',
    entityId?: string,
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

    const subtreeIds = useMemo(
        () => (scope === 'subtree' && entityId ? collectSubtreeGameObjectIds(entities.values(), entityId) : null),
        [entities, scope, entityId],
    );
    const subtreeIdsRef = useRef(subtreeIds);
    useEffect(() => {
        subtreeIdsRef.current = subtreeIds;
    });

    const scopeRef = useRef({ scope, entityId });
    useEffect(() => {
        scopeRef.current = { scope, entityId };
    });

    const isVisible = (e: ComponentInstance): boolean =>
        isVisibleInScope(e, scopeRef.current.scope, scopeRef.current.entityId, subtreeIdsRef.current);

    return {
        onGetEntity: (id: string): ComponentInstance | undefined => {
            const e = entitiesRef.current.get(id);
            return e && isVisible(e) ? e : undefined;
        },
        onQueryEntities: (entityType: string): ComponentInstance[] =>
            Array.from(entitiesRef.current.values()).filter((e) => e.type === entityType && isVisible(e)),
        onCreateEntity: async (entity: Omit<ComponentInstance, 'id'>): Promise<ComponentInstance> => {
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
