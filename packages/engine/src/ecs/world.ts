import { EntityImpl } from './entity';
import { QueryImpl } from './query';
import type { EcsWorld, System, WorkerEvent } from './types';

export class EcsWorldImpl implements EcsWorld {
    private _entities: Map<string, EntityImpl> = new Map();
    private _systems: System[] = [];
    private _queryCache: Map<string, QueryImpl> = new Map();
    /** エンティティ配列のキャッシュ（dirty flag パターンで tick() コストを O(1) に抑える） */
    private _entitiesCache: EntityImpl[] = [];
    private _cacheIsDirty = true;

    registerSystem(system: System): void {
        this._systems.push(system);
    }

    createEntity(id: string): EntityImpl {
        if (this._entities.has(id)) {
            throw new Error(`[ECS] Entity "${id}" already exists.`);
        }
        const entity = new EntityImpl(id);
        this._entities.set(id, entity);
        this._cacheIsDirty = true;
        this._invalidateAllQueries();
        return entity;
    }

    getEntity(id: string): EntityImpl | null {
        return this._entities.get(id) ?? null;
    }

    query(componentNames: string[]): QueryImpl {
        const key = [...componentNames].sort().join('|');
        if (this._queryCache.has(key)) {
            return this._queryCache.get(key) as QueryImpl;
        }
        const entities = Array.from(this._entities.values());
        const query = new QueryImpl(entities, componentNames);
        this._queryCache.set(key, query);
        return query;
    }

    private _snapshot(): EntityImpl[] {
        if (this._cacheIsDirty) {
            this._entitiesCache = Array.from(this._entities.values());
            this._cacheIsDirty = false;
        }
        return this._entitiesCache;
    }

    tick(deltaTime: number, events: WorkerEvent[] = []): void {
        const entities = this._snapshot();
        for (const system of this._systems) {
            system(entities, deltaTime, events);
        }
    }

    dispatch(_event: WorkerEvent): void {
        // Event Bus として拡張可能
    }

    clear(): void {
        this._entities.clear();
        this._systems = [];
        this._queryCache.clear();
        this._entitiesCache = [];
        this._cacheIsDirty = true;
    }

    private _invalidateAllQueries(): void {
        // キャッシュを全クリアすることで、次回 query() 呼び出し時に
        // 最新の entities スナップショットで QueryImpl を再構築させる
        this._queryCache.clear();
    }
}
