/**
 * 遊ぶ範囲（danmaku:canvas の Entity の矩形）と、自機の当たり判定。
 * 範囲は壁の代わり: 自機はこの中から出られず、敵の弾はこの外で消える。
 */

import { circlesOverlap, distanceSq, type Rect, rectCenter, rectContains, type Vec } from './geometry';
import { BULLET_HIT_RADIUS, type EnemyBullet } from './patterns';

/** 大きさを付けていない範囲は、ワールドの既定の大きさとみなす。 */
export const DEFAULT_AREA: Rect = { x: 0, y: 0, w: 800, h: 600 };

/** 敵に体当たりしたときは、見た目より少し小さい円で判定する。 */
const BODY_HIT_SCALE = 0.7;

export interface TransformLike {
    readonly x: number;
    readonly y: number;
    readonly w?: number;
    readonly h?: number;
}

const finite = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function areaOf(transform: TransformLike | undefined): Rect {
    if (!transform) return DEFAULT_AREA;
    const w = finite(transform.w);
    const h = finite(transform.h);
    if (w <= 0 || h <= 0) return { ...DEFAULT_AREA, x: finite(transform.x), y: finite(transform.y) };
    return { x: finite(transform.x), y: finite(transform.y), w, h };
}

/** 自機が属する範囲: 中心を含む範囲。どれにも入っていなければ中心が一番近い範囲。 */
export function areaFor<T extends { readonly area: Rect }>(point: Vec, areas: readonly T[]): T | null {
    const inside = areas.find((candidate) => rectContains(candidate.area, point));
    if (inside) return inside;
    return areas.reduce<T | null>(
        (best, candidate) =>
            best === null || distanceSq(rectCenter(candidate.area), point) < distanceSq(rectCenter(best.area), point)
                ? candidate
                : best,
        null,
    );
}

export interface Body {
    readonly center: Vec;
    readonly radius: number;
}

export function shipIsHit(
    center: Vec,
    hitRadius: number,
    bullets: readonly EnemyBullet[],
    bodies: readonly Body[],
): boolean {
    return (
        bullets.some((bullet) => circlesOverlap(center, hitRadius, bullet, BULLET_HIT_RADIUS)) ||
        bodies.some((body) => circlesOverlap(center, hitRadius, body.center, body.radius * BODY_HIT_SCALE))
    );
}
