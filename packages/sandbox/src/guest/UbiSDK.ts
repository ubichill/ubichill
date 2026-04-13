import type { EcsWorld, System, WorkerEvent } from '@ubichill/engine';
import { EcsEventType, EcsWorldImpl } from '@ubichill/engine';
import type {
    AppAvatarDef,
    CanvasCursorData,
    CanvasStrokeData,
    EntityPatchPayload,
    FetchOptions,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
    VNode,
    WorldEntity,
} from '@ubichill/shared';
import { _beginRender, _callHandler, _clearTarget } from './jsx-runtime';

export type { PluginWorkerMessage };

/** EVT_INPUT の type 文字列マッピング（毎フレーム再生成を回避） */
const INPUT_TYPE_MAP: Readonly<Record<string, string>> = {
    MOUSE_MOVE: EcsEventType.INPUT_MOUSE_MOVE,
    MOUSE_DOWN: EcsEventType.INPUT_MOUSE_DOWN,
    MOUSE_UP: EcsEventType.INPUT_MOUSE_UP,
    KEY_DOWN: EcsEventType.INPUT_KEY_DOWN,
    KEY_UP: EcsEventType.INPUT_KEY_UP,
    CONTEXT_MENU: EcsEventType.INPUT_CONTEXT_MENU,
    SCROLL: EcsEventType.INPUT_SCROLL,
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
    public entityId?: string;

    private readonly _sendToHost: (cmd: PluginGuestCommand) => void;

    constructor(postMessage: (cmd: PluginGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this.local = new EcsWorldImpl();
    }

    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
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
            case 'EVT_ENTITY_WATCH':
                this._pendingWorkerEvents.push({
                    type: `entity:${event.payload.entityType}`,
                    payload: event.payload.entity,
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
            case 'EVT_UI_ACTION':
                // per-targetId ハンドラーレジストリから対応する関数を呼び出す
                _callHandler(event.payload.targetId, event.payload.handlerIndex, event.payload.detail);
                break;
            case 'EVT_MEDIA_TIME_UPDATE':
                this._pendingWorkerEvents.push({
                    type: 'media:timeUpdate',
                    payload: event.payload,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_MEDIA_ENDED':
                this._pendingWorkerEvents.push({
                    type: 'media:ended',
                    payload: event.payload,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_MEDIA_ERROR':
                this._pendingWorkerEvents.push({
                    type: 'media:error',
                    payload: event.payload,
                    timestamp: Date.now(),
                });
                break;
            case 'EVT_MEDIA_LOADED':
                this._pendingWorkerEvents.push({
                    type: 'media:loaded',
                    payload: event.payload,
                    timestamp: Date.now(),
                });
                break;
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

        queryEntities: (entityType: string): Promise<WorldEntity[]> =>
            this._rpc<WorldEntity[]>({ type: 'SCENE_QUERY_ENTITIES', payload: { entityType } }),

        subscribeEntity: (id: string): void => this._send({ type: 'SCENE_SUBSCRIBE_ENTITY', payload: { id } }),

        unsubscribeEntity: (id: string): void => this._send({ type: 'SCENE_UNSUBSCRIBE_ENTITY', payload: { id } }),
    };

    public readonly ui = {
        showToast: (text: string): void => this._send({ type: 'UI_SHOW_TOAST', payload: { text } }),

        /**
         * Worker 内で TSX を使って UI を描画する。
         *
         * factory 関数が呼ばれた瞬間に JSX が評価され、onUbi* 関数ハンドラーが
         * jsx-runtime のハンドラーレジストリに登録される。
         * 生成された VNode は postMessage でシリアライズされ Host へ送られる。
         * Host は VNodeRenderer で実 DOM に変換して Shadow DOM に注入する。
         *
         * @param factory VNode を返すファクトリ関数（毎フレーム呼んで再描画）
         * @param targetId Host 側の描画スロット名（省略時: 'default'）
         *
         * @example
         * ```tsx
         * Ubi.ui.render(() => (
         *   <div style={{ padding: '8px' }}>
         *     <button onUbiClick={() => count++}>+1</button>
         *   </div>
         * ));
         * ```
         */
        render: (factory: () => VNode, targetId = 'default'): void => {
            _beginRender(targetId);
            const vnode = factory();
            this._send({ type: 'UI_RENDER', payload: { targetId, vnode } });
        },

        /**
         * UI をアンマウントする。
         * @param targetId Host 側の描画スロット名（省略時: 'default'）
         */
        unmount: (targetId = 'default'): void => {
            _clearTarget(targetId);
            this._send({ type: 'UI_RENDER', payload: { targetId, vnode: null } });
        },
    };

    public readonly avatar = {
        set: (appDef: AppAvatarDef): void => this._send({ type: 'AVATAR_SET', payload: { appDef } }),
    };

    public readonly canvas = {
        /**
         * 毎フレームのキャンバス描画状態をホストへ送信する。
         * ホストが永続レイヤーの上にアクティブストロークとカーソルを合成して描画する。
         *
         * @param targetId  CanvasDefinition の targetId（省略時: 'default'）
         * @param options   描画オプション（activeStroke: 描画中のストローク, cursor: カーソル）
         */
        frame: (
            targetId: string,
            options: { activeStroke?: CanvasStrokeData | null; cursor?: CanvasCursorData | null },
        ): void =>
            this._send({
                type: 'CANVAS_FRAME',
                payload: { targetId, activeStroke: options.activeStroke ?? null, cursor: options.cursor ?? null },
            }),

        /**
         * 完成ストロークをホストの永続レイヤーへコミットする。
         * 以降のフレームに自動的に描画される。
         *
         * @param targetId  CanvasDefinition の targetId
         * @param stroke    コミットするストロークデータ
         */
        commitStroke: (targetId: string, stroke: CanvasStrokeData): void =>
            this._send({ type: 'CANVAS_COMMIT_STROKE', payload: { targetId, stroke } }),
    };

    /**
     * メディア（動画・音声）再生を Host に委譲する API。
     *
     * Host が `<video>` 要素と Hls.js を管理し、Worker はコマンドのみを送る（ステートレス設計）。
     * capability: 'video:control' が必要。
     *
     * mediaTargets に宣言した targetId を指定する（省略時: 'default'）。
     *
     * @example
     * ```ts
     * Ubi.media.load('https://example.com/stream.m3u8', 'main', 'hls');
     * Ubi.media.play('main');
     * // ECS System 内で media:timeUpdate イベントを受信
     * ```
     */
    public readonly media = {
        /** URL を読み込む。mediaType が 'hls' なら Hls.js を使用、'auto' は URL で自動判定 */
        load: (url: string, targetId = 'default', mediaType?: 'hls' | 'video' | 'auto'): void =>
            this._send({ type: 'MEDIA_LOAD', payload: { targetId, url, mediaType } }),

        /** 再生開始 */
        play: (targetId = 'default'): void => this._send({ type: 'MEDIA_PLAY', payload: { targetId } }),

        /** 一時停止 */
        pause: (targetId = 'default'): void => this._send({ type: 'MEDIA_PAUSE', payload: { targetId } }),

        /** 再生位置を指定秒へ移動 */
        seek: (time: number, targetId = 'default'): void =>
            this._send({ type: 'MEDIA_SEEK', payload: { targetId, time } }),

        /** 音量設定 (0–1) */
        setVolume: (volume: number, targetId = 'default'): void =>
            this._send({ type: 'MEDIA_SET_VOLUME', payload: { targetId, volume } }),

        /** メディア要素を解放 */
        destroy: (targetId = 'default'): void => this._send({ type: 'MEDIA_DESTROY', payload: { targetId } }),

        /** video 要素の表示/非表示を切り替える */
        setVisible: (visible: boolean, targetId = 'default'): void =>
            this._send({ type: 'MEDIA_SET_VISIBLE', payload: { targetId, visible } }),
    };

    /**
     * プラグイン Worker からホストへログを送る。
     * ホストはコンソール出力 + デバッグパネル表示を行う。
     *
     * @param message ログメッセージ
     * @param level   ログレベル（デフォルト: 'info'）
     *
     * @example
     * ```ts
     * Ubi.log('PenUISystem initialized');
     * Ubi.log('click handler fired', 'debug');
     * Ubi.log('something went wrong', 'error');
     * ```
     */
    public log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
        this._send({ type: 'CMD_LOG', payload: { level, message } });
    }

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
        fetch: (url: string, options?: FetchOptions) => this._rpc({ type: 'NET_FETCH', payload: { url, options } }),
    };
}
