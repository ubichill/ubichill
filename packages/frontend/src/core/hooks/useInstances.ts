'use client';

import { type CreateInstanceRequest, type Instance, type WorldListItem, SERVER_CONFIG } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

const API_BASE =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '' : SERVER_CONFIG.DEV_URL);

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
            const res = await fetch(`${API_BASE}/api/v1/instances`);
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
            const res = await fetch(`${API_BASE}/api/v1/worlds`);
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
