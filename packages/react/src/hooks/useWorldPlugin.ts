'use client';

import type { PluginWorkerMessage } from '@ubichill/engine';
import { PluginHostManager } from '@ubichill/sandbox/host';
import type { EntityPatchPayload, PluginHostEvent, WorldEntity } from '@ubichill/shared';
import { useCallback, useEffect, useRef } from 'react';
import type { PluginWorkerHandlers, UsePluginWorkerOptions } from '../usePluginWorker';
import { useWorld } from './useWorld';

/**
 * useWorldPlugin — usePluginWorker に World の entity 操作を自動配線したフック。
 *
 * onGetEntity / onCreateEntity / onUpdateEntity / onDestroyEntity は
 * useWorld() の実装に委譲されるため、呼び出し元で配線不要。
 *
 * UI 描画に特化したプラグインには usePluginWorker を直接使う。
 * ワールドの entity を操作するプラグインにはこちらを使う。
 */
export type UseWorldPluginOptions<TMsg extends PluginWorkerMessage = PluginWorkerMessage> = Omit<
    UsePluginWorkerOptions<TMsg>,
    'handlers'
> & {
    handlers?: Pick<PluginWorkerHandlers<TMsg>, 'onMessage' | 'onCommand' | 'onCursorUpdate'>;
};

export function useWorldPlugin<TMsg extends PluginWorkerMessage = PluginWorkerMessage>(
    options: UseWorldPluginOptions<TMsg>,
) {
    const { entities, createEntity, patchEntity, deleteEntity } = useWorld();
    const managerRef = useRef<PluginHostManager<TMsg> | null>(null);

    // Ref で最新の値を参照（Worker コールバックが stale closure にならないようにする）
    const entitiesRef = useRef(entities);
    entitiesRef.current = entities;
    const handlersRef = useRef<UseWorldPluginOptions<TMsg>['handlers']>(options.handlers);
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
        const manager = new PluginHostManager<TMsg>({
            pluginCode: options.pluginCode,
            pluginId: options.pluginId,
            capabilities: options.capabilities,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            worldId: options.worldId,
            myUserId: options.myUserId,
            handlers: {
                onGetEntity: (id: string) => entitiesRef.current.get(id),

                onCreateEntity: async (entity: Omit<WorldEntity, 'id'>) => {
                    const result = await createEntityRef.current(
                        entity.type,
                        entity.transform,
                        entity.data as Record<string, unknown>,
                    );
                    if (!result) throw new Error('[useWorldPlugin] エンティティの作成に失敗しました');
                    return result as WorldEntity;
                },

                onUpdateEntity: async (_id: string, entityPatch: EntityPatchPayload) => {
                    patchEntityRef.current(entityPatch.entityId, entityPatch.patch);
                },

                onDestroyEntity: async (id: string) => {
                    deleteEntityRef.current(id);
                },

                onMessage: (msg) => handlersRef.current?.onMessage?.(msg),

                onCommand: (cmd) => {
                    if (cmd.type === 'SCENE_UPDATE_CURSOR') {
                        handlersRef.current?.onCursorUpdate?.(cmd.payload.x, cmd.payload.y);
                        return;
                    }
                    handlersRef.current?.onCommand?.(cmd);
                },
            },
        });
        managerRef.current = manager;

        return () => {
            manager.destroy();
            managerRef.current = null;
        };
    }, [
        options.pluginCode,
        options.pluginId,
        options.capabilities,
        options.maxExecutionTime,
        options.tickFps,
        options.disableAutoTick,
        options.worldId,
        options.myUserId,
    ]);

    const sendEvent = useCallback((event: PluginHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    return { sendEvent };
}
