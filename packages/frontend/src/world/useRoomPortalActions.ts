import { useSocket, useWorld } from '@ubichill/react';
import { roomPortalCenter } from '@ubichill/shared';
import { useMemo } from 'react';

/** 見ている所の真ん中（ワールドの座標）。部屋の画面が無ければ null。 */
function viewCenter(): { x: number; y: number } | null {
    const el = document.querySelector<HTMLElement>('[data-scroll-world]');
    if (!el) return null;
    return { x: el.scrollLeft + el.clientWidth / 2, y: el.scrollTop + el.clientHeight / 2 };
}

/** 断られたときの理由。置けた・閉じられたら null。 */
type Outcome = Promise<string | null>;

/**
 * 部屋へのポータルを置く・閉じる。置く場所は見ている所の真ん中で、インスタンスが Entity を作って全員に配る
 * （自分の画面にも entity:created で届く）。
 */
export function useRoomPortalActions(): { open: (room: string) => Outcome; close: () => Outcome } {
    const { socket } = useSocket();
    const { environment } = useWorld();
    return useMemo(() => {
        const failed = (fallback: string) => (response: { success: boolean; error?: string }) =>
            response.success ? null : (response.error ?? fallback);
        return {
            open: (room) =>
                new Promise((resolve) => {
                    if (!socket) return resolve('接続が切れています');
                    const size = environment.worldSize;
                    const at = roomPortalCenter(viewCenter() ?? { x: size.width / 2, y: size.height / 2 }, size);
                    socket.emit('portal:open', { room, ...at }, (response) =>
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
    }, [socket, environment.worldSize]);
}
