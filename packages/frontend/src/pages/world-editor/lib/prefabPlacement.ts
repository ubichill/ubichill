import type { InitialEntity } from '@ubichill/shared';
import type { StageRect } from './stageSelection';

/** 親の原点からの位置で、中身のうち大きさのある Entity が占める範囲。無ければ null。 */
export function contentBounds(entities: readonly InitialEntity[]): StageRect | null {
    const rects = entities.flatMap(function walk(e: InitialEntity): { l: number; t: number; r: number; b: number }[] {
        const { x, y, w = 0, h = 0 } = e.transform;
        const own = w > 0 && h > 0 ? [{ l: x, t: y, r: x + w, b: y + h }] : [];
        const children = e.children.flatMap(walk).map((c) => ({ l: c.l + x, t: c.t + y, r: c.r + x, b: c.b + y }));
        return [...own, ...children];
    });
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((r) => r.l));
    const top = Math.min(...rects.map((r) => r.t));
    return {
        x: left,
        y: top,
        width: Math.max(...rects.map((r) => r.r)) - left,
        height: Math.max(...rects.map((r) => r.b)) - top,
    };
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
