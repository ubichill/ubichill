import type { CreateInstanceRequest, Instance, WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

import { API_BASE } from '@/lib/api';

interface UseInstancesReturn {
    instances: Instance[];
    worlds: WorldListItem[];
    loading: boolean;
    error: string | null;
    createInstance: (request: CreateInstanceRequest) => Promise<Instance | null>;
    refreshInstances: (worldId?: string) => Promise<void>;
    refreshWorlds: (force?: boolean) => Promise<void>;
}

// ワールド一覧は変化が稀なため、モジュール単位で短時間キャッシュ＋同時リクエストの共有を行う。
// useInstances を使う各タブがマウントの度に /api/v1/worlds を叩いて 429 を誘発するのを防ぐ。
const WORLDS_TTL_MS = 30_000;
let worldsCache: { data: WorldListItem[]; at: number } | null = null;
let worldsInflight: Promise<WorldListItem[]> | null = null;

async function fetchWorlds(force: boolean): Promise<WorldListItem[]> {
    if (!force && worldsCache && Date.now() - worldsCache.at < WORLDS_TTL_MS) {
        return worldsCache.data;
    }
    if (!force && worldsInflight) {
        return worldsInflight;
    }
    const promise = (async () => {
        const res = await fetch(`${API_BASE}/api/v1/worlds`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch worlds');
        const data = (await res.json()) as { worlds: WorldListItem[] };
        worldsCache = { data: data.worlds, at: Date.now() };
        return data.worlds;
    })();
    worldsInflight = promise;
    try {
        return await promise;
    } finally {
        if (worldsInflight === promise) worldsInflight = null;
    }
}

export function useInstances(): UseInstancesReturn {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [worlds, setWorlds] = useState<WorldListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshInstances = useCallback(async (worldId?: string) => {
        setLoading(true);
        setError(null);
        try {
            const query = worldId ? `?worldId=${encodeURIComponent(worldId)}` : '';
            const res = await fetch(`${API_BASE}/api/v1/instances${query}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) throw new Error('Failed to fetch instances');
            const data = await res.json();
            setInstances(data.instances);
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
            setWorlds(await fetchWorlds(force));
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
            const res = await fetch(`${API_BASE}/api/v1/instances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
                credentials: 'include',
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create instance');
            }
            const instance = await res.json();
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
        loading,
        error,
        createInstance,
        refreshInstances,
        refreshWorlds,
    };
}
