import { useEffect, useState } from 'react';

/**
 * インスタンス内でワールドを scroll する要素 (`[data-scroll-world]`) の現在位置を返す hook。
 * 要素がなければ `{x:0, y:0}` を返す (ロビーや editor 外など)。
 *
 * リモートユーザーの位置は **world 座標** で届くので、`viewport = world - scroll` で
 * `position:fixed` 描画に変換するために使う。
 */
export function useWorldScroll(): { x: number; y: number } {
    const [scroll, setScroll] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const el = document.querySelector('[data-scroll-world]');
        if (!el) return;
        const update = () => setScroll({ x: el.scrollLeft, y: el.scrollTop });
        update(); // initial
        el.addEventListener('scroll', update, { passive: true });
        return () => el.removeEventListener('scroll', update);
    }, []);

    return scroll;
}
