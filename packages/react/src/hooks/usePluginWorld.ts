/**
 * Ubi.world.* RPC のハンドラ群。watchScope に応じて可視範囲を絞る。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import { collectSubtreeGameObjectIds, isVisibleInScope, type WatchScope } from '../lib/entityScope';
import { useWorld } from './useWorld';

export function usePluginWorld(
    scope: WatchScope = 'subtree',
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

    const subtreeIds = useMemo(
        () =>
            scope === 'subtree' && gameObjectId ? collectSubtreeGameObjectIds(entities.values(), gameObjectId) : null,
        [entities, scope, gameObjectId],
    );
    const subtreeIdsRef = useRef(subtreeIds);
    useEffect(() => {
        subtreeIdsRef.current = subtreeIds;
    });

    const scopeRef = useRef({ scope, gameObjectId });
    useEffect(() => {
        scopeRef.current = { scope, gameObjectId };
    });

    const isVisible = (e: WorldEntity): boolean =>
        isVisibleInScope(e, scopeRef.current.scope, scopeRef.current.gameObjectId, subtreeIdsRef.current);

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
