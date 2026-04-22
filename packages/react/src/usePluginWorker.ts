import { type HostHandlers, PluginHostManager, type PluginHostManagerOptions } from '@ubichill/sandbox';
import type {
    EntityPatchPayload,
    FetchOptions,
    FetchResult,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
    VNode,
    WorldEntity,
} from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export { PluginHostManager };
export type { FetchOptions, FetchResult, PluginHostManagerOptions };

export {
    createPluginFetchHandler,
    DEFAULT_ALLOWED_DOMAINS,
    isUrlAllowed,
    PRODUCTION_ALLOWED_DOMAINS,
} from '@ubichill/sandbox';

/**
 * usePluginWorker に渡すハンドラ定義。
 *
 * `onMessage` は Worker が `Ubi.network.sendToHost()` で送信したメッセージを受け取る。
 * `onCommand` はその他の未処理コマンドを受け取る。
 */
export type PluginWorkerHandlers<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    onMessage?: (msg: PluginWorkerMessage<TPayloadMap>) => void;
    onCommand?: (command: PluginGuestCommand) => void;
    /** Worker が Ubi.ui.render() / Ubi.ui.unmount() を呼ぶたびに発火する */
    onRender?: (targetId: string, vnode: VNode | null) => void;
    /** Worker が Ubi.canvas.frame() を呼んだときに発火する（毎フレーム） */
    onCanvasFrame?: (
        targetId: string,
        activeStroke: import('@ubichill/shared').CanvasStrokeData | null,
        cursor: import('@ubichill/shared').CanvasCursorData | null,
    ) => void;
    /** Worker が Ubi.canvas.commitStroke() を呼んだときに発火する */
    onCanvasCommitStroke?: (targetId: string, stroke: import('@ubichill/shared').CanvasStrokeData) => void;
    /** Worker が Ubi.media.load() を呼んだときに発火する */
    onMediaLoad?: (targetId: string, url: string, mediaType?: 'hls' | 'video' | 'auto') => void;
    /** Worker が Ubi.media.play() を呼んだときに発火する */
    onMediaPlay?: (targetId: string) => void;
    /** Worker が Ubi.media.pause() を呼んだときに発火する */
    onMediaPause?: (targetId: string) => void;
    /** Worker が Ubi.media.seek() を呼んだときに発火する */
    onMediaSeek?: (targetId: string, time: number) => void;
    /** Worker が Ubi.media.setVolume() を呼んだときに発火する */
    onMediaSetVolume?: (targetId: string, volume: number) => void;
    /** Worker が Ubi.media.destroy() を呼んだときに発火する */
    onMediaDestroy?: (targetId: string) => void;
    /** Worker が Ubi.media.setVisible() を呼んだときに発火する */
    onMediaSetVisible?: (targetId: string, visible: boolean) => void;
    /** Worker が Ubi.world.getEntity(id) を呼んだときに発火する */
    onGetEntity?: (id: string) => import('@ubichill/shared').WorldEntity | undefined;
    /** Worker が Ubi.world.queryEntities(type) を呼んだときに発火する */
    onQueryEntities?: (entityType: string) => import('@ubichill/shared').WorldEntity[];
    /** Worker が Ubi.network.broadcast() で送ったデータを受信したときに発火する */
    onNetworkBroadcast?: (type: string, data: unknown) => void;
    /** Worker が Ubi.log() を呼んだときに発火する */
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
    /** Worker が Ubi.world.createEntity() を呼んだときに発火する */
    onCreateEntity?: (entity: Omit<WorldEntity, 'id'>) => Promise<WorldEntity | null>;
    /** Worker が Ubi.world.updateEntity() を呼んだときに発火する */
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    /** Worker が Ubi.world.destroyEntity() を呼んだときに発火する */
    onDestroyEntity?: (id: string) => Promise<void>;
    /** Worker が Ubi.network.fetch() を呼んだときに発火する */
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    /** Tick 送信直前に発火するパフォーマンスフック（setMetricHandler 登録時のみ） */
    onTickComplete?: (metric: import('@ubichill/sandbox').TickMetric) => void;
};

/**
 * HostHandlers に新しいハンドラーが追加されたとき、
 * PluginWorkerHandlers に追加し忘れるとこの型が `never` になる。
 * @internal
 */
export type PluginWorkerHandlerCoverageCheck =
    Exclude<keyof Required<HostHandlers>, keyof PluginWorkerHandlers> extends never ? unknown : never;

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
    // Worker が再作成されるたびにインクリメント（watchEntityTypes の再実行トリガー）
    const [workerRevision, setWorkerRevision] = useState(0);

    const handlersRef = useRef<PluginWorkerHandlers<TPayloadMap>>(options.handlers ?? {});
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);

    useEffect(() => {
        handlersRef.current = options.handlers ?? {};
        onResourceLimitExceededRef.current = options.onResourceLimitExceeded;
    });

    // initialEntities は「Worker 起動時点のスナップショット」であって
    // deps の中に入れると entities 更新のたびに Worker が壊れて作り直される。
    // 最新の参照だけ ref に保持して、新しい Worker を作る瞬間に読み取る。
    const initialEntitiesRef = useRef(options.initialEntities);
    useEffect(() => {
        initialEntitiesRef.current = options.initialEntities;
    });

    useEffect(() => {
        const manager = new PluginHostManager<TPayloadMap>({
            pluginCode: options.pluginCode,
            pluginId: options.pluginId,
            entityId: options.entityId,
            capabilities: options.capabilities,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            disableAutoInput: options.disableAutoInput,
            worldId: options.worldId,
            myUserId: options.myUserId,
            pluginBase: options.pluginBase,
            watchEntityTypes: options.watchEntityTypes,
            initialEntities: initialEntitiesRef.current,
            handlers: {
                onMessage: (msg) => handlersRef.current.onMessage?.(msg),
                onCommand: (cmd) => handlersRef.current.onCommand?.(cmd),
                onRender: (targetId, vnode) => handlersRef.current.onRender?.(targetId, vnode),
                onCanvasFrame: (targetId, activeStroke, cursor) =>
                    handlersRef.current.onCanvasFrame?.(targetId, activeStroke, cursor),
                onCanvasCommitStroke: (targetId, stroke) =>
                    handlersRef.current.onCanvasCommitStroke?.(targetId, stroke),
                onMediaLoad: (targetId, url, mediaType) => handlersRef.current.onMediaLoad?.(targetId, url, mediaType),
                onMediaPlay: (targetId) => handlersRef.current.onMediaPlay?.(targetId),
                onMediaPause: (targetId) => handlersRef.current.onMediaPause?.(targetId),
                onMediaSeek: (targetId, time) => handlersRef.current.onMediaSeek?.(targetId, time),
                onMediaSetVolume: (targetId, volume) => handlersRef.current.onMediaSetVolume?.(targetId, volume),
                onMediaDestroy: (targetId) => handlersRef.current.onMediaDestroy?.(targetId),
                onMediaSetVisible: (targetId, visible) => handlersRef.current.onMediaSetVisible?.(targetId, visible),
                onGetEntity: (id) => handlersRef.current.onGetEntity?.(id),
                onQueryEntities: (entityType) => handlersRef.current.onQueryEntities?.(entityType) ?? [],
                onNetworkBroadcast: (type, data) => handlersRef.current.onNetworkBroadcast?.(type, data),
                onLog: (level, message, prefix) => {
                    if (handlersRef.current.onLog) {
                        handlersRef.current.onLog(level, message);
                    } else {
                        console[level](`${prefix ?? '[PluginSandbox]'} ${message}`);
                    }
                },
                onCreateEntity: async (entity) => {
                    const r = await (handlersRef.current.onCreateEntity?.(entity) ?? Promise.resolve(null));
                    if (!r) throw new Error('[usePluginWorker] createEntity failed');
                    return r;
                },
                onUpdateEntity: (id, patch) => handlersRef.current.onUpdateEntity?.(id, patch) ?? Promise.resolve(),
                onDestroyEntity: (id) => handlersRef.current.onDestroyEntity?.(id) ?? Promise.resolve(),
                onFetch: (url, options) =>
                    handlersRef.current.onFetch?.(url, options) ??
                    Promise.resolve({ ok: false, status: 403, statusText: 'Forbidden', headers: {}, body: '' }),
                onTickComplete: (metric) => handlersRef.current.onTickComplete?.(metric),
            },
            onResourceLimitExceeded: (reason) => onResourceLimitExceededRef.current?.(reason),
        });
        managerRef.current = manager;
        setWorkerRevision((r) => r + 1);

        return () => {
            manager.destroy();
            managerRef.current = null;
        };
    }, [
        options.pluginCode,
        options.pluginId,
        options.entityId,
        options.capabilities,
        options.maxExecutionTime,
        options.tickFps,
        options.disableAutoTick,
        options.disableAutoInput,
        options.worldId,
        options.myUserId,
        options.pluginBase,
        options.watchEntityTypes,
    ]);

    const sendEvent = useCallback((event: PluginHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    const sendEventWithTransfer = useCallback((event: PluginHostEvent, transfer: Transferable[]) => {
        managerRef.current?.sendEventWithTransfer(event, transfer);
    }, []);

    const setScrollElement = useCallback((el: Element | null) => {
        managerRef.current?.setScrollElement(el);
    }, []);

    return { sendEvent, sendEventWithTransfer, workerRevision, setScrollElement };
}
