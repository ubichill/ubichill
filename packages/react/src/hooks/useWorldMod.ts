import { ModHostManager } from '@ubichill/sandbox';
import type { ComponentInstance, EntityPatchPayload, ModHostEvent } from '@ubichill/shared';
import { useCallback, useEffect, useRef } from 'react';
import type { ModWorkerHandlers, UseModWorkerOptions } from '../useModWorker';
import { useWorld } from './useWorld';

/**
 * useWorldMod — useModWorker に World の entity 操作を自動配線したフック。
 *
 * onGetEntity / onCreateEntity / onUpdateEntity / onDestroyEntity は
 * useWorld() の実装に委譲されるため、呼び出し元で配線不要。
 *
 * UI 描画に特化したmodには useModWorker を直接使う。
 * ワールドの entity を操作するmodにはこちらを使う。
 */
export type UseWorldModOptions<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = Omit<
    UseModWorkerOptions<TPayloadMap>,
    'handlers'
> & {
    handlers?: Pick<ModWorkerHandlers<TPayloadMap>, 'onMessage' | 'onCommand'>;
};

export function useWorldMod<TPayloadMap extends Record<string, unknown> = Record<string, unknown>>(
    options: UseWorldModOptions<TPayloadMap>,
) {
    const { entities, createEntity, patchEntity, deleteEntity } = useWorld();
    const managerRef = useRef<ModHostManager<TPayloadMap> | null>(null);

    const entitiesRef = useRef(entities);
    entitiesRef.current = entities;
    const handlersRef = useRef<UseWorldModOptions<TPayloadMap>['handlers']>(options.handlers);
    const createEntityRef = useRef(createEntity);
    const patchEntityRef = useRef(patchEntity);
    const deleteEntityRef = useRef(deleteEntity);

    useEffect(() => {
        handlersRef.current = options.handlers;
    });
    useEffect(() => {
        createEntityRef.current = createEntity;
        patchEntityRef.current = patchEntity;
        deleteEntityRef.current = deleteEntity;
    });

    useEffect(() => {
        const manager = new ModHostManager<TPayloadMap>({
            modCode: options.modCode,
            modId: options.modId,
            capabilities: options.capabilities,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            disableAutoInput: options.disableAutoInput,
            worldId: options.worldId,
            myUserId: options.myUserId,
            handlers: {
                onGetEntity: (id: string) => entitiesRef.current.get(id),

                onCreateEntity: async (entity: Omit<ComponentInstance, 'id'>) => {
                    const result = await createEntityRef.current(
                        entity.type,
                        entity.transform,
                        entity.data as Record<string, unknown>,
                    );
                    if (!result) throw new Error('[useWorldMod] エンティティの作成に失敗しました');
                    return result as ComponentInstance;
                },

                onUpdateEntity: async (_id: string, entityPatch: EntityPatchPayload) => {
                    patchEntityRef.current(entityPatch.entityId, entityPatch.patch);
                },

                onDestroyEntity: async (id: string) => {
                    deleteEntityRef.current(id);
                },

                onMessage: (msg) => handlersRef.current?.onMessage?.(msg),
                onCommand: (cmd) => handlersRef.current?.onCommand?.(cmd),
            },
        });
        managerRef.current = manager;

        return () => {
            manager.destroy();
            managerRef.current = null;
        };
    }, [
        options.modCode,
        options.modId,
        options.capabilities,
        options.maxExecutionTime,
        options.tickFps,
        options.disableAutoTick,
        options.disableAutoInput,
        options.worldId,
        options.myUserId,
    ]);

    const sendEvent = useCallback((event: ModHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    return { sendEvent };
}
