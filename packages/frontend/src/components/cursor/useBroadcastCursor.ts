import { useSocket } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';

/**
 * 自分のカーソル位置を socket 経由で他ユーザーに配信する。
 *
 * 旧 avatar:cursor プラグインの `Ubi.player.syncCursor` がやっていた役割を
 * 本体に取り込んだもの。プラグインが消えても他人から自分の位置が見える。
 *
 * トリガは 2 つ:
 *  1. localCursor の変化 (= pointermove) — マウスが動いたとき
 *  2. scrollEl の scroll イベント — マウスは動かなくてもスクロールで world 位置が変わる
 *
 * どちらの経路でも `world = viewport + scroll` を都度計算して送る。
 * 共通の throttleMs (デフォルト 50ms) で衝突しても 1 回に集約。
 *
 * currentUser が未確定 (= インスタンス未参加) の間は送信しない。
 */
export function useBroadcastCursor(
    localCursor: { x: number; y: number } | null,
    scrollEl: HTMLElement | null,
    throttleMs = 50,
): void {
    const { currentUser, updatePosition } = useSocket();
    const lastSentAt = useRef(0);

    // ── 1. pointermove 経由: localCursor の変化で発火 ─────────────
    useEffect(() => {
        if (!localCursor || !currentUser) return;
        const now = Date.now();
        if (now - lastSentAt.current < throttleMs) return;
        lastSentAt.current = now;
        const sx = scrollEl?.scrollLeft ?? 0;
        const sy = scrollEl?.scrollTop ?? 0;
        updatePosition({ x: localCursor.x + sx, y: localCursor.y + sy });
    }, [localCursor, scrollEl, currentUser, updatePosition, throttleMs]);

    // ── 2. scroll 経由: マウスが動かなくても world 位置が変わる ───
    // imperative addEventListener。scroll listener から localCursor / currentUser /
    // updatePosition の最新値が必要なので ref で持つ。
    const cursorRef = useRef(localCursor);
    const currentUserIdRef = useRef(currentUser?.id);
    const updatePositionRef = useRef(updatePosition);
    useEffect(() => {
        cursorRef.current = localCursor;
        currentUserIdRef.current = currentUser?.id;
        updatePositionRef.current = updatePosition;
    });

    useEffect(() => {
        if (!scrollEl) return;
        const onScroll = () => {
            const c = cursorRef.current;
            if (!c || !currentUserIdRef.current) return;
            const now = Date.now();
            if (now - lastSentAt.current < throttleMs) return;
            lastSentAt.current = now;
            updatePositionRef.current({ x: c.x + scrollEl.scrollLeft, y: c.y + scrollEl.scrollTop });
        };
        scrollEl.addEventListener('scroll', onScroll, { passive: true });
        return () => scrollEl.removeEventListener('scroll', onScroll);
    }, [scrollEl, throttleMs]);
}
