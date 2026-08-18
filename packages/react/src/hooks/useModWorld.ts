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
    isVisibleInScope,
    type WatchScope,
} from '../lib/entityScope';
import { useWorld } from './useWorld';

export function useModWorld(
    scope: WatchScope = 'subtree',
    entityId?: string,
    /**
     * この Worker が entityRef/entityRefArray フィールドで明示的にワイヤリングした GameObject id 集合
     * (access に関わらず全件)。watchScope 外でも、ここに含まれる id への読み取りだけは許可する。
     */
    declaredReadTargets?: Set<string>,
    /**
     * 上記のうち `access: 'write'` を明示したもののみのサブセット。
     * watchScope 外でこの集合に含まれる id への書き込みを許可する。
     * 削除はここに含まれていても許可しない (destroy は watchScope のみで判定する)。
     */
    declaredWriteTargets?: Set<string>,
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

    const declaredReadTargetsRef = useRef(declaredReadTargets);
    useEffect(() => {
        declaredReadTargetsRef.current = declaredReadTargets;
    });
    const declaredWriteTargetsRef = useRef(declaredWriteTargets);
    useEffect(() => {
        declaredWriteTargetsRef.current = declaredWriteTargets;
    });

    // 読み取り: scope に加えて、entityRef/entityRefArray で明示配線された GameObject id
    // (access に関わらず全件) も可視として扱う。
    const isReadable = (e: ComponentInstance): boolean =>
        isAccessibleInScope(
            e,
            scopeRef.current.scope,
            scopeRef.current.entityId,
            scopedIdsRef.current,
            declaredReadTargetsRef.current,
        );
    // 書き込み: scope に加えて、access: 'write' を明示した entityRef のみ許可する。
    const isWritable = (e: ComponentInstance): boolean =>
        isAccessibleInScope(
            e,
            scopeRef.current.scope,
            scopeRef.current.entityId,
            scopedIdsRef.current,
            declaredWriteTargetsRef.current,
        );

    return {
        onGetEntity: (id: string): ComponentInstance | undefined => {
            const e = entitiesRef.current.get(id);
            return e && isReadable(e) ? e : undefined;
        },
        onQueryEntities: (entityType: string): ComponentInstance[] =>
            Array.from(entitiesRef.current.values()).filter((e) => e.type === entityType && isReadable(e)),
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
            // 読み取り (onGetEntity) と同じ「先に対象を引いてから isWritable で判定」にする。
            const target = entitiesRef.current.get(patch.entityId);
            if (!target || !isWritable(target)) {
                throw new Error(`scope外の Entity "${patch.entityId}" への書き込みは許可されていません`);
            }
            worldOpsRef.current.patchEntity(patch.entityId, patch.patch);
        },
        onDestroyEntity: async (id: string): Promise<void> => {
            // 削除は entityRef の declaredTargets を一切参照しない。watchScope で見える
            // (= 自身または自身の GameObject 内) Entity のみ削除できる。
            const target = entitiesRef.current.get(id);
            if (
                !target ||
                !isVisibleInScope(target, scopeRef.current.scope, scopeRef.current.entityId, scopedIdsRef.current)
            ) {
                throw new Error(`scope外の Entity "${id}" の削除は許可されていません`);
            }
            worldOpsRef.current.deleteEntity(id);
        },
    };
}
