import type { PluginWorkerMessage } from '@ubichill/engine';
import {
    type FetchOptions,
    type FetchResult,
    PluginHostManager,
    type PluginHostManagerOptions,
} from '@ubichill/sandbox/host';
import type { PluginGuestCommand, PluginHostEvent } from '@ubichill/shared';
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
 * `onCursorUpdate` は Worker が `SCENE_UPDATE_CURSOR` を送信したときに呼ばれる。
 * プロトコルの型詳細（PluginGuestCommand）を直接扱う必要はない。
 * その他の未処理コマンドは `onCommand` で受け取る。
 */
export type PluginWorkerHandlers<TMsg extends PluginWorkerMessage = PluginWorkerMessage> = {
    onCursorUpdate?: (x: number, y: number) => void;
    onMessage?: (msg: TMsg) => void;
    onCommand?: (command: PluginGuestCommand) => void;
};

export type UsePluginWorkerOptions<TMsg extends PluginWorkerMessage = PluginWorkerMessage> = Omit<
    PluginHostManagerOptions<TMsg>,
    'handlers'
> & {
    handlers?: PluginWorkerHandlers<TMsg>;
};

export function usePluginWorker<TMsg extends PluginWorkerMessage = PluginWorkerMessage>(
    options: UsePluginWorkerOptions<TMsg>,
) {
    const managerRef = useRef<PluginHostManager<TMsg> | null>(null);

    const handlersRef = useRef<PluginWorkerHandlers<TMsg>>(options.handlers ?? {});
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);

    useEffect(() => {
        handlersRef.current = options.handlers ?? {};
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
            worldId: options.worldId,
            myUserId: options.myUserId,
            handlers: {
                onMessage: (msg) => handlersRef.current.onMessage?.(msg),
                onCommand: (cmd) => {
                    if (cmd.type === 'SCENE_UPDATE_CURSOR') {
                        handlersRef.current.onCursorUpdate?.(cmd.payload.x, cmd.payload.y);
                        return;
                    }
                    handlersRef.current.onCommand?.(cmd);
                },
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
        options.worldId,
        options.myUserId,
    ]);

    const sendEvent = useCallback((event: PluginHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    return { sendEvent };
}
