import type { CursorPosition } from '@ubichill/shared';

/**
 * アバターの position をビューポート中央に据えるスクロール位置を求める純関数。
 * `worldSize` の範囲でクランプするため、ワールド端に近づくとそこで止まる
 * (worldSize がカメラのパン可能範囲として意味を持つのはこの計算のみ)。
 *
 * 呼び出し元: `useRideFollow` の requestAnimationFrame ループ
 * (乗車中のみ、毎フレーム呼ばれる)。
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
