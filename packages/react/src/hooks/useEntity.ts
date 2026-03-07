'use client';

import type { WorldEntity } from '@ubichill/shared';
import throttle from 'lodash.throttle';
import { useCallback, useMemo, useRef } from 'react';

function shallowEqual(a: object | null, b: object): boolean {
    if (a === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
    }
    return true;
}
import { useSocket } from './useSocket';
import { useWorld } from './useWorld';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThrottledFn = ReturnType<typeof throttle<(...args: unknown[]) => unknown>>;

/**
 * 特定のエンティティを操作するフック
 * @param entityId エンティティID
 * @param options オプション（initialEntityで初期値を指定可能）
 */
export const useEntity = <T = Record<string, unknown>>(
    entityId: string,
    options?: { initialEntity?: WorldEntity<T> },
): {
    entity: WorldEntity<T> | null;
    ephemeral: unknown;
    syncState: (patch: Partial<Omit<WorldEntity<T>, 'id' | 'type'>>) => void;
    syncStream: (data: unknown) => void;
    tryLock: () => boolean;
    unlock: () => void;
    isLockedByMe: boolean;
    isLockedByOther: boolean;
    isConnected: boolean;
} => {
    const { socket, isConnected, currentUser } = useSocket();
    const { entities, ephemeralData, patchEntity } = useWorld();

    // コンテキストからエンティティを取得、なければ初期値
    const contextEntity = entities.get(entityId) as WorldEntity<T> | undefined;
    const entity = contextEntity ?? options?.initialEntity ?? null;

    // コンテキストからエフェメラルデータを取得
    const ephemeral = ephemeralData.get(entityId) as unknown;

    const previousPatchRef = useRef<Partial<Omit<WorldEntity<T>, 'id' | 'type'>> | null>(null);

    // syncStream の安定参照のために Refs で最新値を保持
    const socketRef = useRef(socket);
    const isConnectedRef = useRef(isConnected);
    const entityIdRef = useRef(entityId);
    socketRef.current = socket;
    isConnectedRef.current = isConnected;
    entityIdRef.current = entityId;

    // throttled 関数はコンポーネントのライフタイムで一度だけ生成（安定参照）
    // Refs 経由で常に最新の socket / entityId を参照するため、依存配列は空でよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const syncStreamThrottle = useMemo<ThrottledFn>(
        () =>
            throttle((data: unknown) => {
                if (!socketRef.current || !isConnectedRef.current) return;
                socketRef.current.emit('entity:ephemeral', { entityId: entityIdRef.current, data });
            }, 50),
        [],
    );

    /**
     * 状態を同期（Reliable）
     * サーバーに保存され、他のクライアントに配信される
     */
    const syncState = useCallback(
        (patch: Partial<Omit<WorldEntity<T>, 'id' | 'type'>>) => {
            if (!isConnected) return;

            // 変更がない場合は送信しない
            if (shallowEqual(previousPatchRef.current, patch)) {
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
     * 間引き処理付き (50ms) / 安定した参照（再レンダーで再生成されない）
     */
    const syncStream = useCallback(
        (data: unknown) => {
            syncStreamThrottle(data);
        },
        [syncStreamThrottle],
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
