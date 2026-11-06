import { useEffect, useState } from 'react';

/**
 * `[data-scroll-world]` (= インスタンス内のワールドスクロール container) を
 * DOM ツリーから動的に検出して返す hook。
 *
 * - InstancePage 等でマウント後に出てくるので route 切替で生え変わる
 * - 見つからない (= ロビーや editor 外) ときは null
 * - MutationObserver で document.body の subtree 変化を購読するが、
 *   mod の VNode レンダリングで頻繁に発火するので **rAF でデバウンス** している。
 *   1 フレーム内の連続変化は 1 回の querySelector に集約され、同じ要素なら
 *   setState は呼ばずに React の bailout (= 再 render なし) に任せる。
 */
export function useScrollWorldEl(): HTMLElement | null {
    const [el, setEl] = useState<HTMLElement | null>(null);

    useEffect(() => {
        let rafId = 0;
        let lastEl: HTMLElement | null = null;
        const tick = () => {
            rafId = 0;
            const next = document.querySelector('[data-scroll-world]') as HTMLElement | null;
            if (next === lastEl) return; // 同じなら state 触らない (React bailout)
            lastEl = next;
            setEl(next);
        };
        const schedule = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(tick);
        };
        tick(); // initial
        const obs = new MutationObserver(schedule);
        obs.observe(document.body, { childList: true, subtree: true });
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            obs.disconnect();
        };
    }, []);

    return el;
}
