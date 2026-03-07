// ============================================
// UbiSDK — Ubichill Plugin SDK (統合クラス)
//
// Sandbox Worker 内でも Worker 外（テスト・ES モジュール利用）でも
// 同一クラスを使います。`_postMessage` を差し替えることでコンテキストに
// 合わせた通信が可能です。
//
// 【プラグイン開発者向け API】
//
//   // ライフサイクル (flat メソッド)
//   Ubi.onTick((dt) => { ... });
//   Ubi.onPlayerJoined((player) => { ... });
//
//   // シーン操作
//   await Ubi.scene.updateEntity('id', { transform: { x: 100 } });
//
//   // ホストへのメッセージ送信
//   Ubi.messaging.send('MY_EVENT', { foo: 'bar' });
//
//   // コンポーネント指向 (Unity ライク)
//   class MyBehaviour extends UbiBehaviour {
//     update(dt) { ... }
//   }
//   Ubi.registerBehaviour(new MyBehaviour());
// ============================================

import type {
    AppAvatarDef,
    CursorMovedCallback,
    CustomEventCallback,
    EntityPatchPayload,
    EntityUpdatedCallback,
    EvtLifecycleInit,
    PluginGuestCommand,
    PluginHostEvent,
    TickCallback,
    UserJoinedCallback,
    UserLeftCallback,
    WorldEntity,
} from '../index';
import type { UbiBehaviour } from './component';
import { EcsWorldImpl } from './ecs/world';
import type { EcsWorld, WorkerEvent } from './ecs/types';

type PendingRequest = {
    resolve: (data: unknown) => void;
    reject: (error: string) => void;
};

/**
 * 内部ヘルパー: 送信用の id 省略コマンド型。
 * T がユニオン型の場合でも各メンバから id を省略できるよう分配（Distributive）処理します。
 */
export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Ubichill Plugin SDK のメインクラス。
 *
 * Sandbox Worker 内では `Ubi` として自動注入されます。
 * Worker 外では `import { Ubi } from '@ubichill/sdk'` でシングルトンを利用できます。
 */
export class UbiSDK {
    // --- RPC 管理 ---
    private _commandCounter = 0;
    private _pendingRequests = new Map<string, PendingRequest>();
    private _rpcTimeout: number;

    // --- コールバック管理 ---
    private _tickCallbacks: TickCallback[] = [];
    private _playerJoinedCallbacks: UserJoinedCallback[] = [];
    private _playerLeftCallbacks: UserLeftCallback[] = [];
    private _cursorMovedCallbacks: CursorMovedCallback[] = [];
    private _entityUpdatedCallbacks: Map<string, EntityUpdatedCallback[]> = new Map();
    private _customEventCallbacks: CustomEventCallback[] = [];

    // --- コンポーネントシステム ---
    private _activeBehaviours: Set<UbiBehaviour> = new Set();

    // --- ECS World ---
    public readonly world: EcsWorld;
    private _pendingWorkerEvents: WorkerEvent[] = [];

    // --- ワールド情報 ---
    /** 現在のワールドID（EVT_LIFECYCLE_INIT 後に設定される） */
    public worldId?: string;
    /** 自ユーザーのID（EVT_LIFECYCLE_INIT 後に設定される） */
    public myUserId?: string;
    /** 実行中のプラグインID（EVT_LIFECYCLE_INIT 後に設定される。デバッグ・ログ用） */
    public pluginId?: string;

    /**
     * メッセージ送信関数。
     * Sandbox 内では セキュリティ設定後に差し替えられます。
     * Worker 外（テスト・開発）では `self.postMessage` を呼びます。
     */
    public _postMessage: (cmd: PluginGuestCommand) => void = (cmd) => {
        if (typeof self !== 'undefined' && typeof window === 'undefined') {
            self.postMessage(cmd);
        } else {
            console.warn('[UbiSDK] postMessage called outside Worker context');
        }
    };

    /**
     * @param options.rpcTimeout RPC タイムアウト (ms)。デフォルト 10 秒。
     */
    constructor(options?: { rpcTimeout?: number }) {
        this._rpcTimeout = options?.rpcTimeout ?? 10_000;
        this.world = new EcsWorldImpl();
    }

    // ============================================
    // 内部: Host からのイベントをディスパッチ
    // sandbox.worker.ts の message ハンドラから呼ばれます。
    // ============================================
    public _dispatchEvent(event: PluginHostEvent): void {
        switch (event.type) {
            case 'EVT_LIFECYCLE_INIT': {
                const init = event as EvtLifecycleInit;
                this.worldId = init.payload.worldId;
                this.myUserId = init.payload.myUserId;
                this.pluginId = init.payload.pluginId;
                break;
            }

            case 'EVT_LIFECYCLE_TICK': {
                const dt = event.payload.deltaTime;
                try {
                    this.world.tick(dt, this._pendingWorkerEvents);
                    this._pendingWorkerEvents = [];
                } catch (err) {
                    console.error('[UbiSDK] ECS World tick error:', err);
                }

                // 従来の Callback ベース API
                for (const cb of this._tickCallbacks) cb(dt);
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.update(dt);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.update エラー:', err);
                    }
                }
                break;
            }

            case 'EVT_PLAYER_JOINED': {
                const { user } = event.payload;
                for (const cb of this._playerJoinedCallbacks) cb(user);
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.onPlayerJoined(user);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.onPlayerJoined エラー:', err);
                    }
                }
                break;
            }

            case 'EVT_PLAYER_LEFT': {
                const { userId } = event.payload;
                for (const cb of this._playerLeftCallbacks) cb(userId);
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.onPlayerLeft(userId);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.onPlayerLeft エラー:', err);
                    }
                }
                break;
            }

            case 'EVT_PLAYER_CURSOR_MOVED': {
                const { userId, position } = event.payload;
                for (const cb of this._cursorMovedCallbacks) cb(userId, position);
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.onPlayerCursorMoved(userId, position);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.onPlayerCursorMoved エラー:', err);
                    }
                }
                break;
            }

            case 'EVT_SCENE_ENTITY_UPDATED': {
                const { entity } = event.payload;
                const cbs = this._entityUpdatedCallbacks.get(entity.id);
                if (cbs) {
                    for (const cb of cbs) cb(entity);
                }
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.onEntityUpdated(entity);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.onEntityUpdated エラー:', err);
                    }
                }
                break;
            }

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

            case 'EVT_CUSTOM': {
                const { eventType, data } = event.payload;
                this._pendingWorkerEvents.push({ type: eventType, payload: data, timestamp: Date.now() });
                for (const cb of this._customEventCallbacks) cb(eventType, data);
                for (const behaviour of this._activeBehaviours) {
                    try {
                        behaviour.onCustomEvent(eventType, data);
                    } catch (err) {
                        console.error('[UbiSDK] behaviour.onCustomEvent エラー:', err);
                    }
                }
                break;
            }
        }
    }

    // ============================================
    // 内部: Host へのコマンド送信
    // ============================================

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

            this._postMessage({ ...command, id } as PluginGuestCommand);
        });
    }

    private _send(command: OmitId<PluginGuestCommand>): void {
        this._postMessage(command as PluginGuestCommand);
    }

    // ============================================
    // ライフサイクル & プレイヤーイベント
    // ============================================

    /**
     * 毎フレーム (requestAnimationFrame 相当) 呼ばれます。
     *
     * @param callback `deltaTime`: 前フレームからの経過時間 (ms)
     * @returns 購読解除関数
     *
     * @example
     * ```js
     * Ubi.onTick((dt) => {
     *   position.x += velocity.x * (dt / 1000);
     * });
     * ```
     */
    public onTick(callback: TickCallback): () => void {
        this._tickCallbacks.push(callback);
        return () => {
            this._tickCallbacks = this._tickCallbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * ユーザーがワールドに入室したとき呼ばれます。
     *
     * @returns 購読解除関数
     *
     * @example
     * ```js
     * Ubi.onPlayerJoined((player) => {
     *   console.log(`${player.name} が入室しました`);
     * });
     * ```
     */
    public onPlayerJoined(callback: UserJoinedCallback): () => void {
        this._playerJoinedCallbacks.push(callback);
        return () => {
            this._playerJoinedCallbacks = this._playerJoinedCallbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * ユーザーがワールドから退室したとき呼ばれます。
     *
     * @returns 購読解除関数
     *
     * @example
     * ```js
     * Ubi.onPlayerLeft((userId) => {
     *   removeMarker(userId);
     * });
     * ```
     */
    public onPlayerLeft(callback: UserLeftCallback): () => void {
        this._playerLeftCallbacks.push(callback);
        return () => {
            this._playerLeftCallbacks = this._playerLeftCallbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * 他のユーザーのカーソルが移動したとき呼ばれます。
     *
     * @returns 購読解除関数
     *
     * @example
     * ```js
     * Ubi.onPlayerCursorMoved((userId, position) => {
     *   updateGhostMarker(userId, position);
     * });
     * ```
     */
    public onPlayerCursorMoved(callback: CursorMovedCallback): () => void {
        this._cursorMovedCallbacks.push(callback);
        return () => {
            this._cursorMovedCallbacks = this._cursorMovedCallbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * 購読中のエンティティが更新されたとき呼ばれます。
     * このメソッドを呼ぶと購読が自動的に開始されます。
     *
     * @param entityId 購読するエンティティのID
     * @returns 購読解除関数（呼ぶと購読解除コマンドも自動送信）
     *
     * @example
     * ```js
     * const unsub = Ubi.onEntityUpdated('sticky-001', (entity) => {
     *   console.log('更新:', entity.data);
     * });
     * unsub(); // 購読解除
     * ```
     */
    public onEntityUpdated(entityId: string, callback: EntityUpdatedCallback): () => void {
        const cbs = this._entityUpdatedCallbacks.get(entityId) ?? [];
        cbs.push(callback);
        this._entityUpdatedCallbacks.set(entityId, cbs);
        this._send({ type: 'SCENE_SUBSCRIBE_ENTITY', payload: { id: entityId } });

        return () => {
            const updated = (this._entityUpdatedCallbacks.get(entityId) ?? []).filter((cb) => cb !== callback);
            if (updated.length === 0) {
                this._entityUpdatedCallbacks.delete(entityId);
                this._send({ type: 'SCENE_UNSUBSCRIBE_ENTITY', payload: { id: entityId } });
            } else {
                this._entityUpdatedCallbacks.set(entityId, updated);
            }
        };
    }

    /**
     * 汎用カスタムイベントを受信したとき呼ばれます。
     *
     * @returns 購読解除関数
     */
    public onCustomEvent(callback: CustomEventCallback): () => void {
        this._customEventCallbacks.push(callback);
        return () => {
            this._customEventCallbacks = this._customEventCallbacks.filter((cb) => cb !== callback);
        };
    }

    // ============================================
    // コンポーネント指向 API (UbiBehaviour)
    // ============================================

    /**
     * UbiBehaviour を継承したコンポーネントを登録し、ライフサイクルを開始します。
     * `start()` が呼ばれ、以降毎フレーム `update()` 等が自動的に呼ばれます。
     *
     * @returns 登録解除関数
     *
     * @example
     * ```js
     * class MyBehaviour extends UbiBehaviour {
     *   update(dt) { ... }
     * }
     * Ubi.registerBehaviour(new MyBehaviour());
     * ```
     */
    public registerBehaviour(behaviour: UbiBehaviour): () => void {
        this._activeBehaviours.add(behaviour);
        try {
            behaviour.start();
        } catch (err) {
            console.error('[UbiSDK] behaviour.start エラー:', err);
        }

        return () => {
            try {
                behaviour.destroy();
            } catch (err) {
                console.error('[UbiSDK] behaviour.destroy エラー:', err);
            }
            this._activeBehaviours.delete(behaviour);
        };
    }

    // ============================================
    // ECS API
    // ============================================

    /**
     * System を ECS World に登録します。
     * 登録されたすべての System は毎フレーム順番に実行されます。
     *
     * @param system System 関数
     *
     * @example
     * ```ts
     * const MySystem = (entities: Entity[], dt: number, events: WorkerEvent[]) => {
     *   for (const entity of entities) {
     *     const pos = entity.getComponent('Position');
     *     if (pos) {
     *       pos.x += 1 * (dt / 1000);
     *     }
     *   }
     * };
     * Ubi.registerSystem(MySystem);
     * ```
     */
    public registerSystem(system: import('./ecs/types').System): void {
        this.world.registerSystem(system);
    }

    // ============================================
    // Ubi.scene — ワールド内のエンティティ操作
    // ============================================

    public readonly scene = {
        /**
         * エンティティの現在の状態を取得します.
         *
         * @example
         * ```js
         * const entity = await Ubi.scene.getEntity('sticky-001');
         * ```
         */
        getEntity: (id: string): Promise<WorldEntity | null> => {
            return this._rpc<WorldEntity | null>({
                type: 'SCENE_GET_ENTITY',
                payload: { id },
            });
        },

        /**
         * 新しいエンティティをワールドに作成します。
         *
         * @returns 作成されたエンティティのID
         *
         * @example
         * ```js
         * const id = await Ubi.scene.createEntity({
         *   type: 'marker',
         *   ownerId: Ubi.myUserId,
         *   lockedBy: null,
         *   transform: { x: 100, y: 200, z: 0, w: 50, h: 50, scale: 1, rotation: 0 },
         *   data: { label: 'My Marker' },
         * });
         * ```
         */
        createEntity: (entity: Omit<WorldEntity, 'id'>): Promise<string> => {
            return this._rpc<string>({
                type: 'SCENE_CREATE_ENTITY',
                payload: { entity },
            });
        },

        /**
         * エンティティの状態を宣言的に更新します（部分更新）。
         *
         * @example
         * ```js
         * await Ubi.scene.updateEntity('sticky-001', {
         *   transform: { x: 150, y: 250 }
         * });
         * ```
         */
        updateEntity: (id: string, patch: EntityPatchPayload['patch']): Promise<void> => {
            return this._rpc<void>({
                type: 'SCENE_UPDATE_ENTITY',
                payload: { id, patch: { entityId: id, patch } },
            });
        },

        /**
         * エンティティを削除します。
         */
        destroyEntity: (id: string): Promise<void> => {
            return this._rpc<void>({
                type: 'SCENE_DESTROY_ENTITY',
                payload: { id },
            });
        },

        /**
         * このプラグインが制御するカーソルの位置を更新します。
         * 毎フレーム呼ぶことを想定した高速 Fire & Forget API です。
         *
         * @example
         * ```js
         * Ubi.onTick(() => {
         *   Ubi.scene.updateCursorPosition(myX, myY);
         * });
         * ```
         */
        updateCursorPosition: (x: number, y: number): void => {
            this._send({ type: 'SCENE_UPDATE_CURSOR', payload: { x, y } });
        },
    };

    // ============================================
    // Ubi.ui — ホスト画面へのUI操作
    // ============================================

    public readonly ui = {
        /**
         * 画面にトースト通知を表示します。
         *
         * @example
         * ```js
         * Ubi.ui.showToast('データを保存しました！');
         * ```
         */
        showToast: (text: string): void => {
            this._send({ type: 'UI_SHOW_TOAST', payload: { text } });
        },
    };

    // ============================================
    // Ubi.avatar — 自ユーザーのアバター操作
    // ============================================

    public readonly avatar = {
        /**
         * 自ユーザーのアバター（カーソル）設定を更新します。
         *
         * @example
         * ```js
         * Ubi.avatar.set({
         *   states: { default: { url: '/cursor.png', hotspot: { x: 0, y: 0 } } },
         *   hideSystemCursor: true,
         * });
         * ```
         */
        set: (appDef: AppAvatarDef): void => {
            this._send({ type: 'AVATAR_SET', payload: { appDef } });
        },
    };

    // ============================================
    // Ubi.net — ネットワーク操作
    // ============================================

    public readonly net = {
        /**
         * ホワイトリストされた URL に対して HTTP リクエストを送信します。
         * セキュリティのため、ホスト側で URL 検証が行われます。
         *
         * @example
         * ```js
         * const res = await Ubi.net.fetch('https://api.github.com/users/octocat');
         * if (res.ok) {
         *   const user = JSON.parse(res.body);
         *   Ubi.ui.showToast(`GitHub: ${user.name}`);
         * }
         * ```
         */
        fetch: (
            url: string,
            options?: {
                method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
                headers?: Record<string, string>;
                body?: string;
            },
        ): Promise<{
            ok: boolean;
            status: number;
            statusText: string;
            headers: Record<string, string>;
            body: string;
        }> => {
            return this._rpc({
                type: 'NET_FETCH',
                payload: { url, options },
            });
        },
    };

    // ============================================
    // Ubi.messaging — ホスト側とのメッセージ送受信
    // ============================================

    public readonly messaging = {
        /**
         * Host 側に対して任意のカスタムメッセージを送信します。
         * Host 側の `usePluginWorker` の `onCommand` で受信できます。
         *
         * @example
         * ```js
         * Ubi.messaging.send('STROKE_COMPLETE', { points: [...] });
         * ```
         */
        send: (type: string, data: unknown): void => {
            this._send({ type: 'CUSTOM_MESSAGE', payload: { type, data } });
        },
    };
}
