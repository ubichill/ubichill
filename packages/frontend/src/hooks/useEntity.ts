'use client';

import {
    type EntityEphemeralPayload,
    type EntityPatchPayload,
    type EntityTransform,
    type WorldEntity,
} from '@ubichill/shared';
import throttle from 'lodash.throttle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './useSocket';

/**
 * ワールド内の全エンティティを管理するフック
 */
export const useWorld = () => {
    const { socket, isConnected, currentUser } = useSocket();
    const [entities, setEntities] = useState<Map<string, WorldEntity>>(new Map());
    const [ephemeralData, setEphemeralData] = useState<Map<string, unknown>>(new Map());

    useEffect(() => {
        if (!socket) return;

        // ワールドスナップショットを受信（初期ロード）
        const handleWorldSnapshot = (entityList: WorldEntity[]) => {
            const newMap = new Map<string, WorldEntity>();
            for (const entity of entityList) {
                newMap.set(entity.id, entity);
            }
            setEntities(newMap);
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

    /**
     * 新しいエンティティを作成
     */
    const createEntity = useCallback(
        async <T>(
            type: string,
            transform: EntityTransform,
            data: T,
        ): Promise<WorldEntity<T> | null> => {
            if (!socket || !isConnected || !currentUser) {
                return null;
            }

            const payload: Omit<WorldEntity<T>, 'id'> = {
                type,
                ownerId: currentUser.id,
                lockedBy: null,
                transform,
                data,
            };

            return new Promise((resolve) => {
                socket.emit('entity:create', payload as unknown as Omit<WorldEntity, 'id'>, (response) => {
                    if (response.success && response.entity) {
                        // 楽観的に追加
                        setEntities((prev) => {
                            const newMap = new Map(prev);
                            newMap.set(response.entity!.id, response.entity!);
                            return newMap;
                        });
                        resolve(response.entity as WorldEntity<T>);
                    } else {
                        resolve(null);
                    }
                });
            });
        },
        [socket, isConnected, currentUser],
    );

    /**
     * エンティティを削除
     */
    const deleteEntity = useCallback(
        (entityId: string) => {
            if (!socket || !isConnected) return;

            // 楽観的に削除
            setEntities((prev) => {
                const newMap = new Map(prev);
                newMap.delete(entityId);
                return newMap;
            });

            socket.emit('entity:delete', entityId);
        },
        [socket, isConnected],
    );

    return {
        entities,
        ephemeralData,
        createEntity,
        deleteEntity,
        isConnected,
        currentUser,
    };
};

/**
 * 特定のエンティティを操作するフック
 * @param entityId エンティティID
 * @param options オプション（initialEntityで初期値を指定可能）
 */
export const useEntity = <T = Record<string, unknown>>(
    entityId: string,
    options?: { initialEntity?: WorldEntity<T> }
) => {
    const { socket, isConnected, currentUser } = useSocket();
    const [entity, setEntity] = useState<WorldEntity<T> | null>(options?.initialEntity ?? null);
    const [ephemeral, setEphemeral] = useState<unknown>(null);
    const previousPatchRef = useRef<Partial<Omit<WorldEntity<T>, 'id' | 'type'>> | null>(null);

    useEffect(() => {
        if (!socket) return;

        // ワールドスナップショットからエンティティを取得
        const handleWorldSnapshot = (entityList: WorldEntity[]) => {
            const found = entityList.find((e) => e.id === entityId);
            if (found) {
                setEntity(found as WorldEntity<T>);
            }
        };

        // エンティティ作成を受信
        const handleEntityCreated = (newEntity: WorldEntity) => {
            if (newEntity.id === entityId) {
                setEntity(newEntity as WorldEntity<T>);
            }
        };

        // パッチを受信
        const handleEntityPatched = (payload: EntityPatchPayload) => {
            if (payload.entityId !== entityId) return;

            setEntity((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    ...payload.patch,
                    transform: payload.patch.transform
                        ? { ...prev.transform, ...payload.patch.transform }
                        : prev.transform,
                } as WorldEntity<T>;
            });
        };

        // エフェメラルを受信
        const handleEntityEphemeral = (payload: EntityEphemeralPayload) => {
            if (payload.entityId !== entityId) return;
            setEphemeral(payload.data);
        };

        // 削除を受信
        const handleEntityDeleted = (deletedId: string) => {
            if (deletedId === entityId) {
                setEntity(null);
            }
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
    }, [socket, entityId]);

    /**
     * 状態を同期（Reliable）
     * サーバーに保存され、他のクライアントに配信される
     */
    const syncState = useCallback(
        (patch: Partial<Omit<WorldEntity<T>, 'id' | 'type'>>) => {
            if (!socket || !isConnected) return;

            // 楽観的UI更新
            setEntity((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    ...patch,
                    transform: patch.transform
                        ? { ...prev.transform, ...patch.transform }
                        : prev.transform,
                } as WorldEntity<T>;
            });

            // 前回のパッチを保存（ロールバック用）
            previousPatchRef.current = patch;

            socket.emit('entity:patch', { entityId, patch: patch as unknown as Partial<Omit<WorldEntity, 'id' | 'type'>> });
        },
        [socket, isConnected, entityId],
    );

    /**
     * ストリームを同期（Volatile）- 50msスロットル
     * サーバーに保存されず、リアルタイムで他のクライアントに配信される
     */
    const syncStream = useMemo(
        () =>
            throttle(
                (data: unknown) => {
                    if (!socket || !isConnected) return;
                    socket.emit('entity:ephemeral', { entityId, data });
                },
                50,
                { leading: true, trailing: true },
            ),
        [socket, isConnected, entityId],
    );

    /**
     * ロックを取得
     */
    const tryLock = useCallback(() => {
        if (!currentUser || !entity) return false;
        if (entity.lockedBy && entity.lockedBy !== currentUser.id) {
            return false; // 他のユーザーがロック中
        }
        syncState({ lockedBy: currentUser.id } as Partial<Omit<WorldEntity<T>, 'id' | 'type'>>);
        return true;
    }, [currentUser, entity, syncState]);

    /**
     * ロックを解除
     */
    const unlock = useCallback(() => {
        if (!currentUser || !entity) return;
        if (entity.lockedBy === currentUser.id) {
            syncState({ lockedBy: null } as Partial<Omit<WorldEntity<T>, 'id' | 'type'>>);
        }
    }, [currentUser, entity, syncState]);

    /**
     * このエンティティが現在のユーザーによってロックされているか
     */
    const isLockedByMe = entity?.lockedBy === currentUser?.id;

    /**
     * このエンティティが他のユーザーによってロックされているか
     */
    const isLockedByOther = Boolean(entity?.lockedBy && entity.lockedBy !== currentUser?.id);

    return {
        entity,
        ephemeral,
        syncState,
        syncStream,
        tryLock,
        unlock,
        isLockedByMe,
        isLockedByOther,
    };
};
