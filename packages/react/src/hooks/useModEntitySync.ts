/**
 * useModEntitySync
 *
 * watchEntityTypes に一致するエンティティの変化を EVT_ENTITY_WATCH として Worker へ転送する。
 * watchScope に応じて可視範囲を絞る ('entity' / 'subtree' / 'parent' / 'world')。
 */

import type { ComponentInstance, ModHostEvent } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import {
    collectAncestorGameObjectIds,
    collectSubtreeGameObjectIds,
    isVisibleInScope,
    type WatchScope,
} from '../lib/entityScope';
import type { WorkerModDefinition } from '../types';

export function useModEntitySync(
    definition: WorkerModDefinition,
    entities: Map<string, ComponentInstance>,
    sendEvent: (event: ModHostEvent) => void,
    workerRevision: number,
    entityId: string | undefined,
): void {
    const watchTypes = definition.watchEntityTypes;
    const scope: WatchScope = definition.watchScope ?? 'subtree';
    const scopedIds = useMemo(() => {
        if (!entityId) return null;
        if (scope === 'subtree') return collectSubtreeGameObjectIds(entities.values(), entityId);
        if (scope === 'parent') return collectAncestorGameObjectIds(entities.values(), entityId);
        return null;
    }, [entities, scope, entityId]);
    const prevEntitiesRef = useRef<Map<string, ComponentInstance>>(new Map());
    const prevWorkerRevisionRef = useRef(-1);

    useEffect(() => {
        if (!watchTypes?.length) return;
        const typeSet = new Set(watchTypes);
        const workerChanged = prevWorkerRevisionRef.current !== workerRevision;
        prevWorkerRevisionRef.current = workerRevision;

        for (const [id, e] of entities) {
            if (!typeSet.has(e.type)) continue;
            if (!isVisibleInScope(e, scope, entityId, scopedIds)) continue;
            const prev = prevEntitiesRef.current.get(id);
            if (workerChanged || prev !== e) {
                sendEvent({ type: 'EVT_ENTITY_WATCH', payload: { entityType: e.type, entity: e } });
            }
        }
        prevEntitiesRef.current = new Map(entities);
    }, [entities, watchTypes, scope, entityId, scopedIds, sendEvent, workerRevision]);
}
