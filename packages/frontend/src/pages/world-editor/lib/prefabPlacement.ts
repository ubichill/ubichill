import type { InitialEntity } from '@ubichill/shared';
import { drawnBoxesOf, enclosing, type StageRect } from './drawnBounds';
import { flattenForStage } from './entityTree';

/** 親の原点からの位置で、中身が描かれる範囲（描く側と同じ大きさ）。大きさの分かる Entity が無ければ null。 */
export const contentBounds = (entities: readonly InitialEntity[]): StageRect | null =>
    enclosing(flattenForStage(entities).flatMap(drawnBoxesOf));

/** 子として置くときの既定の場所: 親が描かれている範囲の真ん中（親の原点から）。大きさが無ければ親の原点。 */
export function centerOf(parent: InitialEntity): { x: number; y: number } {
    const b = enclosing(drawnBoxesOf({ entity: parent, absX: 0, absY: 0 }));
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: 0, y: 0 };
}

// -0 を YAML に書かない
const whole = (value: number): number => Math.round(value) || 0;

const fit = (start: number, size: number, offset: number, limit: number | undefined): number => {
    if (limit === undefined) return start;
    // 入りきらなければ左上（上端）をワールドの端にそろえる
    return Math.min(Math.max(start, -offset), Math.max(-offset, limit - offset - size));
};

/**
 * 中身の真ん中が point（ワールド座標）に来る親の位置。ワールドの大きさがあれば、中身がはみ出さないように寄せる。
 * 中身に大きさが無ければ、親を point に置く。
 */
export function placementFor(
    point: { x: number; y: number },
    bounds: StageRect | null,
    worldSize?: { width: number; height: number },
): { x: number; y: number } {
    const b = bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
        x: whole(fit(point.x - b.x - b.width / 2, b.width, b.x, worldSize?.width)),
        y: whole(fit(point.y - b.y - b.height / 2, b.height, b.y, worldSize?.height)),
    };
}
