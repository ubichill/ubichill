import type { EcsWorld, System, WorkerEvent } from '@ubichill/engine';
import { EcsEventType, EcsWorldImpl } from '@ubichill/engine';
import type {
    AppAvatarDef,
    EntityPatchPayload,
    EvtLifecycleInit,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
    WorldEntity,
} from '@ubichill/shared';

export type { PluginWorkerMessage };

/** EVT_INPUT の type 文字列マッピング（毎フレーム再生成を回避） */
const INPUT_TYPE_MAP: Readonly<Record<string, string>> = {
    MOUSE_MOVE: EcsEventType.INPUT_MOUSE_MOVE,
    MOUSE_DOWN: EcsEventType.INPUT_MOUSE_DOWN,
    MOUSE_UP: EcsEventType.INPUT_MOUSE_UP,
    KEY_DOWN: EcsEventType.INPUT_KEY_DOWN,
    KEY_UP: EcsEventType.INPUT_KEY_UP,
};

type PendingRequest = {
    resolve: (data: unknown) => void;
    reject: (error: string) => void;
};

export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Ubichill Plugin SDK のメインクラス。
 *
 * Sandbox Worker 内では `Ubi` として自動注入されます。
 * プラグインは ECS スタイル（registerSystem）で実装する。
 */
export class UbiSDK {
    private _commandCounter = 0;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _rpcTimeout: number;

    private _pendingWorkerEvents: WorkerEvent[] = [];
    public readonly local: EcsWorld;

    public worldId?: string;
    public myUserId?: string;
    public pluginId?: string;

    private readonly _sendToHost: (cmd: PluginGuestCommand) => void;

    constructor(postMessage: (cmd: PluginGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this.local = new EcsWorldImpl();
    }

    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
            case 'EVT_LIFECYCLE_INIT': {
                // sandbox.worker.ts が early-return するためここは呼ばれない（dead code）
                const init = event as EvtLifecycleInit;
                this.worldId = init.payload.worldId;
                this.myUserId = init.payload.myUserId;
                this.pluginId = init.payload.pluginId;
                break;
            }
            case 'EVT_LIFECYCLE_TICK': {
                const dt = event.payload.deltaTime;
                try {
                    this.local.tick(dt, this._pendingWorkerEvents);
                    this._pendingWorkerEvents.length = 0;
                } catch (err) {
                    console.error('[UbiSDK] ECS World tick error:', err);
                }
                break;
            }
            case 'EVT_PLAYER_JOINED':
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_JOINED,
                    payload: event.payload.user,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_PLAYER_LEFT':
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_LEFT,
                    payload: event.payload.userId,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_PLAYER_CURSOR_MOVED':
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_CURSOR_MOVED,
                    payload: { userId: event.payload.userId, position: event.payload.position },
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_SCENE_ENTITY_UPDATED':
                this._pendingWorkerEvents.push({
                    type: EcsEventType.ENTITY_UPDATED,
                    payload: event.payload.entity,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_RPC_RESPONSE': {
                const pending = this._pendingRequests.get(event.id);
                if (pending) {
                    if (event.success) {
                        pending.resolve(event.data);
                    } else {
                        pending.reject(event.error ?? 'Unknown RPC error');
                    }
                    this._pendingRequests.delete(event.id);
                }
                break;
            }
            case 'EVT_CUSTOM':
                this._pendingWorkerEvents.push({
                    type: event.payload.eventType,
                    payload: event.payload.data,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_NETWORK_BROADCAST':
                this._pendingWorkerEvents.push({
                    type: event.payload.type,
                    payload: { userId: event.payload.userId, data: event.payload.data },
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_INPUT': {
                const now = Date.now();
                for (const inputEvent of event.payload.events) {
                    this._pendingWorkerEvents.push({
                        type: INPUT_TYPE_MAP[inputEvent.type],
                        payload: inputEvent.data,
                        timestamp: now,
                    });
                }
                break;
            }
        }
    }

    private _rpc<T>(command: OmitId<PluginGuestCommand>): Promise<T> {
        const id = `rpc_${this._commandCounter++}`;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                const prefix = this.pluginId ? `[UbiSDK:${this.pluginId}]` : '[UbiSDK]';
                reject(new Error(`${prefix} RPC タイムアウト (${this._rpcTimeout}ms): ${command.type}`));
            }, this._rpcTimeout);

            this._pendingRequests.set(id, {
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data as T);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(new Error(error));
                },
            });

            this._sendToHost({ ...command, id } as PluginGuestCommand);
        });
    }

    private _send(command: OmitId<PluginGuestCommand>): void {
        this._sendToHost(command as PluginGuestCommand);
    }

    public registerSystem(system: System): void {
        this.local.registerSystem(system);
    }

    public readonly world = {
        getEntity: (id: string): Promise<WorldEntity | null> =>
            this._rpc<WorldEntity | null>({ type: 'SCENE_GET_ENTITY', payload: { id } }),

        createEntity: (entity: Omit<WorldEntity, 'id'>): Promise<string> =>
            this._rpc<string>({ type: 'SCENE_CREATE_ENTITY', payload: { entity } }),

        updateEntity: (id: string, patch: EntityPatchPayload['patch']): Promise<void> =>
            this._rpc<void>({ type: 'SCENE_UPDATE_ENTITY', payload: { id, patch: { entityId: id, patch } } }),

        destroyEntity: (id: string): Promise<void> =>
            this._rpc<void>({ type: 'SCENE_DESTROY_ENTITY', payload: { id } }),

        subscribeEntity: (id: string): void => this._send({ type: 'SCENE_SUBSCRIBE_ENTITY', payload: { id } }),

        unsubscribeEntity: (id: string): void => this._send({ type: 'SCENE_UNSUBSCRIBE_ENTITY', payload: { id } }),
    };

    public readonly ui = {
        showToast: (text: string): void => this._send({ type: 'UI_SHOW_TOAST', payload: { text } }),
    };

    public readonly avatar = {
        set: (appDef: AppAvatarDef): void => this._send({ type: 'AVATAR_SET', payload: { appDef } }),
    };

    public readonly network = {
        /**
         * 自分の Host (React) にだけメッセージを送る。他ユーザーには届かない。
         * Host の onMessage ハンドラで受け取る。
         *
         * @example
         * ```ts
         * type MyPayloads = { 'cursor:position': { x: number; y: number } };
         * Ubi.network.sendToHost<MyPayloads>('cursor:position', { x: 100, y: 200 });
         * ```
         */
        sendToHost: <
            TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
            K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
        >(
            type: K,
            data: TPayloadMap[K],
        ): void => this._send({ type: 'NETWORK_SEND_TO_HOST', payload: { type, data } }),

        /**
         * ワールド内の全ユーザーに揮発性データをブロードキャストする。
         * DB には保存されない。他ユーザーの Worker に ECS イベントとして届く。
         * イベントの type は broadcast 時に指定した type 文字列になる。
         * payload: { userId: string; data: unknown }
         *
         * @example
         * ```ts
         * type CursorPayloads = { 'cursor:move': { x: number; y: number } };
         * Ubi.network.broadcast<CursorPayloads>('cursor:move', { x: 100, y: 200 });
         * ```
         */
        broadcast: <
            TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
            K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
        >(
            type: K,
            data: TPayloadMap[K],
        ): void => this._send({ type: 'NETWORK_BROADCAST', payload: { type, data } }),

        /**
         * ホワイトリストされた URL に HTTP リクエストを送る。
         */
        fetch: (
            url: string,
            options?: {
                method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
                headers?: Record<string, string>;
                body?: string;
            },
        ) => this._rpc({ type: 'NET_FETCH', payload: { url, options } }),
    };
}
