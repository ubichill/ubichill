/**
 * usePluginEntitySync
 *
 * definition.watchEntityTypes に一致するエンティティの変化を
 * EVT_ENTITY_WATCH として Worker へ転送する。
 *
 * - Worker 再作成時（workerRevision 変化）は全エンティティを再送
 * - 参照が変わったエンティティのみ差分送信
 */

import type { PluginHostEvent, WorldEntity } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import type { WorkerPluginDefinition } from '../types';

export function usePluginEntitySync(
    definition: WorkerPluginDefinition,
    entities: Map<string, WorldEntity>,
    sendEvent: (event: PluginHostEvent) => void,
    workerRevision: number,
): void {
    const watchTypes = definition.watchEntityTypes;
    const prevEntitiesRef = useRef<Map<string, WorldEntity>>(new Map());
    const prevWorkerRevisionRef = useRef(-1);

    useEffect(() => {
        if (!watchTypes?.length) return;
        const typeSet = new Set(watchTypes);
        const workerChanged = prevWorkerRevisionRef.current !== workerRevision;
        prevWorkerRevisionRef.current = workerRevision;

        for (const [id, e] of entities) {
            if (!typeSet.has(e.type)) continue;
            const prev = prevEntitiesRef.current.get(id);
            if (workerChanged || prev !== e) {
                sendEvent({ type: 'EVT_ENTITY_WATCH', payload: { entityType: e.type, entity: e } });
            }
        }
        prevEntitiesRef.current = new Map(entities);
    }, [entities, watchTypes, sendEvent, workerRevision]);
}
