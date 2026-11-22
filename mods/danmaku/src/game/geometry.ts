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
