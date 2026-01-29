'use client';

import type { WorldEntity } from '@ubichill/shared';
import throttle from 'lodash.throttle';
import { useCallback, useMemo, useRef } from 'react';
import { useWorld } from '../contexts/WorldContext';
import { useSocket } from './useSocket';

/**
 * 特定のエンティティを操作するフック
 * @param entityId エンティティID
 * @param options オプション（initialEntityで初期値を指定可能）
 */
export const useEntity = <T = Record<string, unknown>>(
    entityId: string,
    options?: { initialEntity?: WorldEntity<T> },
) => {
    const { socket, isConnected, currentUser } = useSocket();
    const { entities, ephemeralData, patchEntity } = useWorld();

    // コンテキストからエンティティを取得、なければ初期値
    const contextEntity = entities.get(entityId) as WorldEntity<T> | undefined;
    const entity = contextEntity ?? options?.initialEntity ?? null;

    // コンテキストからエフェメラルデータを取得
    const ephemeral = ephemeralData.get(entityId) as unknown;

    const previousPatchRef = useRef<Partial<Omit<WorldEntity<T>, 'id' | 'type'>> | null>(null);

    /**
     * 状態を同期（Reliable）
     * サーバーに保存され、他のクライアントに配信される
     */
    const syncState = useCallback(
        (patch: Partial<Omit<WorldEntity<T>, 'id' | 'type'>>) => {
            if (!isConnected) return;

            // 変更がない場合は送信しない
            if (JSON.stringify(patch) === JSON.stringify(previousPatchRef.current)) {
                return;
            }
            previousPatchRef.current = patch;

            patchEntity(entityId, patch as Partial<WorldEntity<Record<string, unknown>>>);
        },
        [patchEntity, isConnected, entityId],
    );

    /**
     * リアルタイムデータを送信（Volatile）
     * サーバーに保存されず、他のクライアントに即座に配信される
     * 間引き処理付き (50ms)
     */
    const syncStream = useMemo(
        () =>
            throttle((data: unknown) => {
                if (!socket || !isConnected) return;
                socket.emit('entity:ephemeral', { entityId, data });
            }, 50),
        [socket, isConnected, entityId],
    );

    /**
     * エンティティのロックを取得しようとする
     * 成功すれば true, 失敗(他人がロック中)なら false
     */
    const tryLock = useCallback((): boolean => {
        if (!entity || !currentUser) return false;

        // 既に自分がロックしている
        if (entity.lockedBy === currentUser.id) return true;

        // 誰もロックしていない
        if (!entity.lockedBy) {
            syncState({ lockedBy: currentUser.id } as Partial<Omit<WorldEntity<T>, 'id' | 'type'>>);
            return true;
        }

        return false;
    }, [entity, currentUser, syncState]);

    /**
     * ロックを解放する
     */
    const unlock = useCallback(() => {
        if (!entity || !currentUser) return;

        if (entity.lockedBy === currentUser.id) {
            syncState({ lockedBy: null } as Partial<Omit<WorldEntity<T>, 'id' | 'type'>>);
        }
    }, [entity, currentUser, syncState]);

    const isLockedByMe = entity?.lockedBy === currentUser?.id;
    const isLockedByOther = !!entity?.lockedBy && entity.lockedBy !== currentUser?.id;

    return {
        entity,
        ephemeral,
        syncState,
        syncStream,
        tryLock,
        unlock,
        isLockedByMe,
        isLockedByOther,
        isConnected,
    };
};

// Re-export useWorld from context
export { useWorld } from '../contexts/WorldContext';
