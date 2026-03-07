import { useCallback, useEffect, useRef } from 'react';
import type { EntityPatchPayload, PluginGuestCommand, PluginHostEvent, WorldEntity } from '../index';

// Fetch handler utilities
export {
    createPluginFetchHandler,
    DEFAULT_ALLOWED_DOMAINS,
    DEMO_ALLOWED_DOMAINS,
    isUrlAllowed,
    PRODUCTION_ALLOWED_DOMAINS,
} from './fetchHandler';

// ============================================
// usePluginWorker — React フック
//
// Plugin Web Worker Sandbox のライフサイクルを管理します。
// - CMD_READY を受信して初期化完了を検知（100ms ハックを排除）
// - アンマウント時に確実に worker.terminate() を呼び、ゾンビ Worker を防ぎます
// ============================================

interface UsePluginWorkerOptions {
    /** Worker 内で動的に評価されるプラグインコード（文字列）。
     * プラグインコード内では `Ubi` として SDK が注入されます。
     *
     * @example
     * ```js
     * const pluginCode = `
     *   Ubi.onTick((dt) => {
     *     Ubi.scene.updateCursorPosition(x, y);
     *   });
     * `;
     * ```
     */
    pluginCode: string;

    /** Worker (Guest) から受信したコマンドのハンドラ。
     * Host が Worker からのコマンドを処理する際に使用します。
     */
    onCommand?: (command: PluginGuestCommand) => void;

    /** ワールドID（EVT_LIFECYCLE_INIT に使用） */
    worldId?: string;

    /** 自ユーザーID（EVT_LIFECYCLE_INIT に使用） */
    myUserId?: string;

    /** プラグインID (デバッグ・ロギングに使用) */
    pluginId?: string;

    /**
     * プラグインの最大実行時間（ミリ秒）。
     * 0 または未指定の場合は無制限（タイマーなし）。
     * 通常は設定不要です。
     */
    maxExecutionTime?: number;

    /** リソース制限超過時のコールバック */
    onResourceLimitExceeded?: (reason: string) => void;

    /**
     * 自動 EVT_LIFECYCLE_TICK 送信の FPS。
     * - デフォルト: 60 fps
     * - 0 を指定すると自動 TICK を無効化します
     * - アクティブ時は requestAnimationFrame、非アクティブ時は setInterval にフォールバックし、
     *   ウィンドウが非アクティブでもプラグインが継続して動作します
     */
    tickFps?: number;

    /**
     * true にすると自動 TICK を完全に無効化します。
     * 自前でタイミングを制御したいプラグインで使用してください。
     */
    disableAutoTick?: boolean;
}

/**
 * usePluginWorker
 *
 * Plugin Sandbox Worker のライフサイクルを管理するカスタムフック。
 *
 * - `pluginCode` が変わると Worker を再起動します
 * - CMD_READY を受信して初期化完了を検知します（ハックなし）
 * - アンマウント時に確実に `worker.terminate()` を呼びます
 *
 * @returns `{ sendEvent, terminate }`
 */
export function usePluginWorker(options: UsePluginWorkerOptions) {
    const workerRef = useRef<Worker | null>(null);
    const isInitializedRef = useRef(false);
    const eventQueueRef = useRef<PluginHostEvent[]>([]);
    const onCommandRef = useRef(options.onCommand);
    const worldIdRef = useRef(options.worldId);
    const myUserIdRef = useRef(options.myUserId);
    const onResourceLimitExceededRef = useRef(options.onResourceLimitExceeded);

    const maxExecutionTime = options.maxExecutionTime ?? 0;

    useEffect(() => {
        onCommandRef.current = options.onCommand;
    }, [options.onCommand]);
    useEffect(() => {
        worldIdRef.current = options.worldId;
        myUserIdRef.current = options.myUserId;
    }, [options.worldId, options.myUserId]);
    useEffect(() => {
        onResourceLimitExceededRef.current = options.onResourceLimitExceeded;
    }, [options.onResourceLimitExceeded]);

    useEffect(() => {
        let worker: Worker | null = null;
        let executionTimer: ReturnType<typeof setTimeout> | null = null;
        const workerUrl = new URL('./sandbox.worker.ts', import.meta.url);

        const terminateWithReason = (reason: string) => {
            console.warn(`[PluginSandbox] リソース制限超過: ${reason}`);
            onResourceLimitExceededRef.current?.(reason);
            if (worker) {
                worker.terminate();
                workerRef.current = null;
            }
            if (executionTimer) clearTimeout(executionTimer);
        };

        try {
            worker = new Worker(workerUrl, { type: 'module' });
            workerRef.current = worker;
            isInitializedRef.current = false;

            worker.onmessage = (e: MessageEvent<PluginGuestCommand>) => {
                // CMD_READY: Sandbox が初期化完了を通知 → キューをフラッシュ
                if (e.data.type === 'CMD_READY') {
                    isInitializedRef.current = true;
                    while (eventQueueRef.current.length > 0 && workerRef.current) {
                        const event = eventQueueRef.current.shift();
                        if (event) workerRef.current.postMessage(event);
                    }
                    return;
                }
                onCommandRef.current?.(e.data);
            };

            worker.onerror = (e) => {
                console.error('[PluginSandbox] Sandbox エラー:', e);
            };

            // 最大実行時間タイマー（0 または未指定なら設定しない）
            if (maxExecutionTime > 0) {
                executionTimer = setTimeout(() => {
                    terminateWithReason(`最大実行時間 (${maxExecutionTime}ms) を超過しました`);
                }, maxExecutionTime);
            }

            // EVT_LIFECYCLE_INIT でプラグインコードと初期情報を送信
            const initEvent: PluginHostEvent = {
                type: 'EVT_LIFECYCLE_INIT',
                payload: {
                    code: options.pluginCode,
                    worldId: worldIdRef.current ?? '',
                    myUserId: myUserIdRef.current ?? '',
                    pluginId: options.pluginId,
                },
            };
            worker.postMessage(initEvent);
        } catch (error) {
            console.error('[PluginSandbox] Worker の起動に失敗しました:', error);
        }

        return () => {
            if (executionTimer) clearTimeout(executionTimer);
            if (worker) {
                worker.terminate();
                workerRef.current = null;
                isInitializedRef.current = false;
                eventQueueRef.current = [];
            }
        };
    }, [options.pluginCode, maxExecutionTime, options.pluginId]);

    // ============================================
    // 自動 TICK ループ
    // アクティブ時は rAF、非アクティブ時は setInterval にフォールバック
    // ウィンドウが非アクティブでもプラグインが動作し続けます
    // ============================================
    useEffect(() => {
        if (options.disableAutoTick) return;
        const fps = options.tickFps ?? 60;
        if (fps <= 0) return;

        const intervalMs = 1000 / fps;
        let animationFrameId: number | undefined;
        let intervalId: ReturnType<typeof setInterval> | undefined;
        let lastTime = performance.now();

        const sendTick = (deltaTime: number) => {
            if (workerRef.current && isInitializedRef.current) {
                workerRef.current.postMessage({
                    type: 'EVT_LIFECYCLE_TICK',
                    payload: { deltaTime },
                } as PluginHostEvent);
            }
        };

        const animate = (time: number) => {
            const deltaTime = time - lastTime;
            lastTime = time;
            sendTick(deltaTime);
            animationFrameId = requestAnimationFrame(animate);
        };

        const handleVisibilityChange = () => {
            lastTime = performance.now();
            if (!document.hidden) {
                if (intervalId !== undefined) {
                    clearInterval(intervalId);
                    intervalId = undefined;
                }
                animationFrameId = requestAnimationFrame(animate);
            } else {
                if (animationFrameId !== undefined) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = undefined;
                }
                intervalId = setInterval(() => {
                    const now = performance.now();
                    sendTick(now - lastTime);
                    lastTime = now;
                }, intervalMs);
            }
        };

        if (!document.hidden) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            intervalId = setInterval(() => {
                const now = performance.now();
                sendTick(now - lastTime);
                lastTime = now;
            }, intervalMs);
        }

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId);
            if (intervalId !== undefined) clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [options.disableAutoTick, options.tickFps]);

    /**
     * Host から Worker へ PluginHostEvent を送信します。
     * Worker が未初期化の場合はキューに積み、CMD_READY 後にまとめて送信されます。
     */
    const sendEvent = useCallback((event: PluginHostEvent) => {
        if (workerRef.current && isInitializedRef.current) {
            workerRef.current.postMessage(event);
        } else if (workerRef.current && !isInitializedRef.current) {
            eventQueueRef.current.push(event);
        } else {
            console.warn('[PluginWorker] 未初期化の Worker にイベントを送信しようとしました:', event);
        }
    }, []);

    const terminate = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
    }, []);

    return { sendEvent, terminate };
}

// ============================================
// PluginHostManager — React 不要なクラスベース管理クラス
// ============================================

type HostHandlers = {
    onShowToast?: (text: string) => void;
    onGetEntity?: (id: string) => WorldEntity | undefined;
    onCreateEntity?: (entity: Omit<WorldEntity, 'id'>) => Promise<WorldEntity>;
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    onDestroyEntity?: (id: string) => Promise<void>;
    onSetAvatar?: (appDef: unknown) => void;
    onUpdateCursor?: (x: number, y: number) => void;
    onCustomMessage?: (type: string, data: unknown) => void;
    onFetch?: (
        url: string,
        options?: {
            method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
            headers?: Record<string, string>;
            body?: string;
        },
    ) => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
    }>;
};

interface PluginHostManagerOptions {
    /** ハンドラ関数群 */
    handlers: HostHandlers;
    /** プラグインの最大実行時間（ミリ秒）。0 または未指定の場合は無制限。 */
    maxExecutionTime?: number;
    /** リソース制限超過時のコールバック */
    onResourceLimitExceeded?: (reason: string) => void;
}

/**
 * PluginHostManager
 *
 * React 不要なクラスベースの Plugin Worker マネージャー。
 * フロントエンドの初期化処理などで直接使う場合に利用します。
 *
 * @example
 * ```ts
 * const manager = new PluginHostManager(workerUrl, {
 *   handlers: {
 *     onShowToast: (text) => toast(text),
 *     onGetEntity: (id) => store.getEntity(id),
 *   },
 * });
 * manager.sendEvent({ type: 'EVT_LIFECYCLE_TICK', payload: { deltaTime: 16.7 } });
 * ```
 */
export class PluginHostManager {
    private worker: Worker;
    private handlers: HostHandlers;
    private executionTimer: ReturnType<typeof setTimeout> | null = null;
    private onResourceLimitExceeded?: (reason: string) => void;
    private isInitialized = false;
    private eventQueue: PluginHostEvent[] = [];

    constructor(workerUrl: string | URL, options: PluginHostManagerOptions) {
        this.handlers = options.handlers;
        this.onResourceLimitExceeded = options.onResourceLimitExceeded;

        const maxExecutionTime = options.maxExecutionTime ?? 0;

        this.worker = new Worker(workerUrl, { type: 'module' });
        this.worker.addEventListener('message', (e: MessageEvent<PluginGuestCommand>) => {
            // CMD_READY: Sandbox が初期化完了を通知 → キューをフラッシュ
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

        if (maxExecutionTime > 0) {
            this.executionTimer = setTimeout(() => {
                this._terminateWithReason(`最大実行時間 (${maxExecutionTime}ms) を超過しました`);
            }, maxExecutionTime);
        }
    }

    private _terminateWithReason(reason: string) {
        console.warn(`[PluginSandbox] リソース制限超過: ${reason}`);
        this.onResourceLimitExceeded?.(reason);
        this.destroy();
    }

    private async _handleCommand(e: MessageEvent<PluginGuestCommand>) {
        const command = e.data;
        const { type } = command;
        const id = 'id' in command ? (command as { id?: string }).id : undefined;

        try {
            let result: unknown;

            switch (type) {
                case 'UI_SHOW_TOAST':
                    this.handlers.onShowToast?.(command.payload.text);
                    break;
                case 'SCENE_UPDATE_CURSOR':
                    this.handlers.onUpdateCursor?.(command.payload.x, command.payload.y);
                    break;
                case 'SCENE_GET_ENTITY':
                    result = this.handlers.onGetEntity?.(command.payload.id) ?? null;
                    break;
                case 'SCENE_CREATE_ENTITY':
                    result = (await this.handlers.onCreateEntity?.(command.payload.entity))?.id;
                    break;
                case 'SCENE_UPDATE_ENTITY':
                    await this.handlers.onUpdateEntity?.(command.payload.id, command.payload.patch);
                    break;
                case 'SCENE_DESTROY_ENTITY':
                    await this.handlers.onDestroyEntity?.(command.payload.id);
                    break;
                case 'AVATAR_SET':
                    this.handlers.onSetAvatar?.(command.payload.appDef);
                    break;
                case 'CUSTOM_MESSAGE':
                    this.handlers.onCustomMessage?.(command.payload.type, command.payload.data);
                    break;
                case 'NET_FETCH':
                    result = await this.handlers.onFetch?.(command.payload.url, command.payload.options);
                    break;
                default:
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
        }
    }

    /**
     * Worker へ PluginHostEvent を送信します。
     * 初期化前はキューに積み、CMD_READY 後にまとめて送信されます。
     */
    public sendEvent(event: PluginHostEvent): void {
        if (this.isInitialized) {
            this.worker.postMessage(event);
        } else {
            this.eventQueue.push(event);
        }
    }

    /** Worker を終了します */
    public destroy(): void {
        if (this.executionTimer) {
            clearTimeout(this.executionTimer);
            this.executionTimer = null;
        }
        this.worker.terminate();
    }
}
