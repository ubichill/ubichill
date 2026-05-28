import { useEffect, useState } from 'react';

/**
 * ローカルのマウス位置 (viewport / clientX,Y) を tracking する hook。
 *
 * - SocketProvider に依存しないのでログイン前 / ロビー / どのページでも動く。
 * - 初回 mousemove までは null を返す → 「マウスを動かしていない時はネームプレート非表示」にできる。
 * - タッチ/ペンも対応 (pointermove に統一)。
 */
export function useLocalCursor(): { x: number; y: number } | null {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
        const onLeave = () => setPos(null);
        window.addEventListener('pointermove', onMove);
        document.addEventListener('pointerleave', onLeave);
        return () => {
            window.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerleave', onLeave);
        };
    }, []);

    return pos;
}
