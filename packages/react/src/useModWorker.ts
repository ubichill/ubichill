import { type HostHandlers, ModHostManager, type ModHostManagerOptions } from '@ubichill/sandbox';
import type {
    ComponentInstance,
    EntityPatchPayload,
    FetchOptions,
    FetchResult,
    ModGuestCommand,
    ModHostEvent,
    ModWorkerMessage,
    VNode,
} from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export {
    createModFetchHandler,
    DEFAULT_ALLOWED_DOMAINS,
    isUrlAllowed,
    PRODUCTION_ALLOWED_DOMAINS,
} from '@ubichill/sandbox';
export type { FetchOptions, FetchResult, ModHostManagerOptions };
export { ModHostManager };

/**
 * useModWorker に渡すハンドラ定義。
 *
 * `onMessage` は Worker が `Ubi.network.sendToHost()` で送信したメッセージを受け取る。
 * `onCommand` はその他の未処理コマンドを受け取る。
 */
export type ModWorkerHandlers<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    onMessage?: (msg: ModWorkerMessage<TPayloadMap>) => void;
    onReady?: () => void;
    onCommand?: (command: ModGuestCommand) => void;
    /** Worker が Ubi.ui.render() / Ubi.ui.unmount() を呼ぶたびに発火する */
    onRender?: (targetId: string, vnode: VNode | null) => void;
    /** Worker 起動時に Ubi.state から導出した Inspector 用スキーマを報告する */
    onEditorSchema?: (componentType: string, schema: Record<string, unknown>) => void;
    /** Worker が Ubi.canvas.frame() を呼んだときに発火する（毎フレーム） */
    onCanvasFrame?: (
        targetId: string,
        activeStroke: import('@ubichill/shared').CanvasStrokeData | null,
        cursors: import('@ubichill/shared').CanvasCursorData[],
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
    /** Worker が Ubi.media.setDeviceControl() を呼んだときに発火する */
    onMediaSetDeviceControl?: (targetId: string, enabled: boolean) => void;
    /** Worker が Ubi.world.getEntity(id) を呼んだときに発火する */
    onGetEntity?: (id: string) => import('@ubichill/shared').ComponentInstance | undefined;
    /** Worker が Ubi.world.queryEntities(type) を呼んだときに発火する */
    onQueryEntities?: (entityType: string) => import('@ubichill/shared').ComponentInstance[];
    /** Worker が Ubi.network.broadcast() で送ったデータを受信したときに発火する */
    onNetworkBroadcast?: (type: string, data: unknown) => void;
    /** Worker が Ubi.event.emit() を呼んだときに発火する。Host 側でクロス Worker ルーティングする。 */
    onEventEmit?: (
        type: string,
        data: unknown,
        scope: 'siblings' | 'parent' | 'children' | 'subtree' | 'world',
        targetType: string | undefined,
        senderComponentInstanceId: string | undefined,
    ) => void;
    /** Worker が Ubi.log() を呼んだときに発火する */
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
    /** Worker が Ubi.world.createEntity() を呼んだときに発火する */
    onCreateEntity?: (entity: Omit<ComponentInstance, 'id'>) => Promise<ComponentInstance | null>;
    /** Worker が Ubi.world.updateEntity() を呼んだときに発火する */
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    /** Worker が Ubi.world.destroyEntity() を呼んだときに発火する */
    onDestroyEntity?: (id: string) => Promise<void>;
    /** Worker が Ubi.grip.exclusive() の hold/release/setHover を呼んだときに発火する */
    onGripCommand?: (payload: import('@ubichill/shared').CmdGrip['payload']) => void;
    /** Worker が Ubi.network.fetch() を呼んだときに発火する */
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    /** Tick 送信直前に発火するパフォーマンスフック（setMetricHandler 登録時のみ） */
    onTickComplete?: (metric: import('@ubichill/sandbox').TickMetric) => void;
};

/**
 * HostHandlers に新しいハンドラーが追加されたとき、
 * ModWorkerHandlers に追加し忘れるとこの型が `never` になる。
 * @internal
 */
export type ModWorkerHandlerCoverageCheck =
    Exclude<keyof Required<HostHandlers>, keyof ModWorkerHandlers> extends never ? unknown : never;

export type UseModWorkerOptions<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = Omit<
    ModHostManagerOptions<TPayloadMap>,
    'handlers'
> & {
    handlers?: ModWorkerHandlers<TPayloadMap>;
    /**
     * false の間は Worker を生成・実行しない（コードのダウンロードは済んでいても実行しない）。
     * 権限承認が済むまで実行を遅延させるために使う。既定 true。
     */
    enabled?: boolean;
};

export function useModWorker<TPayloadMap extends Record<string, unknown> = Record<string, unknown>>(
    options: UseModWorkerOptions<TPayloadMap>,
) {
    const managerRef = useRef<ModHostManager<TPayloadMap> | null>(null);
    // Worker が再作成されるたびにインクリメント（watchEntityTypes の再実行トリガー）
    const [workerRevision, setWorkerRevision] = useState(0);

    const handlersRef = useRef<ModWorkerHandlers<TPayloadMap>>(options.handlers ?? {});
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);
    // authorizeCapability は識別子が変わっても Worker を作り直さないよう ref 経由で最新を読む。
    // on-demand モードにするかは「渡されているか」(hasAuthorize) だけで決める。
    const authorizeCapabilityRef = useRef(options.authorizeCapability);
    const hasAuthorize = !!options.authorizeCapability;
    const stableAuthorize = useCallback(
        (capability: string) => authorizeCapabilityRef.current?.(capability) ?? false,
        [],
    );

    useEffect(() => {
        handlersRef.current = options.handlers ?? {};
        onResourceLimitExceededRef.current = options.onResourceLimitExceeded;
        authorizeCapabilityRef.current = options.authorizeCapability;
    });

    // initialEntities は「Worker 起動時点のスナップショット」であって
    // deps の中に入れると entities 更新のたびに Worker が壊れて作り直される。
    // 最新の参照だけ ref に保持して、新しい Worker を作る瞬間に読み取る。
    const initialEntitiesRef = useRef(options.initialEntities);
    useEffect(() => {
        initialEntitiesRef.current = options.initialEntities;
    });

    useEffect(() => {
        // enabled=false の間は実行しない（承認待ち等）。ダウンロード済みコードは modCode に
        // 保持されているだけで、Worker 生成＝実行はここでしか起きない。
        if (options.enabled === false) return;
        const manager = new ModHostManager<TPayloadMap>({
            modCode: options.modCode,
            modId: options.modId,
            componentInstanceId: options.componentInstanceId,
            entityId: options.entityId,
            parentEntityId: options.parentEntityId,
            componentType: options.componentType,
            capabilities: options.capabilities,
            authorizeCapability: hasAuthorize ? stableAuthorize : undefined,
            maxExecutionTime: options.maxExecutionTime,
            tickFps: options.tickFps,
            disableAutoTick: options.disableAutoTick,
            disableAutoInput: options.disableAutoInput,
            worldId: options.worldId,
            myUserId: options.myUserId,
            modBase: options.modBase,
            watchEntityTypes: options.watchEntityTypes,
            initialEntities: initialEntitiesRef.current,
            handlers: {
                onMessage: (msg) => handlersRef.current.onMessage?.(msg),
                onReady: () => handlersRef.current.onReady?.(),
                onCommand: (cmd) => handlersRef.current.onCommand?.(cmd),
                onRender: (targetId, vnode) => handlersRef.current.onRender?.(targetId, vnode),
                onEditorSchema: (componentType, schema) => handlersRef.current.onEditorSchema?.(componentType, schema),
                onCanvasFrame: (targetId, activeStroke, cursors) =>
                    handlersRef.current.onCanvasFrame?.(targetId, activeStroke, cursors),
                onCanvasCommitStroke: (targetId, stroke) =>
                    handlersRef.current.onCanvasCommitStroke?.(targetId, stroke),
                onMediaLoad: (targetId, url, mediaType) => handlersRef.current.onMediaLoad?.(targetId, url, mediaType),
                onMediaPlay: (targetId) => handlersRef.current.onMediaPlay?.(targetId),
                onMediaPause: (targetId) => handlersRef.current.onMediaPause?.(targetId),
                onMediaSeek: (targetId, time) => handlersRef.current.onMediaSeek?.(targetId, time),
                onMediaSetVolume: (targetId, volume) => handlersRef.current.onMediaSetVolume?.(targetId, volume),
                onMediaDestroy: (targetId) => handlersRef.current.onMediaDestroy?.(targetId),
                onMediaSetVisible: (targetId, visible) => handlersRef.current.onMediaSetVisible?.(targetId, visible),
                onMediaSetDeviceControl: (targetId, enabled) =>
                    handlersRef.current.onMediaSetDeviceControl?.(targetId, enabled),
                onGripCommand: (payload) => handlersRef.current.onGripCommand?.(payload),
                onGetEntity: (id) => handlersRef.current.onGetEntity?.(id),
                onQueryEntities: (entityType) => handlersRef.current.onQueryEntities?.(entityType) ?? [],
                onNetworkBroadcast: (type, data) => handlersRef.current.onNetworkBroadcast?.(type, data),
                onEventEmit: (type, data, scope, targetType, senderId) =>
                    handlersRef.current.onEventEmit?.(type, data, scope, targetType, senderId),
                onLog: (level, message, prefix) => {
                    if (handlersRef.current.onLog) {
                        handlersRef.current.onLog(level, message);
                    } else {
                        console[level](`${prefix ?? '[ModSandbox]'} ${message}`);
                    }
                },
                onCreateEntity: async (entity) => {
                    const r = await (handlersRef.current.onCreateEntity?.(entity) ?? Promise.resolve(null));
                    if (!r) throw new Error('[useModWorker] createEntity failed');
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
        options.enabled,
        options.modCode,
        options.modId,
        options.componentInstanceId,
        options.entityId,
        options.parentEntityId,
        options.componentType,
        options.capabilities,
        hasAuthorize,
        stableAuthorize,
        options.maxExecutionTime,
        options.tickFps,
        options.disableAutoTick,
        options.disableAutoInput,
        options.worldId,
        options.myUserId,
        options.modBase,
        options.watchEntityTypes,
    ]);

    const sendEvent = useCallback((event: ModHostEvent) => {
        managerRef.current?.sendEvent(event);
    }, []);

    const sendEventWithTransfer = useCallback((event: ModHostEvent, transfer: Transferable[]) => {
        managerRef.current?.sendEventWithTransfer(event, transfer);
    }, []);

    const setScrollElement = useCallback((el: Element | null) => {
        managerRef.current?.setScrollElement(el);
    }, []);

    return { sendEvent, sendEventWithTransfer, workerRevision, setScrollElement };
}
