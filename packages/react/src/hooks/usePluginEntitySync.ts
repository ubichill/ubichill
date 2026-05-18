/**
 * usePluginEntitySync
 *
 * watchEntityTypes に一致するエンティティの変化を EVT_ENTITY_WATCH として Worker へ転送する。
 * watchScope に応じて可視範囲を絞る ('entity' / 'subtree' / 'world')。
 */

import type { ComponentInstance, PluginHostEvent } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import { collectSubtreeGameObjectIds, isVisibleInScope, type WatchScope } from '../lib/entityScope';
import type { WorkerPluginDefinition } from '../types';

export function usePluginEntitySync(
    definition: WorkerPluginDefinition,
    entities: Map<string, ComponentInstance>,
    sendEvent: (event: PluginHostEvent) => void,
    workerRevision: number,
    entityId: string | undefined,
): void {
    const watchTypes = definition.watchEntityTypes;
    const scope: WatchScope = definition.watchScope ?? 'subtree';
    const subtreeIds = useMemo(
        () => (scope === 'subtree' && entityId ? collectSubtreeGameObjectIds(entities.values(), entityId) : null),
        [entities, scope, entityId],
    );
    const prevEntitiesRef = useRef<Map<string, ComponentInstance>>(new Map());
    const prevWorkerRevisionRef = useRef(-1);

    useEffect(() => {
        if (!watchTypes?.length) return;
        const typeSet = new Set(watchTypes);
        const workerChanged = prevWorkerRevisionRef.current !== workerRevision;
        prevWorkerRevisionRef.current = workerRevision;

        for (const [id, e] of entities) {
            if (!typeSet.has(e.type)) continue;
            if (!isVisibleInScope(e, scope, entityId, subtreeIds)) continue;
            const prev = prevEntitiesRef.current.get(id);
            if (workerChanged || prev !== e) {
                sendEvent({ type: 'EVT_ENTITY_WATCH', payload: { entityType: e.type, entity: e } });
            }
        }
        prevEntitiesRef.current = new Map(entities);
    }, [entities, watchTypes, scope, entityId, subtreeIds, sendEvent, workerRevision]);
}
