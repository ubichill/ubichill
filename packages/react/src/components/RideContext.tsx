/**
 * RideContext — 自分が「乗って」いる乗り物 Entity の状態を管理するコンテキスト。
 *
 * 責務:
 *  - Ubi.ride が CMD_RIDE(mount/dismount)を送ってきたとき、riding state を更新する
 *  - 既に他の乗り物に乗っていた場合は、その乗り物の lockedBy を自動でクリアして降ろす
 *    (1ユーザーが同時に2つの乗り物に乗ることはない)
 *  - CursorLayer (RideProvider の外側・router レベルで動く) から読めるよう
 *    ridingSyncRef にも同期する(HoldContext/heldEntitySyncRef と同じパターン)
 */

import type { CmdRide } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useWorld } from '../hooks/useWorld';
import { ridingSyncRef } from '../ridingSyncRef';

export interface RidingState {
    /** 乗っている乗り物の ComponentInstance ID */
    entityId: string;
}

interface RideContextValue {
    /** 現在乗っている乗り物の状態(null = 何にも乗っていない) */
    riding: RidingState | null;
    /** ride コマンドを処理して乗車状態を更新する */
    handleRideCommand(payload: CmdRide['payload']): void;
}

const RideContext = createContext<RideContextValue | null>(null);

export const RideProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [riding, setRiding] = useState<RidingState | null>(null);
    const ridingRef = useRef<RidingState | null>(null);
    const { patchEntity } = useWorld();

    const handleRideCommand = useCallback(
        (payload: CmdRide['payload']) => {
            if (payload.action === 'mount') {
                const prev = ridingRef.current;
                // 既に別の乗り物に乗っていたら、その lockedBy をクリアして自動で降ろす
                if (prev && prev.entityId !== payload.entityId) {
                    patchEntity(prev.entityId, { lockedBy: null });
                }
                const state: RidingState = { entityId: payload.entityId };
                ridingRef.current = state;
                setRiding(state);
                // RideProvider 外（router レベル）からも読めるよう同期
                ridingSyncRef.set(state);
            } else if (payload.action === 'dismount') {
                if (ridingRef.current?.entityId === payload.entityId) {
                    ridingRef.current = null;
                    setRiding(null);
                    ridingSyncRef.set(null);
                }
            }
        },
        [patchEntity],
    );

    return <RideContext.Provider value={{ riding, handleRideCommand }}>{children}</RideContext.Provider>;
};

/** プロバイダが無い時に返す no-op フォールバック */
const NO_RIDE_CTX: RideContextValue = {
    riding: null,
    handleRideCommand: () => {
        /* no-op (RideProvider 外で呼ばれた場合は何もしない) */
    },
};

/**
 * `RideProvider` の外でも安全に使える。Provider が無い場合は no-op の状態を返す。
 */
export function useRide(): RideContextValue {
    const ctx = useContext(RideContext);
    return ctx ?? NO_RIDE_CTX;
}
