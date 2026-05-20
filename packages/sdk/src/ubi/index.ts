import type { EcsWorld, System, WorkerEvent } from '@ubichill/engine';
import { EcsEventType, EcsWorldImpl } from '@ubichill/engine';
import type {
    ComponentInstance,
    FetchOptions,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
} from '@ubichill/shared';
import { _beginRender, _callHandler, _clearTarget } from '../jsx/jsx-runtime';
import type { CanvasModule } from './canvas';
import { createCanvasModule } from './canvas';
import type { EventModule } from './event';
import { createEventModule } from './event';
import type { MediaModule } from './media';
import { createMediaModule } from './media';
import type { PlayerModule } from './player';
import { createPlayerModule } from './player';
import type { StateModule } from './state';
import { createStateModule } from './state';
import type { OmitId, UiRenderCostStat } from './types';
import type { UiModule } from './ui';
import { createUiModule } from './ui';
import type { WorldModule } from './world';
import { createWorldModule } from './world';

export type { OmitId, PluginWorkerMessage, UiRenderCostStat };

/** EVT_INPUT の type 文字列マッピング（毎フレーム再生成を回避） */
const INPUT_TYPE_MAP: Readonly<Record<string, string>> = {
    MOUSE_MOVE: EcsEventType.INPUT_MOUSE_MOVE,
    MOUSE_DOWN: EcsEventType.INPUT_MOUSE_DOWN,
    MOUSE_UP: EcsEventType.INPUT_MOUSE_UP,
    KEY_DOWN: EcsEventType.INPUT_KEY_DOWN,
    KEY_UP: EcsEventType.INPUT_KEY_UP,
    CONTEXT_MENU: EcsEventType.INPUT_CONTEXT_MENU,
    SCROLL: EcsEventType.INPUT_SCROLL,
    RESIZE: EcsEventType.INPUT_RESIZE,
    CURSOR_STYLE: EcsEventType.INPUT_CURSOR_STYLE,
};

type PendingRequest = {
    resolve: (data: unknown) => void;
    reject: (error: string) => void;
};

/**
 * Ubichill Plugin SDK のメインクラス。Sandbox Worker 内では `Ubi` として注入される。
 *
 * Public API surface:
 *   Ubi.state.*     — 宣言的リアクティブ状態 (persistent / persistMine / shared / topLevel)
 *   Ubi.event.*     — トリガー (sendToHost / broadcast)
 *   Ubi.ui.*        — UI render / toast
 *   Ubi.media.*     — メディア再生 (video / audio / HLS)
 *   Ubi.canvas.*    — canvas 描画
 *   Ubi.player.*    — プレイヤー情報 (others / scroll / syncCursor)
 *   Ubi.world.*     — エンティティ get / query (CRUD は spawn / destroy 経由)
 *   Ubi.spawn(e)    — 新規エンティティ作成 (top-level shortcut)
 *   Ubi.destroy(id) — エンティティ削除
 *   Ubi.fetch(url)  — HTTP (whitelist 経由)
 *   Ubi.registerSystem(fn) — ECS System 登録
 *   Ubi.log(msg, level)
 */
export class UbiSDK {
    // ── RPC ──────────────────────────────────────────────────
    private _commandCounter = 0;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _rpcTimeout: number;
    private readonly _sendToHost: (cmd: PluginGuestCommand) => void;

    // ── ECS ──────────────────────────────────────────────────
    private _pendingWorkerEvents: WorkerEvent[] = [];
    private _isTicking = false;
    private readonly _local: EcsWorld;

    // ── State flush ──────────────────────────────────────────
    private _pendingStateFlushes = new Set<() => void>();
    private _initialEntities: ComponentInstance[] = [];

    // ── Plugin identity (sandbox.worker.ts が設定) ──────────
    public worldId?: string;
    public myUserId?: string;
    public pluginId?: string;
    /** 自 Worker (= 1 Component インスタンス) を識別する flat ID。 */
    public componentInstanceId?: string;
    /** 自 Worker が乗っている Entity (GameObject) の id。Pure ECS 用語の Entity に対応。 */
    public entityId?: string;
    /** 自 Worker の Component 型 (`pluginId:componentName`) */
    public componentType?: string;
    public pluginBase = '';
    public watchEntityTypes: string[] = [];

    // ── Public API modules ───────────────────────────────────
    public readonly state: StateModule;
    public readonly event: EventModule;
    public readonly ui: UiModule;
    public readonly media: MediaModule;
    public readonly canvas: CanvasModule;
    public readonly player: PlayerModule;
    public readonly world: WorldModule;

    constructor(postMessage: (cmd: PluginGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this._local = new EcsWorldImpl();

        const send = (cmd: OmitId<PluginGuestCommand>): void => this._send(cmd);
        const rpc = <T>(cmd: OmitId<PluginGuestCommand>): Promise<T> => this._rpc<T>(cmd);

        this.player = createPlayerModule(send, () => this.myUserId);
        this.ui = createUiModule(send, () => this._isTicking, _beginRender, _clearTarget);
        this.world = createWorldModule(send, rpc);
        this.state = createStateModule({
            send,
            updateEntity: (id, patch) => this.world.update(id, patch),
            getMyUserId: () => this.myUserId,
            getEntityId: () => this.entityId,
            getPluginId: () => this.pluginId,
            getComponentType: () => this.componentType,
            getWatchEntityTypes: () => this.watchEntityTypes,
            getPresenceUsers: () => this.player.getPresenceUsers(),
            getLocalSharedState: () => this.player.getLocalSharedState(),
            getScrollX: () => this.player.getScrollX(),
            getScrollY: () => this.player.getScrollY(),
            getForEachUserComponents: () => this.player.getForEachUserComponents(),
            registerPendingFlush: (fn) => this._pendingStateFlushes.add(fn),
            getInitialEntities: () => this._initialEntities,
            beginRender: _beginRender,
            queueUiRender: (targetId, vnode) => this.ui._queueUiRender(targetId, vnode),
            unmountUi: (targetId) => this.ui._unmountUi(targetId),
            recordUiRenderCost: (targetId, costMs, scope) => this.ui._recordUiRenderCost(targetId, costMs, scope),
            buildEntityTargetId: (entityId, componentName) => this.ui._buildEntityTargetId(entityId, componentName),
        });
        this.event = createEventModule(send);
        this.media = createMediaModule(send);
        this.canvas = createCanvasModule(send);
    }

    // ── Top-level shortcuts ──────────────────────────────────

    /** 新規エンティティを作成。`id` は自動採番、他のフィールドは省略可能。 */
    public spawn(entity: Omit<ComponentInstance, 'id'>): Promise<string> {
        return this.world._createEntity(entity);
    }

    /** 指定 id のエンティティを削除。 */
    public destroy(id: string): Promise<void> {
        return this.world._destroyEntity(id);
    }

    /** HTTP リクエスト (capability whitelist 経由)。 */
    public fetch(url: string, options?: FetchOptions): Promise<unknown> {
        return this._rpc({ type: 'NET_FETCH', payload: { url, options } });
    }

    // ── Transport ─────────────────────────────────────────────

    private _send(command: OmitId<PluginGuestCommand>): void {
        this._sendToHost(command as PluginGuestCommand);
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

    // ── ECS ───────────────────────────────────────────────────

    public registerSystem(system: System): void {
        this._local.registerSystem(system);
    }

    // ── Logging ───────────────────────────────────────────────

    public log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
        this._send({ type: 'CMD_LOG', payload: { level, message } });
    }

    // ── Sandbox lifecycle (@internal) ─────────────────────────

    /** @internal sandbox.worker.ts から EVT_LIFECYCLE_INIT 時に呼ばれる */
    public _setInitialEntities(entities: ComponentInstance[]): void {
        this._initialEntities = entities;
    }

    /** @internal sandbox.worker.ts から全ホストイベントをここに流す */
    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
            case 'EVT_LIFECYCLE_TICK': {
                try {
                    this._isTicking = true;
                    this._local.tick(event.payload.deltaTime, this._pendingWorkerEvents);
                } catch (err) {
                    console.error('[UbiSDK] ECS World tick error:', err);
                } finally {
                    this._isTicking = false;
                    this._pendingWorkerEvents.length = 0;
                    for (const flush of this._pendingStateFlushes) flush();
                    this._pendingStateFlushes.clear();
                    this.ui._flushUiRenderQueue();
                }
                break;
            }
            case 'EVT_PLAYER_JOINED': {
                const { user } = event.payload;
                this.player.handlePlayerJoined(user);
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_JOINED,
                    payload: user,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_PLAYER_LEFT': {
                const { userId } = event.payload;
                this.player.handlePlayerLeft(userId);
                for (const componentName of this.player.getForEachUserComponents()) {
                    this.ui._unmountUi(this.ui._buildEntityTargetId(`user:${userId}`, componentName));
                }
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_LEFT,
                    payload: userId,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_PLAYER_CURSOR_MOVED': {
                const { userId, position } = event.payload;
                const incoming = (event.payload as { sharedState?: Record<string, unknown> }).sharedState;
                this.player.handleCursorMoved(userId, position, incoming);
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_CURSOR_MOVED,
                    payload: { userId, position },
                    timestamp: Date.now(),
                });
                break;
            }
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
            case 'EVT_ENTITY_WATCH': {
                const entity = event.payload.entity as ComponentInstance | undefined;
                const entityType = event.payload.entityType;
                if (entity) {
                    for (const binding of this.state.getStateBindings()) {
                        if (binding.watchType !== entityType) continue;
                        const existingId = binding.getTargetId();
                        if (!existingId) {
                            if (entity.id) binding.trySetTargetId(entity.id);
                        } else if (existingId !== entity.id) {
                            continue;
                        }
                        // top-level + data の両方を一括反映
                        binding.applyEntity(entity);
                    }
                }
                this._pendingWorkerEvents.push({
                    type: `entity:${entityType}`,
                    payload: entity,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_NETWORK_BROADCAST':
                if (event.payload.type === 'presence:sharedState') {
                    const d = event.payload.data as { sharedState: Record<string, unknown> };
                    this.player.handlePresenceSharedState(event.payload.userId, d.sharedState);
                } else {
                    this._pendingWorkerEvents.push({
                        type: event.payload.type,
                        payload: { userId: event.payload.userId, data: event.payload.data },
                        timestamp: Date.now(),
                    });
                }
                break;
            case 'EVT_INPUT': {
                const now = Date.now();
                for (const inputEvent of event.payload.events) {
                    if (inputEvent.type === 'SCROLL') {
                        const d = inputEvent.data as { x: number; y: number };
                        this.player.handleScrollInput(d.x, d.y, now);
                    } else if (inputEvent.type === 'MOUSE_MOVE') {
                        const d = inputEvent.data as { viewportX: number; viewportY: number };
                        this.player.handleMouseMoveInput(d.viewportX, d.viewportY, now);
                    }
                    this._pendingWorkerEvents.push({
                        type: INPUT_TYPE_MAP[inputEvent.type],
                        payload: inputEvent.data,
                        timestamp: now,
                    });
                }
                break;
            }
            case 'EVT_UI_ACTION':
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
}
