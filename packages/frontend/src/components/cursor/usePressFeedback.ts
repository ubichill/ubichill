import { useEffect, useState } from 'react';

/**
 * 自分のカーソルを「クリック中だけ少し縮める」フィードバック用 hook。
 *
 * 目的: 「自分の手」感を強くするため、入力に対する即時の視覚反応を返す。
 * 物理的なフィードバック (触ったら反応する) は脳が自分の延長と感じやすくなる。
 *
 * - window.pointerdown / pointerup を購読
 * - 押下中は true、リリースで false
 * - これを呼ぶ側 (CursorBundle / SelfCursor) で transform: scale(...) や色変化に使う
 */
export function usePressFeedback(): boolean {
    const [pressed, setPressed] = useState(false);
    useEffect(() => {
        const down = (e: PointerEvent) => {
            // 左クリックだけ (右・中ボタンは含めない)
            if (e.button !== 0) return;
            setPressed(true);
        };
        const up = () => setPressed(false);
        window.addEventListener('pointerdown', down);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            window.removeEventListener('pointerdown', down);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    }, []);
    return pressed;
}
