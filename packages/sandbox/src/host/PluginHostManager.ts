/**
 * PluginHostManager — React 非依存のコアクラス。
 *
 * プラグイン Sandbox Worker のライフサイクル・TICK ループ・メッセージ処理を管理する。
 * ブラウザ（Web Worker ホスト）前提で動作し、React に依存しない。
 *
 * React 環境では @ubichill/react の usePluginWorker 経由で使用することを推奨。
 */

import type { PluginWorkerMessage } from '@ubichill/engine';
import type { EntityPatchPayload, PluginGuestCommand, PluginHostEvent, WorldEntity } from '@ubichill/shared';
import { InputCollector } from './InputCollector';

// ============================================================
// Capability 定義
// ============================================================

export const CAPABILITY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    'scene:read': ['SCENE_GET_ENTITY'],
    'scene:update': [
        'SCENE_CREATE_ENTITY',
        'SCENE_UPDATE_ENTITY',
        'SCENE_DESTROY_ENTITY',
        'SCENE_UPDATE_CURSOR',
        'SCENE_SUBSCRIBE_ENTITY',
        'SCENE_UNSUBSCRIBE_ENTITY',
    ],
    'net:fetch': ['NET_FETCH'],
    'ui:toast': ['UI_SHOW_TOAST'],
    'avatar:set': ['AVATAR_SET'],
};

// ============================================================
// 型定義
// ============================================================

export type FetchOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: string;
};

export type FetchResult = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
};

export type HostHandlers<TMsg extends PluginWorkerMessage = PluginWorkerMessage> = {
    onGetEntity?: (id: string) => WorldEntity | undefined;
    onCreateEntity?: (entity: Omit<WorldEntity, 'id'>) => Promise<WorldEntity>;
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    onDestroyEntity?: (id: string) => Promise<void>;
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    onMessage?: (msg: TMsg) => void;
    onCommand?: (command: PluginGuestCommand) => void;
};

export interface PluginHostManagerOptions<TMsg extends PluginWorkerMessage = PluginWorkerMessage> {
    pluginCode: string;
    worldId?: string;
    myUserId?: string;
    pluginId?: string;
    handlers: HostHandlers<TMsg>;
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

export class PluginHostManager<TMsg extends PluginWorkerMessage = PluginWorkerMessage> {
    private worker: Worker;
    private handlers: HostHandlers<TMsg>;
    private executionTimer: ReturnType<typeof setTimeout> | null = null;
    private onResourceLimitExceeded?: (reason: string) => void;
    private isInitialized = false;
    private eventQueue: PluginHostEvent[] = [];
    private allowedCommands: Set<string> | null;
    private readonly _logPrefix: string;

    private animationFrameId?: number;
    private intervalId?: ReturnType<typeof setInterval>;
    private lastTime = performance.now();
    private readonly intervalMs: number;
    private readonly tickEnabled: boolean;
    private _inputCollector: InputCollector | null = null;

    // Arrow fields: bind 済みのため毎フレーム bind() しない（GC ゼロ）
    private readonly _animate = (time: number): void => {
        const deltaTime = time - this.lastTime;
        this.lastTime = time;
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

    constructor(options: PluginHostManagerOptions<TMsg>) {
        this.handlers = options.handlers;
        this.onResourceLimitExceeded = options.onResourceLimitExceeded;
        this._logPrefix = options.pluginId ? `[PluginSandbox:${options.pluginId}]` : '[PluginSandbox]';

        if (options.capabilities) {
            this.allowedCommands = new Set(['CUSTOM_MESSAGE']);
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

        const maxExecutionTime = options.maxExecutionTime ?? 0;
        const workerUrl = new URL('../guest/sandbox.worker.ts', import.meta.url);

        this.worker = new Worker(workerUrl, { type: 'module' });
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
            },
        });

        if (this.tickEnabled) {
            this._startTickLoop();
        }

        if (this.tickEnabled && !options.disableAutoInput) {
            this._inputCollector = new InputCollector();
        }
    }

    static async fromUrl<TMsg extends PluginWorkerMessage = PluginWorkerMessage>(
        url: string,
        options: Omit<PluginHostManagerOptions<TMsg>, 'pluginCode'>,
    ): Promise<PluginHostManager<TMsg>> {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`[PluginHostManager] プラグインコードの取得に失敗: ${res.status} ${url}`);
        }
        return new PluginHostManager<TMsg>({ ...options, pluginCode: await res.text() });
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
            if (this._inputCollector) {
                const inputEvents = this._inputCollector.flushEvents();
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

    private _isCommandAllowed(type: string): boolean {
        if (this.allowedCommands === null) return true;
        return this.allowedCommands.has(type);
    }

    private async _handleCommand(e: MessageEvent<PluginGuestCommand>): Promise<void> {
        const command = e.data;
        const { type } = command;
        const id = 'id' in command ? (command as { id?: string }).id : undefined;

        if (!this._isCommandAllowed(type)) {
            console.warn(`[PluginSandbox] 未宣言の capability: ${type}`);
            if (id) {
                this.sendEvent({ type: 'EVT_RPC_RESPONSE', id, success: false, error: `capability 未宣言: ${type}` });
            }
            return;
        }

        try {
            let result: unknown;
            switch (type) {
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
                case 'NET_FETCH':
                    result = await this.handlers.onFetch?.(command.payload.url, command.payload.options);
                    break;
                case 'CUSTOM_MESSAGE':
                    this.handlers.onMessage?.({
                        type: command.payload.type,
                        payload: command.payload.data,
                    } as TMsg);
                    break;
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
        }
    }

    public sendEvent(event: PluginHostEvent): void {
        if (this.isInitialized) {
            this.worker.postMessage(event);
        } else {
            this.eventQueue.push(event);
        }
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
        this._inputCollector?.destroy();
        this._inputCollector = null;
        this.worker.terminate();
    }
}
