/**
 * heldOffset — 「掴んでいるエンティティとカーソルの相対オフセット」の単一情報源。
 *
 * Worker (grip.acquire) が CMD_GRIP hold で送ってきた offsetX/Y は、WorkerModHost が
 * `entity.data.heldOffset` に書く (share='persistent' のときのみ)。
 * リモート側 (CursorLayer の cursor:moved 受信 / EntityRenderer の初期位置計算) は
 * このフィールドから読むことで、grip ごとに違うオフセット (pen は -18/-24、別 grip は別の値)
 * が正しく反映される。フィールドが無いとき (= 旧 entity や share=local) は左 -24/0 を使う。
 */

import type { ComponentInstance } from '@ubichill/shared';

export const DEFAULT_HELD_OFFSET = { x: -24, y: 0 } as const;

export function readHeldOffset(entity: ComponentInstance | undefined | null): { x: number; y: number } {
    if (!entity) return DEFAULT_HELD_OFFSET;
    const data = entity.data as { heldOffset?: { x?: number; y?: number } | null } | undefined;
    const ho = data?.heldOffset;
    if (!ho) return DEFAULT_HELD_OFFSET;
    return {
        x: typeof ho.x === 'number' ? ho.x : DEFAULT_HELD_OFFSET.x,
        y: typeof ho.y === 'number' ? ho.y : DEFAULT_HELD_OFFSET.y,
    };
}
