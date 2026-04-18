import type { CreateInstanceRequest, Instance, WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

import { API_BASE } from '@/lib/api';

interface UseInstancesReturn {
    instances: Instance[];
    worlds: WorldListItem[];
    loading: boolean;
    error: string | null;
    createInstance: (request: CreateInstanceRequest) => Promise<Instance | null>;
    refreshInstances: () => Promise<void>;
    refreshWorlds: () => Promise<void>;
}

export function useInstances(): UseInstancesReturn {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [worlds, setWorlds] = useState<WorldListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshInstances = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/v1/instances`, {
                credentials: 'include',
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

    const refreshWorlds = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/v1/worlds`, {
                credentials: 'include',
            });
            if (!res.ok) throw new Error('Failed to fetch worlds');
            const data = await res.json();
            setWorlds(data.worlds);
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
        refreshInstances();
        refreshWorlds();
    }, [refreshInstances, refreshWorlds]);

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
