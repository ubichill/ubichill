import type { CreateInstanceRequest, Instance, WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

import { API_BASE } from '@/lib/api';
import { createInstance as createInstanceApi, fetchInstances } from '@/lib/instancesApi';

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
let worldsCache: { data: WorldListItem[]; at: number } | null = null;
let worldsInflight: Promise<WorldListItem[]> | null = null;
let globalWorldsCache: { data: WorldListItem[]; at: number } | null = null;
let globalWorldsInflight: Promise<WorldListItem[]> | null = null;

async function fetchWorlds(scope: 'all' | 'local' | 'global', force: boolean): Promise<WorldListItem[]> {
    const isGlobal = scope === 'global';
    const cache = isGlobal ? globalWorldsCache : worldsCache;
    const inflight = isGlobal ? globalWorldsInflight : worldsInflight;

    if (!force && cache && Date.now() - cache.at < WORLDS_TTL_MS) {
        return cache.data;
    }
    if (!force && inflight) {
        return inflight;
    }
    const promise = (async () => {
        const res = await fetch(`${API_BASE}/api/v1/worlds?scope=${scope}`, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to fetch worlds');
        const data = (await res.json()) as { worlds: WorldListItem[] };
        const entry = { data: data.worlds, at: Date.now() };
        if (isGlobal) {
            globalWorldsCache = entry;
        } else {
            worldsCache = entry;
        }
        return data.worlds;
    })();
    if (isGlobal) {
        globalWorldsInflight = promise;
    } else {
        worldsInflight = promise;
    }
    try {
        return await promise;
    } finally {
        if (isGlobal && globalWorldsInflight === promise) globalWorldsInflight = null;
        if (!isGlobal && worldsInflight === promise) worldsInflight = null;
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
        if (!force && worldsCache && Date.now() - worldsCache.at < WORLDS_TTL_MS) {
            setWorlds(worldsCache.data);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setWorlds(await fetchWorlds('all', force));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshGlobalWorlds = useCallback(async (force = false) => {
        if (!force && globalWorldsCache && Date.now() - globalWorldsCache.at < WORLDS_TTL_MS) {
            setGlobalWorlds(globalWorldsCache.data);
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
