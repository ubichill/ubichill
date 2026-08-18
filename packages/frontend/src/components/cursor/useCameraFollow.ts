import type { CursorPosition } from '@ubichill/shared';
import { useEffect } from 'react';

/**
 * アバターの position をビューポート中央に据えるスクロール位置を求める純関数。
 * `worldSize` の範囲でクランプするため、ワールド端に近づくとそこで止まる
 * (worldSize がカメラのパン可能範囲として意味を持つのはこの計算のみ)。
 */
export function computeCameraScroll(
    position: CursorPosition,
    worldSize: { width: number; height: number },
    viewport: { width: number; height: number },
): { scrollLeft: number; scrollTop: number } {
    const maxScrollLeft = Math.max(0, worldSize.width - viewport.width);
    const maxScrollTop = Math.max(0, worldSize.height - viewport.height);
    return {
        scrollLeft: Math.min(Math.max(position.x - viewport.width / 2, 0), maxScrollLeft),
        scrollTop: Math.min(Math.max(position.y - viewport.height / 2, 0), maxScrollTop),
    };
}

/**
 * `movementMode: 'keyboard'` のワールドで、自分の position が変わるたびに
 * スクロールコンテナ (`[data-scroll-world]`) の scrollLeft/scrollTop を
 * `computeCameraScroll` の結果へ書き換える(= カメラ追従)。
 *
 * `mouse` モードでは何もしない(既存のネイティブ自由スクロールのまま)。
 */
export function useCameraFollow(
    movementMode: 'mouse' | 'keyboard' | undefined,
    scrollEl: HTMLElement | null,
    position: CursorPosition | undefined,
    worldSize: { width: number; height: number },
): void {
    useEffect(() => {
        if (movementMode !== 'keyboard' || !scrollEl || !position) return;
        const { scrollLeft, scrollTop } = computeCameraScroll(position, worldSize, {
            width: scrollEl.clientWidth,
            height: scrollEl.clientHeight,
        });
        scrollEl.scrollLeft = scrollLeft;
        scrollEl.scrollTop = scrollTop;
    }, [movementMode, scrollEl, position, worldSize]);
}
