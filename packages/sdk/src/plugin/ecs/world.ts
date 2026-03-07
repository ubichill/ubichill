/**
 * ECS World 実装
 */

import type { EcsWorld, System, WorkerEvent } from './types';
import { EntityImpl } from './entity';
import { QueryImpl } from './query';

export class EcsWorldImpl implements EcsWorld {
    private _entities: Map<string, EntityImpl> = new Map();
    private _systems: System[] = [];
    private _queryCache: Map<string, QueryImpl> = new Map();

    registerSystem(system: System): void {
        this._systems.push(system);
    }

    createEntity(id: string): EntityImpl {
        if (this._entities.has(id)) {
            console.warn(`[ECS] Entity "${id}" already exists.`);
            return this._entities.get(id)!;
        }

        const entity = new EntityImpl(id);
        this._entities.set(id, entity);
        this._invalidateAllQueries();
        return entity;
    }

    getEntity(id: string): EntityImpl | null {
        return this._entities.get(id) ?? null;
    }

    query(componentNames: string[]): QueryImpl {
        const key = componentNames.sort().join('|');
        if (this._queryCache.has(key)) {
            return this._queryCache.get(key)!;
        }

        const entities = Array.from(this._entities.values());
        const query = new QueryImpl(entities, componentNames);
        this._queryCache.set(key, query);
        return query;
    }

    tick(deltaTime: number, events: WorkerEvent[] = []): void {
        const entities = Array.from(this._entities.values());
        for (const system of this._systems) {
            try {
                system(entities, deltaTime, events);
            } catch (error) {
                console.error('[ECS] System error:', error);
            }
        }
    }

    dispatch(event: WorkerEvent): void {
        // Event Bus として拡張可能
    }

    clear(): void {
        this._entities.clear();
        this._systems = [];
        this._queryCache.clear();
    }

    private _invalidateAllQueries(): void {
        for (const query of this._queryCache.values()) {
            query._invalidateCache();
        }
    }
}
