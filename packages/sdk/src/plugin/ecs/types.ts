/**
 * Ubichill ECS (Entity Component System)
 */

export interface ComponentDefinition<T = unknown> {
    readonly name: string;
    readonly default: T;
}

export interface Entity {
    readonly id: string;

    getComponent<T = unknown>(name: string): T | null;
    setComponent<T = unknown>(name: string, data: T): void;
    hasComponent(name: string): boolean;

    readonly _componentNames: Set<string>;
}

export type System = (
    entities: Entity[],
    deltaTime: number,
    events: WorkerEvent[],
) => void;

export interface Query {
    execute(): Entity[];
    changed(): Entity[];
}

export interface EcsWorld {
    registerSystem(system: System): void;
    createEntity(id: string): Entity;
    getEntity(id: string): Entity | null;
    query(componentNames: string[]): Query;
    tick(deltaTime: number, events?: WorkerEvent[]): void;
    dispatch(event: WorkerEvent): void;
    clear(): void;
}

export interface WorkerEvent {
    type: string;
    entityId?: string;
    payload?: unknown;
    timestamp?: number;
}
