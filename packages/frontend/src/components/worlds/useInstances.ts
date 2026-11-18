import type { CreateInstanceRequest, Instance, WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

import { API_BASE } from '../../lib/api';
import { createInstance as createInstanceApi, fetchInstances } from '../../lib/worlds/instancesApi';

interface UseInstancesReturn {
    instances: Instance[];
    worlds: WorldListItem[];
    globalWorlds: WorldListItem[];
    loading: boolean;
    error: string | null;
    createInstance: (request: CreateInstanceRequest) => Promise<Instance | null>;
    refreshInstances: (worldId?: string) => Promise<void>;
    refreshWorlds: (force?: boolean) => Promise<void>;
    refreshGlobalWorlds: (force?: boolean) => Promise<void>;
}

// ワールド一覧は変化が稀なため、モジュール単位で短時間キャッシュ＋同時リクエストの共有を行う。
// useInstances を使う各タブがマウントの度に /api/v1/worlds を叩いて 429 を誘発するのを防ぐ。
const WORLDS_TTL_MS = 30_000;
interface WorldsSlot {
    cache: { data: WorldListItem[]; at: number } | null;
    inflight: Promise<WorldListItem[]> | null;
}
const emptySlots = (): Record<'local' | 'global', WorldsSlot> => ({
    local: { cache: null, inflight: null },
    global: { cache: null, inflight: null },
});
const worldsStore = { slots: emptySlots() };

const freshWorlds = (scope: 'local' | 'global'): WorldListItem[] | null => {
    const cache = worldsStore.slots[scope].cache;
    return cache && Date.now() - cache.at < WORLDS_TTL_MS ? cache.data : null;
};

/** ログアウトしたとき（次の人に前の人の一覧を使わない）。取得中の結果は捨てた入れ物に入るので残らない。 */
export function resetWorldsCache(): void {
    worldsStore.slots = emptySlots();
}

async function fetchWorlds(scope: 'local' | 'global', force: boolean): Promise<WorldListItem[]> {
    const slot = worldsStore.slots[scope];
    const fresh = force ? null : freshWorlds(scope);
    if (fresh) return fresh;
    if (!force && slot.inflight) return slot.inflight;
    const promise = (async () => {
        const res = await fetch(`${API_BASE}/api/v1/worlds?scope=${scope}`, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to fetch worlds');
        const data = (await res.json()) as { worlds: WorldListItem[] };
        slot.cache = { data: data.worlds, at: Date.now() };
        return data.worlds;
    })();
    slot.inflight = promise;
    try {
        return await promise;
    } finally {
        if (slot.inflight === promise) slot.inflight = null;
    }
}

export function useInstances(): UseInstancesReturn {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [worlds, setWorlds] = useState<WorldListItem[]>([]);
    const [globalWorlds, setGlobalWorlds] = useState<WorldListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshInstances = useCallback(async (worldId?: string) => {
        setLoading(true);
        setError(null);
        try {
            setInstances(await fetchInstances(worldId));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshWorlds = useCallback(async (force = false) => {
        // キャッシュヒット時はローディング表示を出さず即時反映
        const fresh = force ? null : freshWorlds('local');
        if (fresh) {
            setWorlds(fresh);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setWorlds(await fetchWorlds('local', force));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshGlobalWorlds = useCallback(async (force = false) => {
        const fresh = force ? null : freshWorlds('global');
        if (fresh) {
            setGlobalWorlds(fresh);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setGlobalWorlds(await fetchWorlds('global', force));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    const createInstance = useCallback(async (request: CreateInstanceRequest): Promise<Instance | null> => {
        setLoading(true);
        setError(null);
        try {
            const instance = await createInstanceApi(request);
            setInstances((prev) => [...prev, instance]);
            return instance;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshWorlds();
    }, [refreshWorlds]);

    return {
        instances,
        worlds,
        globalWorlds,
        loading,
        error,
        createInstance,
        refreshInstances,
        refreshWorlds,
        refreshGlobalWorlds,
    };
}
