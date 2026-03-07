import type { PluginWorkerMessage } from '@ubichill/engine';
import {
    type FetchOptions,
    type FetchResult,
    type HostHandlers,
    PluginHostManager,
    type PluginHostManagerOptions,
} from '@ubichill/sandbox/host';
import type { PluginHostEvent } from '@ubichill/shared';
import { useCallback, useEffect, useRef } from 'react';

export { PluginHostManager, type FetchOptions, type FetchResult, type HostHandlers, type PluginHostManagerOptions };

export {
    createPluginFetchHandler,
    DEFAULT_ALLOWED_DOMAINS,
    DEMO_ALLOWED_DOMAINS,
    isUrlAllowed,
    PRODUCTION_ALLOWED_DOMAINS,
} from '@ubichill/sandbox/host';

export type UsePluginWorkerOptions<TMsg extends PluginWorkerMessage = PluginWorkerMessage> =
    PluginHostManagerOptions<TMsg>;

export function usePluginWorker<TMsg extends PluginWorkerMessage = PluginWorkerMessage>(
    options: UsePluginWorkerOptions<TMsg>,
) {
    const managerRef = useRef<PluginHostManager<TMsg> | null>(null);

    const handlersRef = useRef<HostHandlers<TMsg>>(options.handlers);
    const worldIdRef = useRef(options.worldId);
    const myUserIdRef = useRef(options.myUserId);
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);

    useEffect(() => {
        handlersRef.current = options.handlers;
    });
    useEffect(() => {
        worldIdRef.current = options.worldId;
        myUserIdRef.current = options.myUserId;
    });
    useEffect(() => {
        onResourceLimitExceededRef.current = options.onResourceLimitExceeded;
    });

    useEffect(() => {
        const manager = new PluginHostManager<TMsg>({
            pluginCode: options.pluginCode,
            pluginId: options.pluginId,
            capabilities: options.capabilities,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            worldId: worldIdRef.current,
            myUserId: myUserIdRef.current,
            handlers: {
                onGetEntity: (id) => handlersRef.current.onGetEntity?.(id),
                onCreateEntity: (entity) =>
                    handlersRef.current.onCreateEntity?.(entity) ?? Promise.resolve(undefined as never),
                onUpdateEntity: (id, patch) => handlersRef.current.onUpdateEntity?.(id, patch) ?? Promise.resolve(),
                onDestroyEntity: (id) => handlersRef.current.onDestroyEntity?.(id) ?? Promise.resolve(),
                onFetch: (url, opts) => handlersRef.current.onFetch?.(url, opts) ?? Promise.resolve(undefined as never),
                onMessage: (msg) => handlersRef.current.onMessage?.(msg),
                onCommand: (cmd) => handlersRef.current.onCommand?.(cmd),
            },
            onResourceLimitExceeded: (reason) => onResourceLimitExceededRef.current?.(reason),
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
    ]);

    const sendEvent = useCallback((event: PluginHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    return { sendEvent };
}
