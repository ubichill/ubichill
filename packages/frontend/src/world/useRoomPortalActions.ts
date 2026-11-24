import { useSocket } from '@ubichill/react';
import { useMemo } from 'react';
import type { Point } from './portalPlacement';

/** 断られたときの理由。置けた・閉じられたら null。 */
type Outcome = Promise<string | null>;

/**
 * 部屋へのポータルを置く・閉じる。at はポータルの真ん中（ワールドの座標。placementAt で寄せたもの）で、インスタンスが
 * Entity を部屋のいちばん前に作って全員に配る（自分の画面にも entity:created で届く）。grant は SNS の backend が出した
 * 置く許可（単体モードでは無い）。
 */
export function useRoomPortalActions(): {
    open: (room: string, at: Point, grant?: string) => Outcome;
    close: () => Outcome;
} {
    const { socket } = useSocket();
    return useMemo(() => {
        const failed = (fallback: string) => (response: { success: boolean; error?: string }) =>
            response.success ? null : (response.error ?? fallback);
        return {
            open: (room, at, grant) =>
                new Promise((resolve) => {
                    if (!socket) return resolve('接続が切れています');
                    socket.emit('portal:open', { room, x: at.x, y: at.y, ...(grant ? { grant } : {}) }, (response) =>
                        resolve(failed('ポータルを置けませんでした')(response)),
                    );
                }),
            close: () =>
                new Promise((resolve) => {
                    if (!socket) return resolve('接続が切れています');
                    socket.emit('portal:close', (response) =>
                        resolve(failed('ポータルを閉じられませんでした')(response)),
                    );
                }),
        };
    }, [socket]);
}
