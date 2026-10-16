import type { EcsWorld, System, WorkerEvent } from '@ubichill/ecs';
import { EcsEventType, EcsWorldImpl } from '@ubichill/ecs';
import type { ComponentInstance } from '@ubichill/shared/mod/entities';
import { UbiError, UbiErrorCode } from '@ubichill/shared/mod/errors';
import { CommandType, normalizeFetchLimits } from '@ubichill/shared/mod/protocol';
import type {
    FetchOptions,
    FetchResult,
    ModGuestCommand,
    ModHostEvent,
    ModWorkerMessage,
} from '@ubichill/shared/mod/types';
import { _beginRender, _callHandler, _clearTarget } from '../jsx/jsx-runtime';
import type { AssetModule } from './asset';
import { createAssetModule } from './asset';
import type { CanvasModule } from './canvas';
import { createCanvasModule } from './canvas';
import type { EntityModule } from './entity';
import { createEntityModule } from './entity';
import type { EventModule } from './event';
import { createEventModule } from './event';
import type { GripModule } from './grip';
import { createGripModule } from './grip';
import type { IdentityModule } from './identity';
import { createIdentityModule } from './identity';
import type { MediaModule } from './media';
import { createMediaModule } from './media';
import type { PlayerModule } from './player';
import { createPlayerModule } from './player';
import { createReadTracker } from './reactiveTracking';
import type { RideModule } from './ride';
import { createRideModule } from './ride';
import type { RuntimeModule } from './runtime';
import { createRuntimeModule } from './runtime';
import type { StateModule } from './state';
import { createStateModule } from './state';
import type { OmitId, RpcOptions, UiRenderCostStat } from './types';
import type { UiModule } from './ui';
import { createUiModule } from './ui';
import type { WorldModule } from './world';
import { createWorldModule } from './world';

export type { ModWorkerMessage, OmitId, UiRenderCostStat };

// ── mod 向け公開サーフェス ───────────────────────────────────
// 規約: `_`接頭のメンバは「内部」。mod に見せる型からは一律で除く。
// `Omit` はメソッドのジェネリクス（例: state.sync<T>）を保持するので安全。

/** `Ubi.ui` の公開面（内部レンダーキュー操作 `_*` を含まない）。 */
export type Ui = Omit<UiModule, `_${string}`>;
/** `Ubi.player` の公開面（イベントハンドラ等の内部アクセサ `_*` を含まない）。 */
export type Player = Omit<PlayerModule, `_${string}`>;
/** `Ubi.state` の公開面（バインディング列挙 `_*` を含まない）。 */
export type State = Omit<StateModule, `_${string}`>;

/**
 * mod 開発者に見せる `Ubi` グローバルの型。
 *
 * `sandbox.worker.ts` は実体として {@link UbiSDK} を注入するが、mod からは
 * 内部ライフサイクル（`_dispatchEvent` 等）やモジュール内部メソッド（`_`接頭）を
 * 触れないよう、この公開型のみを `import('@ubichill/sdk').Ubi` で参照する。
 */
export type Ubi = Omit<UbiSDK, `_${string}` | 'ui' | 'player' | 'state'> & {
    readonly ui: Ui;
    readonly player: Player;
    readonly state: State;
};

/**
 * `Ubi.fetch` のオプション。`signal` は Worker 内だけで使い、Host へは送らない。
 * 本文の受け取り方・上限・制限時間は {@link FetchOptions}。
 */
export type UbiFetchOptions = FetchOptions & {
    /** abort すると通信を取り消し、`FETCH_ABORTED` の UbiError で失敗する。 */
    signal?: AbortSignal;
};

/** Host の制限時間が先に切れて FETCH_TIMEOUT の結果が届くよう、SDK 側はこれだけ長く待つ。 */
const FETCH_RPC_GRACE_MS = 5_000;

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
    reject: (error: string, code?: UbiErrorCode) => void;
};

/**
 * Ubichill Mod SDK のメインクラス。Sandbox Worker 内では `Ubi` として注入される。
 *
 * Public API surface:
 *   Ubi.state.*     — 宣言的リアクティブ状態 (sync の options で挙動切替)
 *   Ubi.event.*     — トリガー (sendToHost / broadcast / emit)
 *   Ubi.entity.*    — エンティティ操作 (self / of(id) / query / get / spawn)
 *   Ubi.ui.*        — UI render / toast
 *   Ubi.media.*     — メディア再生 (video / audio / HLS)
 *   Ubi.canvas.*    — canvas 描画
 *   Ubi.player.*    — プレイヤー情報 (others / scroll / syncCursor)
 *   Ubi.asset.*     — 同梱アセット・WASM（integrity 照合つき）
 *   Ubi.runtime.*   — 実行環境の能力判定（WASM の機能・Host の版）
 *   Ubi.identity.*  — 外部サービスへの身元証明（サービストークン）
 *   Ubi.fetch(url)  — HTTP（ユーザーが許可したドメインのみ。バイナリ・取り消し対応）
 *   Ubi.registerSystem(fn) — ECS System 登録
 *   Ubi.log(msg, level)
 */
export class UbiSDK {
    /** fetch はドメイン初回承認でユーザー応答待ちになるため長めのタイムアウトにする（既定値）。 */
    static readonly FETCH_RPC_TIMEOUT_MS = normalizeFetchLimits().timeoutMs + FETCH_RPC_GRACE_MS;

    // ── RPC ──────────────────────────────────────────────────
    private _commandCounter = 0;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _rpcTimeout: number;
    private readonly _sendToHost: (cmd: ModGuestCommand) => void;

    // ── ECS ──────────────────────────────────────────────────
    private _pendingWorkerEvents: WorkerEvent[] = [];
    private _isTicking = false;
    private readonly _local: EcsWorld;

    // ── State flush ──────────────────────────────────────────
    private _pendingStateFlushes = new Set<() => void>();
    private _initialEntities: ComponentInstance[] = [];

    // ── Mod identity (sandbox.worker.ts が設定) ──────────
    /** この mod が動いているワールドの id。 */
    public worldId?: string;
    /** 自分（このクライアント）のユーザー id。`player.for` 等で自他を判定するのに使う。 */
    public myUserId?: string;
    /** この mod（配布単位）の id。 */
    public modId?: string;
    /** 自 Worker (= 1 Component インスタンス) を識別する flat ID。 */
    public componentInstanceId?: string;
    /** 自 Worker が乗っている Entity (GameObject) の id。Pure ECS 用語の Entity に対応。 */
    public entityId?: string;
    /** 自 Worker の Component 型 (`modId:componentName`) */
    public componentType?: string;
    public modBase = '';
    public watchEntityTypes: string[] = [];
    /** Host環境がタッチ/ペン等の低精度ポインタか (`matchMedia('(pointer: coarse)')`)。スマホ向け入力UIの出し分けに使う。 */
    public hasCoarsePointer = false;
    private _hostProtocolVersion = 0;

    // ── Public API modules ───────────────────────────────────
    /** 宣言的リアクティブ状態。`define` でスキーマを作り `sync` で同期範囲（共有/永続/ユーザー別）を指定する。 */
    public readonly state: StateModule;
    /** イベント送受信。`sendToHost`（本体へ）/`broadcast`（他ユーザーへ）/`emit`（同タブ内他Worker）と型付き `define`。 */
    public readonly event: EventModule;
    /** UI 描画。`render` で VNode を描き、`showToast` で通知を出す。 */
    public readonly ui: UiModule;
    /** メディア再生。動画/音声/HLS の読み込みと再生/停止/シーク/音量。 */
    public readonly media: MediaModule;
    /** 共有キャンバス描画。`frame` で描画フレーム、`commitStroke` でストローク確定。 */
    public readonly canvas: CanvasModule;
    /** プレイヤー情報。`others`/`all` で参加者、`scroll` でスクロール位置、`syncCursor` でカーソル同期。 */
    public readonly player: PlayerModule;
    /** エンティティ操作。`Ubi.entity()` で自身、`Ubi.entity(id)` で他を参照し、`query`/`get`/`spawn` で操作する。 */
    public readonly entity: EntityModule;
    /** 「掴む」操作。ペン等のドラッグ/press ライフサイクルを宣言的に扱う。 */
    public readonly grip: GripModule;
    /** 「乗る」操作。乗り物 Entity を宣言的に扱う。乗車中は自分のアバターがキーボード移動+カメラ追従に切り替わる。 */
    public readonly ride: RideModule;
    /** 同梱アセット。`bytes`/`text` で読み、`wasm` で WebAssembly をコンパイルする（manifest の integrity と照合済み）。 */
    public readonly asset: AssetModule;
    /** 実行環境の能力判定。`supports('wasm:simd')` などで分岐し、`require` で未対応を明確なエラーにする。 */
    public readonly runtime: RuntimeModule;
    /** 外部サービスへの身元証明。`token(audience)` でそのサービス専用の短命なトークンを受け取る。 */
    public readonly identity: IdentityModule;
    /** @internal Ubi.state / Ubi.entity の実装で使用。modからは Ubi.entity 経由で操作する。 */
    private readonly _world: WorldModule;

    constructor(postMessage: (cmd: ModGuestCommand) => void, options?: { rpcTimeout?: number }) {
        this._sendToHost = postMessage;
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this._local = new EcsWorldImpl();

        const send = (cmd: OmitId<ModGuestCommand>): void => this._send(cmd);
        const rpc = <T>(cmd: OmitId<ModGuestCommand>, rpcOptions?: RpcOptions): Promise<T> =>
            this._rpc<T>(cmd, rpcOptions);

        // Ubi.ui.render の自動再描画（依存追跡）用。ui/state 両モジュールで共有する1個だけ
        // 生成し deps 経由で配る（モジュール単一状態にしない — reactiveTracking.ts の docstring 参照）。
        const readTracker = createReadTracker();

        this.player = createPlayerModule(send, () => this.myUserId);
        this.ui = createUiModule(send, () => this._isTicking, _beginRender, _clearTarget, readTracker);
        this._world = createWorldModule(send, rpc);
        this.state = createStateModule({
            send,
            updateEntity: (id, patch) => this._world.update(id, patch),
            getMyUserId: () => this.myUserId,
            getEntityId: () => this.entityId,
            getModId: () => this.modId,
            getComponentType: () => this.componentType,
            getWatchEntityTypes: () => this.watchEntityTypes,
            getPresenceUsers: () => this.player._getPresenceUsers(),
            getLocalSharedState: () => this.player._getLocalSharedState(),
            getScrollX: () => this.player._getScrollX(),
            getScrollY: () => this.player._getScrollY(),
            getForEachUserComponents: () => this.player._getForEachUserComponents(),
            registerPendingFlush: (fn) => this._pendingStateFlushes.add(fn),
            getInitialEntities: () => this._initialEntities,
            trackRead: readTracker.recordRead,
            beginRender: _beginRender,
            queueUiRender: (targetId, vnode) => this.ui._queueUiRender(targetId, vnode),
            unmountUi: (targetId) => this.ui._unmountUi(targetId),
            recordUiRenderCost: (targetId, costMs, scope) => this.ui._recordUiRenderCost(targetId, costMs, scope),
            buildEntityTargetId: (entityId, componentName) => this.ui._buildEntityTargetId(entityId, componentName),
        });
        this.event = createEventModule({
            send,
            registerSystem: (system) => this._local.registerSystem(system),
        });
        this.media = createMediaModule(send);
        this.canvas = createCanvasModule(send);
        this.asset = createAssetModule({
            rpc: (cmd, rpcOptions) => this._rpc(cmd, { timeoutMs: UbiSDK.FETCH_RPC_TIMEOUT_MS, ...rpcOptions }),
        });
        this.identity = createIdentityModule((cmd, rpcOptions) =>
            this._rpc(cmd, { timeoutMs: UbiSDK.FETCH_RPC_TIMEOUT_MS, ...rpcOptions }),
        );
        this.runtime = createRuntimeModule(() => this._hostProtocolVersion, {
            webAssembly: globalThis.WebAssembly,
            sharedArrayBuffer: (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer,
            crossOriginIsolated: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
        });
        this.entity = createEntityModule(
            this._world,
            () => this.componentInstanceId,
            () => this.entityId,
        );
        this.grip = createGripModule({
            state: this.state,
            event: this.event,
            getMyUserId: () => this.myUserId,
            getComponentInstanceId: () => this.componentInstanceId,
            getComponentType: () => this.componentType,
            getEntityId: () => this.entityId,
            listenMouseUp: (cb) => {
                // input:mouse_up ECS イベントを one-shot で listen して press モードの自動解放に使う
                let fired = false;
                const events = this.event.define<{ [EcsEventType.INPUT_MOUSE_UP]: unknown }>();
                const unsub = events.on(EcsEventType.INPUT_MOUSE_UP, () => {
                    if (fired) return;
                    fired = true;
                    cb();
                    unsub();
                });
                return unsub;
            },
            sendGripCommand: (payload) => {
                // _send は OmitId<ModGuestCommand> を受け取り内部で _sendToHost を呼ぶ。
                // CmdGrip は fire-and-forget で id を持たないので OmitId<...> として直接渡せる。
                this._send({ type: CommandType.CMD_GRIP, payload });
            },
            bringToFront: async () => {
                // 自エンティティの transform.z を「同じ Component type の最大 z + 1」に持ち上げる。
                // ペンを持ったときに視覚的に手前に来て、リリース後もその位置 (z) が永続する。
                const type = this.componentType;
                const self = this.componentInstanceId;
                if (!type || !self) return;
                try {
                    const siblings = await this.entity.query(type);
                    let maxZ = 0;
                    let myEntity: ComponentInstance | undefined;
                    for (const s of siblings) {
                        if (s.id === self) myEntity = s;
                        if ((s.transform.z ?? 0) > maxZ) maxZ = s.transform.z ?? 0;
                    }
                    if (!myEntity) return;
                    const myZ = myEntity.transform.z ?? 0;
                    // 既に最前面なら更新しない (毎 click で z を無限に伸ばさない)
                    if (myZ === maxZ) return;
                    // 既存 transform を保ったまま z だけ更新 (patch.transform は完全な型を要求する)
                    await this.entity(self).update({ transform: { ...myEntity.transform, z: maxZ + 1 } });
                } catch {
                    // entity.query / update の失敗は UX に影響しないので無視
                }
            },
        });
        this.ride = createRideModule({
            state: this.state,
            getMyUserId: () => this.myUserId,
            getComponentInstanceId: () => this.componentInstanceId,
            sendRideCommand: (payload) => {
                this._send({ type: CommandType.CMD_RIDE, payload });
            },
        });
    }

    // ── Top-level shortcuts ──────────────────────────────────

    /**
     * HTTP リクエスト。ユーザーが許可したドメイン（と自分のアセット・名前空間）にだけ届く。
     *
     * - `responseType: 'arrayBuffer'` で本文をバイト列として受け取る（コピーせずに Worker へ移る）。
     * - `maxBytes` / `timeoutMs` は Host の上限（`FETCH_LIMITS`）の範囲で指定できる。`timeoutMs` は承認待ちを含む。
     * - `signal` を abort すると取り消し、`FETCH_ABORTED` の UbiError で失敗する。
     * - ドメイン拒否・制限時間・サイズ超過などは失敗の FetchResult（`error.code` 付き）で返る。
     *
     * ブラウザの CORS・cookie・禁止ヘッダーの制限はそのまま残る（Host が許可しても解除されない）。
     */
    public fetch(url: string, options?: UbiFetchOptions & { responseType?: 'text' }): Promise<FetchResult<string>>;
    public fetch(
        url: string,
        options: UbiFetchOptions & { responseType: 'arrayBuffer' },
    ): Promise<FetchResult<ArrayBuffer>>;
    public fetch(url: string, options: UbiFetchOptions = {}): Promise<FetchResult<string | ArrayBuffer>> {
        const { signal, ...wireOptions } = options;
        const { timeoutMs } = normalizeFetchLimits(wireOptions);
        return this._rpc(
            { type: CommandType.NETWORK_FETCH, payload: { url, options: wireOptions } },
            { timeoutMs: timeoutMs + FETCH_RPC_GRACE_MS, signal },
        );
    }

    // ── Transport ─────────────────────────────────────────────

    private _send(command: OmitId<ModGuestCommand>): void {
        this._sendToHost(command as ModGuestCommand);
    }

    private _rpc<T>(command: OmitId<ModGuestCommand>, options: RpcOptions = {}): Promise<T> {
        const timeoutMs = options.timeoutMs ?? this._rpcTimeout;
        const { signal } = options;
        const prefix = this.modId ? `[UbiSDK:${this.modId}]` : '[UbiSDK]';
        if (signal?.aborted) {
            return Promise.reject(
                new UbiError(UbiErrorCode.FETCH_ABORTED, `${prefix} 取り消されました: ${command.type}`),
            );
        }
        const id = `rpc_${this._commandCounter++}`;
        return new Promise<T>((resolve, reject) => {
            const settle = (): void => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                this._pendingRequests.delete(id);
            };
            // 待つのをやめたら Host にも伝え、通信と後片付けを止めてもらう。
            const cancel = (error: UbiError): void => {
                settle();
                this._send({ type: CommandType.CMD_ABORT, payload: { requestId: id } });
                reject(error);
            };
            const onAbort = (): void =>
                cancel(new UbiError(UbiErrorCode.FETCH_ABORTED, `${prefix} 取り消されました: ${command.type}`));
            const timer = setTimeout(
                () =>
                    cancel(
                        new UbiError(
                            UbiErrorCode.RPC_TIMEOUT,
                            `${prefix} RPC タイムアウト (${timeoutMs}ms): ${command.type}`,
                        ),
                    ),
                timeoutMs,
            );
            signal?.addEventListener('abort', onAbort, { once: true });
            this._pendingRequests.set(id, {
                resolve: (data) => {
                    settle();
                    resolve(data as T);
                },
                reject: (error, code) => {
                    settle();
                    // code があれば UbiError、無ければ通常 Error (後方互換)
                    reject(code ? new UbiError(code, error) : new Error(error));
                },
            });
            this._sendToHost({ ...command, id } as ModGuestCommand);
        });
    }

    // ── ECS ───────────────────────────────────────────────────

    /**
     * ECS System を登録する。毎フレーム `(entities, deltaTimeMs, events)` で呼ばれる。
     * mod のロジックの実行単位で、`events` には入力・イベント・エンティティ更新が届く。
     *
     * `deltaTimeMs` は前回tickからの経過時間で**ミリ秒**単位（秒ではない）。
     * 秒基準の速度計算をする場合は `deltaTimeMs / 1000` に変換すること。
     */
    public registerSystem(system: System): void {
        this._local.registerSystem(system);
    }

    // ── Logging ───────────────────────────────────────────────

    /**
     * Host のコンソール/診断へログを出す。mod 内の `console.log` もここへリダイレクトされる。
     * @param level 既定は `'info'`。
     */
    public log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
        this._send({ type: CommandType.CMD_LOG, payload: { level, message } });
    }

    // ── Sandbox lifecycle (@internal) ─────────────────────────

    /** @internal sandbox.worker.ts から EVT_LIFECYCLE_INIT 時に呼ばれる */
    public _setInitialEntities(entities: ComponentInstance[]): void {
        this._initialEntities = entities;
    }

    /** @internal sandbox.worker.ts から EVT_LIFECYCLE_INIT 時に呼ばれる（`Ubi.runtime.protocolVersion`）。 */
    public _setHostProtocolVersion(version: number): void {
        this._hostProtocolVersion = version;
    }

    /** @internal sandbox.worker.ts から全ホストイベントをここに流す */
    public _dispatchEvent(event: ModHostEvent): void {
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
                this.player._handlePlayerJoined(user);
                this._pendingWorkerEvents.push({
                    type: EcsEventType.PLAYER_JOINED,
                    payload: user,
                    timestamp: Date.now(),
                });
                break;
            }
            case 'EVT_PLAYER_LEFT': {
                const { userId } = event.payload;
                this.player._handlePlayerLeft(userId);
                for (const componentName of this.player._getForEachUserComponents()) {
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
                this.player._handleCursorMoved(userId, position, incoming);
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
                        pending.reject(event.error ?? 'Unknown RPC error', event.errorCode);
                    }
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
                    for (const binding of this.state._getStateBindings()) {
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
                    this.player._handlePresenceSharedState(event.payload.userId, d.sharedState);
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
                        this.player._handleScrollInput(d.x, d.y, now);
                    } else if (inputEvent.type === 'MOUSE_MOVE') {
                        const d = inputEvent.data as { viewportX: number; viewportY: number };
                        this.player._handleMouseMoveInput(d.viewportX, d.viewportY, now);
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
            case 'EVT_MEDIA_STATE':
                this.media._handleState(event.payload);
                this._pendingWorkerEvents.push({
                    type: 'media:stateChange',
                    payload: event.payload,
                    timestamp: event.payload.observedAt,
                });
                break;
        }
    }
}
