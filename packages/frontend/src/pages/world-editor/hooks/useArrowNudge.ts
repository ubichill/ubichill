import type { InitialEntity } from '@ubichill/shared';
import { useEffect } from 'react';
import { nudgeFor } from '../lib/stageSelection';

const typingInto = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** 選んだ Entity を矢印キーで 1px（Shift で 10px）動かす。文字を打っているとき・止めているときは何もしない。 */
export function useArrowNudge({
    selected,
    enabled,
    onNudge,
}: {
    selected: InitialEntity | null;
    enabled: boolean;
    onNudge: (patch: { x: number; y: number }) => void;
}) {
    const x = selected?.transform.x;
    const y = selected?.transform.y;
    useEffect(() => {
        if (!enabled || x === undefined || y === undefined) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || typingInto(e.target)) return;
            const step = nudgeFor(e.key, e.shiftKey);
            if (!step) return;
            e.preventDefault();
            onNudge({ x: x + step.dx, y: y + step.dy });
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled, x, y, onNudge]);
}
