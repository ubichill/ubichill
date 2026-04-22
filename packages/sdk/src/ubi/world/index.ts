import type { EntityPatchPayload, WorldEntity } from '@ubichill/shared';
import type { RpcFn, SendFn } from '../types';

export type WorldModule = {
    getEntity(id: string): Promise<WorldEntity | null>;
    createEntity(entity: Omit<WorldEntity, 'id'>): Promise<string>;
    updateEntity(id: string, patch: EntityPatchPayload['patch']): Promise<void>;
    destroyEntity(id: string): Promise<void>;
    queryEntities(entityType: string): Promise<WorldEntity[]>;
    subscribeEntity(id: string): void;
    unsubscribeEntity(id: string): void;
};

export function createWorldModule(send: SendFn, rpc: RpcFn): WorldModule {
    return {
        getEntity: (id) => rpc({ type: 'SCENE_GET_ENTITY', payload: { id } }),
        createEntity: (entity) => rpc({ type: 'SCENE_CREATE_ENTITY', payload: { entity } }),
        updateEntity: (id, patch) =>
            rpc({ type: 'SCENE_UPDATE_ENTITY', payload: { id, patch: { entityId: id, patch } } }),
        destroyEntity: (id) => rpc({ type: 'SCENE_DESTROY_ENTITY', payload: { id } }),
        queryEntities: (entityType) => rpc({ type: 'SCENE_QUERY_ENTITIES', payload: { entityType } }),
        subscribeEntity: (id) => send({ type: 'SCENE_SUBSCRIBE_ENTITY', payload: { id } }),
        unsubscribeEntity: (id) => send({ type: 'SCENE_UNSUBSCRIBE_ENTITY', payload: { id } }),
    };
}
