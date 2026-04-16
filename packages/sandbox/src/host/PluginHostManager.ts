/**
 * PluginHostManager — React 非依存のコアクラス。
 *
 * プラグイン Sandbox Worker のライフサイクル・TICK ループ・メッセージ処理を管理する。
 * ブラウザ（Web Worker ホスト）前提で動作し、React に依存しない。
 *
 * React 環境では @ubichill/react の usePluginWorker 経由で使用することを推奨。
 */

import type {
    EntityPatchPayload,
    FetchOptions,
    FetchResult,
    InputFrameEvent,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
    VNode,
    WorldEntity,
} from '@ubichill/shared';
import { InputCollector } from './InputCollector';
import { isMetricEnabled, reportDiagnostic, reportMetric } from './pluginDiagnostics';

// ============================================================
// Capability 定義
// ============================================================

export const CAPABILITY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    'scene:read': ['SCENE_GET_ENTITY', 'SCENE_QUERY_ENTITIES'],
    'scene:update': [
        'SCENE_CREATE_ENTITY',
        'SCENE_UPDATE_ENTITY',
        'SCENE_DESTROY_ENTITY',
        'SCENE_SUBSCRIBE_ENTITY',
        'SCENE_UNSUBSCRIBE_ENTITY',
    ],
    'net:fetch': ['NET_FETCH'],
    'net:broadcast': ['NETWORK_BROADCAST'],
    'net:host-message': ['NETWORK_SEND_TO_HOST'],
    'ui:toast': ['UI_SHOW_TOAST'],
    'ui:render': ['UI_RENDER'],
    'avatar:set': ['AVATAR_SET'],
    'canvas:draw': ['CANVAS_FRAME', 'CANVAS_COMMIT_STROKE'],
    'video:control': [
        'MEDIA_LOAD',
        'MEDIA_PLAY',
        'MEDIA_PAUSE',
        'MEDIA_SEEK',
        'MEDIA_SET_VOLUME',
        'MEDIA_DESTROY',
        'MEDIA_SET_VISIBLE',
    ],
};

// ============================================================
// コマンド → ハンドラー対応マップ（未接続検知用）
// ============================================================

/**
 * Worker コマンドとそれを処理する HostHandlers のキーの対応。
 * HostHandlers に新しいハンドラーを追加したらここにも追記する。
 */
const CMD_TO_HANDLER = {
    SCENE_GET_ENTITY: 'onGetEntity',
    SCENE_QUERY_ENTITIES: 'onQueryEntities',
    SCENE_CREATE_ENTITY: 'onCreateEntity',
    SCENE_UPDATE_ENTITY: 'onUpdateEntity',
    SCENE_DESTROY_ENTITY: 'onDestroyEntity',
    NET_FETCH: 'onFetch',
    NETWORK_SEND_TO_HOST: 'onMessage',
    NETWORK_BROADCAST: 'onNetworkBroadcast',
    UI_RENDER: 'onRender',
    CANVAS_FRAME: 'onCanvasFrame',
    CANVAS_COMMIT_STROKE: 'onCanvasCommitStroke',
    MEDIA_LOAD: 'onMediaLoad',
    MEDIA_PLAY: 'onMediaPlay',
    MEDIA_PAUSE: 'onMediaPause',
    MEDIA_SEEK: 'onMediaSeek',
    MEDIA_SET_VOLUME: 'onMediaSetVolume',
    MEDIA_DESTROY: 'onMediaDestroy',
    MEDIA_SET_VISIBLE: 'onMediaSetVisible',
} as const satisfies Partial<Record<string, keyof HostHandlers>>;

// ============================================================
// 型定義
// ============================================================

export type { FetchOptions, FetchResult } from '@ubichill/shared';

export type HostHandlers<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    onGetEntity?: (id: string) => WorldEntity | undefined;
    onQueryEntities?: (entityType: string) => WorldEntity[];
    onCreateEntity?: (entity: Omit<WorldEntity, 'id'>) => Promise<WorldEntity>;
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    onDestroyEntity?: (id: string) => Promise<void>;
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    onMessage?: (msg: PluginWorkerMessage<TPayloadMap>) => void;
    onNetworkBroadcast?: (type: string, data: unknown) => void;
    onCommand?: (command: PluginGuestCommand) => void;
    /**
     * Worker が Ubi.ui.render() を呼ぶたびに発火する。
     * vnode が null の場合はアンマウント（Ubi.ui.unmount()）。
     * VNodeRenderer で実 DOM に変換して描画する。
     */
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
    /**
     * Worker が Ubi.log() を呼んだときに発火する。
     * デフォルト実装は PluginHostManager が console[level] で出力する。
     * オーバーライドして UI パネルに表示することも可能。
     */
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, pluginId?: string) => void;
    /**
     * Tick 送信直前に発火するパフォーマンスフック（setMetricHandler が登録済みの場合のみ）。
     * deltaMs: rAF の実フレーム間隔。commandProcessingMs: 前Tickのホスト側コマンド処理累積時間。
     */
    onTickComplete?: (metric: import('./pluginDiagnostics').TickMetric) => void;
};

/**
 * スタティックレジストリに記録されるWorker情報。
 * `PluginHostManager.registry` から取得できる。
 */
export interface PluginWorkerInfo {
    readonly pluginId: string;
    readonly entityId: string | undefined;
    readonly startedAt: number;
}

export interface PluginHostManagerOptions<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> {
    pluginCode: string;
    worldId?: string;
    myUserId?: string;
    pluginId?: string;
    /** このプラグインを起動したエンティティのID（Worker で Ubi.entityId として参照可能） */
    entityId?: string;
    handlers: HostHandlers<TPayloadMap>;
    capabilities?: string[];
    maxExecutionTime?: number;
    onResourceLimitExceeded?: (reason: string) => void;
    tickFps?: number;
    disableAutoTick?: boolean;
    /** DOM 入力（マウス・キーボード）の自動収集を無効化する（デフォルト: false = 有効） */
    disableAutoInput?: boolean;
}

// ============================================================
// PluginHostManager
// ============================================================

export class PluginHostManager<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> {
    // ============================================================
    // スタティック定数
    // ============================================================
    /** 非同期 RPC のタイムアウト (ms)。超過すると RPC エラーとして Worker に返す */
    static RPC_TIMEOUT_MS = 10_000;
    /** eventQueue の最大保持数。超過した場合は古いイベントを破棄する */
    static MAX_QUEUE_SIZE = 100;

    // ============================================================
    // スタティックレジストリ — アクティブWorkerの一覧と総数を外部から取得できる
    // ============================================================
    private static readonly _registry = new Map<string, PluginWorkerInfo>();
    private static _sharedInputCollector: InputCollector | null = null;
    private static _sharedInputRefCount = 0;
    private static readonly _sharedInputCursor = new Map<string, number>();
    private static readonly _sharedScrollElementByInstance = new Map<string, Element | null>();

    private static _acquireSharedInput(instanceKey: string): void {
        if (!PluginHostManager._sharedInputCollector) {
            PluginHostManager._sharedInputCollector = new InputCollector();
        }
        PluginHostManager._sharedInputRefCount += 1;
        PluginHostManager._sharedInputCursor.set(instanceKey, 0);
        PluginHostManager._sharedScrollElementByInstance.set(instanceKey, null);
    }

    private static _releaseSharedInput(instanceKey: string): void {
        PluginHostManager._sharedInputCursor.delete(instanceKey);
        PluginHostManager._sharedScrollElementByInstance.delete(instanceKey);
        PluginHostManager._applySharedScrollElement();

        PluginHostManager._sharedInputRefCount = Math.max(0, PluginHostManager._sharedInputRefCount - 1);
        if (PluginHostManager._sharedInputRefCount === 0) {
            PluginHostManager._sharedInputCollector?.destroy();
            PluginHostManager._sharedInputCollector = null;
            PluginHostManager._sharedInputCursor.clear();
            PluginHostManager._sharedScrollElementByInstance.clear();
        }
    }

    private static _applySharedScrollElement(): void {
        const collector = PluginHostManager._sharedInputCollector;
        if (!collector) return;

        let scrollElement: Element | null = null;
        for (const candidate of PluginHostManager._sharedScrollElementByInstance.values()) {
            if (candidate) {
                scrollElement = candidate;
                break;
            }
        }
        collector.setScrollElement(scrollElement);
    }

    private static _setSharedScrollElement(instanceKey: string, el: Element | null): void {
        if (!PluginHostManager._sharedInputCollector) return;
        PluginHostManager._sharedScrollElementByInstance.set(instanceKey, el);
        PluginHostManager._applySharedScrollElement();
    }

    private static _collectSharedInputFor(instanceKey: string): InputFrameEvent[] {
        const collector = PluginHostManager._sharedInputCollector;
        if (!collector) return [];

        const lastSeq = PluginHostManager._sharedInputCursor.get(instanceKey) ?? 0;
        const { events, lastSeq: nextSeq } = collector.collectSince(lastSeq);
        PluginHostManager._sharedInputCursor.set(instanceKey, nextSeq);

        let minSeq = Number.POSITIVE_INFINITY;
        for (const seq of PluginHostManager._sharedInputCursor.values()) {
            if (seq < minSeq) minSeq = seq;
        }
        if (Number.isFinite(minSeq)) {
            collector.pruneEventsBefore(minSeq);
        }

        return events;
    }

    /** アクティブな全WorkerのInfo。読み取り専用。 */
    static get registry(): ReadonlyMap<string, PluginWorkerInfo> {
        return PluginHostManager._registry;
    }

    /** アクティブWorker総数 */
    static get activeWorkerCount(): number {
        return PluginHostManager._registry.size;
    }

    /**
     * テスト用: スタティックレジストリをリセットする。
     * テスト間でのレジストリ汚染を防ぐために使用する。
     * プロダクションコードから呼び出してはいけない。
     * @internal
     */
    static _resetForTests(): void {
        PluginHostManager._registry.clear();
    }

    // ============================================================
    // インスタンスフィールド
    // ============================================================
    private worker: Worker;
    private handlers: HostHandlers<TPayloadMap>;
    private executionTimer: ReturnType<typeof setTimeout> | null = null;
    private onResourceLimitExceeded?: (reason: string) => void;
    private isInitialized = false;
    private eventQueue: PluginHostEvent[] = [];
    private allowedCommands: Set<string> | null;
    private readonly _logPrefix: string;
    private readonly _pluginId: string;
    private readonly _instanceKey: string;
    /** 現Tickにホスト側でコマンド処理に要した累積時間 (ms) */
    private _currentTickCommandMs = 0;

    private animationFrameId?: number;
    private intervalId?: ReturnType<typeof setInterval>;
    private lastTime = performance.now();
    private readonly intervalMs: number;
    private readonly tickEnabled: boolean;
    private readonly _autoInputEnabled: boolean;

    // Arrow fields: bind 済みのため毎フレーム bind() しない（GC ゼロ）
    private readonly _animate = (time: number): void => {
        const deltaTime = time - this.lastTime;
        this.lastTime = time;

        // メトリクスが有効なときのみ計測・通知
        if (isMetricEnabled()) {
            const metric = {
                pluginId: this._pluginId,
                entityId: PluginHostManager._registry.get(this._instanceKey)?.entityId,
                deltaMs: deltaTime,
                commandProcessingMs: this._currentTickCommandMs,
                activeWorkerCount: PluginHostManager.activeWorkerCount,
                timestamp: performance.now(),
            };
            reportMetric(metric);
            this.handlers.onTickComplete?.(metric);
        }
        this._currentTickCommandMs = 0;

        this._sendTick(deltaTime);
        this.animationFrameId = requestAnimationFrame(this._animate);
    };

    private readonly _intervalTick = (): void => {
        const now = performance.now();
        this._sendTick(now - this.lastTime);
        this.lastTime = now;
    };

    private readonly _onVisibilityChange = (): void => {
        this.lastTime = performance.now();
        if (!document.hidden) {
            if (this.intervalId !== undefined) {
                clearInterval(this.intervalId);
                this.intervalId = undefined;
            }
            this.animationFrameId = requestAnimationFrame(this._animate);
        } else {
            if (this.animationFrameId !== undefined) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = undefined;
            }
            this.intervalId = setInterval(this._intervalTick, this.intervalMs);
        }
    };

    constructor(options: PluginHostManagerOptions<TPayloadMap>) {
        this.handlers = options.handlers;
        this.onResourceLimitExceeded = options.onResourceLimitExceeded;
        this._pluginId = options.pluginId ?? 'unknown';
        this._logPrefix = options.pluginId ? `[PluginSandbox:${options.pluginId}]` : '[PluginSandbox]';
        this._instanceKey = `${this._pluginId}:${performance.now().toFixed(3)}:${Math.random().toString(36).slice(2)}`;
        PluginHostManager._registry.set(this._instanceKey, {
            pluginId: this._pluginId,
            entityId: options.entityId,
            startedAt: performance.now(),
        });

        if (options.capabilities) {
            this.allowedCommands = new Set(['CMD_LOG']);
            for (const cap of options.capabilities) {
                for (const cmd of CAPABILITY_COMMANDS[cap] ?? []) {
                    this.allowedCommands.add(cmd);
                }
            }
        } else {
            this.allowedCommands = null;
        }

        const fps = options.tickFps ?? 60;
        this.intervalMs = fps > 0 ? 1000 / fps : 0;
        this.tickEnabled = !options.disableAutoTick && fps > 0;
        this._autoInputEnabled = this.tickEnabled && !options.disableAutoInput;

        const maxExecutionTime = options.maxExecutionTime ?? 0;

        // Vite の Worker 検出は new Worker(new URL(...)) の形式でないと機能しない
        // 変数に分離すると .ts がそのままアセットとして data:video/mp2t で埋め込まれてしまう
        this.worker = new Worker(new URL('../guest/sandbox.worker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', (e: MessageEvent<PluginGuestCommand>) => {
            if (e.data.type === 'CMD_READY') {
                this.isInitialized = true;
                for (const event of this.eventQueue) {
                    this.worker.postMessage(event);
                }
                this.eventQueue = [];
                return;
            }
            void this._handleCommand(e);
        });

        this.worker.onerror = (e) => {
            console.error(`${this._logPrefix} Worker エラー:`, e);
        };

        if (maxExecutionTime > 0) {
            this.executionTimer = setTimeout(() => {
                this._terminateWithReason(`最大実行時間 (${maxExecutionTime}ms) を超過しました`);
            }, maxExecutionTime);
        }

        // EVT_LIFECYCLE_INIT は直接送信（キュー非経由: deadlock防止）
        this.worker.postMessage({
            type: 'EVT_LIFECYCLE_INIT',
            payload: {
                code: options.pluginCode,
                worldId: options.worldId ?? '',
                myUserId: options.myUserId ?? '',
                pluginId: options.pluginId,
                entityId: options.entityId,
            },
        });

        if (this.tickEnabled) {
            this._startTickLoop();
        }

        if (this._autoInputEnabled) {
            PluginHostManager._acquireSharedInput(this._instanceKey);
        }
    }

    static async fromUrl<TPayloadMap extends Record<string, unknown> = Record<string, unknown>>(
        url: string,
        options: Omit<PluginHostManagerOptions<TPayloadMap>, 'pluginCode'>,
    ): Promise<PluginHostManager<TPayloadMap>> {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`[PluginHostManager] プラグインコードの取得に失敗: ${res.status} ${url}`);
        }
        return new PluginHostManager<TPayloadMap>({ ...options, pluginCode: await res.text() });
    }

    private _startTickLoop(): void {
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        if (!document.hidden) {
            this.animationFrameId = requestAnimationFrame(this._animate);
        } else {
            this.intervalId = setInterval(this._intervalTick, this.intervalMs);
        }
    }

    private _sendTick(deltaTime: number): void {
        if (this.isInitialized) {
            // 入力イベントを Tick より先に送信（UbiSDK 側でキューに積まれ、同 Tick で処理される）
            if (this._autoInputEnabled) {
                const inputEvents = PluginHostManager._collectSharedInputFor(this._instanceKey);
                if (inputEvents.length > 0) {
                    this.sendEvent({ type: 'EVT_INPUT', payload: { events: inputEvents } });
                }
            }
            this.sendEvent({ type: 'EVT_LIFECYCLE_TICK', payload: { deltaTime } });
        }
    }

    private _terminateWithReason(reason: string): void {
        console.warn(`${this._logPrefix} リソース制限超過: ${reason}`);
        this.onResourceLimitExceeded?.(reason);
        this.destroy();
    }

    /**
     * Promise にタイムアウトを付加する。
     * RPC_TIMEOUT_MS 以内に解決しない場合は reject する。
     */
    private _withTimeout<T>(promise: Promise<T>, cmdType: string): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error(`RPC タイムアウト (${PluginHostManager.RPC_TIMEOUT_MS}ms): ${cmdType}`)),
                    PluginHostManager.RPC_TIMEOUT_MS,
                ),
            ),
        ]);
    }

    private _isCommandAllowed(type: string): boolean {
        if (this.allowedCommands === null) return true;
        return this.allowedCommands.has(type);
    }

    private async _handleCommand(e: MessageEvent<PluginGuestCommand>): Promise<void> {
        const command = e.data;
        const { type } = command;
        const id = 'id' in command ? (command as { id?: string }).id : undefined;

        if (!this._isCommandAllowed(type)) {
            reportDiagnostic({
                level: 'warn',
                pluginId: this._pluginId,
                code: 'CAPABILITY_VIOLATION',
                message: `未宣言の capability コマンド: ${type}`,
            });
            if (id) {
                this.sendEvent({ type: 'EVT_RPC_RESPONSE', id, success: false, error: `capability 未宣言: ${type}` });
            }
            return;
        }

        // ハンドラー未接続チェック（接続漏れを早期検知）
        const handlerKey = (CMD_TO_HANDLER as Record<string, keyof HostHandlers>)[type];
        if (handlerKey && !this.handlers[handlerKey]) {
            reportDiagnostic({
                level: 'warn',
                pluginId: this._pluginId,
                code: 'HANDLER_NOT_CONNECTED',
                message: `コマンド ${type} に対するハンドラー ${handlerKey} が未接続です`,
            });
        }

        const _cmdStart = isMetricEnabled() ? performance.now() : 0;
        try {
            let result: unknown;
            switch (type) {
                case 'SCENE_GET_ENTITY':
                    result = this.handlers.onGetEntity?.(command.payload.id) ?? null;
                    break;
                case 'SCENE_QUERY_ENTITIES':
                    result = this.handlers.onQueryEntities?.(command.payload.entityType) ?? [];
                    break;
                case 'SCENE_CREATE_ENTITY':
                    result = (
                        await this._withTimeout(
                            this.handlers.onCreateEntity?.(command.payload.entity) ?? Promise.resolve(undefined),
                            type,
                        )
                    )?.id;
                    break;
                case 'SCENE_UPDATE_ENTITY':
                    await this._withTimeout(
                        this.handlers.onUpdateEntity?.(command.payload.id, command.payload.patch) ?? Promise.resolve(),
                        type,
                    );
                    break;
                case 'SCENE_DESTROY_ENTITY':
                    await this._withTimeout(
                        this.handlers.onDestroyEntity?.(command.payload.id) ?? Promise.resolve(),
                        type,
                    );
                    break;
                case 'NET_FETCH':
                    result = await this._withTimeout(
                        this.handlers.onFetch?.(command.payload.url, command.payload.options) ??
                            Promise.resolve(undefined),
                        type,
                    );
                    break;
                case 'NETWORK_SEND_TO_HOST':
                    this.handlers.onMessage?.({
                        type: command.payload.type,
                        payload: command.payload.data,
                    } as PluginWorkerMessage<TPayloadMap>);
                    break;
                case 'NETWORK_BROADCAST':
                    this.handlers.onNetworkBroadcast?.(command.payload.type, command.payload.data);
                    break;
                case 'UI_RENDER':
                    this.handlers.onRender?.(command.payload.targetId, command.payload.vnode);
                    break;
                case 'CANVAS_FRAME':
                    this.handlers.onCanvasFrame?.(
                        command.payload.targetId,
                        command.payload.activeStroke,
                        command.payload.cursor,
                    );
                    break;
                case 'CANVAS_COMMIT_STROKE':
                    this.handlers.onCanvasCommitStroke?.(command.payload.targetId, command.payload.stroke);
                    break;
                case 'MEDIA_LOAD':
                    this.handlers.onMediaLoad?.(
                        command.payload.targetId,
                        command.payload.url,
                        command.payload.mediaType,
                    );
                    break;
                case 'MEDIA_PLAY':
                    this.handlers.onMediaPlay?.(command.payload.targetId);
                    break;
                case 'MEDIA_PAUSE':
                    this.handlers.onMediaPause?.(command.payload.targetId);
                    break;
                case 'MEDIA_SEEK':
                    this.handlers.onMediaSeek?.(command.payload.targetId, command.payload.time);
                    break;
                case 'MEDIA_SET_VOLUME':
                    this.handlers.onMediaSetVolume?.(command.payload.targetId, command.payload.volume);
                    break;
                case 'MEDIA_DESTROY':
                    this.handlers.onMediaDestroy?.(command.payload.targetId);
                    break;
                case 'MEDIA_SET_VISIBLE':
                    this.handlers.onMediaSetVisible?.(command.payload.targetId, command.payload.visible);
                    break;
                case 'CMD_LOG': {
                    const { level, message } = command.payload;
                    if (this.handlers.onLog) {
                        this.handlers.onLog(level, message, this._logPrefix);
                    } else {
                        console[level](`${this._logPrefix} ${message}`);
                    }
                    break;
                }
                default:
                    this.handlers.onCommand?.(command);
                    break;
            }
            if (id) {
                this.sendEvent({ type: 'EVT_RPC_RESPONSE', id, success: true, data: result });
            }
        } catch (error) {
            if (id) {
                const message = error instanceof Error ? error.message : String(error);
                this.sendEvent({ type: 'EVT_RPC_RESPONSE', id, success: false, error: message });
            }
        } finally {
            if (_cmdStart > 0) {
                this._currentTickCommandMs += performance.now() - _cmdStart;
            }
        }
    }

    public sendEvent(event: PluginHostEvent): void {
        if (this.isInitialized) {
            this.worker.postMessage(event);
        } else {
            if (this.eventQueue.length >= PluginHostManager.MAX_QUEUE_SIZE) {
                // 初期化前に大量イベントが積まれた場合、最も古いものを破棄する
                this.eventQueue.shift();
                reportDiagnostic({
                    level: 'warn',
                    pluginId: this._pluginId,
                    code: 'RESOURCE_LIMIT_EXCEEDED',
                    message: `eventQueue が上限 (${PluginHostManager.MAX_QUEUE_SIZE}) に達したため古いイベントを破棄しました`,
                });
            }
            this.eventQueue.push(event);
        }
    }

    /**
     * Transferable オブジェクト（OffscreenCanvas 等）付きでイベントを送信する。
     * Transferable は所有権が Worker に移るため、送信後は Host 側から使用できない。
     */
    /**
     * ワールドスクロールを供給する要素を InputCollector に登録する。
     * GenericPluginHost が [data-scroll-world] 要素を見つけたときに呼ぶ。
     */
    public setScrollElement(el: Element | null): void {
        if (!this._autoInputEnabled) return;
        PluginHostManager._setSharedScrollElement(this._instanceKey, el);
    }

    public sendEventWithTransfer(event: PluginHostEvent, transfer: Transferable[]): void {
        if (this.isInitialized) {
            this.worker.postMessage(event, transfer);
        }
        // 未初期化時は Transferable をキューに積めないため無視
        // （canvas.request() は init 後に呼ばれるため実運用では発生しない）
    }

    public destroy(): void {
        if (this.executionTimer) {
            clearTimeout(this.executionTimer);
            this.executionTimer = null;
        }
        if (this.tickEnabled) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
        }
        if (this.animationFrameId !== undefined) cancelAnimationFrame(this.animationFrameId);
        if (this.intervalId !== undefined) clearInterval(this.intervalId);
        if (this._autoInputEnabled) {
            PluginHostManager._releaseSharedInput(this._instanceKey);
        }
        this.worker.terminate();
        PluginHostManager._registry.delete(this._instanceKey);
    }
}
