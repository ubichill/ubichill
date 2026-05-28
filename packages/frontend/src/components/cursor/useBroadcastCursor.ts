import { useSocket } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';

/**
 * 自分のカーソル位置を socket 経由で他ユーザーに配信する。
 *
 * 旧 avatar:cursor プラグインの `Ubi.player.syncCursor` がやっていた役割を
 * 本体に取り込んだもの。プラグインが消えても他人から自分の位置が見える。
 *
 * - viewport 座標 (localCursor) を受け取り、`world = viewport + scroll` に変換して送る
 *   (scroll は `[data-scroll-world]` 要素から都度読む — React state 経由しないので最新)
 * - throttleMs ごとに max 1 回送信 (毎フレーム fire しても socket spam しない)
 * - currentUser が未確定 (= インスタンス未参加) の間は送信しない
 */
export function useBroadcastCursor(
    localCursor: { x: number; y: number } | null,
    scrollEl: HTMLElement | null,
    throttleMs = 50,
): void {
    const { currentUser, updatePosition } = useSocket();
    const lastSentAt = useRef(0);

    useEffect(() => {
        if (!currentUser || !localCursor) return;
        const now = Date.now();
        if (now - lastSentAt.current < throttleMs) return;
        lastSentAt.current = now;
        const sx = scrollEl?.scrollLeft ?? 0;
        const sy = scrollEl?.scrollTop ?? 0;
        updatePosition({
            x: localCursor.x + sx,
            y: localCursor.y + sy,
        });
    }, [localCursor, scrollEl, currentUser, updatePosition, throttleMs]);
}
