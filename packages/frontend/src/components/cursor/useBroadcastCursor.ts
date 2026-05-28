import type { HoldState } from '@ubichill/sdk/react';
import { useSocket } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';

/**
 * 自分のカーソル位置を socket 経由で他ユーザーに配信する。
 *
 * 旧 avatar:cursor プラグインの `Ubi.player.syncCursor` がやっていた役割を
 * 本体に取り込んだもの。プラグインが消えても他人から自分の位置が見える。
 *
 * **自己完結**: 内部で pointermove + scroll を addEventListener する。
 * React state は使わない (= 親が再 render しない)。
 *
 * トリガは 2 つ:
 *  1. pointermove — マウスが動いたとき
 *  2. scroll  — マウスは動かなくてもスクロールで world 位置が変わる
 *
 * どちらの経路でも `world = viewport + scroll` を都度計算して送る。
 * 共通の throttleMs (デフォルト 50ms) で衝突しても 1 回に集約。
 *
 * currentUser が未確定 (= インスタンス未参加) の間は送信しない。
 *
 * heldRef: HoldContext の ref。cursor:move に heldEntityId を含めて
 * 他ユーザーに「今持っているエンティティ」を伝える。
 */
export function useBroadcastCursor(
    scrollEl: HTMLElement | null,
    heldRef: React.RefObject<HoldState | null>,
    throttleMs = 50,
): void {
    const { currentUser, updatePosition } = useSocket();

    // listener 内から最新値を読むため ref で保持 (subscribe コスト 0)
    const currentUserIdRef = useRef(currentUser?.id);
    const updatePositionRef = useRef(updatePosition);
    useEffect(() => {
        currentUserIdRef.current = currentUser?.id;
        updatePositionRef.current = updatePosition;
    });

    // 最後に観測した viewport 座標 (scroll-only 時に再利用)
    const lastViewportRef = useRef<{ x: number; y: number } | null>(null);
    const lastSentAt = useRef(0);

    useEffect(() => {
        const send = () => {
            const v = lastViewportRef.current;
            if (!v || !currentUserIdRef.current) return;
            const now = Date.now();
            if (now - lastSentAt.current < throttleMs) return;
            lastSentAt.current = now;
            const sx = scrollEl?.scrollLeft ?? 0;
            const sy = scrollEl?.scrollTop ?? 0;
            const held = heldRef.current;
            // share !== 'local' の場合のみ heldEntityId を含める
            const heldEntityId =
                held && held.share !== 'local' ? held.entityId : held === null ? null : undefined;
            updatePositionRef.current({ x: v.x + sx, y: v.y + sy }, undefined, heldEntityId);
        };

        const onMove = (e: PointerEvent) => {
            lastViewportRef.current = { x: e.clientX, y: e.clientY };
            send();
        };

        window.addEventListener('pointermove', onMove);
        scrollEl?.addEventListener('scroll', send, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            scrollEl?.removeEventListener('scroll', send);
        };
    }, [scrollEl, throttleMs, heldRef]);
}
