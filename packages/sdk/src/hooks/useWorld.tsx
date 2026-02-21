'use client';

import type {
    AvailableKind,
    EntityEphemeralPayload,
    EntityPatchPayload,
    WorldEntity,
    WorldEnvironmentData,
    WorldSnapshotPayload,
} from '@ubichill/shared';
import { DEFAULTS } from '@ubichill/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocket } from './useSocket';

// ============================================
// Types
// ============================================

export interface WorldContextType {
    entities: Map<string, WorldEntity>;
    ephemeralData: Map<string, unknown>;
    environment: WorldEnvironmentData;
    availableKinds: AvailableKind[];
    activePlugins: string[];
    createEntity: <T = Record<string, unknown>>(
        type: string,
        transform: WorldEntity['transform'],
        data: T,
    ) => Promise<WorldEntity<T> | null>;
    patchEntity: (entityId: string, patch: EntityPatchPayload['patch']) => void;
    deleteEntity: (entityId: string) => void;
    isConnected: boolean;
}

// ============================================
// Context
// ============================================

const WorldContext = createContext<WorldContextType | null>(null);

// ============================================
// Provider
// ============================================

export const WorldProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket, isConnected } = useSocket();
    const [entities, setEntities] = useState<Map<string, WorldEntity>>(new Map());
    const [ephemeralData, setEphemeralData] = useState<Map<string, unknown>>(new Map());
    const [environment, setEnvironment] = useState<WorldEnvironmentData>(DEFAULTS.WORLD_ENVIRONMENT);
    const [availableKinds, setAvailableKinds] = useState<AvailableKind[]>([]);
    const [activePlugins, setActivePlugins] = useState<string[]>([]);

    useEffect(() => {
        if (!socket) return;

        // ワールドスナップショットを受信（初期ロード）
        const handleWorldSnapshot = (payload: WorldSnapshotPayload) => {
            const newMap = new Map<string, WorldEntity>();
            for (const entity of payload.entities) {
                newMap.set(entity.id, entity);
            }
            setEntities(newMap);
            setEnvironment(payload.environment);
            setAvailableKinds(payload.availableKinds);
            setActivePlugins(payload.activePlugins || []);
        };

        // エンティティ作成を受信
        const handleEntityCreated = (entity: WorldEntity) => {
            setEntities((prev) => {
                const newMap = new Map(prev);
                newMap.set(entity.id, entity);
                return newMap;
            });
        };

        // エンティティパッチを受信（Reliable）
        const handleEntityPatched = (payload: EntityPatchPayload) => {
            setEntities((prev) => {
                const entity = prev.get(payload.entityId);
                if (!entity) return prev;

                const newMap = new Map(prev);
                const updatedEntity: WorldEntity = {
                    ...entity,
                    ...payload.patch,
                    transform: payload.patch.transform
                        ? { ...entity.transform, ...payload.patch.transform }
                        : entity.transform,
                    data: payload.patch.data
                        ? {
                              ...(entity.data as Record<string, unknown>),
                              ...(payload.patch.data as Record<string, unknown>),
                          }
                        : entity.data,
                };
                newMap.set(payload.entityId, updatedEntity);
                return newMap;
            });
        };

        // エンティティエフェメラルを受信（Volatile）
        const handleEntityEphemeral = (payload: EntityEphemeralPayload) => {
            setEphemeralData((prev) => {
                const newMap = new Map(prev);
                newMap.set(payload.entityId, payload.data);
                return newMap;
            });
        };

        // エンティティ削除を受信
        const handleEntityDeleted = (entityId: string) => {
            setEntities((prev) => {
                const newMap = new Map(prev);
                newMap.delete(entityId);
                return newMap;
            });
            setEphemeralData((prev) => {
                const newMap = new Map(prev);
                newMap.delete(entityId);
                return newMap;
            });
        };

        socket.on('world:snapshot', handleWorldSnapshot);
        socket.on('entity:created', handleEntityCreated);
        socket.on('entity:patched', handleEntityPatched);
        socket.on('entity:ephemeral', handleEntityEphemeral);
        socket.on('entity:deleted', handleEntityDeleted);

        return () => {
            socket.off('world:snapshot', handleWorldSnapshot);
            socket.off('entity:created', handleEntityCreated);
            socket.off('entity:patched', handleEntityPatched);
            socket.off('entity:ephemeral', handleEntityEphemeral);
            socket.off('entity:deleted', handleEntityDeleted);
        };
    }, [socket]);

    const createEntity = useCallback(
        async <T = Record<string, unknown>>(
            type: string,
            transform: WorldEntity['transform'],
            data: T,
        ): Promise<WorldEntity<T> | null> => {
            if (!socket || !isConnected) return null;

            const payload = {
                type,
                transform,
                data,
                ownerId: socket.id || '',
                lockedBy: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            } as unknown as Omit<WorldEntity, 'id'>;

            return new Promise((resolve) => {
                socket.emit('entity:create', payload as unknown as Omit<WorldEntity, 'id'>, (response) => {
                    if (response.success && response.entity) {
                        const newEntity = response.entity as WorldEntity<T>;
                        setEntities((prev) => {
                            const newMap = new Map(prev);
                            newMap.set(newEntity.id, newEntity as unknown as WorldEntity);
                            return newMap;
                        });
                        resolve(newEntity);
                    } else {
                        console.error('Failed to create entity:', response.error);
                        resolve(null);
                    }
                });
            });
        },
        [socket, isConnected],
    );

    const patchEntity = useCallback(
        (entityId: string, patch: EntityPatchPayload['patch']) => {
            if (!socket || !isConnected) return;

            setEntities((prev) => {
                const entity = prev.get(entityId);
                if (!entity) return prev;

                const newMap = new Map(prev);
                const updatedEntity: WorldEntity = {
                    ...entity,
                    ...patch,
                    transform: patch.transform ? { ...entity.transform, ...patch.transform } : entity.transform,
                    data: patch.data
                        ? { ...(entity.data as Record<string, unknown>), ...(patch.data as Record<string, unknown>) }
                        : entity.data,
                };
                newMap.set(entityId, updatedEntity);
                return newMap;
            });

            socket.emit('entity:patch', { entityId, patch });
        },
        [socket, isConnected],
    );

    const deleteEntity = useCallback(
        (entityId: string) => {
            if (!socket || !isConnected) return;

            setEntities((prev) => {
                const newMap = new Map(prev);
                newMap.delete(entityId);
                return newMap;
            });

            socket.emit('entity:delete', entityId);
        },
        [socket, isConnected],
    );

    const contextValue: WorldContextType = useMemo(
        () => ({
            entities,
            ephemeralData,
            environment,
            availableKinds,
            activePlugins,
            createEntity,
            patchEntity,
            deleteEntity,
            isConnected,
        }),
        [
            entities,
            ephemeralData,
            environment,
            availableKinds,
            activePlugins,
            createEntity,
            patchEntity,
            deleteEntity,
            isConnected,
        ],
    );

    return <WorldContext.Provider value={contextValue}>{children}</WorldContext.Provider>;
};

export const useWorld = () => {
    const context = useContext(WorldContext);
    if (!context) {
        throw new Error('useWorld must be used within WorldProvider');
    }
    return context;
};
