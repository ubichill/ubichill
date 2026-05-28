import { useSocket } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';

/**
 * 自分のカーソル位置を socket 経由で他ユーザーに配信する。
 *
 * 旧 avatar:cursor プラグインの `Ubi.player.syncCursor` がやっていた役割を
 * 本体に取り込んだもの。プラグインが消えても他人から自分の位置が見える。
 *
 * - viewport 座標 (x, y) を受け取り、`world = viewport + scroll` に変換して送る
 * - throttleMs ごとに max 1 回送信 (毎フレーム fire しても socket spam しない)
 * - currentUser が未確定 (= インスタンス未参加) の間は送信しない
 */
export function useBroadcastCursor(
    localCursor: { x: number; y: number } | null,
    scroll: { x: number; y: number },
    throttleMs = 50,
): void {
    const { currentUser, updatePosition } = useSocket();
    const lastSentAt = useRef(0);

    useEffect(() => {
        if (!currentUser || !localCursor) return;
        const now = Date.now();
        if (now - lastSentAt.current < throttleMs) return;
        lastSentAt.current = now;
        updatePosition({
            x: localCursor.x + scroll.x,
            y: localCursor.y + scroll.y,
        });
    }, [localCursor, scroll, currentUser, updatePosition, throttleMs]);
}
