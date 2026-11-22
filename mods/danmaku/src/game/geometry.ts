export interface Vec {
    readonly x: number;
    readonly y: number;
}

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** min > max のときは min を返す（範囲が潰れていても値は決まる）。 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

export function rectCenter(rect: Rect): Vec {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function rectContains(rect: Rect, point: Vec, margin = 0): boolean {
    return (
        point.x >= rect.x - margin &&
        point.x <= rect.x + rect.w + margin &&
        point.y >= rect.y - margin &&
        point.y <= rect.y + rect.h + margin
    );
}

/** box を area の中へ押し込む。box が area より大きい軸は area の中央に揃える。 */
export function clampRectInto<T extends Rect>(box: T, area: Rect): T {
    const axis = (pos: number, size: number, start: number, length: number): number =>
        size >= length ? start + (length - size) / 2 : clamp(pos, start, start + length - size);
    return { ...box, x: axis(box.x, box.w, area.x, area.w), y: axis(box.y, box.h, area.y, area.h) };
}

export function circlesOverlap(a: Vec, radiusA: number, b: Vec, radiusB: number): boolean {
    const reach = radiusA + radiusB;
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < reach * reach;
}

export function distanceSq(a: Vec, b: Vec): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** 1 フレームの間に from から to へまっすぐ動く。 */
export interface Motion {
    readonly from: Vec;
    readonly to: Vec;
}

export function still(point: Vec): Motion {
    return { from: point, to: point };
}

/** from から to へ time（0〜1）の割合だけ進んだ位置。 */
export function pointAlong(motion: Motion, time: number): Vec {
    return {
        x: motion.from.x + (motion.to.x - motion.from.x) * time,
        y: motion.from.y + (motion.to.y - motion.from.y) * time,
    };
}

/**
 * 1 フレームの間にそれぞれまっすぐ動く 2 つの円が、初めて重なる時点（0 以上 1 未満の割合）。重ならなければ null。
 * 移動後の位置だけを見ると、速い弾がフレームの間に相手を通り抜けても当たらないので、
 * 相手から見た動き（線分）と円の距離で見る。ちょうど接するだけは重なりに数えない（circlesOverlap と同じ）。
 */
export function sweptContact(a: Motion, b: Motion, reach: number): number | null {
    const start = { x: a.from.x - b.from.x, y: a.from.y - b.from.y };
    const move = { x: a.to.x - b.to.x - start.x, y: a.to.y - b.to.y - start.y };
    const gap = start.x * start.x + start.y * start.y - reach * reach;
    if (gap < 0) return 0;
    const along = start.x * move.x + start.y * move.y;
    const length = move.x * move.x + move.y * move.y;
    if (length === 0 || along >= 0) return null;
    const discriminant = along * along - length * gap;
    if (discriminant <= 0) return null;
    const time = (-along - Math.sqrt(discriminant)) / length;
    return time < 1 ? time : null;
}
