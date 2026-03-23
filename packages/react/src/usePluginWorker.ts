import {
    type FetchOptions,
    type FetchResult,
    PluginHostManager,
    type PluginHostManagerOptions,
} from '@ubichill/sandbox/host';
import type { PluginGuestCommand, PluginHostEvent, PluginWorkerMessage } from '@ubichill/shared';
import { useCallback, useEffect, useRef } from 'react';

export { PluginHostManager, type FetchOptions, type FetchResult, type PluginHostManagerOptions };

export {
    createPluginFetchHandler,
    DEFAULT_ALLOWED_DOMAINS,
    DEMO_ALLOWED_DOMAINS,
    isUrlAllowed,
    PRODUCTION_ALLOWED_DOMAINS,
} from '@ubichill/sandbox/host';

/**
 * usePluginWorker に渡すハンドラ定義。
 *
 * `onMessage` は Worker が `Ubi.network.sendToHost()` で送信したメッセージを受け取る。
 * `onCommand` はその他の未処理コマンドを受け取る。
 */
export type PluginWorkerHandlers<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    onMessage?: (msg: PluginWorkerMessage<TPayloadMap>) => void;
    onCommand?: (command: PluginGuestCommand) => void;
};

export type UsePluginWorkerOptions<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = Omit<
    PluginHostManagerOptions<TPayloadMap>,
    'handlers'
> & {
    handlers?: PluginWorkerHandlers<TPayloadMap>;
};

export function usePluginWorker<TPayloadMap extends Record<string, unknown> = Record<string, unknown>>(
    options: UsePluginWorkerOptions<TPayloadMap>,
) {
    const managerRef = useRef<PluginHostManager<TPayloadMap> | null>(null);

    const handlersRef = useRef<PluginWorkerHandlers<TPayloadMap>>(options.handlers ?? {});
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);

    useEffect(() => {
        handlersRef.current = options.handlers ?? {};
    });
    useEffect(() => {
        onResourceLimitExceededRef.current = options.onResourceLimitExceeded;
    });

    useEffect(() => {
        const manager = new PluginHostManager<TPayloadMap>({
            pluginCode: options.pluginCode,
            pluginId: options.pluginId,
            capabilities: options.capabilities,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            disableAutoInput: options.disableAutoInput,
            worldId: options.worldId,
            myUserId: options.myUserId,
            handlers: {
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
        options.disableAutoInput,
        options.worldId,
        options.myUserId,
    ]);

    const sendEvent = useCallback((event: PluginHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    return { sendEvent };
}
