import type { Entity, Query } from './types';

export class QueryImpl implements Query {
    private _allEntities: Entity[];
    private _componentNames: string[];
    private _cachedResult: Entity[] | null = null;

    constructor(entities: Entity[], componentNames: string[]) {
        this._allEntities = entities;
        this._componentNames = componentNames;
    }

    execute(): Entity[] {
        if (this._cachedResult !== null) {
            return this._cachedResult;
        }
        this._cachedResult = this._allEntities.filter((entity) =>
            this._componentNames.every((name) => entity.hasComponent(name)),
        );
        return this._cachedResult;
    }

    changed(): Entity[] {
        return this.execute();
    }

    _invalidateCache(): void {
        this._cachedResult = null;
    }
}
