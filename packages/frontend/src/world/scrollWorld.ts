import type { CursorPosition } from '@ubichill/shared';
import { computeCameraScroll } from './cursor/useCameraFollow';

/** 部屋のワールドを、point が画面の中心に来るようにスクロールする。部屋の外（エディタ・world.html の読み込み前）では何もしない。 */
export function scrollWorldTo(
    point: CursorPosition,
    worldSize: { width: number; height: number },
    behavior: ScrollBehavior = 'smooth',
): void {
    const el = document.querySelector<HTMLElement>('[data-scroll-world]');
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const { scrollLeft, scrollTop } = computeCameraScroll(point, worldSize, {
        width: el.clientWidth,
        height: el.clientHeight,
    });
    el.scrollTo({ left: scrollLeft, top: scrollTop, behavior: reduced ? 'auto' : behavior });
}
