'use client';

import {
    type CreateInstanceRequest,
    ENV_KEYS,
    type Instance,
    type RoomListItem,
    SERVER_CONFIG,
} from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env[ENV_KEYS.API_URL] || SERVER_CONFIG.DEV_URL;

interface UseInstancesReturn {
    instances: Instance[];
    rooms: RoomListItem[];
    loading: boolean;
    error: string | null;
    createInstance: (request: CreateInstanceRequest) => Promise<Instance | null>;
    refreshInstances: () => Promise<void>;
    refreshRooms: () => Promise<void>;
}

export function useInstances(): UseInstancesReturn {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [rooms, setRooms] = useState<RoomListItem[]>([]);
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

    const refreshRooms = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/v1/rooms`);
            if (!res.ok) throw new Error('Failed to fetch rooms');
            const data = await res.json();
            setRooms(data.rooms);
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
        refreshRooms();
    }, [refreshInstances, refreshRooms]);

    return {
        instances,
        rooms,
        loading,
        error,
        createInstance,
        refreshInstances,
        refreshRooms,
    };
}
