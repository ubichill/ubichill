/**
 * Ubi.world.* RPC のハンドラ群。watchScope に応じて可視範囲を絞る。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import {
    collectAncestorGameObjectIds,
    collectSubtreeGameObjectIds,
    isAccessible as isAccessibleInScope,
    type WatchScope,
} from '../lib/entityScope';
import { useWorld } from './useWorld';

export function useModWorld(
    scope: WatchScope = 'subtree',
    entityId?: string,
    /**
     * この Worker が entityRef/entityRefArray フィールドで明示的にワイヤリングした GameObject id 集合。
     * watchScope 外でも、ここに含まれる id への書き込み/削除だけは許可する
     * (Editor で明示配線された「1つの UI Component が複数 Entity を操作する」ユースケースの経路)。
     */
    declaredTargets?: Set<string>,
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

    const scopedIds = useMemo(() => {
        if (!entityId) return null;
        if (scope === 'subtree') return collectSubtreeGameObjectIds(entities.values(), entityId);
        if (scope === 'parent') return collectAncestorGameObjectIds(entities.values(), entityId);
        return null;
    }, [entities, scope, entityId]);
    const scopedIdsRef = useRef(scopedIds);
    useEffect(() => {
        scopedIdsRef.current = scopedIds;
    });

    const scopeRef = useRef({ scope, entityId });
    useEffect(() => {
        scopeRef.current = { scope, entityId };
    });

    const declaredTargetsRef = useRef(declaredTargets);
    useEffect(() => {
        declaredTargetsRef.current = declaredTargets;
    });

    // scope に加えて、entityRef/entityRefArray で明示配線された GameObject id も可視として扱う。
    const isAccessible = (e: ComponentInstance): boolean =>
        isAccessibleInScope(
            e,
            scopeRef.current.scope,
            scopeRef.current.entityId,
            scopedIdsRef.current,
            declaredTargetsRef.current,
        );

    return {
        onGetEntity: (id: string): ComponentInstance | undefined => {
            const e = entitiesRef.current.get(id);
            return e && isAccessible(e) ? e : undefined;
        },
        onQueryEntities: (entityType: string): ComponentInstance[] =>
            Array.from(entitiesRef.current.values()).filter((e) => e.type === entityType && isAccessible(e)),
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
            // `patch.entityId` は ComponentInstance.id (= entitiesRef のキー、componentInstanceId)。
            // GameObject id ではない — 自 Worker の self-update も同じ RPC を通るため、
            // 読み取り (onGetEntity) と同じ「先に対象を引いてから isAccessible で判定」にする。
            const target = entitiesRef.current.get(patch.entityId);
            if (!target || !isAccessible(target)) {
                throw new Error(`scope外の Entity "${patch.entityId}" への書き込みは許可されていません`);
            }
            worldOpsRef.current.patchEntity(patch.entityId, patch.patch);
        },
        onDestroyEntity: async (id: string): Promise<void> => {
            const target = entitiesRef.current.get(id);
            if (!target || !isAccessible(target)) {
                throw new Error(`scope外の Entity "${id}" の削除は許可されていません`);
            }
            worldOpsRef.current.deleteEntity(id);
        },
    };
}
