/**
 * usePluginWorld
 *
 * Worker の Ubi.world.* RPC を処理するハンドラ群を構築する。
 *
 * 責務:
 * - onGetEntity / onQueryEntities（同期読み取り）
 * - onCreateEntity / onUpdateEntity / onDestroyEntity（非同期書き込み）
 * - stale closure を防ぐための ref 管理
 */

import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import type { HostHandlers } from '../usePluginWorker';
import { useWorld } from './useWorld';

export function usePluginWorld(): Pick<
    HostHandlers,
    'onGetEntity' | 'onQueryEntities' | 'onCreateEntity' | 'onUpdateEntity' | 'onDestroyEntity'
> {
    const { entities, createEntity, patchEntity, deleteEntity } = useWorld();

    const worldOpsRef = useRef({ createEntity, patchEntity, deleteEntity });
    useEffect(() => {
        worldOpsRef.current = { createEntity, patchEntity, deleteEntity };
    });

    const entitiesRef = useRef(entities);
    useEffect(() => {
        entitiesRef.current = entities;
    });

    return {
        onGetEntity: (id: string): WorldEntity | undefined => entitiesRef.current.get(id),
        onQueryEntities: (entityType: string): WorldEntity[] =>
            Array.from(entitiesRef.current.values()).filter((e) => e.type === entityType),
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
