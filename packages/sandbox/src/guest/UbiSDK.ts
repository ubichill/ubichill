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

export type UiRenderCostStat = {
    targetId: string;
    entityId?: string;
    componentName?: string;
    renderCount: number;
    totalFactoryMs: number;
    averageFactoryMs: number;
    maxFactoryMs: number;
    lastFactoryMs: number;
    lastRenderedAt: number;
};

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

export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * `Ubi.state.define` が返すエンティティ状態オブジェクト。
 *
 * スコープマーカー (`Ubi.state.shared / persistent / persistMine`) でフィールドごとに同期方式を宣言する。
 * ローカル専用フィールドはマーカーなしで記述する。
 *
 * - `local`              : 全フィールドへの Proxy アクセス。書き込みはスコープに応じて自動フラッシュ
 *                          (shared → presence broadcast / persistent → entity.data / persistMine → entity.data[`${field}:${userId}`])
 * - `for(userId)`        : 指定ユーザーの値 + 位置を取得。shared/persistMine はそのユーザーの値、persistent/local は共通値を返す
 * - `onChange(key, fn)`  : 指定フィールドが変わったときに呼ばれるリスナー（ローカル・リモート両方を通知）
 * - `renderForEachUser()`: 全ユーザー統一描画（退室時は自動アンマウント）
 */
export interface EntityState<T extends Record<string, unknown>> {
    readonly local: T;
    for(userId: string): EntityStateFor<T>;
    onChange<K extends keyof T & string>(key: K, listener: (next: T[K], prev: T[K]) => void): void;
    renderForEachUser(componentName: string, factory: (state: EntityStateFor<T>) => VNode | null): void;
}

/** `EntityState.for()` / `renderForEachUser` コールバックの型 */
export type EntityStateFor<T extends Record<string, unknown>> = {
    readonly id: string;
    readonly worldX: number;
    readonly worldY: number;
    readonly viewportX: number;
    readonly viewportY: number;
} & { readonly [P in keyof T]: T[P] };

// ── スコープマーカー（state.define 内部でフィールドの同期方式を判定するために使う） ──
const UBI_STATE_SCOPE = Symbol.for('@ubichill/stateScope');
type StateScope = 'shared' | 'persistent' | 'persistMine';

interface ScopeMarker<T = unknown> {
    readonly [UBI_STATE_SCOPE]: StateScope;
    readonly value: T;
}

function isScopeMarker(v: unknown): v is ScopeMarker {
    return typeof v === 'object' && v !== null && UBI_STATE_SCOPE in v;
}

/**
 * SDK 内部で保持する状態バインディング。
 * EVT_ENTITY_WATCH 受信時に {@link applyEntityData} が呼ばれ、entity.data を local に反映する。
 */
interface StateBinding {
    /** 監視対象エンティティの種別（watchEntityTypes の先頭 or 自エンティティ種別） */
    readonly watchType: string;
    /** 現在の target entity id。未解決のとき null */
    getTargetId(): string | null;
    /** 未解決時のみターゲットを設定する */
    trySetTargetId(id: string): void;
    /** entity.data を local / perUserPersistMine に反映する */
    applyEntityData(data: Record<string, unknown>): void;
}

/** SDK 内部で保持するユーザーエントリ（viewport 座標は持たない・worldX/Y は可変） */
type PresenceEntry = {
    id: string;
    worldX: number;
    worldY: number;
    sharedState: Record<string, unknown>;
};

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
    private _uiRenderQueue = new Map<string, VNode | null>();
    private _uiFlushScheduled = false;
    private _isTicking = false;
    private _uiTargetScope = new Map<string, { entityId: string; componentName: string }>();
    private _uiRenderStats = new Map<
        string,
        {
            targetId: string;
            entityId?: string;
            componentName?: string;
            renderCount: number;
            totalFactoryMs: number;
            maxFactoryMs: number;
            lastFactoryMs: number;
            lastRenderedAt: number;
        }
    >();
    public readonly local: EcsWorld;

    public worldId?: string;
    public myUserId?: string;
    public pluginId?: string;
    public entityId?: string;
    public pluginBase = '';
    /** plugin.json の watchEntityTypes（state 自動同期のターゲット解決に使用） */
    public watchEntityTypes: string[] = [];

    // ── presence 内部状態 ──────────────────────────────────────────
    private _presenceUsers = new Map<string, PresenceEntry>();
    private _scrollX = 0;
    private _scrollY = 0;
    private _localViewportX = 0;
    private _localViewportY = 0;
    private _positionSyncThrottleMs = 0;
    private _lastPositionSent = 0;
    /** setSharedState で書き込んだ自分のローカル共有状態 */
    private _localSharedState: Record<string, unknown> = {};
    /** renderForEachUser で登録されたコンポーネント名（退室時のアンマウントに使用） */
    private _forEachUserComponents = new Set<string>();
    /** state.define の set() で dirty になった flush 関数（ティック末端で一括実行） */
    private _pendingStateFlushes = new Set<() => void>();
    /** state.define で作成されたバインディング（EVT_ENTITY_WATCH の受信時に local へ反映される） */
    private _stateBindings: StateBinding[] = [];
    /** Worker 起動時点で Host から渡された、watchEntityTypes にマッチする既存エンティティ */
    private _initialEntities: WorldEntity[] = [];

    private readonly _sendToHost: (cmd: PluginGuestCommand) => void;

    constructor(postMessage: (cmd: PluginGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this.local = new EcsWorldImpl();
    }

    /** presence 内部: スロットリングつき position:update 送信 */
    private _trySendPosition(worldX: number, worldY: number, now: number): void {
        if (this._positionSyncThrottleMs <= 0) return;
        if (now - this._lastPositionSent < this._positionSyncThrottleMs) return;
        this._lastPositionSent = now;
        this._send({
            type: 'NETWORK_SEND_TO_HOST',
            payload: {
                type: 'position:update',
                data: { x: worldX, y: worldY, sharedState: this._localSharedState },
            },
        });
    }

    private _buildEntityTargetId(entityId: string, componentName: string): string {
        return `entity:${entityId}:component:${componentName}`;
    }

    private _queueUiRender(targetId: string, vnode: VNode | null): void {
        this._uiRenderQueue.set(targetId, vnode);
        if (this._isTicking || this._uiFlushScheduled) return;
        this._uiFlushScheduled = true;
        queueMicrotask(() => {
            this._uiFlushScheduled = false;
            if (!this._isTicking) {
                this._flushUiRenderQueue();
            }
        });
    }

    private _flushUiRenderQueue(): void {
        if (this._uiRenderQueue.size === 0) return;
        for (const [targetId, vnode] of this._uiRenderQueue) {
            this._send({ type: 'UI_RENDER', payload: { targetId, vnode } });
        }
        this._uiRenderQueue.clear();
    }

    private _recordUiRenderCost(
        targetId: string,
        costMs: number,
        scope?: { entityId: string; componentName: string },
    ): void {
        if (scope) {
            this._uiTargetScope.set(targetId, scope);
        }
        const meta = this._uiTargetScope.get(targetId);
        const prev = this._uiRenderStats.get(targetId);
        this._uiRenderStats.set(targetId, {
            targetId,
            entityId: meta?.entityId,
            componentName: meta?.componentName,
            renderCount: (prev?.renderCount ?? 0) + 1,
            totalFactoryMs: (prev?.totalFactoryMs ?? 0) + costMs,
            maxFactoryMs: Math.max(prev?.maxFactoryMs ?? 0, costMs),
            lastFactoryMs: costMs,
            lastRenderedAt: Date.now(),
        });
    }

    private _renderUi(
        factory: () => VNode,
        targetId: string,
        scope?: { entityId: string; componentName: string },
    ): void {
        const start = performance.now();
        _beginRender(targetId);
        const vnode = factory();
        const costMs = performance.now() - start;
        this._recordUiRenderCost(targetId, costMs, scope);
        this._queueUiRender(targetId, vnode);
    }

    private _unmountUi(targetId: string): void {
        _clearTarget(targetId);
        this._queueUiRender(targetId, null);
    }

    /**
     * @internal Worker の init ハンドラが EVT_LIFECYCLE_INIT を受けたときに呼ぶ。
     * state.define はこのスナップショットを使ってプラグインコード実行前に local を同期反映する。
     */
    public _setInitialEntities(entities: WorldEntity[]): void {
        this._initialEntities = entities;
    }

    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
            case 'EVT_LIFECYCLE_TICK': {
                const dt = event.payload.deltaTime;
                try {
                    this._isTicking = true;
                    this.local.tick(dt, this._pendingWorkerEvents);
                } catch (err) {
                    console.error('[UbiSDK] ECS World tick error:', err);
                } finally {
                    this._isTicking = false;
                    this._pendingWorkerEvents.length = 0;
                    for (const flush of this._pendingStateFlushes) flush();
                    this._pendingStateFlushes.clear();
                    this._flushUiRenderQueue();
                }
                break;
            }
            case 'EVT_PLAYER_JOINED': {
                const user = event.payload.user;
                const existing = this._presenceUsers.get(user.id);
                // ホストが送ってくる既知フィールド (avatar, cursorState) を sharedState に収容
                const joinedSharedState: Record<string, unknown> = { ...(existing?.sharedState ?? {}) };
                if (user.avatar !== undefined) joinedSharedState.avatar = user.avatar;
                if (user.cursorState !== undefined) joinedSharedState.cursorState = user.cursorState;
                this._presenceUsers.set(user.id, {
                    id: user.id,
                    // 位置は CURSOR_MOVED で上書きされるため既存値を優先
                    worldX: existing?.worldX ?? user.position?.x ?? 0,
                    worldY: existing?.worldY ?? user.position?.y ?? 0,
                    sharedState: joinedSharedState,
                });
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_JOINED,
                    payload: user,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_PLAYER_LEFT': {
                const userId = event.payload.userId;
                this._presenceUsers.delete(userId);
                // renderForEachUser で描画済みのターゲットをアンマウント
                for (const componentName of this._forEachUserComponents) {
                    this._unmountUi(this._buildEntityTargetId(`user:${userId}`, componentName));
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
                const entry = this._presenceUsers.get(userId);
                if (entry) {
                    entry.worldX = position.x;
                    entry.worldY = position.y;
                    // ホストが sharedState を中継してきた場合はマージ
                    const incoming = (event.payload as { sharedState?: Record<string, unknown> }).sharedState;
                    if (incoming) Object.assign(entry.sharedState, incoming);
                }
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
                if (entity && this._stateBindings.length > 0) {
                    for (const binding of this._stateBindings) {
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
                // presence:sharedState は SDK レベルで処理し ECS には渡さない
                if (event.payload.type === 'presence:sharedState') {
                    const entry = this._presenceUsers.get(event.payload.userId);
                    if (entry) {
                        const d = event.payload.data as { sharedState: Record<string, unknown> };
                        Object.assign(entry.sharedState, d.sharedState);
                    }
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
                        this._scrollX = d.x;
                        this._scrollY = d.y;
                        this._trySendPosition(this._localViewportX + d.x, this._localViewportY + d.y, now);
                    } else if (inputEvent.type === 'MOUSE_MOVE') {
                        const d = inputEvent.data as { viewportX: number; viewportY: number };
                        this._localViewportX = d.viewportX;
                        this._localViewportY = d.viewportY;
                        this._trySendPosition(d.viewportX + this._scrollX, d.viewportY + this._scrollY, now);
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
            this._renderUi(factory, targetId);
        },

        /**
         * entity/component 単位で描画する。
         * targetId の命名を統一し、描画コストを entity 単位で集計しやすくする。
         */
        renderEntity: (entityId: string, componentName: string, factory: () => VNode): void => {
            const targetId = this._buildEntityTargetId(entityId, componentName);
            this._renderUi(factory, targetId, { entityId, componentName });
        },

        /**
         * UI をアンマウントする。
         * @param targetId Host 側の描画スロット名（省略時: 'default'）
         */
        unmount: (targetId = 'default'): void => {
            this._unmountUi(targetId);
        },

        /**
         * entity/component 単位でアンマウントする。
         */
        unmountEntity: (entityId: string, componentName: string): void => {
            this._unmountUi(this._buildEntityTargetId(entityId, componentName));
        },

        /**
         * target/entity/component ごとの描画コスト統計を取得する。
         * 1件 = 1targetId の累積値。
         */
        getRenderStats: (): UiRenderCostStat[] => {
            const out: UiRenderCostStat[] = [];
            for (const stat of this._uiRenderStats.values()) {
                out.push({
                    targetId: stat.targetId,
                    entityId: stat.entityId,
                    componentName: stat.componentName,
                    renderCount: stat.renderCount,
                    totalFactoryMs: stat.totalFactoryMs,
                    averageFactoryMs: stat.renderCount > 0 ? stat.totalFactoryMs / stat.renderCount : 0,
                    maxFactoryMs: stat.maxFactoryMs,
                    lastFactoryMs: stat.lastFactoryMs,
                    lastRenderedAt: stat.lastRenderedAt,
                });
            }
            return out.sort((a, b) => b.totalFactoryMs - a.totalFactoryMs);
        },

        /**
         * 描画コスト統計をクリアする。entityId 指定時はその entity のみ削除。
         */
        clearRenderStats: (entityId?: string): void => {
            if (!entityId) {
                this._uiRenderStats.clear();
                this._uiTargetScope.clear();
                return;
            }
            for (const [targetId, stat] of this._uiRenderStats) {
                if (stat.entityId === entityId) {
                    this._uiRenderStats.delete(targetId);
                    this._uiTargetScope.delete(targetId);
                }
            }
        },
    };

    /**
     * ワールド参加中ユーザーの位置情報と位置同期の制御。
     */
    public readonly presence = {
        /** 現在ワールドにいる全ユーザーの ID セット（位置つき） */
        users: (): ReadonlyMap<string, { worldX: number; worldY: number; viewportX: number; viewportY: number }> => {
            const result = new Map<string, { worldX: number; worldY: number; viewportX: number; viewportY: number }>();
            for (const [id, entry] of this._presenceUsers) {
                result.set(id, {
                    worldX: entry.worldX,
                    worldY: entry.worldY,
                    viewportX: entry.worldX - this._scrollX,
                    viewportY: entry.worldY - this._scrollY,
                });
            }
            return result;
        },

        /** 現在のスクロール量 */
        scroll: (): { readonly x: number; readonly y: number } => ({
            x: this._scrollX,
            y: this._scrollY,
        }),

        /**
         * マウス移動・スクロール時に position:update をホストへ自動送信する。
         * capability: 'net:host-message' が必要。
         *
         * @param options.throttleMs  送信間隔 (ms)。デフォルト 50ms。
         */
        syncPosition: (options?: { throttleMs?: number }): void => {
            this._positionSyncThrottleMs = options?.throttleMs ?? 50;
        },
    };

    /**
     * エンティティ状態の管理。
     *
     * `Ubi.state.define(schema)` でエンティティの全状態を一か所で宣言する。
     * 各フィールドにスコープマーカーを付けて同期方式を選ぶ:
     *
     * - `Ubi.state.shared(default)`      : presence 経由で全ユーザーへ broadcast（ephemeral）
     * - `Ubi.state.persistent(default)`  : entity.data に書き込む（共有 + リロード後も保持）
     * - `Ubi.state.persistMine(default)` : entity.data[`${field}:${userId}`] に書き込む（ユーザーごと）
     * - マーカーなし                     : ローカルのみ（自分のプロセス内）
     *
     * 同期対象のエンティティ（= `persistent` / `persistMine` の書き込み先）は
     * plugin.json の watchEntityTypes から自動解決される:
     *   - 自プラグインの entityType が watchEntityTypes に含まれる → Ubi.entityId（自エンティティ）
     *   - それ以外 → watchEntityTypes[0] の最初のエンティティ
     *
     * @example
     * ```ts
     * const state = Ubi.state.define({
     *   playlist: Ubi.state.persistent([] as Track[]),  // entity.data に保存
     *   isPlaying: Ubi.state.persistent(false),
     *   myVolume: Ubi.state.persistMine(0.7),           // 自分だけの音量
     *   localTime: 0,                                   // ローカルのみ
     * });
     *
     * state.local.playlist = [newTrack];  // → entity.data に自動保存
     * state.local.myVolume = 0.8;          // → entity.data['myVolume:<userId>'] に保存
     * state.onChange('isPlaying', (next) => { if (next) play(); });
     * ```
     */
    public readonly state = {
        /** presence 経由で全ユーザーへ broadcast する ephemeral フィールド */
        shared: <T>(defaultValue: T): T =>
            ({ [UBI_STATE_SCOPE]: 'shared' as StateScope, value: defaultValue }) as unknown as T,
        /** entity.data に書き込む共有フィールド（ページをリロードしても残る） */
        persistent: <T>(defaultValue: T): T =>
            ({ [UBI_STATE_SCOPE]: 'persistent' as StateScope, value: defaultValue }) as unknown as T,
        /** entity.data[`${field}:${userId}`] に書き込むユーザーごとのフィールド */
        persistMine: <T>(defaultValue: T): T =>
            ({ [UBI_STATE_SCOPE]: 'persistMine' as StateScope, value: defaultValue }) as unknown as T,

        define: <T extends Record<string, unknown>>(schema: T): EntityState<T> => {
            // ── スキーマをスコープと初期値に分解 ─────────────────────
            const scopes = new Map<string, StateScope | 'local'>();
            const defaults: Record<string, unknown> = {};
            for (const key of Object.keys(schema)) {
                const raw = (schema as Record<string, unknown>)[key];
                if (isScopeMarker(raw)) {
                    scopes.set(key, raw[UBI_STATE_SCOPE]);
                    defaults[key] = raw.value;
                } else {
                    scopes.set(key, 'local');
                    defaults[key] = raw;
                }
            }

            const local: Record<string, unknown> = { ...defaults };
            // 他ユーザーの persistMine 値（entity.data から抽出）
            const perUserPersistMine = new Map<string, Record<string, unknown>>();
            const listeners = new Map<string, Set<(next: unknown, prev: unknown) => void>>();

            // ── shared フィールドを presence の _localSharedState にシード ──
            for (const [key, scope] of scopes) {
                if (scope === 'shared' && !(key in this._localSharedState)) {
                    this._localSharedState[key] = defaults[key];
                }
            }

            // ── 同期対象エンティティの解決 ──────────────────────────
            // 優先順位:
            //   (1) 自エンティティが watchEntityTypes に含まれているならそれを使う
            //   (2) Host から渡された initialEntities のうち watchEntityTypes にマッチするもの
            // どちらも該当しなければ targetEntityId は null のまま、その後の EVT_ENTITY_WATCH で解決する。
            const watchType = this.watchEntityTypes[0] ?? this.pluginId ?? '';
            let targetEntityId: string | null = null;
            let initialData: Record<string, unknown> | null = null;
            if (this.entityId && this.pluginId && this.watchEntityTypes.includes(this.pluginId)) {
                targetEntityId = this.entityId;
                const self = this._initialEntities.find((e) => e.id === this.entityId);
                initialData = (self?.data as Record<string, unknown> | undefined) ?? null;
            } else if (watchType) {
                const match = this._initialEntities.find((e) => e.type === watchType);
                if (match) {
                    targetEntityId = match.id;
                    initialData = (match.data as Record<string, unknown> | undefined) ?? null;
                }
            }

            // ── flush バッファ ──────────────────────────────────────
            const pendingSharedWrites: Record<string, unknown> = {};
            const pendingEntityWrites: Record<string, unknown> = {};
            let sharedDirty = false;
            let entityDirty = false;

            const flushShared = (): void => {
                if (!sharedDirty) return;
                sharedDirty = false;
                Object.assign(this._localSharedState, pendingSharedWrites);
                if (this.myUserId) {
                    const me = this._presenceUsers.get(this.myUserId);
                    if (me) Object.assign(me.sharedState, pendingSharedWrites);
                }
                this._send({
                    type: 'NETWORK_BROADCAST',
                    payload: {
                        type: 'presence:sharedState',
                        data: { sharedState: { ...pendingSharedWrites } },
                    },
                });
                for (const k of Object.keys(pendingSharedWrites)) delete pendingSharedWrites[k];
            };

            const flushEntity = (): void => {
                if (!entityDirty) return;
                if (!targetEntityId) return; // target 未解決 → 次回のフラッシュで再試行
                entityDirty = false;
                const id = targetEntityId;
                const patch = { ...pendingEntityWrites };
                for (const k of Object.keys(pendingEntityWrites)) delete pendingEntityWrites[k];
                void this.world.updateEntity(id, { data: patch });
            };

            const fire = (key: string, next: unknown, prev: unknown): void => {
                const set = listeners.get(key);
                if (!set) return;
                for (const fn of set) fn(next, prev);
            };

            // ── entity.data → local への反映 ───────────────────────
            const applyEntityData = (data: Record<string, unknown>): void => {
                const persistMinePrefixes = new Map<string, string>(); // 'field:' → fieldName
                for (const [key, scope] of scopes) {
                    if (scope === 'persistent') {
                        if (key in data) {
                            const next = data[key];
                            const prev = local[key];
                            if (next !== prev) {
                                local[key] = next;
                                fire(key, next, prev);
                            }
                        }
                    } else if (scope === 'persistMine') {
                        persistMinePrefixes.set(`${key}:`, key);
                    }
                }

                if (persistMinePrefixes.size === 0) return;
                for (const dataKey of Object.keys(data)) {
                    for (const [prefix, field] of persistMinePrefixes) {
                        if (!dataKey.startsWith(prefix)) continue;
                        const userId = dataKey.slice(prefix.length);
                        if (!userId) break;
                        const value = data[dataKey];
                        if (userId === this.myUserId) {
                            const prev = local[field];
                            if (prev !== value) {
                                local[field] = value;
                                fire(field, value, prev);
                            }
                        } else {
                            let entry = perUserPersistMine.get(userId);
                            if (!entry) {
                                entry = {};
                                perUserPersistMine.set(userId, entry);
                            }
                            entry[field] = value;
                        }
                        break;
                    }
                }
            };

            // ── プラグインコード実行前に初期エンティティを同期反映 ──
            // ここで onChange listener はまだ登録されていないので fire は空打ちになる。
            // プラグインは state.local.xxx を読めば初期値が取れる。
            if (initialData) applyEntityData(initialData);

            // ── バインディング登録 ──────────────────────────────────
            this._stateBindings.push({
                watchType,
                getTargetId: () => targetEntityId,
                trySetTargetId: (id) => {
                    if (!targetEntityId) targetEntityId = id;
                },
                applyEntityData,
            });

            // ── local は Proxy。書き込みでスコープに応じた flush を予約 ──
            const proxy = new Proxy(local, {
                get: (target, prop) => (typeof prop === 'string' ? target[prop] : undefined),
                set: (target, prop, value) => {
                    if (typeof prop !== 'string') return false;
                    const prev = target[prop];
                    target[prop] = value;
                    if (prev === value) return true;

                    const scope = scopes.get(prop) ?? 'local';
                    fire(prop, value, prev);

                    if (scope === 'shared') {
                        pendingSharedWrites[prop] = value;
                        sharedDirty = true;
                        this._pendingStateFlushes.add(flushShared);
                    } else if (scope === 'persistent') {
                        pendingEntityWrites[prop] = value;
                        entityDirty = true;
                        this._pendingStateFlushes.add(flushEntity);
                    } else if (scope === 'persistMine' && this.myUserId) {
                        pendingEntityWrites[`${prop}:${this.myUserId}`] = value;
                        entityDirty = true;
                        this._pendingStateFlushes.add(flushEntity);
                    }
                    return true;
                },
            }) as T;

            const getFor = (userId: string): EntityStateFor<T> => {
                const entry = this._presenceUsers.get(userId);
                const mine = perUserPersistMine.get(userId);
                const result: Record<string, unknown> = { id: userId };
                for (const [key, scope] of scopes) {
                    if (scope === 'shared') {
                        result[key] = entry?.sharedState[key] !== undefined ? entry.sharedState[key] : defaults[key];
                    } else if (scope === 'persistMine') {
                        if (userId === this.myUserId) {
                            result[key] = local[key];
                        } else {
                            result[key] = mine?.[key] !== undefined ? mine[key] : defaults[key];
                        }
                    } else {
                        result[key] = local[key];
                    }
                }
                const worldX = entry?.worldX ?? 0;
                const worldY = entry?.worldY ?? 0;
                result.worldX = worldX;
                result.worldY = worldY;
                result.viewportX = worldX - this._scrollX;
                result.viewportY = worldY - this._scrollY;
                return result as unknown as EntityStateFor<T>;
            };

            return {
                local: proxy,
                for: getFor,
                onChange: (key, listener) => {
                    let set = listeners.get(key);
                    if (!set) {
                        set = new Set();
                        listeners.set(key, set);
                    }
                    set.add(listener as (n: unknown, p: unknown) => void);
                },
                renderForEachUser: (componentName, factory) => {
                    this._forEachUserComponents.add(componentName);
                    for (const [userId] of this._presenceUsers) {
                        const stateFor = getFor(userId);
                        const targetId = this._buildEntityTargetId(`user:${userId}`, componentName);
                        const scope = { entityId: `user:${userId}`, componentName };
                        const start = performance.now();
                        _beginRender(targetId);
                        const vnode = factory(stateFor);
                        const costMs = performance.now() - start;
                        this._recordUiRenderCost(targetId, costMs, scope);
                        if (vnode === null) {
                            this._unmountUi(targetId);
                        } else {
                            this._queueUiRender(targetId, vnode);
                        }
                    }
                },
            };
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
