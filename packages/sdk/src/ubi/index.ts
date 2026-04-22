import type { EcsWorld, System, WorkerEvent } from '@ubichill/engine';
import { EcsEventType, EcsWorldImpl } from '@ubichill/engine';
import type { PluginGuestCommand, PluginHostEvent, PluginWorkerMessage, WorldEntity } from '@ubichill/shared';
import { _beginRender, _callHandler, _clearTarget } from '../jsx/jsx-runtime';
import type { CanvasModule } from './canvas';
import { createCanvasModule } from './canvas';
import type { MediaModule } from './media';
import { createMediaModule } from './media';
import type { NetworkModule } from './network';
import { createNetworkModule } from './network';
import type { PresenceModule } from './presence';
import { createPresenceModule } from './presence';
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
 * Ubichill Plugin SDK のメインクラス。
 *
 * Sandbox Worker 内では `Ubi` として自動注入されます。
 * プラグインは ECS スタイル（registerSystem）で実装する。
 *
 * 各 API は ubi/ ディレクトリのモジュールに分離されています:
 * - ubi/state/   → Ubi.state
 * - ubi/ui/      → Ubi.ui
 * - ubi/presence/→ Ubi.presence
 * - ubi/world/   → Ubi.world
 * - ubi/network/ → Ubi.network
 * - ubi/media/   → Ubi.media
 * - ubi/canvas/  → Ubi.canvas
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

    // ── State flush ──────────────────────────────────────────
    private _pendingStateFlushes = new Set<() => void>();
    private _initialEntities: WorldEntity[] = [];

    // ── ECS World (registerSystem で使用) ───────────────────
    public readonly local: EcsWorld;

    // ── Plugin identity (sandbox.worker.ts が設定) ──────────
    public worldId?: string;
    public myUserId?: string;
    public pluginId?: string;
    public entityId?: string;
    public pluginBase = '';
    public watchEntityTypes: string[] = [];

    // ── Public API modules ───────────────────────────────────
    public readonly world: WorldModule;
    public readonly ui: UiModule;
    public readonly presence: PresenceModule;
    public readonly state: StateModule;
    public readonly network: NetworkModule;
    public readonly media: MediaModule;
    public readonly canvas: CanvasModule;

    constructor(postMessage: (cmd: PluginGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this.local = new EcsWorldImpl();

        const send = (cmd: OmitId<PluginGuestCommand>): void => this._send(cmd);
        const rpc = <T>(cmd: OmitId<PluginGuestCommand>): Promise<T> => this._rpc<T>(cmd);

        this.presence = createPresenceModule(send);
        this.ui = createUiModule(send, () => this._isTicking, _beginRender, _clearTarget);
        this.world = createWorldModule(send, rpc);
        this.state = createStateModule({
            send,
            updateEntity: (id, patch) => this.world.updateEntity(id, patch),
            getMyUserId: () => this.myUserId,
            getEntityId: () => this.entityId,
            getPluginId: () => this.pluginId,
            getWatchEntityTypes: () => this.watchEntityTypes,
            getPresenceUsers: () => this.presence.getPresenceUsers(),
            getLocalSharedState: () => this.presence.getLocalSharedState(),
            getScrollX: () => this.presence.getScrollX(),
            getScrollY: () => this.presence.getScrollY(),
            getForEachUserComponents: () => this.presence.getForEachUserComponents(),
            registerPendingFlush: (fn) => this._pendingStateFlushes.add(fn),
            getInitialEntities: () => this._initialEntities,
            beginRender: _beginRender,
            queueUiRender: (targetId, vnode) => this.ui._queueUiRender(targetId, vnode),
            unmountUi: (targetId) => this.ui._unmountUi(targetId),
            recordUiRenderCost: (targetId, costMs, scope) => this.ui._recordUiRenderCost(targetId, costMs, scope),
            buildEntityTargetId: (entityId, componentName) => this.ui._buildEntityTargetId(entityId, componentName),
        });
        this.network = createNetworkModule(send, rpc);
        this.media = createMediaModule(send);
        this.canvas = createCanvasModule(send);
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
        this.local.registerSystem(system);
    }

    // ── Logging ───────────────────────────────────────────────

    public log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
        this._send({ type: 'CMD_LOG', payload: { level, message } });
    }

    // ── Sandbox lifecycle (@internal) ─────────────────────────

    /** @internal sandbox.worker.ts から EVT_LIFECYCLE_INIT 時に呼ばれる */
    public _setInitialEntities(entities: WorldEntity[]): void {
        this._initialEntities = entities;
    }

    /** @internal sandbox.worker.ts から全ホストイベントをここに流す */
    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
            case 'EVT_LIFECYCLE_TICK': {
                try {
                    this._isTicking = true;
                    this.local.tick(event.payload.deltaTime, this._pendingWorkerEvents);
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
                this.presence.handlePlayerJoined(user);
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_JOINED,
                    payload: user,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_PLAYER_LEFT': {
                const { userId } = event.payload;
                this.presence.handlePlayerLeft(userId);
                for (const componentName of this.presence.getForEachUserComponents()) {
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
                this.presence.handleCursorMoved(userId, position, incoming);
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
                const entity = event.payload.entity as WorldEntity | undefined;
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
                        const data = entity.data as Record<string, unknown> | undefined;
                        if (data) binding.applyEntityData(data);
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
                    this.presence.handlePresenceSharedState(event.payload.userId, d.sharedState);
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
                        this.presence.handleScrollInput(d.x, d.y, now);
                    } else if (inputEvent.type === 'MOUSE_MOVE') {
                        const d = inputEvent.data as { viewportX: number; viewportY: number };
                        this.presence.handleMouseMoveInput(d.viewportX, d.viewportY, now);
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
