import { CommandType, type ComponentInstance, type EntityPatchPayload, type VNode } from '@ubichill/shared';
import type { EntityState, EntityStateFor, PresenceEntry, SendFn, StateBinding } from '../types';

// ── スコープマーカー (このファイル内部のみ) ───────────────────────

const UBI_STATE_SCOPE = Symbol.for('@ubichill/stateScope');
type StateScope = 'shared' | 'persistent' | 'persistMine' | 'topLevel';

interface ScopeMarker<T = unknown> {
    readonly [UBI_STATE_SCOPE]: StateScope;
    readonly value: T;
    readonly topLevelKey?: 'lockedBy' | 'ownerId';
}

function isScopeMarker(v: unknown): v is ScopeMarker {
    return typeof v === 'object' && v !== null && UBI_STATE_SCOPE in v;
}

/** ComponentInstance の top-level として書き込める / 読み取れるフィールド。 */
const TOP_LEVEL_KEYS = new Set(['lockedBy', 'ownerId']);

// ── 公開オプション ───────────────────────────────────────────

export interface SyncOptions {
    /** ユーザーごとに独立した値 (旧: persistMine)。 */
    perUser?: boolean;
    /** 揮発性 (旧: shared)。DB に保存されず退出時に消える。 */
    ephemeral?: boolean;
    /** ComponentInstance の top-level フィールドに割り当てる (旧: topLevel)。 */
    topLevel?: 'lockedBy' | 'ownerId';
}

function resolveScope(opts: SyncOptions | undefined): StateScope {
    if (opts?.topLevel) return 'topLevel';
    if (opts?.ephemeral) return 'shared';
    if (opts?.perUser) return 'persistMine';
    return 'persistent';
}

// ── 依存型 ────────────────────────────────────────────────────────

export type StateModuleDeps = {
    send: SendFn;
    updateEntity(id: string, patch: EntityPatchPayload['patch']): Promise<void>;
    getMyUserId(): string | undefined;
    getEntityId(): string | undefined;
    getPluginId(): string | undefined;
    getComponentType(): string | undefined;
    getWatchEntityTypes(): string[];
    getPresenceUsers(): Map<string, PresenceEntry>;
    getLocalSharedState(): Record<string, unknown>;
    getScrollX(): number;
    getScrollY(): number;
    getForEachUserComponents(): Set<string>;
    registerPendingFlush(fn: () => void): void;
    getInitialEntities(): ComponentInstance[];
    beginRender(targetId: string): void;
    queueUiRender(targetId: string, vnode: VNode | null): void;
    unmountUi(targetId: string): void;
    recordUiRenderCost(targetId: string, costMs: number, scope?: { entityId: string; componentName: string }): void;
    buildEntityTargetId(entityId: string, componentName: string): string;
};

// ── 公開型 ────────────────────────────────────────────────────────

export type StateModule = {
    /**
     * 値を同期対象としてマークする。マーカーなしの値 (例: `count: 0`) はローカル専用。
     *
     * デフォルトは「全員と共有 + 永続化 (entity.data)」。
     * `perUser` / `ephemeral` / `topLevel` で挙動を変えられる。
     *
     * ```ts
     * const state = Ubi.state.define({
     *   count: 0,                                                  // ローカル専用
     *   color: Ubi.state.sync('#1a1a1a'),                          // 共有 + 永続
     *   myVolume: Ubi.state.sync(0.7, { perUser: true }),
     *   cursorState: Ubi.state.sync('default', { ephemeral: true }),
     *   lockedBy: Ubi.state.sync<string|null>(null, { topLevel: 'lockedBy' }),
     * });
     * ```
     */
    sync<T>(defaultValue: T, options?: SyncOptions): T;
    define<T extends Record<string, unknown>>(schema: T): EntityState<T>;
    getStateBindings(): StateBinding[];
};

// ── ファクトリ ────────────────────────────────────────────────────

export function createStateModule(deps: StateModuleDeps): StateModule {
    const stateBindings: StateBinding[] = [];

    const define = <T extends Record<string, unknown>>(schema: T): EntityState<T> => {
        const scopes = new Map<string, StateScope | 'local'>();
        const topLevelMap = new Map<string, 'lockedBy' | 'ownerId'>(); // schema key → top-level field name
        const defaults: Record<string, unknown> = {};
        for (const key of Object.keys(schema)) {
            const raw = (schema as Record<string, unknown>)[key];
            if (isScopeMarker(raw)) {
                scopes.set(key, raw[UBI_STATE_SCOPE]);
                defaults[key] = raw.value;
                if (raw[UBI_STATE_SCOPE] === 'topLevel' && raw.topLevelKey) {
                    topLevelMap.set(key, raw.topLevelKey);
                }
            } else {
                scopes.set(key, 'local');
                defaults[key] = raw;
            }
        }

        const local: Record<string, unknown> = { ...defaults };
        const perUserPersistMine = new Map<string, Record<string, unknown>>();
        const listeners = new Map<string, Set<(next: unknown, prev: unknown) => void>>();

        // shared フィールドを localSharedState にシード
        const localSharedState = deps.getLocalSharedState();
        for (const [key, scope] of scopes) {
            if (scope === 'shared' && !(key in localSharedState)) {
                localSharedState[key] = defaults[key];
            }
        }

        // 同期対象 ComponentInstance の解決
        const watchType = deps.getWatchEntityTypes()[0] ?? deps.getPluginId() ?? '';
        const ownGameObjectId = deps.getEntityId();
        const componentType = deps.getComponentType();
        let targetEntityId: string | null = null;
        let initialData: Record<string, unknown> | null = null;
        let initialEntity: ComponentInstance | null = null;
        if (ownGameObjectId && componentType && deps.getWatchEntityTypes().includes(componentType)) {
            const self = deps
                .getInitialEntities()
                .find((e) => e.entityId === ownGameObjectId && e.type === componentType);
            if (self) {
                targetEntityId = self.id;
                initialData = (self.data as Record<string, unknown> | undefined) ?? null;
                initialEntity = self;
            }
        } else if (watchType) {
            const match = deps.getInitialEntities().find((e) => e.type === watchType);
            if (match) {
                targetEntityId = match.id;
                initialData = (match.data as Record<string, unknown> | undefined) ?? null;
                initialEntity = match;
            }
        }

        // flush バッファ
        const pendingSharedWrites: Record<string, unknown> = {};
        const pendingEntityWrites: Record<string, unknown> = {};
        const pendingTopLevelWrites: Record<string, unknown> = {};
        let sharedDirty = false;
        let entityDirty = false;

        let batchDepth = 0;
        // batch 中は (firstPrev, latestNext) を集約。Map なので同一キーの再書込は最新値で上書き。
        const batchedFires = new Map<string, { prev: unknown; next: unknown }>();

        const fire = (key: string, next: unknown, prev: unknown): void => {
            if (batchDepth > 0) {
                const existing = batchedFires.get(key);
                if (existing) {
                    existing.next = next;
                } else {
                    batchedFires.set(key, { prev, next });
                }
                return;
            }
            const set = listeners.get(key);
            if (!set) return;
            for (const fn of set) fn(next, prev);
        };

        const runBatch = (fn: () => void): void => {
            batchDepth++;
            try {
                fn();
            } finally {
                batchDepth--;
                if (batchDepth === 0 && batchedFires.size > 0) {
                    const entries = [...batchedFires.entries()];
                    batchedFires.clear();
                    for (const [key, { prev, next }] of entries) {
                        if (prev === next) continue;
                        const set = listeners.get(key);
                        if (!set) continue;
                        for (const fn of set) fn(next, prev);
                    }
                }
            }
        };

        const flushShared = (): void => {
            if (!sharedDirty) return;
            sharedDirty = false;
            Object.assign(localSharedState, pendingSharedWrites);
            const myUserId = deps.getMyUserId();
            if (myUserId) {
                const me = deps.getPresenceUsers().get(myUserId);
                if (me) Object.assign(me.sharedState, pendingSharedWrites);
            }
            deps.send({
                type: CommandType.NETWORK_BROADCAST,
                payload: {
                    type: 'presence:sharedState',
                    data: { sharedState: { ...pendingSharedWrites } },
                },
            });
            for (const k of Object.keys(pendingSharedWrites)) delete pendingSharedWrites[k];
        };

        const flushEntity = (): void => {
            if (!entityDirty) return;
            if (!targetEntityId) return;
            entityDirty = false;
            const id = targetEntityId;
            const dataPatch = { ...pendingEntityWrites };
            const topPatch = { ...pendingTopLevelWrites };
            for (const k of Object.keys(pendingEntityWrites)) delete pendingEntityWrites[k];
            for (const k of Object.keys(pendingTopLevelWrites)) delete pendingTopLevelWrites[k];
            const patch: EntityPatchPayload['patch'] = { ...topPatch };
            if (Object.keys(dataPatch).length > 0) patch.data = dataPatch;
            void deps.updateEntity(id, patch);
        };

        /** ComponentInstance 全体を受け取り、top-level + data を一括反映する。 */
        const applyEntity = (entity: ComponentInstance): void => {
            for (const [key, scope] of scopes) {
                if (scope !== 'topLevel') continue;
                const topKey = topLevelMap.get(key) ?? key;
                if (!TOP_LEVEL_KEYS.has(topKey)) continue;
                const next = (entity as unknown as Record<string, unknown>)[topKey];
                const prev = local[key];
                if (next !== prev) {
                    local[key] = next;
                    fire(key, next, prev);
                }
            }
            const data = entity.data as Record<string, unknown> | undefined;
            if (data) applyEntityData(data);
        };

        const applyEntityData = (data: Record<string, unknown>): void => {
            const persistMinePrefixes = new Map<string, string>();
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
                    const myUserId = deps.getMyUserId();
                    if (userId === myUserId) {
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

        // プラグインコード実行前に初期エンティティを同期反映 (data + top-level)
        if (initialEntity) applyEntity(initialEntity);
        else if (initialData) applyEntityData(initialData);

        stateBindings.push({
            watchType,
            getTargetId: () => targetEntityId,
            trySetTargetId: (id) => {
                if (!targetEntityId) targetEntityId = id;
            },
            applyEntityData,
            applyEntity,
        });

        // local は Proxy — 書き込みでスコープに応じた flush を予約
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
                    deps.registerPendingFlush(flushShared);
                } else if (scope === 'persistent') {
                    pendingEntityWrites[prop] = value;
                    entityDirty = true;
                    deps.registerPendingFlush(flushEntity);
                } else if (scope === 'persistMine') {
                    const myUserId = deps.getMyUserId();
                    if (myUserId) {
                        pendingEntityWrites[`${prop}:${myUserId}`] = value;
                        entityDirty = true;
                        deps.registerPendingFlush(flushEntity);
                    }
                } else if (scope === 'topLevel') {
                    const topKey = topLevelMap.get(prop) ?? prop;
                    if (!TOP_LEVEL_KEYS.has(topKey)) return true;
                    pendingTopLevelWrites[topKey] = value;
                    entityDirty = true;
                    deps.registerPendingFlush(flushEntity);
                }
                return true;
            },
        }) as T;

        const getFor = (userId: string): EntityStateFor<T> => {
            const entry = deps.getPresenceUsers().get(userId);
            const mine = perUserPersistMine.get(userId);
            const result: Record<string, unknown> = { id: userId };
            for (const [key, scope] of scopes) {
                if (scope === 'shared') {
                    result[key] = entry?.sharedState[key] !== undefined ? entry.sharedState[key] : defaults[key];
                } else if (scope === 'persistMine') {
                    result[key] =
                        userId === deps.getMyUserId()
                            ? local[key]
                            : mine?.[key] !== undefined
                              ? mine[key]
                              : defaults[key];
                } else {
                    result[key] = local[key];
                }
            }
            const worldX = entry?.worldX ?? 0;
            const worldY = entry?.worldY ?? 0;
            result.worldX = worldX;
            result.worldY = worldY;
            result.viewportX = worldX - deps.getScrollX();
            result.viewportY = worldY - deps.getScrollY();
            return result as unknown as EntityStateFor<T>;
        };

        return {
            local: proxy,
            for: getFor,
            batch: runBatch,
            onChange: (key, listener) => {
                let set = listeners.get(key);
                if (!set) {
                    set = new Set();
                    listeners.set(key, set);
                }
                set.add(listener as (n: unknown, p: unknown) => void);
            },
            renderForEachUser: (componentName, factory) => {
                deps.getForEachUserComponents().add(componentName);
                for (const [userId] of deps.getPresenceUsers()) {
                    const stateFor = getFor(userId);
                    const targetId = deps.buildEntityTargetId(`user:${userId}`, componentName);
                    const scope = { entityId: `user:${userId}`, componentName };
                    const start = performance.now();
                    deps.beginRender(targetId);
                    const vnode = factory(stateFor);
                    deps.recordUiRenderCost(targetId, performance.now() - start, scope);
                    if (vnode === null) {
                        deps.unmountUi(targetId);
                    } else {
                        deps.queueUiRender(targetId, vnode);
                    }
                }
            },
        };
    };

    return {
        sync: <T>(defaultValue: T, options?: SyncOptions): T => {
            const scope = resolveScope(options);
            const marker: ScopeMarker<T> = {
                [UBI_STATE_SCOPE]: scope,
                value: defaultValue,
                topLevelKey: options?.topLevel,
            };
            return marker as unknown as T;
        },
        define,
        getStateBindings: () => stateBindings,
    };
}
