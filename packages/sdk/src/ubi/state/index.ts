import type { EntityPatchPayload, VNode, WorldEntity } from '@ubichill/shared';
import type { EntityState, EntityStateFor, PresenceEntry, SendFn, StateBinding } from '../types';

// ── スコープマーカー (このファイル内部のみ) ───────────────────────

const UBI_STATE_SCOPE = Symbol.for('@ubichill/stateScope');
type StateScope = 'shared' | 'persistent' | 'persistMine';

interface ScopeMarker<T = unknown> {
    readonly [UBI_STATE_SCOPE]: StateScope;
    readonly value: T;
}

function isScopeMarker(v: unknown): v is ScopeMarker {
    return typeof v === 'object' && v !== null && UBI_STATE_SCOPE in v;
}

// ── 依存型 ────────────────────────────────────────────────────────

export type StateModuleDeps = {
    send: SendFn;
    updateEntity(id: string, patch: EntityPatchPayload['patch']): Promise<void>;
    getMyUserId(): string | undefined;
    getEntityId(): string | undefined;
    getPluginId(): string | undefined;
    getWatchEntityTypes(): string[];
    getPresenceUsers(): Map<string, PresenceEntry>;
    getLocalSharedState(): Record<string, unknown>;
    getScrollX(): number;
    getScrollY(): number;
    getForEachUserComponents(): Set<string>;
    registerPendingFlush(fn: () => void): void;
    getInitialEntities(): WorldEntity[];
    // UI ヘルパー (renderForEachUser で使用)
    beginRender(targetId: string): void;
    queueUiRender(targetId: string, vnode: VNode | null): void;
    unmountUi(targetId: string): void;
    recordUiRenderCost(targetId: string, costMs: number, scope?: { entityId: string; componentName: string }): void;
    buildEntityTargetId(entityId: string, componentName: string): string;
};

// ── 公開型 ────────────────────────────────────────────────────────

export type StateModule = {
    shared<T>(defaultValue: T): T;
    persistent<T>(defaultValue: T): T;
    persistMine<T>(defaultValue: T): T;
    define<T extends Record<string, unknown>>(schema: T): EntityState<T>;
    getStateBindings(): StateBinding[];
};

// ── ファクトリ ────────────────────────────────────────────────────

export function createStateModule(deps: StateModuleDeps): StateModule {
    const stateBindings: StateBinding[] = [];

    const define = <T extends Record<string, unknown>>(schema: T): EntityState<T> => {
        // スキーマをスコープと初期値に分解
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
        const perUserPersistMine = new Map<string, Record<string, unknown>>();
        const listeners = new Map<string, Set<(next: unknown, prev: unknown) => void>>();

        // shared フィールドを localSharedState にシード
        const localSharedState = deps.getLocalSharedState();
        for (const [key, scope] of scopes) {
            if (scope === 'shared' && !(key in localSharedState)) {
                localSharedState[key] = defaults[key];
            }
        }

        // 同期対象エンティティの解決
        const watchType = deps.getWatchEntityTypes()[0] ?? deps.getPluginId() ?? '';
        let targetEntityId: string | null = null;
        let initialData: Record<string, unknown> | null = null;

        const entityId = deps.getEntityId();
        const pluginId = deps.getPluginId();
        if (entityId && pluginId && deps.getWatchEntityTypes().includes(pluginId)) {
            targetEntityId = entityId;
            const self = deps.getInitialEntities().find((e) => e.id === entityId);
            initialData = (self?.data as Record<string, unknown> | undefined) ?? null;
        } else if (watchType) {
            const match = deps.getInitialEntities().find((e) => e.type === watchType);
            if (match) {
                targetEntityId = match.id;
                initialData = (match.data as Record<string, unknown> | undefined) ?? null;
            }
        }

        // flush バッファ
        const pendingSharedWrites: Record<string, unknown> = {};
        const pendingEntityWrites: Record<string, unknown> = {};
        let sharedDirty = false;
        let entityDirty = false;

        const fire = (key: string, next: unknown, prev: unknown): void => {
            const set = listeners.get(key);
            if (!set) return;
            for (const fn of set) fn(next, prev);
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
            if (!targetEntityId) return; // 未解決 → 次回フラッシュで再試行
            entityDirty = false;
            const id = targetEntityId;
            const patch = { ...pendingEntityWrites };
            for (const k of Object.keys(pendingEntityWrites)) delete pendingEntityWrites[k];
            void deps.updateEntity(id, { data: patch });
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

        // プラグインコード実行前に初期エンティティを同期反映
        if (initialData) applyEntityData(initialData);

        stateBindings.push({
            watchType,
            getTargetId: () => targetEntityId,
            trySetTargetId: (id) => {
                if (!targetEntityId) targetEntityId = id;
            },
            applyEntityData,
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
        shared: <T>(defaultValue: T): T =>
            ({ [UBI_STATE_SCOPE]: 'shared' as StateScope, value: defaultValue }) as unknown as T,
        persistent: <T>(defaultValue: T): T =>
            ({ [UBI_STATE_SCOPE]: 'persistent' as StateScope, value: defaultValue }) as unknown as T,
        persistMine: <T>(defaultValue: T): T =>
            ({
                [UBI_STATE_SCOPE]: 'persistMine' as StateScope,
                value: defaultValue,
            }) as unknown as T,
        define,
        getStateBindings: () => stateBindings,
    };
}
