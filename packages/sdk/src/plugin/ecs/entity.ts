/**
 * Entity 実装
 */

import type { Entity } from './types';

export class EntityImpl implements Entity {
    readonly id: string;
    readonly _componentNames: Set<string> = new Set();

    private _components: Map<string, unknown> = new Map();

    constructor(id: string) {
        this.id = id;
    }

    getComponent<T = unknown>(name: string): T | null {
        const component = this._components.get(name);
        return (component as T) ?? null;
    }

    setComponent<T = unknown>(name: string, data: T): void {
        this._components.set(name, data);
        this._componentNames.add(name);
    }

    hasComponent(name: string): boolean {
        return this._components.has(name);
    }

    _reset(): void {
        this._components.clear();
        this._componentNames.clear();
    }

    _removeComponent(name: string): void {
        this._components.delete(name);
        this._componentNames.delete(name);
    }
}
