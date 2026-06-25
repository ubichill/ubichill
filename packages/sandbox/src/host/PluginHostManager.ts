/**
 * PluginHostManager — 1 つの Sandbox Worker のライフサイクルを管理する usecase 層。
 *
 * 担当:
 *  - Worker の生成 / 初期化 / 破棄
 *  - TICK ループ (rAF / visibility 切替で interval にフォールバック)
 *  - Worker → Host コマンドの受信と HostHandlers への振り分け (capability gate 付き)
 *  - Host → Worker イベント送信 (初期化前はキューに退避)
 *
 * 在籍簿は PluginRegistry、DOM 入力共有は SharedInputPool に委譲する。
 * React 非依存。React 環境では @ubichill/react の usePluginWorker 経由で使う。
 */
import {
    CommandType,
    HostEventType,
    type PluginGuestCommand,
    type PluginHostEvent,
    type PluginWorkerMessage,
    UbiErrorCode,
} from '@ubichill/shared';
import { CAPABILITY_COMMANDS, CMD_TO_HANDLER } from './capability';
import { getActiveWorkerCount, getWorker, registerWorker, unregisterWorker } from './PluginRegistry';
import { isMetricEnabled, reportDiagnostic, reportMetric } from './pluginDiagnostics';
import {
    acquireSharedInput,
    collectSharedInputFor,
    releaseSharedInput,
    setSharedScrollElement,
} from './SharedInputPool';
import type { HostHandlers, PluginHostManagerOptions } from './types';

export class PluginHostManager<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> {
    /** 非同期 RPC のタイムアウト (ms)。超過すると RPC エラーとして Worker に返す */
    static RPC_TIMEOUT_MS = 10_000;
    /** eventQueue の最大保持数。超過した場合は古いイベントを破棄する */
    static MAX_QUEUE_SIZE = 100;

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
                componentInstanceId: getWorker(this._instanceKey)?.componentInstanceId,
                deltaMs: deltaTime,
                commandProcessingMs: this._currentTickCommandMs,
                activeWorkerCount: getActiveWorkerCount(),
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
        registerWorker(this._instanceKey, {
            pluginId: this._pluginId,
            componentInstanceId: options.componentInstanceId,
            entityId: options.entityId,
            parentEntityId: options.parentEntityId,
            componentType: options.componentType,
            startedAt: performance.now(),
            _sendEvent: (event) => this.sendEvent(event),
        });

        if (options.capabilities) {
            // CMD_LOG / CMD_READY / CMD_GRIP は capability 宣言なしで常に許可する。
            // - CMD_LOG: デバッグログ（制限すると開発体験が著しく悪化）
            // - CMD_READY: Worker の初期化通知（必須）
            // - CMD_GRIP: SDK コアの「掴む」機能。capability 不要（pen.worker 等が普通に使う）
            this.allowedCommands = new Set(['CMD_LOG', 'CMD_READY', 'CMD_GRIP', 'EDITOR_SCHEMA']);

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
        this.worker = new Worker(new URL('../worker/sandbox.worker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', (e: MessageEvent<PluginGuestCommand>) => {
            if (e.data.type === CommandType.CMD_READY) {
                this.isInitialized = true;
                this.handlers.onReady?.();
                for (const event of this.eventQueue) {
                    this.worker.postMessage(event);
                }
                this.eventQueue = [];
                return;
            }
            // 初期化失敗: ロード状態は「完了」にして他のエンティティ表示を止めない (graceful degradation)。
            // 失敗した worker は機能しないが、UI のローディングスピナーは止まる。
            if (e.data.type === CommandType.CMD_INIT_FAILED) {
                console.error(`${this._logPrefix} 初期化失敗:`, e.data.payload.error);
                this.handlers.onInitFailed?.(e.data.payload.error);
                this.handlers.onReady?.(); // ロード終了として扱う (ハングを防ぐ)
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
            type: HostEventType.EVT_LIFECYCLE_INIT,
            payload: {
                code: options.pluginCode,
                worldId: options.worldId ?? '',
                myUserId: options.myUserId ?? '',
                pluginId: options.pluginId,
                componentInstanceId: options.componentInstanceId,
                entityId: options.entityId,
                componentType: options.componentType,
                pluginBase: options.pluginBase,
                watchEntityTypes: options.watchEntityTypes,
                initialEntities: options.initialEntities,
            },
        });

        if (this.tickEnabled) {
            this._startTickLoop();
        }

        if (this._autoInputEnabled) {
            acquireSharedInput(this._instanceKey);
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
                const inputEvents = collectSharedInputFor(this._instanceKey);
                if (inputEvents.length > 0) {
                    this.sendEvent({ type: HostEventType.EVT_INPUT, payload: { events: inputEvents } });
                }
            }
            this.sendEvent({ type: HostEventType.EVT_LIFECYCLE_TICK, payload: { deltaTime } });
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
            const message = `未宣言の capability コマンド: ${type}`;
            reportDiagnostic({
                level: 'warn',
                pluginId: this._pluginId,
                code: UbiErrorCode.CAPABILITY_NOT_DECLARED,
                message,
            });
            if (id) {
                this.sendEvent({
                    type: HostEventType.EVT_RPC_RESPONSE,
                    id,
                    success: false,
                    error: message,
                    errorCode: UbiErrorCode.CAPABILITY_NOT_DECLARED,
                });
            }
            return;
        }

        // ハンドラー未接続チェック（接続漏れを早期検知）
        const handlerKey = (CMD_TO_HANDLER as Record<string, keyof HostHandlers>)[type];
        if (handlerKey && !this.handlers[handlerKey]) {
            reportDiagnostic({
                level: 'warn',
                pluginId: this._pluginId,
                code: UbiErrorCode.HANDLER_NOT_CONNECTED,
                message: `コマンド ${type} に対するハンドラー ${handlerKey} が未接続です`,
            });
        }

        const _cmdStart = isMetricEnabled() ? performance.now() : 0;
        try {
            let result: unknown;
            switch (type) {
                case CommandType.SCENE_GET_ENTITY:
                    result = this.handlers.onGetEntity?.(command.payload.id) ?? null;
                    break;
                case CommandType.SCENE_QUERY_ENTITIES:
                    result = this.handlers.onQueryEntities?.(command.payload.entityType) ?? [];
                    break;
                case CommandType.SCENE_CREATE_ENTITY:
                    result = (
                        await this._withTimeout(
                            this.handlers.onCreateEntity?.(command.payload.entity) ?? Promise.resolve(undefined),
                            type,
                        )
                    )?.id;
                    break;
                case CommandType.SCENE_UPDATE_ENTITY:
                    await this._withTimeout(
                        this.handlers.onUpdateEntity?.(command.payload.id, command.payload.patch) ?? Promise.resolve(),
                        type,
                    );
                    break;
                case CommandType.SCENE_DESTROY_ENTITY:
                    await this._withTimeout(
                        this.handlers.onDestroyEntity?.(command.payload.id) ?? Promise.resolve(),
                        type,
                    );
                    break;
                case CommandType.NET_FETCH:
                    result = await this._withTimeout(
                        this.handlers.onFetch?.(command.payload.url, command.payload.options) ??
                            Promise.resolve(undefined),
                        type,
                    );
                    break;
                case CommandType.NETWORK_SEND_TO_HOST:
                    this.handlers.onMessage?.({
                        type: command.payload.type,
                        payload: command.payload.data,
                    } as PluginWorkerMessage<TPayloadMap>);
                    break;
                case CommandType.NETWORK_BROADCAST:
                    this.handlers.onNetworkBroadcast?.(command.payload.type, command.payload.data);
                    break;
                case CommandType.EVENT_EMIT:
                    this.handlers.onEventEmit?.(
                        command.payload.type,
                        command.payload.data,
                        command.payload.scope,
                        command.payload.targetType,
                        getWorker(this._instanceKey)?.componentInstanceId,
                    );
                    break;
                case CommandType.UI_RENDER:
                    this.handlers.onRender?.(command.payload.targetId, command.payload.vnode);
                    break;
                case CommandType.EDITOR_SCHEMA:
                    this.handlers.onEditorSchema?.(command.payload.componentType, command.payload.schema);
                    break;
                case CommandType.CANVAS_FRAME:
                    this.handlers.onCanvasFrame?.(
                        command.payload.targetId,
                        command.payload.activeStroke,
                        command.payload.cursors,
                    );
                    break;
                case CommandType.CANVAS_COMMIT_STROKE:
                    this.handlers.onCanvasCommitStroke?.(command.payload.targetId, command.payload.stroke);
                    break;
                case CommandType.MEDIA_LOAD:
                    this.handlers.onMediaLoad?.(
                        command.payload.targetId,
                        command.payload.url,
                        command.payload.mediaType,
                    );
                    break;
                case CommandType.MEDIA_PLAY:
                    this.handlers.onMediaPlay?.(command.payload.targetId);
                    break;
                case CommandType.MEDIA_PAUSE:
                    this.handlers.onMediaPause?.(command.payload.targetId);
                    break;
                case CommandType.MEDIA_SEEK:
                    this.handlers.onMediaSeek?.(command.payload.targetId, command.payload.time);
                    break;
                case CommandType.MEDIA_SET_VOLUME:
                    this.handlers.onMediaSetVolume?.(command.payload.targetId, command.payload.volume);
                    break;
                case CommandType.MEDIA_DESTROY:
                    this.handlers.onMediaDestroy?.(command.payload.targetId);
                    break;
                case CommandType.MEDIA_SET_VISIBLE:
                    this.handlers.onMediaSetVisible?.(command.payload.targetId, command.payload.visible);
                    break;
                case CommandType.CMD_GRIP:
                    this.handlers.onGripCommand?.(command.payload);
                    break;
                case CommandType.CMD_LOG: {
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
                this.sendEvent({ type: HostEventType.EVT_RPC_RESPONSE, id, success: true, data: result });
            }
        } catch (error) {
            if (id) {
                const message = error instanceof Error ? error.message : String(error);
                // RPC タイムアウトは _withTimeout が投げた専用メッセージで判別する
                const errorCode = message.includes('RPC タイムアウト')
                    ? UbiErrorCode.RPC_TIMEOUT
                    : UbiErrorCode.RPC_HANDLER_ERROR;
                this.sendEvent({ type: HostEventType.EVT_RPC_RESPONSE, id, success: false, error: message, errorCode });
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
                    code: UbiErrorCode.RESOURCE_LIMIT_EXCEEDED,
                    message: `eventQueue が上限 (${PluginHostManager.MAX_QUEUE_SIZE}) に達したため古いイベントを破棄しました`,
                });
            }
            this.eventQueue.push(event);
        }
    }

    /**
     * ワールドスクロールを供給する要素を SharedInputPool に登録する。
     * GenericPluginHost が [data-scroll-world] 要素を見つけたときに呼ぶ。
     */
    public setScrollElement(el: Element | null): void {
        if (!this._autoInputEnabled) return;
        setSharedScrollElement(this._instanceKey, el);
    }

    /**
     * Transferable オブジェクト（OffscreenCanvas 等）付きでイベントを送信する。
     * Transferable は所有権が Worker に移るため、送信後は Host 側から使用できない。
     */
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
            releaseSharedInput(this._instanceKey);
        }
        this.worker.terminate();
        unregisterWorker(this._instanceKey);
    }
}
