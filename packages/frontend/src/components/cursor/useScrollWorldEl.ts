import { useEffect, useState } from 'react';

/**
 * `[data-scroll-world]` (= インスタンス内のワールドスクロール container) を
 * DOM ツリーから動的に検出して返す hook。
 *
 * - InstancePage 等でマウント後に出てくるので route 切替で生え変わる
 * - 見つからない (= ロビーや editor 外) ときは null
 * - MutationObserver で「DOM の childList/subtree が変化したとき」だけ再検出する
 *   (polling 不要、最小コスト)
 */
export function useScrollWorldEl(): HTMLElement | null {
    const [el, setEl] = useState<HTMLElement | null>(null);

    useEffect(() => {
        const find = (): HTMLElement | null => document.querySelector('[data-scroll-world]');
        const sync = () => {
            const next = find();
            setEl((prev) => (prev === next ? prev : next));
        };
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(document.body, { childList: true, subtree: true });
        return () => obs.disconnect();
    }, []);

    return el;
}
